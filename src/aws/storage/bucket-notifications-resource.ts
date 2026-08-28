// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-s3/lib/notifications-resource/notifications-resource.ts
import { Lazy } from "cdktn";
import { Construct } from "constructs";
import { EventType, IBucket, NotificationKeyFilter } from "./bucket";
import {
  BucketNotificationDestinationType,
  IBucketNotificationDestination,
} from "./bucket-destination";
import { NotificationsResourceHandler } from "./notifications-resource-handler";
import { Duration } from "../../duration";
import { ValidationError } from "../../errors";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { CustomResource } from "../custom-resource";
import * as iam from "../iam";

export interface BucketNotificationsResourceProps extends AwsConstructProps {
  /**
   * The bucket to manage notifications for.
   */
  readonly bucket: IBucket;

  /**
   * The role to be used by the notifications handler Lambda function.
   *
   * @default - a new role is created for the singleton handler.
   */
  readonly handlerRole?: iam.IRole;

  /**
   * Skips notification validation of Amazon SQS, Amazon SNS, and Lambda
   * destinations.
   *
   * @default false
   */
  readonly skipDestinationValidation?: boolean;
}

/**
 * A `Custom::S3BucketNotifications` custom resource that manages bucket
 * notifications for a bucket, driving AWS CDK's own
 * `notifications-resource-handler` (verbatim) through a
 * `cfncompat_custom_resource`.
 *
 * The reason we need it is because the S3 bucket notification configuration
 * is defined on the bucket itself, which makes it impossible to provision
 * notifications at the same time as the target (since
 * PutBucketNotificationConfiguration validates the targets). It is also the
 * only way to add notifications to a bucket this stack does not own (an
 * imported bucket), since Terraform manages no resource for it.
 *
 * This custom resource always treats the bucket as unmanaged (`Managed:
 * "false"`): the handler GETs the bucket's existing notification
 * configuration and merges in only this stack's own entries (tracked by a
 * `stackId`-prefixed `Id`), rather than overwriting the whole configuration.
 * That merge - not overwrite - semantics is what makes it safe for several
 * stacks (including the owning stack) to add notifications to the same
 * bucket.
 *
 * Since only a single `BucketNotificationsResource` is allowed for each
 * bucket, this construct is not exported in the public API of this module.
 * Instead, it is created just-in-time by `BucketBase.addEventNotification`,
 * so a 1:1 relationship is ensured.
 *
 * @see
 * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-notificationconfig.html
 */
export class BucketNotificationsResource extends AwsConstructBase {
  public resource?: CustomResource;

  public get outputs(): Record<string, any> {
    return this.resource ? { physicalResourceId: this.resource.ref } : {};
  }

  private eventBridgeEnabled = false;
  private readonly lambdaNotifications =
    new Array<LambdaFunctionConfiguration>();
  private readonly queueNotifications = new Array<QueueConfiguration>();
  private readonly topicNotifications = new Array<TopicConfiguration>();
  private readonly bucket: IBucket;
  private readonly handlerRole?: iam.IRole;
  private readonly skipDestinationValidation: boolean;

  constructor(
    scope: Construct,
    id: string,
    props: BucketNotificationsResourceProps,
  ) {
    super(scope, id, props);
    this.bucket = props.bucket;
    this.handlerRole = props.handlerRole;
    this.skipDestinationValidation = props.skipDestinationValidation ?? false;
  }

