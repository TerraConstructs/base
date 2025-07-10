// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/lib/private/jsii-deprecated.ts

export function quiet(): string | undefined {
  const deprecated = process.env.JSII_DEPRECATED;
  process.env.JSII_DEPRECATED = "quiet";
  return deprecated;
}

export function reset(deprecated: string | undefined) {
  if (deprecated === undefined) {
    delete process.env.JSII_DEPRECATED;
  } else {
    process.env.JSII_DEPRECATED = deprecated;
  }
}
