// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-s3/lib/notifications-resource/notifications-resource-handler.ts
import { Construct } from "constructs";
import { Duration } from "../../duration";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as compute from "../compute";
import { CustomResourceHandler } from "../custom-resource-handler";
import * as iam from "../iam";

// TERRACONSTRUCTS DEVIATION: upstream reads this handler from an aws-cdk-lib build asset
// (`custom-resource-handlers/dist/aws-s3/notifications-resource-handler/index.py`); that asset
// pipeline does not exist here, so the source is inlined verbatim, as in
// `src/aws/compute/ecs/drain-hook/instance-drain-hook.ts`. Upstream's comment-stripping is
// also dropped: it only serves CloudFormation's 4 KiB inline `ZipFile` limit, and
// `Code.fromInline` renders a `data.archive_file` instead.
const HANDLER_SOURCE = `
import boto3  # type: ignore
import json
import logging
import urllib.request

s3 = boto3.client("s3")

EVENTBRIDGE_CONFIGURATION = 'EventBridgeConfiguration'
CONFIGURATION_TYPES = ["TopicConfigurations", "QueueConfigurations", "LambdaFunctionConfigurations"]

def handler(event: dict, context):
  response_status = "SUCCESS"
  error_message = ""
  try:
    props = event["ResourceProperties"]
    notification_configuration = props["NotificationConfiguration"]
    managed = props.get('Managed', 'true').lower() == 'true'
    skipDestinationValidation = props.get('SkipDestinationValidation', 'false').lower() == 'true'
    stack_id = event['StackId']
    old = event.get("OldResourceProperties", {}).get("NotificationConfiguration", {})
    if managed:
      config = handle_managed(event["RequestType"], notification_configuration)
    else:
      config = handle_unmanaged(props["BucketName"], stack_id, event["RequestType"], notification_configuration, old)
    s3.put_bucket_notification_configuration(Bucket=props["BucketName"], NotificationConfiguration=config, SkipDestinationValidation=skipDestinationValidation)
  except Exception as e:
    logging.exception("Failed to put bucket notification configuration")
    response_status = "FAILED"
    error_message = f"Error: {str(e)}. "
  finally:
    submit_response(event, context, response_status, error_message)

def handle_managed(request_type, notification_configuration):
  if request_type == 'Delete':
    return {}
  return notification_configuration

def handle_unmanaged(bucket, stack_id, request_type, notification_configuration, old):
  def get_id(n):
    n['Id'] = ''
    sorted_notifications = sort_filter_rules(n)
    strToHash=json.dumps(sorted_notifications, sort_keys=True).replace('"Name": "prefix"', '"Name": "Prefix"').replace('"Name": "suffix"', '"Name": "Suffix"')
    return f"{stack_id}-{hash(strToHash)}"
  def with_id(n):
    n['Id'] = get_id(n)
    return n

  # find external notifications
  external_notifications = {}
  existing_notifications = s3.get_bucket_notification_configuration(Bucket=bucket)
  for t in CONFIGURATION_TYPES:
    if request_type == 'Update':
        old_incoming_ids = [get_id(n) for n in old.get(t, [])]
        # if the notification was created by us, we know what id to expect so we can filter by it.
        external_notifications[t] = [n for n in existing_notifications.get(t, []) if not get_id(n) in old_incoming_ids]      
    elif request_type == 'Delete':
        # For 'Delete' request, old parameter is an empty dict so we cannot use this to determine which are external
        # notifications. Fall back to rely on the stack naming logic.
        external_notifications[t] = [n for n in existing_notifications.get(t, []) if not n['Id'].startswith(f"{stack_id}-")]
    elif request_type == 'Create':
        # if this is a create event then all existing notifications are external
        external_notifications[t] = [n for n in existing_notifications.get(t, [])]
  # always treat EventBridge configuration as an external config if it already exists
  # as there is no way to determine whether it's managed by us or not
  if EVENTBRIDGE_CONFIGURATION in existing_notifications:
    external_notifications[EVENTBRIDGE_CONFIGURATION] = existing_notifications[EVENTBRIDGE_CONFIGURATION]

  # if delete, that's all we need
  if request_type == 'Delete':
    return external_notifications

  # otherwise, merge external with incoming config and augment with id
  notifications = {}
  for t in CONFIGURATION_TYPES:
    external = external_notifications.get(t, [])
    incoming = [with_id(n) for n in notification_configuration.get(t, [])]
    notifications[t] = external + incoming

  # EventBridge configuration is a special case because it's just an empty object if it exists
  if EVENTBRIDGE_CONFIGURATION in notification_configuration:
    notifications[EVENTBRIDGE_CONFIGURATION] = notification_configuration[EVENTBRIDGE_CONFIGURATION]
  elif EVENTBRIDGE_CONFIGURATION in external_notifications:
    notifications[EVENTBRIDGE_CONFIGURATION] = external_notifications[EVENTBRIDGE_CONFIGURATION]

  return notifications

def submit_response(event: dict, context, response_status: str, error_message: str):
  response_body = json.dumps(
    {
      "Status": response_status,
      "Reason": f"{error_message}See the details in CloudWatch Log Stream: {context.log_stream_name}",
      "PhysicalResourceId": event.get("PhysicalResourceId") or event["LogicalResourceId"],
      "StackId": event["StackId"],
      "RequestId": event["RequestId"],
      "LogicalResourceId": event["LogicalResourceId"],
      "NoEcho": False,
    }
  ).encode("utf-8")
  headers = {"content-type": "", "content-length": str(len(response_body))}
  try:
    req = urllib.request.Request(url=event["ResponseURL"], headers=headers, data=response_body, method="PUT")
    with urllib.request.urlopen(req) as response:
      print(response.read().decode("utf-8"))
    print("Status code: " + response.reason)
  except Exception as e:
      print("send(..) failed executing request.urlopen(..): " + str(e))

def sort_filter_rules(json_obj):
  # Check if the input is a dictionary
  if not isinstance(json_obj, dict):
      return json_obj
  # Recursively sort the filter rules for nested dictionaries
  for key, value in json_obj.items():
      if isinstance(value, dict):
          json_obj[key] = sort_filter_rules(value)
      elif isinstance(value, list):
          json_obj[key] = [sort_filter_rules(item) for item in value]
  # Sort the FilterRules list if it exists
  if "Filter" in json_obj and "Key" in json_obj["Filter"] and "FilterRules" in json_obj["Filter"]["Key"]:
      filter_rules = json_obj["Filter"]["Key"]["FilterRules"]
      sorted_filter_rules = sorted(filter_rules, key=lambda x: x["Name"])
      json_obj["Filter"]["Key"]["FilterRules"] = sorted_filter_rules
  return json_obj`;

