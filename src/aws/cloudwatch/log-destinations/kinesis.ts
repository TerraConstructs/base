// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-logs-destinations/lib/kinesis.ts

import { Construct } from "constructs";
import * as logs from "..";
import * as iam from "../../iam";
import * as kinesis from "../../notify";

/**
 * Customize the Kinesis Logs Destination
 */
export interface KinesisDestinationProps {
  /**
   * The role to assume to write log events to the destination
   *
   * @default - A new Role is created
   */
  readonly role?: iam.IRole;
}

/**
 * Use a Kinesis stream as the destination for a log subscription
 */
export class KinesisDestination implements logs.ILogSubscriptionDestination {
  /**
   * @param stream The Kinesis stream to use as destination
   * @param props The Kinesis Destination properties
   *
   */
  constructor(
    private readonly stream: kinesis.IStream,
    private readonly props: KinesisDestinationProps = {},
  ) {}

  public bind(
    scope: Construct,
    _sourceLogGroup: logs.ILogGroup,
  ): logs.LogSubscriptionDestinationConfig {
    // Following example from https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html#DestinationKinesisExample
    // Create a role to be assumed by CWL that can write to this stream and pass itself.
    const id = "CloudWatchLogsCanPutRecords";
    const role =
      this.props.role ??
      (scope.node.tryFindChild(id) as iam.IRole) ??
      new iam.Role(scope, id, {
        assumedBy: new iam.ServicePrincipal("logs.amazonaws.com"),
      });
    this.stream.grantWrite(role);
    role.grantPassRole(role);

    const dependencies: Construct[] = [];
    const policy = role.node.tryFindChild("DefaultPolicy");
    if (policy) {
      // // Remove circular dependency
      // const tfRole = role.node.defaultChild as TerraformElement;
      // tfRole.addOverride("depends_on", undefined);

      // Unlike AWS CDK:
      // https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-logs-destinations/lib/kinesis.ts#L47
      // We must return the dependencies. for the caller to attach them to the nested subscription filter Construct
      // only. If we attach them the scope, the `TerraformDependencyAspect` will propagate the dependencies to all
      // nested constructs (role, policy, subscriptionFilter) causing hard to handle dependency cycles between them.
      // Simply letting the caller attach the dependency to the nested subscription filter directly solves this cycle.

      // Ensures policy is created before subscription filter
      dependencies.push(policy);
    }

    return { arn: this.stream.streamArn, role, dependencies };
  }
}
