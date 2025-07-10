// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/authorizer.test.ts

import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Authorizer, IRestApi } from "../../../src/aws/compute";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

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
    const stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const authorizer = new MyAuthorizer(stack, "authorizer");

    expect(Authorizer.isAuthorizer(authorizer)).toEqual(true);
    expect(Authorizer.isAuthorizer(stack)).toEqual(false);
  });
});
