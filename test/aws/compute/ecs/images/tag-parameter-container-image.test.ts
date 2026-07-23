// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/images/tag-parameter-container-image.test.ts

import { dataAwsIamPolicyDocument } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as ecs from "../../../../../src/aws/compute/ecs";
import { Repository } from "../../../../../src/aws/storage";
import { Template } from "../../../../assertions";

describe("tag parameter container image", () => {
  describe("TagParameter container image", () => {
    test("throws an error when tagParameterName() is used without binding the image", () => {
      // GIVEN
      const stack = getAwsStack();
      const repository = new Repository(stack, "Repository");
      const tagParameterContainerImage = new ecs.TagParameterContainerImage(
        repository,
      );

      // THEN
      // TERRACONSTRUCTS DEVIATION: upstream's tagParameterName getter wraps the
      // returned value in `cdk.Lazy.string({ produce: ... })`, so the "must be
      // bound first" check only fires when CloudFormation template tokens are
      // resolved (hence wrapping the getter in a CfnOutput and synth-ing via
      // Template.fromStack()). The ported getter (src/aws/compute/ecs/images/
      // tag-parameter-container-image.ts) is not lazily wrapped -- it validates
      // and throws synchronously on access -- so the throw is asserted directly.
      expect(() => {
        return tagParameterContainerImage.tagParameterName;
      }).toThrow(
        /TagParameterContainerImage must be used in a container definition when using tagParameterName/,
      );

      // OLD CFN (lazy via CfnOutput + Template.fromStack synth):
      // const stack = new cdk.Stack();
      // const repository = new ecr.Repository(stack, 'Repository');
      // const tagParameterContainerImage = new ecs.TagParameterContainerImage(repository);
      // new cdk.CfnOutput(stack, 'Output', {
      //   value: tagParameterContainerImage.tagParameterName,
      // });
      // expect(() => {
      //   Template.fromStack(stack);
      // }).toThrow(/TagParameterContainerImage must be used in a container definition when using tagParameterName/);
    });

    test("throws an error when tagParameterValue() is used without binding the image", () => {
      // GIVEN
      const stack = getAwsStack();
      const repository = new Repository(stack, "Repository");
      const tagParameterContainerImage = new ecs.TagParameterContainerImage(
        repository,
      );

      // THEN
      // TERRACONSTRUCTS DEVIATION: see tagParameterName() note above -- the
      // ported getter throws synchronously rather than lazily on CFN resolution.
      expect(() => {
        return tagParameterContainerImage.tagParameterValue;
      }).toThrow(
        /TagParameterContainerImage must be used in a container definition when using tagParameterValue/,
      );

      // OLD CFN (lazy via CfnOutput + Template.fromStack synth):
      // const stack = new cdk.Stack();
      // const repository = new ecr.Repository(stack, 'Repository');
      // const tagParameterContainerImage = new ecs.TagParameterContainerImage(repository);
      // new cdk.CfnOutput(stack, 'Output', {
      //   value: tagParameterContainerImage.tagParameterValue,
      // });
      // expect(() => {
      //   Template.fromStack(stack);
      // }).toThrow(/TagParameterContainerImage must be used in a container definition when using tagParameterValue/);
    });

    // TERRACONSTRUCTS DEVIATION: dropped -- "can be used in a cross-account manner".
    // This test exercises CDK's multi-environment App/cross-stack-reference feature
    // (a pipeline-account Stack and a service-account Stack in the same App, with CDK's
    // default stack synthesizer resolving the cross-account IAM trust policy principal
    // ARN and tagging the consuming Role with a synthesizer-computed
    // `aws-cdk:id` = `${stackName}_${hash}` value). TerraConstructs' AwsStack is
    // "constrained to a single AWS Account/Region to simulate CFN behavior" (see
    // src/aws/aws-stack.ts) and storage/ecr-repository.ts#grant() has a confirmed
    // `// TODO: Implement cross-account principal logic from CDK` -- there is no
    // ported cross-account grant/trust-policy resolution to exercise here.
    //
    // test('can be used in a cross-account manner', () => {
    //   // GIVEN
    //   const app = new cdk.App();
    //   const pipelineStack = new cdk.Stack(app, 'PipelineStack', {
    //     env: {
    //       account: 'pipeline-account',
    //       region: 'us-west-1',
    //     },
    //   });
    //   const repositoryName = 'my-ecr-repo';
    //   const repository = new ecr.Repository(pipelineStack, 'Repository', {
    //     repositoryName: repositoryName,
    //   });
    //   const tagParameterContainerImage = new ecs.TagParameterContainerImage(repository);
    //
    //   const serviceStack = new cdk.Stack(app, 'ServiceStack', {
    //     env: {
    //       account: 'service-account',
    //       region: 'us-west-1',
    //     },
    //   });
    //   const fargateTaskDefinition = new ecs.FargateTaskDefinition(serviceStack, 'ServiceTaskDefinition');
    //
    //   // WHEN
    //   fargateTaskDefinition.addContainer('Container', {
    //     image: tagParameterContainerImage,
    //   });
    //
    //   // THEN
    //   Template.fromStack(pipelineStack).hasResourceProperties('AWS::ECR::Repository', {
    //     RepositoryName: repositoryName,
    //     RepositoryPolicyText: {
    //       Statement: [{
    //         Action: [
    //           'ecr:BatchCheckLayerAvailability',
    //           'ecr:GetDownloadUrlForLayer',
    //           'ecr:BatchGetImage',
    //         ],
    //         Effect: 'Allow',
    //         Principal: {
    //           AWS: {
    //             'Fn::Join': ['', [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               ':iam::service-account:root',
    //             ]],
    //           },
    //         },
    //         Condition: {
    //           StringEquals: {
    //             'aws:PrincipalTag/aws-cdk:id': 'ServiceStack_c8a38b9d3ed0e8d960dd0d679c0bab1612dafa96f5',
    //           },
    //         },
    //       }],
    //     },
    //   });
    //
    //   Template.fromStack(serviceStack).hasResourceProperties('AWS::IAM::Policy', {
    //     PolicyDocument: Match.objectLike({
    //       Statement: Match.arrayWith([
    //         Match.objectLike({
    //           Action: [
    //             'ecr:BatchCheckLayerAvailability',
    //             'ecr:GetDownloadUrlForLayer',
    //             'ecr:BatchGetImage',
    //           ],
    //           Effect: 'Allow',
    //           Resource: {
    //             'Fn::Join': ['', [
    //               'arn:',
    //               { Ref: 'AWS::Partition' },
    //               `:ecr:us-west-1:pipeline-account:repository/${repositoryName}`,
    //             ]],
    //           },
    //         }),
    //         Match.objectLike({
    //           Action: 'ecr:GetAuthorizationToken',
    //           Effect: 'Allow',
    //           Resource: '*',
    //         }),
    //       ]),
    //     }),
    //   });
    //
    //   Template.fromStack(serviceStack).hasResourceProperties('AWS::IAM::Role', {
    //     Tags: [
    //       {
    //         Key: 'aws-cdk:id',
    //         Value: 'ServiceStack_c8a38b9d3ed0e8d960dd0d679c0bab1612dafa96f5',
    //       },
    //     ],
    //   });
    // });

    test("bound image grants ECR pull permissions to the task execution role", () => {
      // GIVEN
      const stack = getAwsStack();
      const repository = new Repository(stack, "Repository");
      const taskDefinition = new ecs.FargateTaskDefinition(
        stack,
        "ServiceTaskDefinition",
      );

      // WHEN
      taskDefinition.addContainer("Container", {
        image: new ecs.TagParameterContainerImage(repository),
      });

      // THEN
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
              ],
              effect: "Allow",
              resources: [stack.resolve(repository.repositoryArn)],
            },
            {
              actions: ["ecr:GetAuthorizationToken"],
              effect: "Allow",
              resources: ["*"],
            },
          ],
        },
      );
    });
  });
});

describe("tag parameter container image synth", () => {
  test("TagParameterContainerImage synth matches snapshot", () => {
    // GIVEN
    const app: App = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });
    const repository = new Repository(stack, "Repository");
    const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef");

    // WHEN
    taskDefinition.addContainer("web", {
      image: new ecs.TagParameterContainerImage(repository),
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app: App = Testing.app();
  return new AwsStack(app);
}
