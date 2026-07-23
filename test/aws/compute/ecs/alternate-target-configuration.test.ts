// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/alternate-target-configuration.test.ts

import { ecsService } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as ecs from "../../../../src/aws/compute/ecs";
import * as iam from "../../../../src/aws/iam";
import { Template } from "../../../assertions";

describe("AlternateTarget", () => {
  let stack: AwsStack;
  let vpc: compute.Vpc;
  let cluster: ecs.Cluster;
  let taskDefinition: ecs.FargateTaskDefinition;
  let blueTargetGroup: compute.ApplicationTargetGroup;
  let greenTargetGroup: compute.ApplicationTargetGroup;
  let alb: compute.ApplicationLoadBalancer;
  let listener: compute.ApplicationListener;
  let prodRule: compute.ApplicationListenerRule;
  let testRule: compute.ApplicationListenerRule;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app);
    vpc = new compute.Vpc(stack, "Vpc");
    cluster = new ecs.Cluster(stack, "EcsCluster", { vpc });
    taskDefinition = new ecs.FargateTaskDefinition(stack, "FargateTaskDef");
    taskDefinition.addContainer("web", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 80 }],
    });

    blueTargetGroup = new compute.ApplicationTargetGroup(stack, "BlueTG", {
      vpc,
      port: 80,
      targetType: compute.TargetType.IP,
    });

    greenTargetGroup = new compute.ApplicationTargetGroup(stack, "GreenTG", {
      vpc,
      port: 80,
      targetType: compute.TargetType.IP,
    });

    alb = new compute.ApplicationLoadBalancer(stack, "ALB", { vpc });
    listener = alb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.fixedResponse(200),
    });

    prodRule = new compute.ApplicationListenerRule(stack, "ProdRule", {
      listener,
      priority: 1,
      conditions: [compute.ListenerCondition.pathPatterns(["/prod"])],
      action: compute.ListenerAction.forward([blueTargetGroup]),
    });

    testRule = new compute.ApplicationListenerRule(stack, "TestRule", {
      listener,
      priority: 2,
      conditions: [compute.ListenerCondition.pathPatterns(["/test"])],
      action: compute.ListenerAction.forward([blueTargetGroup]),
    });
  });

  test("AlternateTarget creates correct configuration with production listener only", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // WHEN
    const alternateTarget = new ecs.AlternateTarget("GreenTG", {
      alternateTargetGroup: greenTargetGroup,
      productionListener:
        ecs.ListenerRuleConfiguration.applicationListenerRule(prodRule),
    });

    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
      alternateTarget,
    });
    target.attachToApplicationTargetGroup(blueTargetGroup);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsService.EcsService, {
      load_balancer: [
        {
          container_name: "web",
          container_port: 80,
          target_group_arn: stack.resolve(blueTargetGroup.targetGroupArn),
          advanced_configuration: expect.objectContaining({
            alternate_target_group_arn: stack.resolve(
              greenTargetGroup.targetGroupArn,
            ),
            production_listener_rule: stack.resolve(prodRule.listenerRuleArn),
          }),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   LoadBalancers: [
    //     {
    //       ContainerName: 'web',
    //       ContainerPort: 80,
    //       TargetGroupArn: {
    //         Ref: Match.stringLikeRegexp('BlueTG'),
    //       },
    //       AdvancedConfiguration: {
    //         AlternateTargetGroupArn: {
    //           Ref: Match.stringLikeRegexp('GreenTG'),
    //         },
    //         ProductionListenerRule: {
    //           Ref: Match.stringLikeRegexp('ProdRule'),
    //         },
    //         TestListenerRule: Match.absent(),
    //       },
    //     },
    //   ],
    // });

    // `test_listener_rule` has no TF equivalent of `Match.absent()` on a
    // partial-match assertion (toHaveResourceWithProperties only checks the
    // subset of keys given), so assert it directly on the resolved resource.
    const [svc] = Object.values(
      Template.resourceObjects(stack, ecsService.EcsService),
    ) as any[];
    expect(
      svc.load_balancer[0].advanced_configuration.test_listener_rule,
    ).toBeUndefined();
  });

  test("AlternateTarget creates correct configuration with both production and test listeners", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // WHEN
    const alternateTarget = new ecs.AlternateTarget("GreenTG", {
      alternateTargetGroup: greenTargetGroup,
      productionListener:
        ecs.ListenerRuleConfiguration.applicationListenerRule(prodRule),
      testListener:
        ecs.ListenerRuleConfiguration.applicationListenerRule(testRule),
    });

    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
      alternateTarget,
    });
    target.attachToApplicationTargetGroup(blueTargetGroup);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsService.EcsService, {
      load_balancer: [
        {
          container_name: "web",
          container_port: 80,
          target_group_arn: stack.resolve(blueTargetGroup.targetGroupArn),
          advanced_configuration: expect.objectContaining({
            alternate_target_group_arn: stack.resolve(
              greenTargetGroup.targetGroupArn,
            ),
            production_listener_rule: stack.resolve(prodRule.listenerRuleArn),
            test_listener_rule: stack.resolve(testRule.listenerRuleArn),
          }),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   LoadBalancers: [
    //     {
    //       ContainerName: 'web',
    //       ContainerPort: 80,
    //       TargetGroupArn: {
    //         Ref: Match.stringLikeRegexp('BlueTG'),
    //       },
    //       AdvancedConfiguration: {
    //         AlternateTargetGroupArn: {
    //           Ref: Match.stringLikeRegexp('GreenTG'),
    //         },
    //         ProductionListenerRule: {
    //           Ref: Match.stringLikeRegexp('ProdRule'),
    //         },
    //         TestListenerRule: {
    //           Ref: Match.stringLikeRegexp('TestRule'),
    //         },
    //       },
    //     },
    //   ],
    // });
  });

  test("AlternateTarget creates correct configuration with custom role", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    const customRole = new iam.Role(stack, "CustomRole", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          stack,
          "AmazonECSInfrastructureRolePolicyForLoadBalancers",
          "AmazonECSInfrastructureRolePolicyForLoadBalancers",
        ),
      ],
    });

    // WHEN
    const alternateTarget = new ecs.AlternateTarget("GreenTG", {
      alternateTargetGroup: greenTargetGroup,
      productionListener:
        ecs.ListenerRuleConfiguration.applicationListenerRule(prodRule),
      role: customRole,
    });

    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
      alternateTarget,
    });
    target.attachToApplicationTargetGroup(blueTargetGroup);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsService.EcsService, {
      load_balancer: [
        {
          container_name: "web",
          container_port: 80,
          target_group_arn: stack.resolve(blueTargetGroup.targetGroupArn),
          advanced_configuration: {
            alternate_target_group_arn: stack.resolve(
              greenTargetGroup.targetGroupArn,
            ),
            production_listener_rule: stack.resolve(prodRule.listenerRuleArn),
            role_arn: stack.resolve(customRole.roleArn),
          },
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   LoadBalancers: [
    //     {
    //       ContainerName: 'web',
    //       ContainerPort: 80,
    //       TargetGroupArn: {
    //         Ref: Match.stringLikeRegexp('BlueTG'),
    //       },
    //       AdvancedConfiguration: {
    //         AlternateTargetGroupArn: {
    //           Ref: Match.stringLikeRegexp('GreenTG'),
    //         },
    //         ProductionListenerRule: {
    //           Ref: Match.stringLikeRegexp('ProdRule'),
    //         },
    //         RoleArn: {
    //           'Fn::GetAtt': [
    //             'CustomRole6D8E6809',
    //             'Arn',
    //           ],
    //         },
    //       },
    //     },
    //   ],
    // });
  });

  test("NetworkListenerConfiguration works with NLB listeners", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    const nlb = new compute.NetworkLoadBalancer(stack, "NLB", { vpc });
    const nlbListener = nlb.addListener("NlbListener", { port: 80 });

    const nlbBlueTargetGroup = new compute.NetworkTargetGroup(
      stack,
      "NlbBlueTG",
      {
        vpc,
        port: 80,
        targetType: compute.TargetType.IP,
      },
    );

    const nlbGreenTargetGroup = new compute.NetworkTargetGroup(
      stack,
      "NlbGreenTG",
      {
        vpc,
        port: 80,
        targetType: compute.TargetType.IP,
      },
    );

    nlbListener.addAction("DefaultAction", {
      action: compute.NetworkListenerAction.forward([nlbBlueTargetGroup]),
    });

    // WHEN
    const alternateTarget = new ecs.AlternateTarget("GreenTG", {
      alternateTargetGroup: nlbGreenTargetGroup,
      productionListener:
        ecs.ListenerRuleConfiguration.networkListener(nlbListener),
    });

    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
      alternateTarget,
    });
    target.attachToNetworkTargetGroup(nlbBlueTargetGroup);

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(ecsService.EcsService, {
      load_balancer: [
        {
          container_name: "web",
          container_port: 80,
          target_group_arn: stack.resolve(nlbBlueTargetGroup.targetGroupArn),
          advanced_configuration: expect.objectContaining({
            alternate_target_group_arn: stack.resolve(
              nlbGreenTargetGroup.targetGroupArn,
            ),
            production_listener_rule: stack.resolve(nlbListener.listenerArn),
          }),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   LoadBalancers: [
    //     {
    //       ContainerName: 'web',
    //       ContainerPort: 80,
    //       TargetGroupArn: {
    //         Ref: Match.stringLikeRegexp('NlbBlueTG'),
    //       },
    //       AdvancedConfiguration: {
    //         AlternateTargetGroupArn: {
    //           Ref: Match.stringLikeRegexp('NlbGreenTG'),
    //         },
    //         ProductionListenerRule: {
    //           Ref: Match.stringLikeRegexp('NlbListener'),
    //         },
    //       },
    //     },
    //   ],
    // });
  });

  test("Service without alternate target works correctly (regression test)", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    // WHEN - No alternate target provided
    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
    });
    target.attachToApplicationTargetGroup(blueTargetGroup);

    // THEN - Should not have AdvancedConfiguration
    Template.synth(stack).toHaveResourceWithProperties(ecsService.EcsService, {
      load_balancer: [
        {
          container_name: "web",
          container_port: 80,
          target_group_arn: stack.resolve(blueTargetGroup.targetGroupArn),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   LoadBalancers: [
    //     {
    //       ContainerName: 'web',
    //       ContainerPort: 80,
    //       TargetGroupArn: {
    //         Ref: Match.stringLikeRegexp('BlueTG'),
    //       },
    //       AdvancedConfiguration: Match.absent(),
    //     },
    //   ],
    // });

    const [svc] = Object.values(
      Template.resourceObjects(stack, ecsService.EcsService),
    ) as any[];
    expect(svc.load_balancer[0].advanced_configuration).toBeUndefined();
  });

  test("Service without alternate target works with NLB (regression test)", () => {
    // GIVEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });

    new compute.NetworkLoadBalancer(stack, "NLB", { vpc });
    const nlbBlueTargetGroup = new compute.NetworkTargetGroup(
      stack,
      "NlbBlueTG",
      {
        vpc,
        port: 80,
        targetType: compute.TargetType.IP,
      },
    );

    // WHEN - No alternate target provided
    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
    });
    target.attachToNetworkTargetGroup(nlbBlueTargetGroup);

    // THEN - Should not have AdvancedConfiguration
    Template.synth(stack).toHaveResourceWithProperties(ecsService.EcsService, {
      load_balancer: [
        {
          container_name: "web",
          container_port: 80,
          target_group_arn: stack.resolve(nlbBlueTargetGroup.targetGroupArn),
        },
      ],
    });
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::Service', {
    //   LoadBalancers: [
    //     {
    //       ContainerName: 'web',
    //       ContainerPort: 80,
    //       TargetGroupArn: {
    //         Ref: Match.stringLikeRegexp('NlbBlueTG'),
    //       },
    //       AdvancedConfiguration: Match.absent(),
    //     },
    //   ],
    // });

    const [svc] = Object.values(
      Template.resourceObjects(stack, ecsService.EcsService),
    ) as any[];
    expect(svc.load_balancer[0].advanced_configuration).toBeUndefined();
  });
});

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts and test/aws/compute/ecs/app-mesh-proxy-configuration.test.ts
// for the harness idiom) - guards against emitted-Terraform drift for the
// `advanced_configuration` block on `aws_ecs_service.load_balancer`.
describe("AlternateTarget snapshot", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app: App = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });

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

    const blueTargetGroup = new compute.ApplicationTargetGroup(
      stack,
      "BlueTG",
      {
        vpc,
        port: 80,
        targetType: compute.TargetType.IP,
      },
    );
    const greenTargetGroup = new compute.ApplicationTargetGroup(
      stack,
      "GreenTG",
      {
        vpc,
        port: 80,
        targetType: compute.TargetType.IP,
      },
    );

    const alb = new compute.ApplicationLoadBalancer(stack, "ALB", { vpc });
    const listener = alb.addListener("Listener", {
      port: 80,
      defaultAction: compute.ListenerAction.fixedResponse(200),
    });
    const prodRule = new compute.ApplicationListenerRule(stack, "ProdRule", {
      listener,
      priority: 1,
      conditions: [compute.ListenerCondition.pathPatterns(["/prod"])],
      action: compute.ListenerAction.forward([blueTargetGroup]),
    });

    // WHEN
    const service = new ecs.FargateService(stack, "FargateService", {
      cluster,
      taskDefinition,
    });
    const alternateTarget = new ecs.AlternateTarget("GreenTG", {
      alternateTargetGroup: greenTargetGroup,
      productionListener:
        ecs.ListenerRuleConfiguration.applicationListenerRule(prodRule),
    });
    const target = service.loadBalancerTarget({
      containerName: "web",
      containerPort: 80,
      alternateTarget,
    });
    target.attachToApplicationTargetGroup(blueTargetGroup);

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
