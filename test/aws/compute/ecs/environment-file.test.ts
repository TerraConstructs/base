// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/environment-file.test.ts

import * as path from "path";
import { s3Object } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as storage from "../../../../src/aws/storage";
import { Template } from "../../../assertions";

describe("environment file", () => {
  describe("ecs.EnvironmentFile.fromAsset", () => {
    test("fails if asset is not a single file", () => {
      // GIVEN
      const stack = new AwsStack(Testing.app({ fakeCdktfJsonPath: true }));
      const fileAsset = ecs.EnvironmentFile.fromAsset(
        path.join(__dirname, "demo-envfiles"),
      );

      // THEN
      expect(() => defineContainerDefinition(stack, fileAsset)).toThrow(
        /Asset must be a single file/,
      );
    });

    test("only one environment file asset object is created even if multiple container definitions use the same file", () => {
      // GIVEN
      // TERRACONSTRUCTS DEVIATION: upstream toggles cx-api's
      // NEW_STYLE_STACK_SYNTHESIS_CONTEXT and inspects
      // `app.synth().stacks[0].assets` -- a CDK CloudAssembly concept.
      // cdktn's `App.synth()` returns void and writes Terraform JSON straight
      // to disk; there is no in-memory assets manifest to introspect. The
      // dedup behavior under test -- AssetEnvironmentFile.bind() caches
      // `this.asset` so repeated bind() calls for the same EnvironmentFile
      // instance don't create a second Asset -- is instead observed at the
      // Terraform-resource level: only one aws_s3_object upload resource
      // should exist for the shared file even though two ContainerDefinitions
      // reference it.
      // const app = new cdk.App({ context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false } });
      // const stack = new cdk.Stack(app);
      const stack = new AwsStack(Testing.app({ fakeCdktfJsonPath: true }));
      const fileAsset = ecs.EnvironmentFile.fromAsset(
        path.join(__dirname, "demo-envfiles", "test-envfile.env"),
      );

      // WHEN
      const image = ecs.ContainerImage.fromRegistry("/aws/aws-example-app");
      const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TaskDef");
      const containerDefinitionProps: ecs.ContainerDefinitionProps = {
        environmentFiles: [fileAsset],
        image,
        memoryLimitMiB: 512,
        taskDefinition,
      };

      new ecs.ContainerDefinition(
        stack,
        "ContainerOne",
        containerDefinitionProps,
      );
      new ecs.ContainerDefinition(
        stack,
        "ContainerTwo",
        containerDefinitionProps,
      );

      // THEN
      // container one has an asset, container two does not
      Template.resources(stack, s3Object.S3Object).toHaveLength(1);
      // const assembly = app.synth();
      // const synthesized = assembly.stacks[0];
      // expect(synthesized.assets.length).toEqual(1);
    });
  });
});

describe("EnvironmentFile synth", () => {
  test("EnvironmentFile.fromAsset synth matches snapshot", () => {
    // GIVEN
    const app: App = Testing.app({ fakeCdktfJsonPath: true });
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });
    const fileAsset = ecs.EnvironmentFile.fromAsset(
      path.join(__dirname, "demo-envfiles", "test-envfile.env"),
    );

    // WHEN
    defineContainerDefinition(stack, fileAsset);

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("EnvironmentFile.fromBucket synth matches snapshot", () => {
    // GIVEN
    const app: App = Testing.app({ fakeCdktfJsonPath: true });
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });
    const bucket = new storage.Bucket(stack, "EnvFileBucket");
    const fileAsset = ecs.EnvironmentFile.fromBucket(bucket, "env/test.env");

    // WHEN
    defineContainerDefinition(stack, fileAsset);

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function defineContainerDefinition(
  stack: AwsStack,
  environmentFile: ecs.EnvironmentFile,
) {
  const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TaskDef");

  return new ecs.ContainerDefinition(stack, "Container", {
    environmentFiles: [environmentFile],
    image: ecs.ContainerImage.fromRegistry("/aws/aws-example-app"),
    memoryLimitMiB: 512,
    taskDefinition,
  });
}
