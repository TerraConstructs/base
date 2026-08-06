/* eslint-disable prettier/prettier,max-len */
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/elasticache-grants.generated.ts

import * as iam from "../../iam";

/**
 * The minimal shape `ServerlessCacheGrants` needs from a serverless cache resource.
 *
 * TERRACONSTRUCTS DEVIATION: upstream types the grants-collection resource as
 * `elasticache.IServerlessCacheRef` (a CloudFormation cross-stack "Reference" marker interface
 * generated from the CFN resource spec, imported from `aws-cdk-lib/interfaces`). TerraConstructs
 * has no equivalent generated-reference layer (identical omission pattern to the rds/docdb `*Ref`
 * interfaces, e.g. `IDatabaseCluster.dbClusterRef` in `../rds/cluster-ref.ts`). Rather than import
 * this module's own construct-facing `IServerlessCache` (`./serverless-cache-base.ts`, a sibling
 * file in this port) and risk a forward/circular module dependency from this "generated" file, the
 * minimal structural shape actually used below (`serverlessCacheArn`) is declared locally.
 * `IServerlessCache` — and any class that implements it, such as `ServerlessCacheBase` — satisfies
 * this interface automatically via TypeScript structural typing, exactly as `elasticache.
 * IServerlessCacheRef` does for the upstream CFN L1 —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/serverless-cache-base.ts#L119-L124
 */
export interface IServerlessCacheRef {
  /**
   * The ARN of the serverless cache the grant actions apply to.
   */
  readonly serverlessCacheArn: string;
}

/**
 * Properties for ServerlessCacheGrants
 */
export interface ServerlessCacheGrantsProps {
  /**
   * The resource on which actions will be allowed
   */
  readonly resource: IServerlessCacheRef;
}

/**
 * Options for a custom-actions grant.
 *
 * TERRACONSTRUCTS DEVIATION: upstream types the `options` parameter of `actions()` as
 * `cdk.PermissionsOptions` (`aws-cdk-lib/core`, not ported here). Only the `resourceArns` override
 * used by this file's own `connect()` call site is reproduced.
 */
export interface ServerlessCacheGrantsPermissionsOptions {
  /**
   * The resource ARNs to grant the actions on
   *
   * @default - the ARN of the serverless cache this grants object was created for
   */
  readonly resourceArns?: string[];
}

/**
 * Collection of grant methods for a IServerlessCacheRef
 */
export class ServerlessCacheGrants {
  /**
   * Creates grants for ServerlessCacheGrants
   */
  public static fromServerlessCache(
    resource: IServerlessCacheRef,
  ): ServerlessCacheGrants {
    return new ServerlessCacheGrants({
      resource: resource,
    });
  }

  protected readonly resource: IServerlessCacheRef;

  private constructor(props: ServerlessCacheGrantsProps) {
    this.resource = props.resource;
  }

  /**
   * Grant the given identity custom permissions
   */
  public actions(
    grantee: iam.IGrantable,
    actions: Array<string>,
    options: ServerlessCacheGrantsPermissionsOptions = {},
  ): iam.Grant {
    const result = iam.Grant.addToPrincipal({
      actions: actions,
      grantee: grantee,
      resourceArns: options.resourceArns ?? [this.resource.serverlessCacheArn],
    });
    return result;
  }

  /**
   * Grant connect permissions to the cache
   */
  public connect(grantee: iam.IGrantable): iam.Grant {
    const actions = [
      "elasticache:Connect",
      "elasticache:DescribeServerlessCaches",
    ];
    return this.actions(grantee, actions, {});
  }
}
