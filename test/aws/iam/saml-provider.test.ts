import { iamSamlProvider } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  SamlMetadataDocument,
  SamlProvider,
} from "../../../src/aws/iam/saml-provider";
import { Template } from "../../assertions";

let stack: AwsStack;
beforeEach(() => {
  const app = Testing.app();
  stack = new AwsStack(app);
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
