import { iamSamlProvider } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  SamlMetadataDocument,
  SamlProvider,
} from "../../../src/aws/iam/saml-provider";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};
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

test("SAML provider", () => {
  new SamlProvider(stack, "Provider", {
    metadataDocument: SamlMetadataDocument.fromXml("document"),
  });

  Template.synth(stack).toHaveResourceWithProperties(
    iamSamlProvider.IamSamlProvider,
    {
      saml_metadata_document: "document",
    },
  );
});

test("SAML provider name", () => {
  new SamlProvider(stack, "Provider", {
    metadataDocument: SamlMetadataDocument.fromXml("document"),
    name: "provider-name",
  });

  Template.synth(stack).toHaveResourceWithProperties(
    iamSamlProvider.IamSamlProvider,
    {
      name: "provider-name",
      saml_metadata_document: "document",
    },
  );
});

test("throws with invalid name", () => {
  expect(
    () =>
      new SamlProvider(stack, "Provider", {
        name: "invalid name",
        metadataDocument: SamlMetadataDocument.fromXml("document"),
      }),
  ).toThrow(/Invalid SAML provider name/);
});
