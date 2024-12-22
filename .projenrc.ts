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
} from "./projenrc";

// set strict node version
const nodeVersion = "20";

const project = new cdk.JsiiProject({
  name: "@envtio/base",
  npmAccess: javascript.NpmAccess.PUBLIC,
  author: "Vincent De Smet",
  authorAddress: "vincent.drl@gmail.com",
  repositoryUrl: "https://github.com/envtio/base",
  keywords: ["environment-toolkit", "beacon", "beacon-bundle"],
  defaultReleaseBranch: "main",
  typescriptVersion: "~5.4",
  jsiiVersion: "~5.4",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: "9",
  projenrcTs: true,
  prettier: true,
  eslint: true,

  // release config
  release: true,
  releaseToNpm: true,
  // disable auto generation of API reference for now
  docgen: false,

  // cdktf construct lib config
  peerDeps: [
    "cdktf@^0.20.8",
    "@cdktf/provider-aws@^19.34.0",
    "@cdktf/provider-time@^10.2.1",
    "constructs@^10.3.0",
  ],
  devDeps: [
    "cdktf@^0.20.8",
    "@cdktf/provider-aws@^19.34.0",
    "@cdktf/provider-time@^10.2.1",
    "constructs@^10.3.0",
    "@jsii/spec@^1.102.0",
    "@mrgrain/jsii-struct-builder",
    "@types/mime-types",
  ],
  bundledDeps: ["esbuild-wasm@^0.23.1", "mime-types", "change-case@^4.1.1"],

  workflowNodeVersion: nodeVersion,
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

// override harcoded jest testMatch patterns :(
// https://github.com/projen/projen/blob/8b225dcdacb3aacebf368b2e06abdbb39d62c0dc/src/javascript/jest.ts#L861
project.tryFindObjectFile("package.json")?.addOverride("jest.testMatch", [
  "<rootDir>/@(src|test)/**/*(*.)@(test).ts?(x)", // remove spec.ts from pattern
  "<rootDir>/@(src|test)/**/__tests__/**/*.ts?(x)", // default
  "<rootDir>/@(projenrc)/**/*(*.)@(test).ts?(x)", // remove spec.ts from pattern
  "<rootDir>/@(projenrc)/**/__tests__/**/*.ts?(x)", // default
]);

project.gitignore.exclude(".env");

// exclude the integration tests from the npm package
project.addPackageIgnore("/integ/");
project.tsconfigDev?.addInclude("integ/**/*.ts");

// Limit workers and disable coverage for faster test runs
project.testTask.updateStep(0, {
  exec: "jest --passWithNoTests --updateSnapshot --maxWorkers=4 --coverage=false",
  receiveArgs: true,
});

project.package.addField("packageManager", "pnpm@9.9.0"); // silence COREPACK_ENABLE_AUTO_PIN warning
project.package.addEngine("node", nodeVersion);
new TextFile(project, ".nvmrc", {
  lines: [nodeVersion],
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

project.synth();
