// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-ecr/test/auth-token.test.ts

import { dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as iam from "../../../src/aws/iam";
import {
  AuthorizationToken,
  PublicGalleryAuthorizationToken,
} from "../../../src/aws/storage";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("auth-token", () => {
  let stack: AwsStack;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("AuthorizationToken.grantRead()", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("test.service"),
    });

    // WHEN
    AuthorizationToken.grantRead(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["ecr:GetAuthorizationToken"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
  });

  test("PublicGalleryAuthorizationToken.grantRead()", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("test.service"),
    });

    // WHEN
    PublicGalleryAuthorizationToken.grantRead(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "ecr-public:GetAuthorizationToken",
              "sts:GetServiceBearerToken",
            ],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
  });
});