  /**
   * Adds a notification subscription for this bucket.
   * If this is the first notification, the custom resource is added to the stack.
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

    // resolve target. this also provides an opportunity for the target to e.g. update
    // policies to allow this notification to happen.
    const targetProps = target.bind(this, this.bucket);
    const commonConfig: CommonConfiguration = {
      Events: [event],
      Filter: renderFilters(filters, this),
    };

    // if the target specifies any dependencies, add them to the custom resource.
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
          LambdaFunctionArn: targetProps.arn,
        });
        break;

      case BucketNotificationDestinationType.QUEUE:
        this.queueNotifications.push({
          ...commonConfig,
          QueueArn: targetProps.arn,
        });
        break;

      case BucketNotificationDestinationType.TOPIC:
        this.topicNotifications.push({
          ...commonConfig,
          TopicArn: targetProps.arn,
        });
        break;

      default:
        throw new ValidationError(
          "Unsupported notification target type:" +
            BucketNotificationDestinationType[targetProps.type],
          this,
        );
    }
  }

  public enableEventBridgeNotification() {
    this.createResourceOnce();
    this.eventBridgeEnabled = true;
  }

  private renderNotificationConfiguration(): NotificationConfiguration {
    return {
      EventBridgeConfiguration: this.eventBridgeEnabled ? {} : undefined,
      LambdaFunctionConfigurations:
        this.lambdaNotifications.length > 0
          ? this.lambdaNotifications
          : undefined,
      QueueConfigurations:
        this.queueNotifications.length > 0
          ? this.queueNotifications
          : undefined,
      TopicConfigurations:
        this.topicNotifications.length > 0
          ? this.topicNotifications
          : undefined,
    };
  }

  /**
   * Defines the bucket notifications resources in the stack only once.
   * This is called lazily as we add notifications, so that if notifications are not added,
   * there is no notifications resource.
   */
  private createResourceOnce(): CustomResource {
    if (!this.resource) {
      const handler = NotificationsResourceHandler.singleton(this, {
        role: this.handlerRole,
      });

      // Unmanaged mode (see the class doc) merges, so the handler needs to read
      // the bucket's existing configuration as well as write the merged result.
      handler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["s3:PutBucketNotification"],
          resources: [this.bucket.bucketArn],
        }),
      );
      handler.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetBucketNotification"],
          resources: [this.bucket.bucketArn],
        }),
      );

      this.resource = new CustomResource(this, "Resource", {
        resourceType: "Custom::S3BucketNotifications",
        serviceToken: handler.functionArn,
        // Matches the handler's own Lambda timeout: the custom resource must not
        // give up before the function it is waiting on does.
        serviceTimeout: Duration.seconds(300),
        properties: {
          BucketName: this.bucket.bucketName,
          NotificationConfiguration: Lazy.anyValue({
            produce: () => this.renderNotificationConfiguration(),
          }),
          // Must be the *string* "false", never a bool: the handler does
          // `props.get('Managed', 'true').lower() == 'true'`.
          Managed: "false",
          // Only rendered when true - the handler already defaults to
          // "false" when the key is absent.
          ...(this.skipDestinationValidation
            ? { SkipDestinationValidation: "true" }
            : {}),
        },
      });

      // The handler's role policy (Get/PutBucketNotification) must exist
      // before the custom resource invokes the handler.
      this.resource.node.addDependency(handler);
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

function renderFilters(
  filters: NotificationKeyFilter[],
  scope: BucketNotificationsResource,
): Filter | undefined {
  if (!filters || filters.length === 0) {
    return undefined;
  }

  const renderedRules = new Array<FilterRule>();
  let hasPrefix = false;
  let hasSuffix = false;

  for (const rule of filters) {
    if (!rule.suffix && !rule.prefix) {
      throw new ValidationError(
        "NotificationKeyFilter must specify `prefix` and/or `suffix`",
        scope,
      );
    }

    if (rule.suffix) {
      if (hasSuffix) {
        throw new ValidationError(
          "Cannot specify more than one suffix rule in a filter.",
          scope,
        );
      }
      renderedRules.push({ Name: "suffix", Value: rule.suffix });
      hasSuffix = true;
    }

    if (rule.prefix) {
      if (hasPrefix) {
        throw new ValidationError(
          "Cannot specify more than one prefix rule in a filter.",
          scope,
        );
      }
      renderedRules.push({ Name: "prefix", Value: rule.prefix });
      hasPrefix = true;
    }
  }

  return {
    Key: {
      FilterRules: renderedRules,
    },
  };
}

interface NotificationConfiguration {
  EventBridgeConfiguration?: EventBridgeConfiguration;
  LambdaFunctionConfigurations?: LambdaFunctionConfiguration[];
  QueueConfigurations?: QueueConfiguration[];
  TopicConfigurations?: TopicConfiguration[];
}

interface CommonConfiguration {
  Id?: string;
  Events: string[];
  Filter?: Filter;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface EventBridgeConfiguration {}

interface LambdaFunctionConfiguration extends CommonConfiguration {
  LambdaFunctionArn: string;
}

interface QueueConfiguration extends CommonConfiguration {
  QueueArn: string;
}

interface TopicConfiguration extends CommonConfiguration {
  TopicArn: string;
}

interface FilterRule {
  Name: "prefix" | "suffix";
  Value: string;
}

interface Filter {
  Key: { FilterRules: FilterRule[] };
}
