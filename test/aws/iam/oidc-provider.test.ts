import { iamOpenidConnectProvider } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { OpenIdConnectProvider } from "../../../src/aws/iam/oidc-provider";

const arnOfProvider =
  "arn:aws:iam::1234567:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/someid";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};
describe("OpenIdConnectProvider resource", () => {
  test("minimal configuration (no thumbprint)", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new OpenIdConnectProvider(stack, "MyProvider", {
      url: "https://openid-endpoint",
      clientIds: ["266362248691-342342xasdasdasda-apps.googleusercontent.com"],
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    expect(synthesized).toHaveResourceWithProperties(
      iamOpenidConnectProvider.IamOpenidConnectProvider,
      {
        url: "https://openid-endpoint",
        client_id_list: [
          "266362248691-342342xasdasdasda-apps.googleusercontent.com",
        ],
      },
    );
  });

  test('"openIdConnectProviderArn" resolves to the ref', () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const provider = new OpenIdConnectProvider(stack, "MyProvider", {
      url: "https://openid-endpoint",
      clientIds: ["266362248691-342342xasdasdasda-apps.googleusercontent.com"],
    });

    // THEN
    expect(stack.resolve(provider.openIdConnectProviderArn)).toStrictEqual(
      "${aws_iam_openid_connect_provider.MyProvider_730BA1C8.arn}",
    );
  });

  test("static fromOpenIdConnectProviderArn can be used to import a provider", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const provider = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "MyProvider",
      arnOfProvider,
    );

    // THEN
    expect(stack.resolve(provider.openIdConnectProviderArn)).toStrictEqual(
      arnOfProvider,
    );
  });

  test("thumbprint list and client ids can be specified", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    new OpenIdConnectProvider(stack, "MyProvider", {
      url: "https://my-url",
      clientIds: ["client1", "client2"],
      thumbprints: ["thumb1"],
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    expect(synthesized).toHaveResourceWithProperties(
      iamOpenidConnectProvider.IamOpenidConnectProvider,
      {
        url: "https://my-url",
        client_id_list: ["client1", "client2"],
        thumbprint_list: ["thumb1"],
      },
    );
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
