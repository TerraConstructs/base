import { cdk, javascript, ReleasableCommits, TextFile } from "projen";
import {
  AwsProviderStructBuilder,
  LambdaFunctionVpcConfigStructBuilder,
  S3BucketWebsiteConfigurationConfigStructBuilder,
  S3BucketCorsConfigurationConfigStructBuilder,
  S3BucketLifecycleConfigurationRuleStructBuilder,
  PolicyDocumentStatementStructBuilder,
  PolicyDocumentConfigStructBuilder,
  LbListenerConfigStructBuilder,
  LbTargetGroupAttachmentConfigStructBuilder,
} from "./projenrc";

// set strict node version compatible with webcontainers.io
const nodeVersion = ">=20.9.0";
const pnpmVersion = "11.5.0";
const workflowNodeVersion = "24.12.0";

// Number of parallel shards the jest suite is split across in the PR build.
// Standard GitHub-hosted runners are free for public repos, so sharding across
// more (free) machines is cheaper than one paid larger runner.
const testShardCount = 5;

// The only suite that needs a live docker daemon: its beforeAll does a real
// `docker build -t esbuild ...`. It runs in its own job so the other shards can
// skip the ~860MB docker image cache restore entirely.
const dockerTestPath = "test/aws/compute/function-nodejs/docker.test.ts";

// Jobs that only compile/lint/package set LEAN_BOOTSTRAP=true to skip the
// docker + go + bun + opentofu setup, none of which they use.
const leanBootstrapGate = "env.LEAN_BOOTSTRAP != 'true'";

const dockerCacheHit = "steps.docker-cache.outputs.cache-hit";

// Docker setup and caching
// This is based on the CDK's PR build workflow:
// https://github.com/aws/aws-cdk/blob/v2.204.0/.github/workflows/pr-build.yml#L38-L58
const dockerSetupSteps = [
  {
    name: "set up Docker",
    uses: "docker/setup-buildx-action@v3",
  },
  {
    name: "Load docker images",
    id: "docker-cache",
    uses: "actions/cache/restore@v4",
    with: {
      path: "~/.docker-images.tar",
      key: "docker-cache-${{ runner.os }}",
    },
  },
  {
    name: "Restore docker images",
    if: `\${{ ${dockerCacheHit} }}`,
    run: "docker image load --input ~/.docker-images.tar",
  },
];

// The same steps, but skipped entirely when a job sets LEAN_BOOTSTRAP=true.
const optionalDockerSetupSteps = dockerSetupSteps.map((step, i) => ({
  ...step,
  if:
    i === 2
      ? `\${{ ${leanBootstrapGate} && ${dockerCacheHit} }}`
      : `\${{ ${leanBootstrapGate} }}`,
}));

const checkoutStep = {
  name: "Checkout",
  uses: "actions/checkout@v6",
  with: {
    ref: "${{ github.event.pull_request.head.ref }}",
    repository: "${{ github.event.pull_request.head.repo.full_name }}",
  },
};

const nodeSetupSteps = [
  {
    name: "Setup pnpm",
    uses: "pnpm/action-setup@v5",
    with: { version: pnpmVersion },
  },
  {
    name: "Setup Node.js",
    uses: "actions/setup-node@v6",
    with: {
      "node-version": workflowNodeVersion,
      "package-manager-cache": false,
    },
  },
  {
    name: "Install dependencies",
    run: "pnpm i --no-frozen-lockfile",
  },
];

