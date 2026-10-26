// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-s3/lib/notifications-resource/notifications-resource-handler.ts
import * as fs from "fs";
import * as path from "path";
import { Construct } from "constructs";
import { Duration } from "../../duration";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as compute from "../compute";
import { CustomResourceHandler } from "../custom-resource-handler";
import * as iam from "../iam";

// TERRACONSTRUCTS DEVIATION: upstream reads this handler from an aws-cdk-lib build asset
// (`custom-resource-handlers/dist/aws-s3/notifications-resource-handler/index.py`); that asset
// pipeline does not exist here, so the source is kept verbatim in the sibling
// `notifications-resource-handler.py`, which the compile task copies into `lib/`. Its leading
// provenance comment block (up to the first blank line) is stripped so the deployed code is
// byte-identical to upstream. Upstream's comment-stripping is also dropped: it only serves
// CloudFormation's 4 KiB inline `ZipFile` limit, and `Code.fromInline` renders a
// `data.archive_file` instead.
// Read lazily (on first handler construction) so importing the library never touches disk.
function handlerSource(): string {
  return fs
    .readFileSync(
      path.join(__dirname, "notifications-resource-handler.py"),
      "utf8",
    )
    .replace(/^(#.*\n)+\n/, "");
}

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
      code: compute.Code.fromInline(handlerSource()),
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
