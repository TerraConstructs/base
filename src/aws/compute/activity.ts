import { sfnActivity } from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
// import { CustomerManagedEncryptionConfiguration } from "./customer-managed-key-encryption-configuration";
// import { EncryptionConfiguration } from "./encryption-configuration";
// import { buildEncryptionConfiguration } from "./private/util";
import {
  // Arn,
  ArnFormat,
} from "../arn";
import { AwsBeaconBase, IAwsBeacon, AwsBeaconProps } from "../beacon";
import * as iam from "../iam";
import { AwsSpec } from "../spec";

/**
 * Properties for defining a new Step Functions Activity
 */
export interface ActivityProps extends AwsBeaconProps {
  /**
   * The name for this activity.
   *
   * This name must be unique for your AWS account and region for 90 days.
   * For more information, see [Limits Related to State Machine Executions][1] in the AWS Step Functions Developer Guide.
   *
   * To enable logging with CloudWatch Logs, the name should only contain 0-9, A-Z, a-z, - and _.
   * Length Constraints: Minimum length of 1. Maximum length of 80.
   *
   * [1]: https://docs.aws.amazon.com/step-functions/latest/dg/limits.html#service-limits-state-machine-executions
   *
   * @default - If not supplied, a name is generated
   */
  readonly activityName?: string;

  // /**
  //  * The encryptionConfiguration object used for server-side encryption of the activity inputs.
  //  *
  //  * @default - data is transparently encrypted using an AWS owned key
  //  */
  // readonly encryptionConfiguration?: EncryptionConfiguration;
}

export interface ActivityOutputs {
  /**
   * The Amazon Resource Name (ARN) that identifies the created activity.
   */
  readonly arn: string;
}

/**
 * Represents a Step Functions Activity
 * https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html
 */
export interface IActivity extends IAwsBeacon {
  /** Strongly typed outputs */
  readonly activityOutputs: ActivityOutputs;

  /**
   * The ARN of the activity
   *
   * @attribute
   */
  readonly activityArn: string;

  /**
   * The name of the activity
   *
   * @attribute
   */
  readonly activityName: string;

  // /**
  //  * The encryptionConfiguration object used for server-side encryption of the activity inputs
  //  *
  //  * @attribute
  //  */
  // readonly encryptionConfiguration?: EncryptionConfiguration;
}

/**
 * Define a new Step Functions Activity
 */
export class Activity extends AwsBeaconBase implements IActivity {
  /**
   * Construct an Activity from an existing Activity ARN
   */
  public static fromActivityArn(
    scope: Construct,
    id: string,
    activityArn: string,
  ): IActivity {
    class Imported extends AwsBeaconBase implements IActivity {
      public get activityOutputs(): ActivityOutputs {
        return {
          arn: this.activityArn,
        };
      }
      public get outputs(): Record<string, any> {
        return this.activityOutputs;
      }
      public get activityArn() {
        return activityArn;
      }
      public get activityName() {
        return (
          this.stack.splitArn(activityArn, ArnFormat.COLON_RESOURCE_NAME)
            .resourceName || ""
        );
      }
    }

    return new Imported(scope, id);
  }

  /**
   * Construct an Activity from an existing Activity Name
   */
  public static fromActivityName(
    scope: Construct,
    id: string,
    activityName: string,
  ): IActivity {
    return Activity.fromActivityArn(
      scope,
      id,
      AwsSpec.ofAwsBeacon(scope).formatArn({
        service: "states",
        resource: "activity",
        resourceName: activityName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
    );
  }

  public get activityOutputs(): ActivityOutputs {
    return {
      arn: this.activityArn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.activityOutputs;
  }
  public readonly resource: sfnActivity.SfnActivity;

  /**
   * @attribute
   */
  public readonly activityArn: string;

  /**
   * @attribute
   */
  public readonly activityName: string;

  // /**
  //  * @attribute
  //  */
  // public readonly encryptionConfiguration?: EncryptionConfiguration;

  constructor(scope: Construct, id: string, props: ActivityProps = {}) {
    super(scope, id, props);

    /**
     * To enable logging with CloudWatch Logs, the name should only contain 0-9, A-Z, a-z, - and _.
     * Length Constraints: Minimum length of 1. Maximum length of 80.
     */
    const resourceName =
      props.activityName ||
      Lazy.stringValue({
        produce: () =>
          this.stack.uniqueResourceName(this, {
            prefix: this.gridUUID + "-",
            maxLength: 80,
            allowedSpecialCharacters: "-_",
          }),
      });

    // this.encryptionConfiguration = props.encryptionConfiguration;
    // if (
    //   props.encryptionConfiguration instanceof
    //   CustomerManagedEncryptionConfiguration
    // ) {
    //   props.encryptionConfiguration.kmsKey.addToResourcePolicy(
    //     new iam.PolicyStatement({
    //       resources: ["*"],
    //       actions: ["kms:Decrypt", "kms:GenerateDataKey"],
    //       principals: [new iam.ServicePrincipal("states.amazonaws.com")],
    //       condition: [
    //         {
    //           test: "StringEquals",
    //           variable: "kms:EncryptionContext:aws:states:activityArn",
    //           values: [
    //             this.stack.formatArn({
    //               service: "states",
    //               resource: "activity",
    //               sep: ":",
    //               resourceName,
    //             }),
    //           ],
    //         },
    //       ],
    //     }),
    //   );
    // }

    this.resource = new sfnActivity.SfnActivity(this, "Resource", {
      name: resourceName,
      // encryptionConfiguration: buildEncryptionConfiguration(
      //   props.encryptionConfiguration,
      // ),
    });

    this.activityArn = this.resource.id;
    this.activityName = this.resource.name;
  }

  /**
   * Grant the given identity permissions on this Activity
   *
   * @param identity The principal
   * @param actions The list of desired actions
   */
  public grant(identity: iam.IGrantable, ...actions: string[]) {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions,
      resourceArns: [this.activityArn],
    });
  }
}
