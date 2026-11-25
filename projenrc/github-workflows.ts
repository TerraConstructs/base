import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  // main, 2026-11-25
  "TerraConstructs/run-aws-emulator":
    "1fe3c99aa756c399e9059c6738c2006c68174169",
  // v4.1.3
  "sigstore/cosign-installer": "756fe2d284c7292c4e9b62c8a28f1e5629c59532",
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
    // keep in sync with go.mod and .mise.toml; go-version-file can't be used
    // because some jobs (package-js, release_npm) run this before checkout
    with: { "go-version": "1.27.3" },
  },
  {
    uses: pinned("oven-sh/setup-bun"),
    if: `\${{ ${LEAN_BOOTSTRAP_GATE} }}`,
    // keep in sync with .mise.toml
    with: { "bun-version": "1.4.4" },
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

export interface EmulatorWorkflowOptions {
  /** pnpm version used to compile the construct library. */
  readonly pnpmVersion: string;
  /** Node version used to compile the construct library. */
  readonly workflowNodeVersion: string;
  /** Cron expression (UTC) for the scheduled run. */
  readonly cron: string;
  /** Job timeout in minutes for the full nightly run. */
  readonly timeoutMinutes: number;
  /** Job timeout in minutes for one service on a pull request. */
  readonly pullRequestTimeoutMinutes: number;
  /**
   * Repository (`owner/name`) that runs the emulator jobs.
   *
   * Other repositories skip the jobs instead of failing.
   */
  readonly repository: string;
}

/**
 * Service directories under integ/aws that have their own Makefile.
 *
 * This is the same discovery rule as integ/emulator-all.sh, so the matrix
 * and the nightly run cover the same services. Adding a service directory
 * changes the generated workflow and needs a new `projen` run.
 */
export function emulatorServices(project: cdk.JsiiProject): string[] {
  const root = join(project.outdir, "integ", "aws");
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (e) => e.isDirectory() && existsSync(join(root, e.name, "Makefile")),
    )
    .map((e) => e.name)
    .sort();
}

/**
 * Services that run as more than one matrix leg, as `leg name -> targets`.
 *
 * The legs of a service must list every target in integ/aws/<service>/Makefile
 * exactly once; `emulatorMatrix` throws otherwise. Add a new target of a split
 * service to one leg here, then run `projen`. Services that are not listed run
 * as one leg with all targets.
 */
const EMULATOR_SPLIT_SERVICES: Record<string, Record<string, string[]>> = {
  notify: {
    "notify-sqs": [
      "queue",
      "fifo-queue",
      "source-queue-permission",
      "dlq-queue",
    ],
    "notify-stream-sns": [
      "stream",
      "stream-dashboard",
      "stream-resource-policy",
      "sns",
      "sns-lambda",
      "sns-sqs",
      "sns-url",
    ],
  },
};

