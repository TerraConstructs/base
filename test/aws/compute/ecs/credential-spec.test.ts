// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/credential-spec.test.ts

import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as storage from "../../../../src/aws/storage";

describe("credential spec", () => {
  describe("ecs.DomainJoinedCredentialSpec", () => {
    test("returns the correct prefixId and location", () => {
      // GIVEN
      const stack = new AwsStack(Testing.app());
      const credSpecLocation = "credSpecLocation";
      const credSpec = new ecs.DomainJoinedCredentialSpec(credSpecLocation);
      const containerDefinition = defineContainerDefinition(stack, credSpec);

      // THEN
      expect(containerDefinition.credentialSpecs?.length == 1);
      expect(containerDefinition.credentialSpecs?.at(0)?.typePrefix).toEqual(
        "credentialspec",
      );
      expect(containerDefinition.credentialSpecs?.at(0)?.location).toEqual(
        credSpecLocation,
      );
    });

    describe("fromS3Bucket", () => {
      test("returns a valid version-less S3 object ARN as location", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const objectKey = "credSpec";
        const bucket = new storage.Bucket(stack, "bucket");
        const credSpec = ecs.DomainJoinedCredentialSpec.fromS3Bucket(
          bucket,
          objectKey,
        );
        const containerDefinition = defineContainerDefinition(stack, credSpec);

        // THEN
        expect(
          stack.resolve(containerDefinition.credentialSpecs?.at(0)?.location),
        ).toEqual(stack.resolve(bucket.arnForObjects(objectKey)));
      });

      test("returns a valid versioned S3 object ARN as location", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const objectKey = "credSpec";
        const bucket = new storage.Bucket(stack, "bucket");
        const credSpec = ecs.DomainJoinedCredentialSpec.fromS3Bucket(
          bucket,
          objectKey,
        );
        const containerDefinition = defineContainerDefinition(stack, credSpec);

        // THEN
        expect(
          stack.resolve(containerDefinition.credentialSpecs?.at(0)?.location),
        ).toEqual(stack.resolve(bucket.arnForObjects(objectKey)));
      });
    });

    describe("fromSsmParameter", () => {
      test("returns a valid SSM parameter ARN as location", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const parameter = new storage.StringParameter(stack, "parameter", {
          stringValue: "value",
        });
        const credSpec =
          ecs.DomainJoinedCredentialSpec.fromSsmParameter(parameter);
        const containerDefinition = defineContainerDefinition(stack, credSpec);

        // THEN
        expect(containerDefinition.credentialSpecs?.at(0)?.location).toEqual(
          parameter.parameterArn,
        );
      });
    });
  });

  describe("ecs.DomainlessCredentialSpec", () => {
    test("returns the correct prefixId and location", () => {
      // GIVEN
      const stack = new AwsStack(Testing.app());
      const credSpecLocation = "credSpecLocation";
      const credSpec = new ecs.DomainlessCredentialSpec(credSpecLocation);
      const containerDefinition = defineContainerDefinition(stack, credSpec);

      // THEN
      expect(containerDefinition.credentialSpecs?.length == 1);
      expect(containerDefinition.credentialSpecs?.at(0)?.typePrefix).toEqual(
        "credentialspecdomainless",
      );
      expect(containerDefinition.credentialSpecs?.at(0)?.location).toEqual(
        credSpecLocation,
      );
    });

    describe("fromS3Bucket", () => {
      test("fails if key name is empty", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const bucket = new storage.Bucket(stack, "bucket");

        // THEN
        expect(() =>
          ecs.DomainlessCredentialSpec.fromS3Bucket(bucket, ""),
        ).toThrow(/key is undefined/);
      });

      test("returns a valid version-less S3 object ARN as location", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const objectKey = "credSpec";
        const bucket = new storage.Bucket(stack, "bucket");
        const credSpec = ecs.DomainlessCredentialSpec.fromS3Bucket(
          bucket,
          objectKey,
        );
        const containerDefinition = defineContainerDefinition(stack, credSpec);

        // THEN
        expect(
          stack.resolve(containerDefinition.credentialSpecs?.at(0)?.location),
        ).toEqual(stack.resolve(bucket.arnForObjects(objectKey)));
      });

      test("returns a valid versioned S3 object ARN as location", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const objectKey = "credSpec";
        const bucket = new storage.Bucket(stack, "bucket");
        const credSpec = ecs.DomainlessCredentialSpec.fromS3Bucket(
          bucket,
          objectKey,
        );
        const containerDefinition = defineContainerDefinition(stack, credSpec);

        // THEN
        expect(
          stack.resolve(containerDefinition.credentialSpecs?.at(0)?.location),
        ).toEqual(stack.resolve(bucket.arnForObjects(objectKey)));
      });
    });

    describe("fromSsmParameter", () => {
      test("returns a valid SSM parameter ARN as location", () => {
        // GIVEN
        const stack = new AwsStack(Testing.app());
        const parameter = new storage.StringParameter(stack, "parameter", {
          stringValue: "value",
        });
        const credSpec =
          ecs.DomainlessCredentialSpec.fromSsmParameter(parameter);
        const containerDefinition = defineContainerDefinition(stack, credSpec);

        // THEN
        expect(containerDefinition.credentialSpecs?.at(0)?.location).toEqual(
          parameter.parameterArn,
        );
      });
    });
  });
});

function defineContainerDefinition(
  stack: AwsStack,
  credentialSpec: ecs.CredentialSpec,
) {
  const taskDefinition = new ecs.Ec2TaskDefinition(stack, "TaskDef");

  return new ecs.ContainerDefinition(stack, "Container", {
    credentialSpecs: [credentialSpec],
    image: ecs.ContainerImage.fromRegistry("/aws/aws-example-app"),
    memoryLimitMiB: 512,
    taskDefinition,
  });
}
