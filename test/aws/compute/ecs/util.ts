// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/util.ts

import { AwsStack } from "../../../../src/aws/aws-stack";
import { InstanceType, Vpc } from "../../../../src/aws/compute";
import * as autoscaling from "../../../../src/aws/compute/auto-scaling";
import * as ecs from "../../../../src/aws/compute/ecs";

export function addDefaultCapacityProvider(
  cluster: ecs.Cluster,
  stack: AwsStack,
  vpc: Vpc,
  props?: Omit<ecs.AsgCapacityProviderProps, "autoScalingGroup">,
) {
  const autoScalingGroup = new autoscaling.AutoScalingGroup(
    stack,
    "DefaultAutoScalingGroup",
    {
      vpc,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      instanceType: new InstanceType("t2.micro"),
    },
  );
  const provider = new ecs.AsgCapacityProvider(stack, "AsgCapacityProvider", {
    ...props,
    autoScalingGroup,
  });
  cluster.addAsgCapacityProvider(provider);
  cluster.connections.addSecurityGroup(
    ...autoScalingGroup.connections.securityGroups,
  );
}