const project = new cdk.JsiiProject({
  name: "terraconstructs",
  npmAccess: javascript.NpmAccess.PUBLIC,
  author: "Vincent De Smet",
  authorAddress: "vincent.drl@gmail.com",
  repositoryUrl: "https://github.com/TerraConstructs/base",
  keywords: ["terraconstructs"],
  defaultReleaseBranch: "main",
  typescriptVersion: "~5.9",
  jsiiVersion: "~5.9",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion,
  projenrcTs: true,
  prettier: true,
  eslint: true,
  tsconfig: {
    compilerOptions: {
      // jsii strict tsconfig validation requires es2022
      target: "ES2022",
      lib: ["es2022"],
      isolatedModules: true,
    },
  },

  // release config
  release: true,
  releaseToNpm: true,
  npmTrustedPublishing: true,
  // Only release when there are feat: or fix: commits (not chore:, ci:, etc.)
  // Default is everyCommit() which triggers releases even for chore commits
  releasableCommits: ReleasableCommits.featuresAndFixes(),
  // disable auto generation of API reference for now
  docgen: false,

  // cdktn construct lib config
  peerDeps: [
    "cdktn@^0.23.0",
    "@cdktn/provider-aws@^24.8.0",
    "@cdktn/provider-time@^13.1.0",
    "@cdktn/provider-archive@^13.1.0",
    "@cdktn/provider-tls@^13.1.0",
    "@cdktn/provider-cloudinit@^13.1.0",
    "@cdktn/provider-docker@^15.3.0",
    "constructs@^10.6.0",
    "@aws-cdk/cloud-assembly-schema@^49.4.0",
    "@aws-cdk/region-info@^2.233.0",
  ],
  devDeps: [
    "cdktn@^0.23.0",
    "@cdktn/provider-aws@^24.8.0",
    "@cdktn/provider-time@^13.1.0",
    "@cdktn/provider-archive@^13.1.0",
    "@cdktn/provider-tls@^13.1.0",
    "@cdktn/provider-cloudinit@^13.1.0",
    "@cdktn/provider-docker@^15.3.0",
    "constructs@^10.6.0",
    "@aws-cdk/cloud-assembly-schema@^49.4.0",
    "@aws-cdk/region-info@^2.233.0",
    "@jsii/spec@^1.102.0",
    "@mrgrain/jsii-struct-builder",
    "@types/mime-types",
    "fast-check@^3.23.2",
    "delay@^5.0.0",
    // TODO: replace eslint/prettier headacheswith biome
    // pinned due to https://prettier.io/blog/2025/11/27/3.7.0
    "prettier@3.3.3", // Exact pin, no caret
    "eslint-plugin-prettier@5.2.1", // Match version from before upgrade
  ],
  bundledDeps: [
    "mime-types",
    "change-case@^4.1.1",
    "@balena/dockerignore@^1.0.2",
    "ignore@^5.3.2",
    "minimatch@^10.2.5",
  ],
  // deps: ["@balena/dockerignore@^1.0.2", "ignore@^5.3.2"],

  workflowNodeVersion,
  // Every step here is gated on LEAN_BOOTSTRAP so jobs that only compile, lint
  // or package (build, package-js) can opt out. The docker image cache alone is
  // ~860MB and costs 40-60s of `docker image load` per job that restores it.
  workflowBootstrapSteps: [
    ...optionalDockerSetupSteps,
    // // use individual setup actions for tool specific caching
    // {
    //   uses: "jdx/mise-action@v2",
    //   with: {
    //     version: "2024.9.9",
    //     cache: true,
    //     install_args: ["bun", "node", "go", "opentofu"].join(" "),
    //   },
    // },
    {
      uses: "actions/setup-go@v5",
      if: `\${{ ${leanBootstrapGate} }}`,
      with: {
        "go-version": "^1.23.0",
      },
    },
    {
      uses: "oven-sh/setup-bun@v1",
      if: `\${{ ${leanBootstrapGate} }}`,
      with: {
        "bun-version": "1.1.26",
      },
    },
    {
      uses: "opentofu/setup-opentofu@v1",
      if: `\${{ ${leanBootstrapGate} }}`,
      with: {
        tofu_wrapper: false,
        tofu_version: "1.8.2",
      },
    },
  ],
  postBuildSteps: [
    // NOTE: Conditions required to ensure this only runs on pushes to main
    {
      name: "Export Docker images",
      if: "${{ github.event_name == 'push' && github.ref_name == 'main' }}",
      run: 'docker image save --output ~/.docker-images.tar $(docker image list --format \'{{ if ne .Repository "<none>" }}{{ .Repository }}{{ if ne .Tag "<none>" }}:{{ .Tag }}{{ end }}{{ else }}{{ .ID }}{{ end }}\')',
    },
    {
      name: "Cache Docker images",
      if: "${{ github.event_name == 'push' && github.ref_name == 'main' }}",
      uses: "actions/cache/save@v4",
      with: {
        path: "~/.docker-images.tar",
        key: "docker-cache-${{ runner.os }}",
      },
    },
  ],

  jestOptions: {
    jestConfig: {
      setupFilesAfterEnv: ["<rootDir>/setup.js"],
      // Jest is resource greedy so this shouldn't be more than 50%
      maxWorkers: "50%",
      testEnvironment: "node",
    },
  },

  licensed: true,
  license: "Apache-2.0",
  pullRequestTemplateContents: [
    "By submitting this pull request, I confirm that my contribution is made under the terms of the Apache 2.0 license.",
  ],

  // disable autoMerge for now
  autoMerge: false,

  // Exclude pinned packages from automatic upgrades
  // prettier 3.7+ has breaking formatting changes: https://prettier.io/blog/2025/11/27/3.7.0
  depsUpgradeOptions: {
    exclude: ["prettier", "eslint-plugin-prettier"],
  },
});

new TextFile(project, "pnpm-workspace.yaml", {
  lines: ["allowBuilds:", "  unrs-resolver: true", "nodeLinker: hoisted"],
});

// Pin actions/upload-artifact to a full commit SHA to satisfy the workflow
// security policy (zizmor unpinned-uses). v7 -> 043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
project.github?.actions.set(
  "actions/upload-artifact",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
);

