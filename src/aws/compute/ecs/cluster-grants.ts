// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/cluster-grants.ts

import type { ICluster } from "./cluster";
import { ArnFormat } from "../../arn";
import { AwsStack } from "../../aws-stack";
import * as iam from "../../iam";
// TERRACONSTRUCTS DEVIATION: upstream types this against `ecs.IClusterRef` (the CFN-generated
// cross-language "resource reference" interface from `./ecs.generated`, resolved via
// `resource.clusterRef.clusterName`). TerraConstructs has no CFN L1 layer and does not port that
// reference-object indirection, so this is typed directly against the L2 `ICluster` (defined in
// `./cluster`) and reads `clusterName` straight off it.

/**
 * Properties for ClusterGrants
 */
interface ClusterGrantsProps {
  /**
   * The resource on which actions will be allowed
   */
  readonly resource: ICluster;
}

/**
 * Collection of grant methods for a ICluster
 */
export class ClusterGrants {
  /**
   * Creates grants for ClusterGrants
   */
  public static fromCluster(resource: ICluster): ClusterGrants {
    return new ClusterGrants({
      resource: resource,
    });
  }

  protected readonly resource: ICluster;

  private constructor(props: ClusterGrantsProps) {
    this.resource = props.resource;
  }

  /**
   * Grants an ECS Task Protection API permission to the specified grantee.
   * This method provides a streamlined way to assign the 'ecs:UpdateTaskProtection'
   * permission, enabling the grantee to manage task protection in the ECS cluster.
   */
  public taskProtection(grantee: iam.IGrantable): iam.Grant {
    const actions = ["ecs:UpdateTaskProtection"];
    return iam.Grant.addToPrincipal({
      actions: actions,
      grantee: grantee,
      resourceArns: [this.arnForTasks("*")],
    });
  }

  /**
   * Returns an ARN that represents all tasks within the cluster that match
   * the task pattern specified. To represent all tasks, specify ``"*"``.
   *
   * @param keyPattern Task id pattern
   */
  private arnForTasks(keyPattern: string): string {
    return AwsStack.ofAwsConstruct(this.resource).formatArn({
      service: "ecs",
      resource: "task",
      resourceName: `${this.resource.clusterName}/${keyPattern}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
  }
}
