// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/deployment-lifecycle-hook-target.test.ts

import { dataAwsIamPolicyDocument, ecsService } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as iam from "../../../../src/aws/iam";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

/**
 * Grab the single synthesized resource of a given type as a plain object,
 * without hard-coding TerraConstructs' generated (hashed) logical id.
 */
function soleResource(stack: AwsStack, type: any): any {
  return Object.values(Template.resourceObjects(stack, type))[0];
}

describe("DeploymentLifecycleHookTarget", () => {
  let stack: AwsStack;
  let vpc: compute.Vpc;
  let cluster: ecs.Cluster;
  let taskDefinition: ecs.FargateTaskDefinition;
  let lambdaFunction: compute.LambdaFunction;

  beforeEach(() => {
    stack = new AwsStack(Testing.app(), "TestStack", { gridBackendConfig });
    vpc = new compute.Vpc(stack, "Vpc");
    cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    taskDefinition = new ecs.FargateTaskDefinition(stack, "FargateTaskDef");
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 80 }],
    });

    lambdaFunction = new compute.LambdaFunction(stack, "TestFunction", {
      runtime: compute.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: compute.Code.fromInline(
        'exports.handler = async () => { return { hookStatus: "SUCCEEDED" }; }',
      ),
    });
  });

  test("DeploymentLifecycleLambdaTarget creates default role when none provided", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // WHEN
    const hookTarget = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [ecs.DeploymentLifecycleStage.PRE_SCALE_UP],
      },
    );
    service.addLifecycleHook(hookTarget);

    // THEN
    // resolving the EcsService resource first synths the stack, which is what causes
    // DeploymentLifecycleLambdaTarget.bind() to run and create/populate hookTarget.role
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.deployment_configuration).toMatchObject({
      lifecycle_hook: [
        {
          lifecycle_stages: ["PRE_SCALE_UP"],
          hook_target_arn: stack.resolve(lambdaFunction.functionArn),
          role_arn: stack.resolve(hookTarget.role.roleArn),
        },
      ],
    });
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     LifecycleHooks: [
    //       {
    //         LifecycleStages: ['PRE_SCALE_UP'],
    //         HookTargetArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('TestFunction'),
    //             'Arn',
    //           ],
    //         },
    //         RoleArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('Role'),
    //             'Arn',
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_ecs.name}",
                ],
              },
            ],
          },
        ],
      },
    );
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    //   AssumeRolePolicyDocument: {
    //     Statement: [
    //       {
    //         Action: 'sts:AssumeRole',
    //         Effect: 'Allow',
    //         Principal: {
    //           Service: 'ecs.amazonaws.com',
    //         },
    //       },
    //     ],
    //   },
    // });

    // TERRACONSTRUCTS DEVIATION: the aws_iam_role_policy `policy` attribute references a
    // dataAwsIamPolicyDocument data source (rather than an inline JSON document like CFN's
    // AWS::IAM::Policy), and the second grantInvoke() resource is the provider's
    // `qualified_invoke_arn` computed attribute rather than a hand-built `Fn::Join [arn, ':*']`.
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["lambda:InvokeFunction"],
            effect: "Allow",
            resources: [
              stack.resolve(lambdaFunction.functionArn),
              stack.resolve(lambdaFunction.functionQualifiedInvokeArn),
            ],
          },
        ],
      },
    );
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: 'lambda:InvokeFunction',
    //         Effect: 'Allow',
    //         Resource: [
    //           {
    //             'Fn::GetAtt': [
    //               Match.stringLikeRegexp('TestFunction'),
    //               'Arn',
    //             ],
    //           },
    //           {
    //             'Fn::Join': [
    //               '',
    //               [
    //                 {
    //                   'Fn::GetAtt': [
    //                     Match.stringLikeRegexp('TestFunction'),
    //                     'Arn',
    //                   ],
    //                 },
    //                 ':*',
    //               ],
    //             ],
    //           },
    //         ],
    //       },
    //     ],
    //   },
    // });
  });

  test("DeploymentLifecycleLambdaTarget uses provided role", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    const customRole = new iam.Role(stack, "CustomRole", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
    });
    lambdaFunction.grantInvoke(customRole);

    // WHEN
    const hookTarget = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [ecs.DeploymentLifecycleStage.PRE_SCALE_UP],
        role: customRole,
      },
    );
    service.addLifecycleHook(hookTarget);

    // THEN
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.deployment_configuration).toMatchObject({
      lifecycle_hook: [
        {
          lifecycle_stages: ["PRE_SCALE_UP"],
          hook_target_arn: stack.resolve(lambdaFunction.functionArn),
          role_arn: stack.resolve(customRole.roleArn),
        },
      ],
    });
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     LifecycleHooks: [
    //       {
    //         LifecycleStages: ['PRE_SCALE_UP'],
    //         HookTargetArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('TestFunction'),
    //             'Arn',
    //           ],
    //         },
    //         RoleArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('CustomRole'),
    //             'Arn',
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("DeploymentLifecycleLambdaTarget supports multiple lifecycle stages", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // WHEN
    const hookTarget = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [
          ecs.DeploymentLifecycleStage.PRE_SCALE_UP,
          ecs.DeploymentLifecycleStage.POST_SCALE_UP,
          ecs.DeploymentLifecycleStage.TEST_TRAFFIC_SHIFT,
        ],
      },
    );
    service.addLifecycleHook(hookTarget);

    // THEN
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.deployment_configuration).toMatchObject({
      lifecycle_hook: [
        {
          lifecycle_stages: [
            "PRE_SCALE_UP",
            "POST_SCALE_UP",
            "TEST_TRAFFIC_SHIFT",
          ],
          hook_target_arn: stack.resolve(lambdaFunction.functionArn),
        },
      ],
    });
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     LifecycleHooks: [
    //       {
    //         LifecycleStages: ['PRE_SCALE_UP', 'POST_SCALE_UP', 'TEST_TRAFFIC_SHIFT'],
    //         HookTargetArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('TestFunction'),
    //             'Arn',
    //           ],
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("addLifecycleHook throws when not using ECS deployment controller", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY,
      },
    });

    const hookTarget = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [ecs.DeploymentLifecycleStage.PRE_SCALE_UP],
      },
    );

    // THEN
    expect(() => {
      service.addLifecycleHook(hookTarget);
    }).toThrow(
      /Deployment lifecycle hooks requires the ECS deployment controller/,
    );
  });

  test("multiple lifecycle hooks can be added to a service", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    const secondLambda = new compute.LambdaFunction(stack, "SecondFunction", {
      runtime: compute.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: compute.Code.fromInline(
        'exports.handler = async () => { return { hookStatus: "SUCCEEDED" }; }',
      ),
    });

    // WHEN
    const firstHook = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [ecs.DeploymentLifecycleStage.PRE_SCALE_UP],
      },
    );

    const secondHook = new ecs.DeploymentLifecycleLambdaTarget(
      secondLambda,
      "PostScaleUpHook",
      {
        lifecycleStages: [ecs.DeploymentLifecycleStage.POST_SCALE_UP],
      },
    );

    service.addLifecycleHook(firstHook);
    service.addLifecycleHook(secondHook);

    // THEN
    // Repo-specific: LifecycleHooks land in a deterministically-ordered TF list (insertion
    // order of addLifecycleHook() calls), so this asserts the exact array instead of upstream's
    // Match.arrayWith(Match.objectLike(...)) order-independent matching.
    const resource = soleResource(stack, ecsService.EcsService);
    expect(resource.deployment_configuration).toMatchObject({
      lifecycle_hook: [
        {
          lifecycle_stages: ["PRE_SCALE_UP"],
          hook_target_arn: stack.resolve(lambdaFunction.functionArn),
        },
        {
          lifecycle_stages: ["POST_SCALE_UP"],
          hook_target_arn: stack.resolve(secondLambda.functionArn),
        },
      ],
    });
    // OLD CFN:
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   DeploymentConfiguration: {
    //     LifecycleHooks: Match.arrayWith([
    //       Match.objectLike({
    //         LifecycleStages: ['PRE_SCALE_UP'],
    //         HookTargetArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('TestFunction'),
    //             'Arn',
    //           ],
    //         },
    //       }),
    //       Match.objectLike({
    //         LifecycleStages: ['POST_SCALE_UP'],
    //         HookTargetArn: {
    //           'Fn::GetAtt': [
    //             Match.stringLikeRegexp('SecondFunction'),
    //             'Arn',
    //           ],
    //         },
    //       }),
    //     ]),
    //   },
    // });
  });

  test("lifecycle hooks cannot be added during service creation with non-ECS deployment controller", () => {
    // GIVEN
    const hookTarget = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [ecs.DeploymentLifecycleStage.PRE_SCALE_UP],
      },
    );

    // THEN
    expect(() => {
      const service = new ecs.FargateService(stack, "FargateService", {
        cluster,
        taskDefinition,
        deploymentController: {
          type: ecs.DeploymentControllerType.CODE_DEPLOY,
        },
      });
      service.addLifecycleHook(hookTarget);
    }).toThrow(
      /Deployment lifecycle hooks requires the ECS deployment controller/,
    );
  });
});

