// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/ec2/cross-stack.test.ts

import { ecsService, vpcSecurityGroupIngressRule } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import { ApplicationLoadBalancer, Vpc } from "../../../../../src/aws/compute";
import * as ecs from "../../../../../src/aws/compute/ecs";
import { Template } from "../../../../assertions";
import { addDefaultCapacityProvider } from "../util";

const gridBackendConfig = { address: "http://localhost:3000" };

// Test various cross-stack Cluster/Service/ALB scenario's

let app: App;
let stack1: AwsStack;
let stack2: AwsStack;
let cluster: ecs.Cluster;
let service: ecs.Ec2Service;

describe("cross stack", () => {
  beforeEach(() => {
    app = Testing.app();

    stack1 = new AwsStack(app, "Stack1", { gridBackendConfig });
    const vpc = new Vpc(stack1, "Vpc");
    cluster = new ecs.Cluster(stack1, "Cluster", {
      vpc,
    });
    addDefaultCapacityProvider(cluster, stack1, vpc);

    stack2 = new AwsStack(app, "Stack2", { gridBackendConfig });
    const taskDefinition = new ecs.Ec2TaskDefinition(stack2, "TD");
    const container = taskDefinition.addContainer("Main", {
      image: ecs.ContainerImage.fromRegistry("asdf"),
      memoryLimitMiB: 512,
    });
    container.addPortMappings({ containerPort: 8000 });

    service = new ecs.Ec2Service(stack2, "Service", {
      cluster,
      taskDefinition,
    });
  });

  test("ALB next to Service", () => {
    // WHEN
    const lb = new ApplicationLoadBalancer(stack2, "ALB", {
      vpc: cluster.vpc,
    });
    const listener = lb.addListener("listener", { port: 80 });
    listener.addTargets("target", {
      port: 80,
      targets: [service],
    });

    // THEN: it shouldn't throw due to cyclic dependencies
    Template.resources(stack2, ecsService.EcsService).toHaveLength(1);
    // OLD CFN: Template.fromStack(stack2).resourceCountIs('AWS::ECS::Service', 1);

    expectIngress(stack2);
  });

  test("ALB next to Cluster", () => {
    // WHEN
    const lb = new ApplicationLoadBalancer(stack1, "ALB", {
      vpc: cluster.vpc,
    });
    const listener = lb.addListener("listener", { port: 80 });
    listener.addTargets("target", {
      port: 80,
      targets: [service],
    });

    // THEN: it shouldn't throw due to cyclic dependencies
    Template.resources(stack2, ecsService.EcsService).toHaveLength(1);
    // OLD CFN: Template.fromStack(stack2).resourceCountIs('AWS::ECS::Service', 1);
    expectIngress(stack2);
  });

  test("ALB in its own stack", () => {
    // WHEN
    const stack3 = new AwsStack(app, "Stack3", { gridBackendConfig });
    const lb = new ApplicationLoadBalancer(stack3, "ALB", {
      vpc: cluster.vpc,
    });
    const listener = lb.addListener("listener", { port: 80 });
    listener.addTargets("target", {
      port: 80,
      targets: [service],
    });

    // THEN: it shouldn't throw due to cyclic dependencies
    Template.resources(stack2, ecsService.EcsService).toHaveLength(1);
    // OLD CFN: Template.fromStack(stack2).resourceCountIs('AWS::ECS::Service', 1);
    expectIngress(stack2);
  });
});

function expectIngress(stack: AwsStack) {
  // TERRACONSTRUCTS DEVIATION: cross-stack SecurityGroup references resolve
  // via a `terraform_remote_state` data source (cdktn's cross-stack
  // reference mechanism) instead of a CFN `Fn::ImportValue`. The exact
  // construct-id hash suffix folded into the remote-state output key (e.g.
  // upstream's "...InstanceSecurityGroupFBA881D0GroupId2F7C804A") is only
  // knowable by actually running synth, which this conversion pass is not
  // allowed to do -- so `security_group_id` is matched loosely on the parts
  // that are structurally guaranteed: the referencing stack id (Stack1) and
  // the `InstanceSecurityGroup` construct created by
  // addDefaultCapacityProvider() -> AutoScalingGroup.
  Template.synth(stack).toHaveResourceWithProperties(
    vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
    {
      from_port: 32768,
      to_port: 65535,
      security_group_id: expect.stringMatching(
        /^\$\{data\.terraform_remote_state\.cross-stack-reference-input-Stack1\.outputs\.cross-stack-output-aws_security_group.*InstanceSecurityGroup.*id\}$/,
      ),
    },
  );
  // OLD CFN:
  // Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
  //   FromPort: 32768,
  //   ToPort: 65535,
  //   GroupId: { 'Fn::ImportValue': 'Stack1:ExportsOutputFnGetAttDefaultAutoScalingGroupInstanceSecurityGroupFBA881D0GroupId2F7C804A' },
  // });
}

// NOTE: not part of the upstream suite - added per harness convention (see
// test/aws/notify/queue.test.ts / test/aws/compute/ecs/gelf-log-driver.test.ts
// for the idiom) to guard against emitted-Terraform drift for the cross-stack
// SecurityGroup ingress rule (via terraform_remote_state) that backs the
// EC2/bridge-mode dynamic-host-port ALB scenario exercised above.
describe("cross stack synth", () => {
  test("Should synth ALB next to Service and match SnapShot", () => {
    // GIVEN
    const synthApp = Testing.app();
    const synthStack1 = new AwsStack(synthApp, "Stack1", {
      gridBackendConfig,
    });
    const synthVpc = new Vpc(synthStack1, "Vpc");
    const synthCluster = new ecs.Cluster(synthStack1, "Cluster", {
      vpc: synthVpc,
    });
    addDefaultCapacityProvider(synthCluster, synthStack1, synthVpc);

    const synthStack2 = new AwsStack(synthApp, "Stack2", {
      gridBackendConfig,
    });
    const synthTaskDefinition = new ecs.Ec2TaskDefinition(synthStack2, "TD");
    const synthContainer = synthTaskDefinition.addContainer("Main", {
      image: ecs.ContainerImage.fromRegistry("asdf"),
      memoryLimitMiB: 512,
    });
    synthContainer.addPortMappings({ containerPort: 8000 });
    const synthService = new ecs.Ec2Service(synthStack2, "Service", {
      cluster: synthCluster,
      taskDefinition: synthTaskDefinition,
    });

    // WHEN
    const lb = new ApplicationLoadBalancer(synthStack2, "ALB", {
      vpc: synthCluster.vpc,
    });
    const listener = lb.addListener("listener", { port: 80 });
    listener.addTargets("target", {
      port: 80,
      targets: [synthService],
    });

    // THEN
    synthStack1.prepareStack(); // may generate additional resources
    synthStack2.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack1)).toMatchSnapshot();
    expect(Testing.synth(synthStack2)).toMatchSnapshot();
  });
});
