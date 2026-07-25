import { cdk, github } from "projen";

type JobStep = github.workflows.JobStep;

/**
 * Actions pinned to a full commit SHA.
 *
 * Version tags are mutable, so `uses: some/action@v4` is a supply-chain risk and
 * is flagged by zizmor's `unpinned-uses` rule. Keys are action names without a
 * version, which overrides every usage of that action across all Projen-managed
 * workflows. Sub-path actions (`actions/cache/restore`) resolve as their own key
 * and therefore need their own entry.
 *
 * To refresh a pin:
 *   gh api /repos/<owner>/<repo>/commits/<tag> --jq .sha
 *
 * NOTE: the two hand-written workflows (dependabot-automerge.yml,
 * dependabot-go-check.yml) are not Projen-generated and are unaffected by this
 * map; they must be pinned by editing those files directly.
 */
export const PINNED_ACTIONS: Record<string, string> = {
  // v6
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  // v4
  "actions/cache": "0057852bfaa89a56745cba8c7296529d2fc39830",
  "actions/cache/restore": "0057852bfaa89a56745cba8c7296529d2fc39830",
  "actions/cache/save": "0057852bfaa89a56745cba8c7296529d2fc39830",
  // v6
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38",
  // v5
  "actions/setup-go": "40f1582b2485089dde7abd97c1529aa768e1baff",
  // v8
  "actions/download-artifact": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  // v7
  "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  // v5
  "pnpm/action-setup": "fc06bc1257f339d1d5d8b3a19a8cae5388b55320",
  // v3
  "docker/setup-buildx-action": "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
  // v1
  "oven-sh/setup-bun": "f4d14e03ff726c06358e5557344e1da148b56cf7",
  // v1
  "opentofu/setup-opentofu": "9d84900f3238fab8cd84ce47d658d25dd008be2f",
  // v6
  "amannn/action-semantic-pull-request":
    "48f256284bd46cdaab1048c3721360e808335d50",
  // v8
  "peter-evans/create-pull-request": "5f6978faf089d4d20b00c7766989d076bb2fc7f1",
};

/**
 * Resolve an action name to its pinned `name@sha` reference.
 *
 * Steps injected through `addOverride` are raw YAML and bypass Projen's action
 * provider, so they must resolve their own pins. Using this everywhere keeps
 * PINNED_ACTIONS the single source of truth; it is idempotent for steps that do
 * also pass through the provider.
 */
function pinned(action: string): string {
  const sha = PINNED_ACTIONS[action];
  if (!sha) {
    throw new Error(`${action} is missing from PINNED_ACTIONS`);
  }
  return `${action}@${sha}`;
}

/**
 * Jobs that only compile, lint or package set LEAN_BOOTSTRAP=true to skip the
 * docker + go + bun + opentofu setup, none of which they use.
 */
const LEAN_BOOTSTRAP_GATE = "env.LEAN_BOOTSTRAP != 'true'";

const DOCKER_CACHE_HIT = "steps.docker-cache.outputs.cache-hit";
const DOCKER_IMAGE_TAR = "~/.docker-images.tar";
const DOCKER_CACHE_KEY = "docker-cache-${{ runner.os }}";

/** Only fire on pushes to main, where the docker image cache is populated. */
const ON_MAIN_PUSH =
  "${{ github.event_name == 'push' && github.ref_name == 'main' }}";

/**
 * Docker setup and caching.
 *
 * Based on the CDK's PR build workflow:
 * https://github.com/aws/aws-cdk/blob/v2.204.0/.github/workflows/pr-build.yml#L38-L58
 */
const dockerSetupSteps: JobStep[] = [
  {
    name: "set up Docker",
    uses: pinned("docker/setup-buildx-action"),
  },
  {
    name: "Load docker images",
    id: "docker-cache",
    uses: pinned("actions/cache/restore"),
    with: { path: DOCKER_IMAGE_TAR, key: DOCKER_CACHE_KEY },
  },
  {
    name: "Restore docker images",
    if: `\${{ ${DOCKER_CACHE_HIT} }}`,
    run: `docker image load --input ${DOCKER_IMAGE_TAR}`,
  },
];

/** The same steps, but skipped entirely when a job sets LEAN_BOOTSTRAP=true. */
const optionalDockerSetupSteps: JobStep[] = dockerSetupSteps.map((step) => ({
  ...step,
  if: step.if
    ? `\${{ ${LEAN_BOOTSTRAP_GATE} && ${DOCKER_CACHE_HIT} }}`
    : `\${{ ${LEAN_BOOTSTRAP_GATE} }}`,
}));

