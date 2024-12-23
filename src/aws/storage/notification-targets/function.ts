import { TerraformResource } from "cdktf";
import { Construct } from "constructs";
import * as storage from "..";
import { AwsStack } from "../..";
import { IFunction } from "../../compute";
import * as iam from "../../iam";

/**
 * Use a Lambda function as a bucket notification destination
 */
export class FunctionDestination
  implements storage.IBucketNotificationDestination
{
  constructor(private readonly fn: IFunction) {}

  public bind(
    _scope: Construct,
    bucket: storage.IBucket,
  ): storage.BucketNotificationDestinationConfig {
    // const uniqueId = AwsStack.uniqueId(this.fn);
    const permissionId = `AllowBucketNotificationsTo${AwsStack.uniqueId(this.fn.permissionsNode)}`;

    if (!(bucket instanceof Construct)) {
      throw new Error(`LambdaDestination for function ${AwsStack.uniqueId(this.fn.permissionsNode)} can only be configured on a
        bucket construct (Bucket ${bucket.bucketName})`);
    }

    if (bucket.node.tryFindChild(permissionId) === undefined) {
      this.fn.addPermission(permissionId, {
        sourceAccount: AwsStack.ofAwsConstruct(bucket).account,
        principal: new iam.ServicePrincipal("s3.amazonaws.com"),
        sourceArn: bucket.bucketArn,
        // Placing the permissions node in the same scope as the s3 bucket.
        // Otherwise, there is a circular dependency when the s3 bucket
        // and lambda functions declared in different stacks.
        scope: bucket,
      });
    }

    // if we have a permission resource for this relationship, add it as a dependency
    // to the bucket notifications resource, so it will be created first.
    const permission = bucket.node.tryFindChild(permissionId) as
      | TerraformResource
      | undefined;

    return {
      type: storage.BucketNotificationDestinationType.LAMBDA,
      arn: this.fn.functionArn,
      dependencies: permission ? [permission] : undefined,
    };
  }
}