/** Targets of a service: the `## Test` targets that integ/emulator-all.sh runs. */
function emulatorTargets(project: cdk.JsiiProject, service: string): string[] {
  const makefile = readFileSync(
    join(project.outdir, "integ", "aws", service, "Makefile"),
    "utf8",
  );
  return makefile
    .split("\n")
    .map((line) => /^([a-zA-Z0-9_.-]+):.*## Test/.exec(line)?.[1])
    .filter((t): t is string => !!t && t !== "all");
}

interface EmulatorLeg {
  /** Name of the leg, shown in the job name and used in the cache key. */
  readonly leg: string;
  /** Service directory under integ/aws. */
  readonly service: string;
  /** Space-separated targets to run, or an empty string for all targets. */
  readonly targets: string;
}

/** Matrix legs of the pull request job: one per service, or per split leg. */
export function emulatorMatrix(project: cdk.JsiiProject): EmulatorLeg[] {
  return emulatorServices(project).flatMap((service) => {
    const split = EMULATOR_SPLIT_SERVICES[service];
    if (!split) {
      return [{ leg: service, service, targets: "" }];
    }
    const assigned = Object.values(split).flat();
    const actual = emulatorTargets(project, service);
    const missing = actual.filter((t) => !assigned.includes(t));
    const unknown = assigned.filter((t) => !actual.includes(t));
    const duplicated = assigned.filter((t, i) => assigned.indexOf(t) !== i);
    if (missing.length || unknown.length || duplicated.length) {
      throw new Error(
        `EMULATOR_SPLIT_SERVICES.${service} is out of sync with integ/aws/${service}/Makefile: ` +
          `missing [${missing}], unknown [${unknown}], duplicated [${duplicated}]`,
      );
    }
    return Object.entries(split).map(([leg, targets]) => ({
      leg,
      service,
      targets: targets.join(" "),
    }));
  });
}

/**
 * Emulator image and signer, read from integ/emulator-image.env, the single
 * source of truth shared with integ/common.mk. See that file for how to bump.
 */
function readEmulatorConfig(): { image: string; signer: string } {
  const text = readFileSync(
    join(__dirname, "..", "integ", "emulator-image.env"),
    "utf8",
  );
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = /^([A-Z_]+)=(\S+)$/.exec(line);
    if (!match) {
      throw new Error(`integ/emulator-image.env: invalid line: ${line}`);
    }
    values[match[1]] = match[2];
  }
  for (const key of ["EMULATOR_IMAGE", "EMULATOR_IMAGE_SIGNER"]) {
    if (!values[key]) {
      throw new Error(`integ/emulator-image.env: missing ${key}`);
    }
  }
  return {
    image: values.EMULATOR_IMAGE,
    signer: values.EMULATOR_IMAGE_SIGNER,
  };
}

const { image: EMULATOR_IMAGE, signer: EMULATOR_IMAGE_SIGNER } =
  readEmulatorConfig();

/**
 * Steps that prepare a runner for `make -C integ aws-emulator`.
 *
 * Shared by the nightly workflow and the pull request job.
 */
function emulatorJobSteps(
  options: EmulatorWorkflowOptions,
  cacheLeg: string,
): JobStep[] {
  const toolSteps = workflowBootstrapSteps
    .filter((step) => /setup-(go|bun|opentofu)@/.test(step.uses ?? ""))
    .map(({ if: _gate, ...step }) =>
      /setup-go@/.test(step.uses ?? "")
        ? { ...step, with: { ...step.with, cache: false } }
        : step,
    );
  // The Go build cache holds the compiled aws-sdk-go-v2 and go-synth packages,
  // which cost 120-165 s on a cold runner. Each leg saves its own key, so legs
  // never race to save one key. Restore falls back to any leg with the same
  // go.sum, so a new leg or an edited integ test still starts warm.
  const goCacheKey = "go-emulator-${{ runner.os }}-${{ hashFiles('go.sum') }}";
  return [
    {
      name: "Checkout",
      uses: pinned("actions/checkout"),
      with: { "persist-credentials": false },
    },
    ...toolSteps,
    {
      name: "Locate Go caches",
      id: "go-cache",
      run: [
        'echo "build=$(go env GOCACHE)" >> "$GITHUB_OUTPUT"',
        'echo "mod=$(go env GOMODCACHE)" >> "$GITHUB_OUTPUT"',
      ].join("\n"),
    },
    {
      name: "Cache Go build and modules",
      uses: pinned("actions/cache"),
      with: {
        path: [
          "${{ steps.go-cache.outputs.build }}",
          "${{ steps.go-cache.outputs.mod }}",
        ].join("\n"),
        key: `${goCacheKey}-${cacheLeg}-\${{ hashFiles('integ/**/*.go') }}`,
        "restore-keys": [`${goCacheKey}-${cacheLeg}-`, `${goCacheKey}-`].join(
          "\n",
        ),
      },
    },
    {
      name: "Setup OpenTofu plugin cache",
      run: [
        'mkdir -p "$RUNNER_TEMP/tf-plugin-cache"',
        'echo "TF_PLUGIN_CACHE_DIR=$RUNNER_TEMP/tf-plugin-cache" >> "$GITHUB_ENV"',
        'echo "TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=true" >> "$GITHUB_ENV"',
      ].join("\n"),
    },
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
    // The integ apps consume the compiled lib folder, not src.
    { name: "Compile", run: "pnpm exec projen compile" },
    // The action verifies the image signature itself and needs cosign on PATH.
    {
      name: "Install cosign",
      uses: pinned("sigstore/cosign-installer"),
    },
    {
      name: "Start AWS emulator",
      id: "emulator",
      uses: pinned("TerraConstructs/run-aws-emulator"),
      with: {
        image: EMULATOR_IMAGE,
        "certificate-identity": EMULATOR_IMAGE_SIGNER,
        memory: "2g",
        "wait-timeout": "120",
      },
    },
  ];
}