/**
 * Bootstrap steps shared by every Projen-generated workflow job.
 *
 * Every step is gated on LEAN_BOOTSTRAP so jobs that only compile, lint or
 * package can opt out. The docker image cache alone is ~860MB and costs 40-60s
 * of `docker image load` in each job that restores it.
 */
export const workflowBootstrapSteps: JobStep[] = [
  ...optionalDockerSetupSteps,
  {
    uses: pinned("actions/setup-go"),
    if: `\${{ ${LEAN_BOOTSTRAP_GATE} }}`,
    with: { "go-version": "^1.23.0" },
  },
  {
    uses: pinned("oven-sh/setup-bun"),
    if: `\${{ ${LEAN_BOOTSTRAP_GATE} }}`,
    with: { "bun-version": "1.1.26" },
  },
  {
    uses: pinned("opentofu/setup-opentofu"),
    if: `\${{ ${LEAN_BOOTSTRAP_GATE} }}`,
    with: { tofu_wrapper: false, tofu_version: "1.8.2" },
  },
];

/**
 * Repopulate the docker image cache consumed by the `test (docker)` job.
 *
 * Only ever fires in release.yml: build.yml runs on pull_request, so the
 * on-main-push condition is never true there.
 */
export const postBuildSteps: JobStep[] = [
  {
    name: "Export Docker images",
    if: ON_MAIN_PUSH,
    run: `docker image save --output ${DOCKER_IMAGE_TAR} $(docker image list --format '{{ if ne .Repository "<none>" }}{{ .Repository }}{{ if ne .Tag "<none>" }}:{{ .Tag }}{{ end }}{{ else }}{{ .ID }}{{ end }}')`,
  },
  {
    name: "Cache Docker images",
    if: ON_MAIN_PUSH,
    uses: pinned("actions/cache/save"),
    with: { path: DOCKER_IMAGE_TAR, key: DOCKER_CACHE_KEY },
  },
];

export interface BuildWorkflowTuningOptions {
  /** pnpm version used by the standalone test jobs. */
  readonly pnpmVersion: string;
  /** Node version used by the standalone test jobs. */
  readonly workflowNodeVersion: string;
  /**
   * How many parallel shards the jest suite is split across.
   *
   * Standard GitHub-hosted runners are free for public repos, so sharding
   * across more (free) machines is cheaper than one paid larger runner.
   */
  readonly testShardCount: number;
  /**
   * The only suite that needs a live docker daemon: its beforeAll does a real
   * `docker build -t esbuild ...`. It runs in its own job so the other shards
   * can skip the ~860MB docker image cache restore entirely.
   */
  readonly dockerTestPath: string;
}

/**
 * Checkout for the standalone test jobs.
 *
 * `persist-credentials: false` because these jobs check out PR-controlled code
 * and then install and execute it; leaving the token in .git/config is zizmor's
 * `artipacked` finding. Nothing downstream of these jobs uses git credentials.
 */
const checkoutStep: JobStep = {
  name: "Checkout",
  uses: pinned("actions/checkout"),
  with: {
    ref: "${{ github.event.pull_request.head.ref }}",
    repository: "${{ github.event.pull_request.head.repo.full_name }}",
    "persist-credentials": false,
  },
};

function nodeSetupSteps(options: BuildWorkflowTuningOptions): JobStep[] {
  return [
    {
      name: "Setup pnpm",
      uses: pinned("pnpm/action-setup"),
      with: { version: options.pnpmVersion },
    },
    {
      name: "Setup Node.js",
      uses: pinned("actions/setup-node"),
      with: {
        "node-version": options.workflowNodeVersion,
        "package-manager-cache": false,
      },
    },
    { name: "Install dependencies", run: "pnpm i --no-frozen-lockfile" },
  ];
}

/**
 * Split jest out of the build job into parallel shards, and trim the bootstrap
 * of jobs that do not need docker/go/bun/opentofu.
 *
 * The suite is CPU-bound with low fixed per-worker cost, so it shards cleanly;
 * and because larger runners are billed even for public repos while standard
 * runners are free, N free machines beat one paid larger runner.
 */
