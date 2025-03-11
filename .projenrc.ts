import { cdk, javascript, TextFile } from "projen";
import {
  AwsProviderStructBuilder,
  LambdaFunctionVpcConfigStructBuilder,
  S3BucketWebsiteConfigurationConfigStructBuilder,
  S3BucketCorsConfigurationConfigStructBuilder,
  S3BucketLifecycleConfigurationRuleStructBuilder,
  SqsQueueConfigStructBuilder,
  PolicyDocumentStatementStructBuilder,
  PolicyDocumentConfigStructBuilder,
  LbListenerConfigStructBuilder,
  LbTargetGroupAttachmentConfigStructBuilder,
} from "./projenrc";

// set strict node version compatible with webcontainers.io
const nodeVersion = ">=18.18.0";
const workflowNodeVersion = "18.20.5";

const project = new cdk.JsiiProject({
  name: "terraconstructs",
  npmAccess: javascript.NpmAccess.PUBLIC,
  author: "Vincent De Smet",
  authorAddress: "vincent.drl@gmail.com",
  repositoryUrl: "https://github.com/TerraConstructs/base",
  keywords: ["terraconstructs"],
  defaultReleaseBranch: "main",
  typescriptVersion: "~5.7",
  jsiiVersion: "~5.7",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: "9",
  projenrcTs: true,
  prettier: true,
  eslint: true,
  tsconfig: {
    compilerOptions: {
      target: "ES2020",
      lib: ["es2020"],
    },
  },

  // release config
  release: true,
  releaseToNpm: true,
  // disable auto generation of API reference for now
  docgen: false,

  // cdktf construct lib config
  peerDeps: [
    "cdktf@^0.20.8",
    "@cdktf/provider-aws@^19.54.0",
    "@cdktf/provider-time@^10.2.1",
    "@cdktf/provider-tls@10.0.1",
    "@cdktf/provider-cloudinit@10.0.3",
    "constructs@^10.3.0",
  ],
  devDeps: [
    "cdktf@^0.20.8",
    "@cdktf/provider-aws@^19.54.0",
    "@cdktf/provider-time@^10.2.1",
    "@cdktf/provider-tls@10.0.1",
    "@cdktf/provider-cloudinit@10.0.3",
    "constructs@^10.3.0",
    "@jsii/spec@^1.102.0",
    "@mrgrain/jsii-struct-builder",
    "@types/mime-types",
  ],
  bundledDeps: ["esbuild-wasm@^0.23.1", "mime-types", "change-case@^4.1.1"],

  workflowNodeVersion,
  workflowBootstrapSteps: [
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
      with: {
        "go-version": "^1.23.0",
      },
    },
    {
      uses: "oven-sh/setup-bun@v1",
      with: {
        "bun-version": "1.1.26",
      },
    },
    {
      uses: "opentofu/setup-opentofu@v1",
      with: {
        tofu_wrapper: false,
        tofu_version: "1.8.2",
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
  tsJestOptions: {
    transformOptions: {
      // Skips type checking, speeds up tests significantly
      isolatedModules: true,
    },
  },

  licensed: true,
  license: "GPL-3.0-or-later",
  pullRequestTemplateContents: [
    "By submitting this pull request, I confirm that my contribution is made under the terms of the GPL-3.0-or-later license.",
  ],

  // disable autoMerge for now
  autoMerge: false,
});

project.prettier?.addIgnorePattern("*.generated.ts");

project.gitignore.exclude(".env");

// exclude the integration tests from the npm package
project.addPackageIgnore("/integ/");
project.tsconfigDev?.addInclude("integ/**/*.ts");

// Temp disable coverage for faster test runs
project.testTask.updateStep(0, {
  exec: "jest --passWithNoTests --updateSnapshot --coverage=false",
  receiveArgs: true,
});

project.package.addField("packageManager", "pnpm@9.9.0"); // silence COREPACK_ENABLE_AUTO_PIN warning
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
new SqsQueueConfigStructBuilder(project);
new LbListenerConfigStructBuilder(project);
new LbTargetGroupAttachmentConfigStructBuilder(project);

project.synth();