/** Step that prints the emulator log when an earlier step of the job failed. */
const emulatorLogsStep: JobStep = {
  name: "Show AWS emulator logs",
  if: "failure()",
  env: { EMULATOR_CONTAINER: "${{ steps.emulator.outputs.container }}" },
  run: 'docker logs "$EMULATOR_CONTAINER"',
};

/**
 * Nightly workflow that runs the AWS integration tests against aws-emulator.
 *
 * The full run takes more than an hour, so it stays sequential and does not
 * gate pull requests. It needs a Docker daemon and no AWS credentials.
 * Targets that the emulator cannot serve are listed in integ/emulator-skip.txt.
 */
export function addEmulatorWorkflow(
  project: cdk.JsiiProject,
  options: EmulatorWorkflowOptions,
): void {
  const workflow = project.github?.addWorkflow("integ-aws-emulator");
  if (!workflow) {
    throw new Error("expected the GitHub component to be enabled");
  }
  workflow.on({
    schedule: [{ cron: options.cron }],
    workflowDispatch: {
      inputs: {
        service: {
          description:
            "Run only this service directory under integ/aws (default: all)",
          required: false,
          default: "",
        },
      },
    },
  });
  workflow.file?.addOverride("concurrency", {
    group: "integ-aws-emulator",
    "cancel-in-progress": false,
  });
  workflow.addJob("integ-aws-emulator", {
    name: "integ (aws-emulator)",
    if: `github.repository == '${options.repository}'`,
    runsOn: ["ubuntu-latest"],
    timeoutMinutes: options.timeoutMinutes,
    permissions: { contents: github.workflows.JobPermission.READ },
    steps: [
      ...emulatorJobSteps(options, "nightly"),
      {
        name: "Run AWS integration tests against aws-emulator",
        env: {
          EMULATOR_SERVICE: "${{ inputs.service }}",
          EMULATOR_EXTERNAL: "1",
        },
        run: "make -C integ aws-emulator",
      },
      emulatorLogsStep,
    ],
  });
}

/**
 * Add a job to the build workflow that runs each emulator service in parallel.
 *
 * Each matrix leg has its own runner and emulator container, started by the run-aws-emulator action. The job does not
 * depend on the `build` job: that job uploads a packaged artifact and runs for
 * longer than a compile, while the integ apps only need `lib/` from a compile
 * in the same job. Running in parallel keeps the wall time near the slowest
 * service.
 */
export function addEmulatorPullRequestJob(
  project: cdk.JsiiProject,
  options: EmulatorWorkflowOptions,
): void {
  const buildWorkflow = project.tryFindObjectFile(
    ".github/workflows/build.yml",
  );
  if (!buildWorkflow) {
    throw new Error("expected .github/workflows/build.yml to exist");
  }
  const steps = [
    ...emulatorJobSteps(options, "${{ matrix.leg }}"),
    {
      name: "Run ${{ matrix.leg }} integration tests against aws-emulator",
      env: {
        EMULATOR_SERVICE: "${{ matrix.service }}",
        EMULATOR_TARGETS: "${{ matrix.targets }}",
        EMULATOR_EXTERNAL: "1",
        EMULATOR_SKIP_SLOW: "1",
      },
      run: "make -C integ aws-emulator",
    },
    emulatorLogsStep,
  ];
  buildWorkflow.addOverride("jobs.integ-aws-emulator", {
    name: "integ (aws-emulator, ${{ matrix.leg }})",
    if: `github.repository == '${options.repository}'`,
    "runs-on": "ubuntu-latest",
    "timeout-minutes": options.pullRequestTimeoutMinutes,
    permissions: { contents: "read" },
    env: { CI: "true" },
    strategy: {
      "fail-fast": false,
      matrix: { include: emulatorMatrix(project) },
    },
    steps,
  });
}
