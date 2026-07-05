// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/authorizer.test.ts

import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Authorizer, IRestApi } from "../../../src/aws/compute";

describe("authorizer", () => {
  test("isAuthorizer correctly detects an instance of type Authorizer", () => {
    class MyAuthorizer extends Authorizer {
      public readonly authorizerId = "test-authorizer-id";
      public get outputs(): Record<string, any> {
        return {
          authorizerId: this.authorizerId,
        };
      }
      public _attachToApi(_: IRestApi): void {
        // do nothing
      }
    }
    const app = Testing.app();
    const stack = new AwsStack(app);
    const authorizer = new MyAuthorizer(stack, "authorizer");

    expect(Authorizer.isAuthorizer(authorizer)).toEqual(true);
    expect(Authorizer.isAuthorizer(stack)).toEqual(false);
  });
});
