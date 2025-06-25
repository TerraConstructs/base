// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/machine-image/utils.ts

import { Construct } from "constructs";
import { StringParameter, ParameterValueType } from "../../storage/parameter";

export function lookupImage(
  scope: Construct,
  _cachedInContext: boolean | undefined,
  parameterName: string,
) {
  // TODO: Add context lookups via Grid
  return StringParameter.valueForTypedStringParameterV2(
    scope,
    parameterName,
    ParameterValueType.AWS_EC2_IMAGE_ID,
  );
  // return _cachedInContext
  //   ? StringParameter.valueFromLookup(scope, parameterName)
  //   : StringParameter.valueForTypedStringParameterV2(
  //       scope,
  //       parameterName,
  //       ParameterValueType.AWS_EC2_IMAGE_ID,
  //     );
}
