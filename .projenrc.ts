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
const nodeVersion = ">=20.9.0";
const workflowNodeVersion = "20.9.0";

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
    "cdktf@^0.21.0",
    "@cdktf/provider-aws@^20.1.0",
    "@cdktf/provider-time@^11.0.0",
    "@cdktf/provider-archive@^11.0.0",
    "@cdktf/provider-tls@^11.0.0",
    "@cdktf/provider-cloudinit@^11.0.0",
    "@cdktf/provider-docker@^12.0.2",
    "constructs@^10.4.2",
  ],
  devDeps: [
    "cdktf@^0.21.0",
    "@cdktf/provider-aws@^20.1.0",
    "@cdktf/provider-time@^11.0.0",
    "@cdktf/provider-archive@^11.0.0",
    "@cdktf/provider-tls@^11.0.0",
    "@cdktf/provider-cloudinit@^11.0.0",
    "@cdktf/provider-docker@^12.0.2",
    "constructs@^10.4.2",
    "@jsii/spec@^1.102.0",
    "@mrgrain/jsii-struct-builder",
    "@types/mime-types",
    "fast-check@^3.23.2",
    "delay@^5.0.0",
  ],
  bundledDeps: [
    // TODO: remove esbuild-wasm
    "esbuild-wasm@^0.23.1",
    "mime-types",
    "change-case@^4.1.1",
    "@balena/dockerignore@^1.0.2",
    "ignore@^5.3.2",
    "minimatch@^3.1.2",
  ],
  // deps: ["@balena/dockerignore@^1.0.2", "ignore@^5.3.2"],

  workflowNodeVersion,
  workflowBootstrapSteps: [
    // Docker setup and caching
    // This is based on the CDK's PR build workflow:
    // https://github.com/aws/aws-cdk/blob/v2.204.0/.github/workflows/pr-build.yml#L38-L58
    // TODO: Only run this on PR builds and pushes to main
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
      if: "${{ steps.docker-cache.outputs.cache-hit }}",
      run: "docker image load --input ~/.docker-images.tar",
    },
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
  tsJestOptions: {
    transformOptions: {
      // Skips type checking, speeds up tests significantly
      isolatedModules: true,
    },
  },

  licensed: true,
  license: "Apache-2.0",
  pullRequestTemplateContents: [
    "By submitting this pull request, I confirm that my contribution is made under the terms of the Apache 2.0 license.",
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
