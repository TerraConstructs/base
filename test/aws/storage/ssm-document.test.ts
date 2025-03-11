// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ssm/test/ssm-document.test.ts

import { ssmAssociation } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("parameter", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("association name is rendered properly in L1 construct", () => {
    // WHEN
    new ssmAssociation.SsmAssociation(stack, "Assoc", {
      name: "document",
      parameters: {
        a: JSON.stringify(["a"]),
        B: JSON.stringify([]),
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ssmAssociation.SsmAssociation,
      {
        name: "document",
        parameters: {
          a: '["a"]',
          B: "[]",
        },
      },
    );
  });
});