// well-known logical id to ensure stack singletonity - verbatim upstream value.
const SINGLETON_ID =
  "BucketNotificationsHandler050a0587b7544547bf325f094a3db834";

/**
 * Construction properties for `NotificationsResourceHandler`.
 */
export interface NotificationsResourceHandlerProps extends AwsConstructProps {
  /**
   * The IAM role assumed by the notifications handler Lambda function.
   *
   * @default - a new role is created with the basic Lambda execution managed
   * policy attached.
   */
  readonly role?: iam.IRole;
}

/**
 * A Lambda-based custom resource handler that provisions S3 bucket
 * notifications for a bucket.
 *
 * The resource property schema is:
 *
 *     {
 *       BucketName: string,
 *       NotificationConfiguration: { see PutBucketNotificationConfiguration },
 *       Managed: "true" | "false",
 *       SkipDestinationValidation?: "true" | "false",
 *     }
 *
 * For 'Delete' operations, an empty `NotificationConfiguration` is sent, as
 * required. Errors and results are propagated as-is.
 */
export class NotificationsResourceHandler extends AwsConstructBase {
  /**
   * Defines a stack-singleton Lambda function with the logic for a
   * `Custom::S3BucketNotifications` custom resource that provisions bucket
   * notification configuration for a bucket.
   *
   * @param context the construct requesting the handler
   * @param props handler configuration, used only if the handler does not
   * already exist in this stack
   */
  public static singleton(
    context: Construct,
    props: NotificationsResourceHandlerProps = {},
  ): NotificationsResourceHandler {
    const stack = AwsStack.ofAwsConstruct(context);
    const existing = stack.node.tryFindChild(SINGLETON_ID);
    if (existing) {
      return existing as NotificationsResourceHandler;
    }
    return new NotificationsResourceHandler(stack, SINGLETON_ID, props);
  }

  /**
   * The underlying custom resource handler Lambda function.
   */
  public readonly handler: CustomResourceHandler;

  constructor(
    scope: Construct,
    id: string,
    props: NotificationsResourceHandlerProps = {},
  ) {
    super(scope, id, props);

    this.handler = new CustomResourceHandler(this, "Handler", {
      code: compute.Code.fromInline(HANDLER_SOURCE.replace(/^\n/, "")),
      runtime: compute.Runtime.PYTHON_3_12,
      handler: "index.handler",
      timeout: Duration.seconds(300),
      role: props.role,
      description:
        'AWS CloudFormation handler for "Custom::S3BucketNotifications" resources (@aws-cdk/aws-s3)',
    });
  }

  /**
   * The ARN of the handler's Lambda function. Used as the service token in
   * the `Custom::S3BucketNotifications` custom resource.
   */
  public get functionArn(): string {
    return this.handler.functionArn;
  }

  /**
   * The role assumed by the handler's Lambda function.
   */
  public get role(): iam.IRole {
    return this.handler.role;
  }

  public get outputs(): Record<string, any> {
    return { arn: this.functionArn };
  }

  /**
   * Adds a statement to the IAM role assumed by the handler.
   */
  public addToRolePolicy(statement: iam.PolicyStatement): void {
    this.handler.addToRolePolicy(statement);
  }
}
