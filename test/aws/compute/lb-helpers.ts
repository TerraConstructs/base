import { Construct } from "constructs";
import {
  ApplicationTargetGroup,
  IApplicationLoadBalancerTarget,
} from "../../../src/aws/compute/alb/application-target-group";
import {
  Connections,
  IConnectable,
} from "../../../src/aws/compute/connections";
import { LoadBalancerTargetProps } from "../../../src/aws/compute/lb-shared/base-target-group";
import { TargetType } from "../../../src/aws/compute/lb-shared/enums";
import {
  NetworkTargetGroup,
  INetworkLoadBalancerTarget,
} from "../../../src/aws/compute/nlb/network-target-group";
import { SecurityGroup } from "../../../src/aws/compute/security-group";
import { Vpc } from "../../../src/aws/compute/vpc";

export class FakeSelfRegisteringTarget
  extends Construct
  implements
    IApplicationLoadBalancerTarget,
    INetworkLoadBalancerTarget,
    IConnectable
{
  public readonly securityGroup: SecurityGroup;
  public readonly connections: Connections;

  constructor(scope: Construct, id: string, vpc: Vpc) {
    super(scope, id);
    this.securityGroup = new SecurityGroup(this, "SG", { vpc });
    this.connections = new Connections({
      securityGroups: [this.securityGroup],
    });
  }

  public attachToApplicationTargetGroup(
    targetGroup: ApplicationTargetGroup,
  ): LoadBalancerTargetProps {
    targetGroup.registerConnectable(this);
    return { targetType: TargetType.INSTANCE };
  }

  public attachToNetworkTargetGroup(
    _targetGroup: NetworkTargetGroup,
  ): LoadBalancerTargetProps {
    return { targetType: TargetType.INSTANCE };
  }
}
