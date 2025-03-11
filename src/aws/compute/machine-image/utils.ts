// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/machine-image/utils.ts

import { Construct } from "constructs";
import * as storage from "../../storage";

export function lookupImage(
  scope: Construct,
  _cachedInContext: boolean | undefined,
  parameterName: string,
) {
  // TODO: Add context lookups via Grid
  return storage.StringParameter.valueForTypedStringParameterV2(
    scope,
    parameterName,
    storage.ParameterValueType.AWS_EC2_IMAGE_ID,
  );
  // return _cachedInContext
  //   ? storage.StringParameter.valueFromLookup(scope, parameterName)
  //   : storage.StringParameter.valueForTypedStringParameterV2(
  //       scope,
  //       parameterName,
  //       storage.ParameterValueType.AWS_EC2_IMAGE_ID,
  //     );
}
