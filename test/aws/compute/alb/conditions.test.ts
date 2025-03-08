// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancingv2/test/alb/conditions.test.ts

import * as compute from "../../../../src/aws/compute";

describe("tests", () => {
  test("pathPatterns length greater than 5 will throw exception", () => {
    //GIVEN
    const array = ["/u1", "/u2", "/u3", "/u4", "/u5"];

    //WHEN
    compute.ListenerCondition.pathPatterns(array); // Does not throw
    array.push("/u6");

    // THEN
    expect(() => {
      compute.ListenerCondition.pathPatterns(array);
    }).toThrow(/A rule can only have '5' condition values/);
  });
});