// NOTE: `base` is a public repo, so the standard `ubuntu-latest` runner is
// already 4 vCPU / 16GB — identical hardware to the `custom-linux-l` larger
// runner, which is billed even for public repos. The override bought nothing.
// If release ever needs to be faster, `custom-linux-xl` (8 vCPU / 32GB) is the
// size worth paying for.

const buildWorkflow = project.tryFindObjectFile(".github/workflows/build.yml");

// Stop superseded pushes to a PR from running to completion alongside each other.
buildWorkflow?.addOverride("concurrency", {
  group:
    "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
  "cancel-in-progress": true,
});

// The build job now only synthesizes, compiles, lints and packages.
buildWorkflow?.addOverride("jobs.build.env.SKIP_JEST", "true");
buildWorkflow?.addOverride("jobs.build.env.LEAN_BOOTSTRAP", "true");
// package-js only runs jsii-pacmak — no docker, go, bun or opentofu needed.
buildWorkflow?.addOverride("jobs.package-js.env.LEAN_BOOTSTRAP", "true");

// jest, split across parallel shards on free standard runners.
// NOTE: `--ci` means snapshots are NOT rewritten here; a stale snapshot fails
// the shard instead of being silently self-mutated into the PR.
buildWorkflow?.addOverride("jobs.test", {
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
    ...nodeSetupSteps,
    {
      name: "Cache jest transform",
      uses: "actions/cache@v4",
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
buildWorkflow?.addOverride("jobs.test-docker", {
  name: "test (docker)",
  "runs-on": "ubuntu-latest",
  permissions: { contents: "read" },
  env: { CI: "true" },
  steps: [
    checkoutStep,
    ...dockerSetupSteps,
    ...nodeSetupSteps,
    {
      name: "test",
      run: `pnpm exec jest --ci --coverage=false --runTestsByPath ${dockerTestPath}`,
    },
  ],
});

// Single aggregate check for branch protection. Requiring this instead of the
// individual `test (n/5)` contexts keeps the ruleset stable if testShardCount
// changes. `needs.<job>.result` is only "success" when every matrix leg passed.
buildWorkflow?.addOverride("jobs.tests", {
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

// The upgrade job only runs npm-check-updates + pnpm i + projen synth.
const upgradeWorkflow = project.tryFindObjectFile(
  ".github/workflows/upgrade-main.yml",
);
upgradeWorkflow?.addOverride("jobs.upgrade.env.LEAN_BOOTSTRAP", "true");

project.prettier?.addIgnorePattern("*.generated.ts");
project.eslint?.addRules({
  curly: "off",
});

project.gitignore.exclude(".env");
// asset-staging synth by-product (src/asset-staging.ts TERRACONSTRUCTS_STAGING_DIRECTORY)
project.gitignore.exclude("tcons-staging/");

// exclude the integration tests from the npm package
project.addPackageIgnore("/integ/");
project.tsconfigDev?.addInclude("integ/**/*.ts");

// Temp disable coverage for faster test runs.
// SKIP_JEST lets the PR build job run `projen build` for compile/lint/package
// only, while jest runs in parallel shards (see jobs.test in build.yml).
// `projen test` locally, and the release workflow, still run the full suite.
project.testTask.updateStep(0, {
  exec: "jest --passWithNoTests --updateSnapshot --coverage=false",
  receiveArgs: true,
  condition: 'node -e "if (process.env.SKIP_JEST) process.exit(1)"',
});

project.package.addField("packageManager", `pnpm@${pnpmVersion}`); // silence COREPACK_ENABLE_AUTO_PIN warning
project.package.addEngine("node", nodeVersion);
new TextFile(project, ".nvmrc", {
  lines: [workflowNodeVersion],
});

// required to support bundled dependencies
// https://github.com/pnpm/pnpm/issues/844#issuecomment-1120104431
project.npmrc?.addConfig("node-linker", "hoisted");

new AwsProviderStructBuilder(project);
new PolicyDocumentStatementStructBuilder(project);
new PolicyDocumentConfigStructBuilder(project);
new LambdaFunctionVpcConfigStructBuilder(project);
new S3BucketWebsiteConfigurationConfigStructBuilder(project);
new S3BucketCorsConfigurationConfigStructBuilder(project);
new S3BucketLifecycleConfigurationRuleStructBuilder(project);
new LbListenerConfigStructBuilder(project);
new LbTargetGroupAttachmentConfigStructBuilder(project);

// Copy non-TypeScript resource files (e.g., .vtl templates) to lib/ after compilation
project.compileTask.exec(
  'find src -name "*.vtl" -or -name "Dockerfile" -type f -exec sh -c \'mkdir -p "lib/$(dirname "${1#src/}")" && cp "$1" "lib/${1#src/}"\' _ {} \\;',
);

project.synth();
