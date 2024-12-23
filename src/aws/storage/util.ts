import { IConstruct } from "constructs";
import { AwsStack, ArnFormat } from "..";
import { BucketOutputs } from "./bucket";

export function parseBucketArn(
  construct: IConstruct,
  outputs: BucketOutputs,
): string {
  // if we have an explicit bucket ARN, use it.
  if (outputs.arn) {
    return outputs.arn;
  }

  if (outputs.name) {
    return AwsStack.ofAwsConstruct(construct).formatArn({
      // S3 Bucket names are globally unique in a partition,
      // and so their ARNs have empty region and account components
      region: "",
      account: "",
      service: "s3",
      resource: outputs.name,
    });
  }

  throw new Error(
    "Cannot determine bucket ARN. At least `bucketArn` or `bucketName` is needed",
  );
}

export function parseBucketName(
  construct: IConstruct,
  outputs: BucketOutputs,
): string | undefined {
  // if we have an explicit bucket name, use it.
  if (outputs.name) {
    return outputs.name;
  }

  // extract bucket name from bucket arn
  if (outputs.arn) {
    return AwsStack.ofAwsConstruct(construct).splitArn(
      outputs.arn,
      ArnFormat.SLASH_RESOURCE_NAME,
    ).resource;
  }

  // no bucket name is okay since it's optional.
  return undefined;
}

/**
 * All http request methods
 */
export enum HttpMethods {
  /**
   * The GET method requests a representation of the specified resource.
   */
  GET = "GET",
  /**
   * The PUT method replaces all current representations of the target resource with the request payload.
   */
  PUT = "PUT",
  /**
   * The HEAD method asks for a response identical to that of a GET request, but without the response body.
   */
  HEAD = "HEAD",
  /**
   * The POST method is used to submit an entity to the specified resource, often causing a change in state or side effects on the server.
   */
  POST = "POST",
  /**
   * The DELETE method deletes the specified resource.
   */
  DELETE = "DELETE",
}

/**
 * All http request methods
 */
export enum RedirectProtocol {
  HTTP = "http",
  HTTPS = "https",
}

/**
 * Normalize windows paths to be posix-like.
 */
export function normalPath(path: string) {
  // ref: https://github.com/winglang/wing/blob/v0.83.8/libs/wingsdk/src/shared/misc.ts#L15
  if (process.platform === "win32") {
    return (
      path
        // force posix path separator
        .replace(/\\+/g, "/")
    );
  } else {
    return path;
  }
}