export function tuneBuildWorkflow(
  project: cdk.JsiiProject,
  options: BuildWorkflowTuningOptions,
): void {
  const { testShardCount, dockerTestPath } = options;
  const buildWorkflow = project.tryFindObjectFile(
    ".github/workflows/build.yml",
  );
  if (!buildWorkflow) {
    throw new Error("expected .github/workflows/build.yml to exist");
  }

  // Stop superseded pushes to a PR running to completion alongside each other.
  buildWorkflow.addOverride("concurrency", {
    group:
      "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
    "cancel-in-progress": true,
  });

  // The build job now only synthesizes, compiles, lints and packages.
  buildWorkflow.addOverride("jobs.build.env.SKIP_JEST", "true");
  buildWorkflow.addOverride("jobs.build.env.LEAN_BOOTSTRAP", "true");
  // It checks out and executes PR-controlled code, so it should not hold write.
  // The self-mutation job performs the only write, under its own same-repo gate.
  buildWorkflow.addOverride("jobs.build.permissions", { contents: "read" });
  // package-js only runs jsii-pacmak — no docker, go, bun or opentofu needed.
  buildWorkflow.addOverride("jobs.package-js.env.LEAN_BOOTSTRAP", "true");

  // jest, split across parallel shards on free standard runners.
  // NOTE: `--ci` means snapshots are NOT rewritten here; a stale snapshot fails
  // the shard instead of being silently self-mutated into the PR.
  buildWorkflow.addOverride("jobs.test", {
    name: `test (\${{ matrix.shard }}/${testShardCount})`,
    "runs-on": "ubuntu-latest",
    permissions: { contents: "read" },
    env: { CI: "true" },
    strategy: {
      "fail-fast": false,
      matrix: {
        shard: Array.from({ length: testShardCount }, (_, i) => i + 1),
      },
    },
    steps: [
      checkoutStep,
      ...nodeSetupSteps(options),
      {
        name: "Cache jest transform",
        uses: pinned("actions/cache"),
        with: {
          path: "${{ runner.temp }}/jest-cache",
          key: "jest-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ github.sha }}",
          "restore-keys": [
            "jest-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-",
            "jest-${{ runner.os }}-",
          ].join("\n"),
        },
      },
      {
        name: "test",
        run: [
          "pnpm exec jest --ci --coverage=false",
          "--cacheDirectory ${{ runner.temp }}/jest-cache",
          `--shard=\${{ matrix.shard }}/${testShardCount}`,
          `--testPathIgnorePatterns "/node_modules/" "${dockerTestPath}"`,
        ].join(" "),
      },
    ],
  });

  // The docker-backed suite, isolated so the shards above stay docker-free.
  buildWorkflow.addOverride("jobs.test-docker", {
    name: "test (docker)",
    "runs-on": "ubuntu-latest",
    permissions: { contents: "read" },
    env: { CI: "true" },
    steps: [
      checkoutStep,
      ...dockerSetupSteps,
      ...nodeSetupSteps(options),
      {
        name: "test",
        run: `pnpm exec jest --ci --coverage=false --runTestsByPath ${dockerTestPath}`,
      },
    ],
  });

  // Single aggregate check for branch protection. Requiring this instead of the
  // individual `test (n/N)` contexts keeps the ruleset stable if testShardCount
  // changes. `needs.<job>.result` is only "success" when every matrix leg passed.
  buildWorkflow.addOverride("jobs.tests", {
    name: "tests",
    needs: ["test", "test-docker"],
    if: "always()",
    "runs-on": "ubuntu-latest",
    permissions: { contents: "read" },
    steps: [
      {
        name: "Check test results",
        run: [
          'if [ "${{ needs.test.result }}" != "success" ] || [ "${{ needs.test-docker.result }}" != "success" ]; then',
          '  echo "::error::test shards: ${{ needs.test.result }}, docker tests: ${{ needs.test-docker.result }}"',
          "  exit 1",
          "fi",
        ].join("\n"),
      },
    ],
  });
}

/** Pin every Projen-managed action reference to a full commit SHA. */
export function pinGitHubActions(project: cdk.JsiiProject): void {
  for (const [action, sha] of Object.entries(PINNED_ACTIONS)) {
    project.github?.actions.set(action, `${action}@${sha}`);
  }
}

/** The upgrade job only runs npm-check-updates + pnpm i + projen synth. */
export function tuneUpgradeWorkflow(project: cdk.JsiiProject): void {
  project
    .tryFindObjectFile(".github/workflows/upgrade-main.yml")
    ?.addOverride("jobs.upgrade.env.LEAN_BOOTSTRAP", "true");
}
