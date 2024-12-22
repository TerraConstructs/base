// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-cloudwatch/lib/private/object.ts

export function dropUndefined<T extends object>(x: T): T {
  if (x === null) {
    return x;
  }
  const ret: any = {};
  for (const [key, value] of Object.entries(x)) {
    if (value !== undefined) {
      ret[key] = value;
    }
  }
  return ret;
}
