// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/core/lib/private/md5.ts

import * as crypto from "crypto";

/**
 * Return a hash of the given input string, in hex format
 */
export function md5hash(x: string) {
  const hash = crypto.createHash("md5");
  hash.update(x);
  return hash.digest("hex");
}
