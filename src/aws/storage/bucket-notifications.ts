import { s3BucketNotification } from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import { AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { IBucket, EventType, NotificationKeyFilter } from "./bucket";
import {
  BucketNotificationDestinationType,
  IBucketNotificationDestination,
} from "./bucket-destination";

export interface NotificationsProps extends AwsBeaconProps {
  /**
   * The bucket to manage notifications for.
   */
  readonly bucket: IBucket;
}

/**
 * A custom CloudFormation resource that updates bucket notifications for a
 * bucket. The reason we need it is because the AWS::S3::Bucket notification
 * configuration is defined on the bucket itself, which makes it impossible to
 * provision notifications at the same time as the target (since
 * PutBucketNotifications validates the targets).
 *
 * Since only a single BucketNotifications resource is allowed for each Bucket,
 * this construct is not exported in the public API of this module. Instead, it
 * is created just-in-time by `s3.Bucket.onEvent`, so a 1:1 relationship is
 * ensured.
 *
 * @see
 * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-notificationconfig.html
 */
export class BucketNotifications extends AwsBeaconBase {
  public resource?: s3BucketNotification.S3BucketNotification;
  public get outputs(): Record<string, any> {
    return {};
  }

  private eventBridgeEnabled = false;
  private readonly lambdaNotifications =
    new Array<s3BucketNotification.S3BucketNotificationLambdaFunction>();
  private readonly queueNotifications =
    new Array<s3BucketNotification.S3BucketNotificationQueue>();
  private readonly topicNotifications =
    new Array<s3BucketNotification.S3BucketNotificationTopic>();
  private readonly bucket: IBucket;

  constructor(scope: Construct, id: string, props: NotificationsProps) {
    super(scope, id);
    this.bucket = props.bucket;
  }

  /**
   * Adds a notification subscription for this bucket.
   * If this is the first notification, a BucketNotification resource is added to the stack.
   *
   * @param event The type of event
   * @param target The target construct
   * @param filters A set of S3 key filters
   */
  public addNotification(
    event: EventType,
    target: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ) {
    const resource = this.createResourceOnce();
    // TODO: Seems Terraform provider does not have limitations on prefix and suffix?
    // let hasPrefix = false;
    // let hasSuffix = false;
    for (const filter of filters) {
      // if (!filter.suffix && !filter.prefix) {
      //   throw new Error(
      //     "NotificationKeyFilter must specify `prefix` and/or `suffix`",
      //   );
      // }
      // if (filter.suffix) {
      //   if (hasSuffix) {
      //     throw new Error(
      //       "Cannot specify more than one suffix rule in a filter.",
      //     );
      //   }
      //   hasSuffix = true;
      // }
      // if (filter.prefix) {
      //   if (hasPrefix) {
      //     throw new Error(
      //       "Cannot specify more than one prefix rule in a filter.",
      //     );
      //   }
      //   hasPrefix = true;
      // }
      // resolve target. this also provides an opportunity for the target to e.g. update
      // policies to allow this notification to happen.
      const targetProps = target.bind(this, this.bucket);
      const commonConfig: CommonConfiguration = {
        events: [event],
        id: filter.id,
        filterPrefix: filter.prefix,
        filterSuffix: filter.suffix,
      };

      // if the target specifies any dependencies, add them here.
      // for example, the SNS topic policy must be created /before/ the notification resource.
      // otherwise, S3 won't be able to confirm the subscription.
      if (targetProps.dependencies) {
        resource.node.addDependency(...targetProps.dependencies);
      }

      // based on the target type, add the the correct configurations array
      switch (targetProps.type) {
        case BucketNotificationDestinationType.LAMBDA:
          this.lambdaNotifications.push({
            ...commonConfig,
            lambdaFunctionArn: targetProps.arn,
          });
          break;

        case BucketNotificationDestinationType.QUEUE:
          this.queueNotifications.push({
            ...commonConfig,
            queueArn: targetProps.arn,
          });
          break;

        // TODO: re-add SNS support
        case BucketNotificationDestinationType.TOPIC:
          this.topicNotifications.push({
            ...commonConfig,
            topicArn: targetProps.arn,
          });
          break;

        default:
          throw new Error(
            "Unsupported notification target type:" +
              BucketNotificationDestinationType[targetProps.type],
          );
      }
    }
  }

  public enableEventBridgeNotification() {
    this.createResourceOnce();
    this.eventBridgeEnabled = true;
  }

  /**
   * Defines the bucket notifications resources in the stack only once.
   * This is called lazily as we add notifications, so that if notifications are not added,
   * there is no notifications resource.
   */
  private createResourceOnce() {
    if (!this.resource) {
      this.resource = new s3BucketNotification.S3BucketNotification(
        this,
        "Resource",
        {
          bucket: this.bucket.bucketName,
          eventbridge: Lazy.anyValue({
            produce: () => this.eventBridgeEnabled,
          }),
          lambdaFunction: Lazy.anyValue({
            produce: () =>
              this.lambdaNotifications.length > 0
                ? this.lambdaNotifications.map((l) =>
                    s3BucketNotification.s3BucketNotificationLambdaFunctionToTerraform(
                      l,
                    ),
                  )
                : undefined,
          }),
          queue: Lazy.anyValue({
            produce: () =>
              this.queueNotifications.length > 0
                ? this.queueNotifications.map((q) =>
                    s3BucketNotification.s3BucketNotificationQueueToTerraform(
                      q,
                    ),
                  )
                : undefined,
          }),
          topic: Lazy.anyValue({
            produce: () =>
              this.topicNotifications.length > 0
                ? this.topicNotifications.map((t) =>
                    s3BucketNotification.s3BucketNotificationTopicToTerraform(
                      t,
                    ),
                  )
                : undefined,
          }),
        },
      );
    }
    return this.resource;
  }

  /**
   * Adds resource to the Terraform JSON output at Synth time.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    // Add dependency on bucket policy if it exists to avoid race conditions
    // S3 does not allow calling PutBucketPolicy and PutBucketNotification APIs at the same time
    // See https://github.com/aws/aws-cdk/issues/27600
    // prepareStack are used here because bucket policy maybe added to construct after addition of notification resource.
    // but we need this defined before stack Aspect maps construct dependencies to Terraform dependsOn
    if (this.bucket.policy) {
      this.node.addDependency(this.bucket.policy);
    }
    return {};
  }
}

interface CommonConfiguration {
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/s3_bucket_notification#id S3BucketNotification#id}
   *
   * Please be aware that the id field is automatically added to all resources in Terraform providers using a Terraform provider SDK version below 2.
   * If you experience problems setting this value it might not be settable. Please take a look at the provider documentation to ensure it should be settable.
   */
  readonly id?: string;
  readonly events: string[];
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/s3_bucket_notification#filter_prefix S3BucketNotification#filter_prefix}
   */
  readonly filterPrefix?: string;
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/s3_bucket_notification#filter_suffix S3BucketNotification#filter_suffix}
   */
  readonly filterSuffix?: string;
}