// Repo-specific: wrapping describe with toMatchSnapshot() synth coverage (harness idiom, see
// test/aws/notify/queue.test.ts and test/aws/compute/auto-scaling/cron.test.ts), proving the
// lifecycle hook target's role + policy + `aws_ecs_service.deployment_configuration.lifecycle_hook`
// wiring stays stable across the whole synthesized stack.
describe("DeploymentLifecycleHookTarget synth", () => {
  test("default role and multiple lifecycle hooks synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack(Testing.app(), "TestStack", {
      gridBackendConfig,
    });
    const vpc = new compute.Vpc(stack, "Vpc");
    const cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    const taskDefinition = new ecs.FargateTaskDefinition(
      stack,
      "FargateTaskDef",
    );
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 80 }],
    });
    const lambdaFunction = new compute.LambdaFunction(stack, "TestFunction", {
      runtime: compute.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: compute.Code.fromInline(
        'exports.handler = async () => { return { hookStatus: "SUCCEEDED" }; }',
      ),
    });
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // WHEN
    const hookTarget = new ecs.DeploymentLifecycleLambdaTarget(
      lambdaFunction,
      "PreScaleUpHook",
      {
        lifecycleStages: [
          ecs.DeploymentLifecycleStage.PRE_SCALE_UP,
          ecs.DeploymentLifecycleStage.POST_SCALE_UP,
        ],
      },
    );
    service.addLifecycleHook(hookTarget);

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
