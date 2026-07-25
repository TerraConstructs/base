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
import {
  pinGitHubActions,
  postBuildSteps,
  tuneBuildWorkflow,
  tuneUpgradeWorkflow,
  workflowBootstrapSteps,
} from "./projenrc/github-workflows";

// set strict node version compatible with webcontainers.io
const nodeVersion = ">=20.9.0";
const pnpmVersion = "11.5.0";
const workflowNodeVersion = "24.12.0";

// Number of parallel shards the jest suite is split across in the PR build.
const testShardCount = 5;

// The only suite that needs a live docker daemon.
const dockerTestPath = "test/aws/compute/function-nodejs/docker.test.ts";

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
  workflowBootstrapSteps,
  postBuildSteps,

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

pinGitHubActions(project);

// NOTE: `base` is a public repo, so the standard `ubuntu-latest` runner is
// already 4 vCPU / 16GB — identical hardware to the `custom-linux-l` larger
// runner, which is billed even for public repos. The override bought nothing.
// If release ever needs to be faster, `custom-linux-xl` (8 vCPU / 32GB) is the
// size worth paying for.
tuneBuildWorkflow(project, {
  pnpmVersion,
  workflowNodeVersion,
  testShardCount,
  dockerTestPath,
});
tuneUpgradeWorkflow(project);

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

// Keep dev tooling and build by-products out of the published tarball.
//
// NOTE: gitignore.exclude() only writes .gitignore. Because package.json has no
// `files` allowlist, npm ships everything that .npmignore does not deny — so a
// gitignored path is hidden from git review while still being published. Every
// entry here needs its own addPackageIgnore() call; `tcons-staging/` above is
// exactly how this was missed (published in 0.2.12).
[
  // asset-staging synth by-product, regenerated by the test run that
  // `projen build` performs immediately before `projen package`
  "/tcons-staging/",
  // Go module for the terratest integ suite; no jsii Go target is configured,
  // and jsii-pacmak generates its own go.mod when one is
  "/go.mod",
  "/go.sum",
  // local tooling / editor config
  "/.envrc",
  "/.mise.toml",
  "/.nvmrc",
  "/.terraform-version",
  "/.terraform.d/",
  "/CLAUDE.md",
  "/pnpm-workspace.yaml",
  // jest bootstrap (jestConfig.setupFilesAfterEach), dev-only
  "/setup.js",
].forEach((pattern) => project.addPackageIgnore(pattern));

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
