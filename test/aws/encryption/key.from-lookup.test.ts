// https://github.com/aws/aws-cdk/blob/34bdecad76ac93d7dc4f8321352e851cebc75e17/packages/aws-cdk-lib/aws-kms/test/key.from-lookup.test.ts

// import { iamPolicy, dataAwsIamPolicy } from "@cdktf/provider-aws";
import { App, Testing, Lazy } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import { Key } from "../../../src/aws/encryption/key";
// import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("key from lookup", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props?
      // account: "1234",
      // env: { region: "us-east-1", account: "123456789012" },
    });
  });

  test("requires concrete values", () => {
    expect(() => {
      // GIVEN

      Key.fromLookup(stack, "Key", {
        aliasName: Lazy.stringValue({ produce: () => "some-id" }),
      });
    }).toThrow(
      "All arguments to Key.fromLookup() must be concrete (no Tokens)",
    );
  });

  test("return correct key", () => {
    const key = Key.fromLookup(stack, "Key", {
      aliasName: "alias/foo",
    });

    expect(key.keyId).toEqual("alias/foo");
    expect(stack.resolve(key.keyArn)).toEqual(
      "${data.aws_kms_key.Key_961B73FD.arn}",
    );
  });

  // test("return dummy key if returnDummyKeyOnMissing is true", () => {
  //   const key = Key.fromLookup(stack, "Key", {
  //     aliasName: "alias/foo",
  //   });

  //   Template.synth(stack).toMatchSnapshot();
  //   expect(key.keyId).toEqual(Key.DEFAULT_DUMMY_KEY_ID);
  //   // expect(app.synth().manifest.missing).toEqual([
  //   //   {
  //   //     key: "key-provider:account=123456789012:aliasName=alias/foo:region=us-east-1",
  //   //     props: {
  //   //       account: "123456789012",
  //   //       aliasName: "alias/foo",
  //   //       ignoreErrorOnMissingContext: true,
  //   //       lookupRoleArn:
  //   //         "arn:${AWS::Partition}:iam::123456789012:role/cdk-hnb659fds-lookup-role-123456789012-us-east-1",
  //   //       dummyValue: {
  //   //         keyId: "1234abcd-12ab-34cd-56ef-1234567890ab",
  //   //       },
  //   //       region: "us-east-1",
  //   //     },
  //   //     provider: "key-provider",
  //   //   },
  //   // ]);
  // });

  // describe("isLookupDummy method", () => {
  //   // test("return false if the lookup key is not a dummy key", () => {
  //   //   const key = Key.fromLookup(stack, "Key", {
  //   //     aliasName: "alias/foo",
  //   //     returnDummyKeyOnMissing: true,
  //   //   });

  //   //   expect(Key.isLookupDummy(key)).toEqual(false);
  //   // });

  //   test("return true if the lookup key is a dummy key", () => {
  //     const key = Key.fromLookup(stack, "Key", {
  //       aliasName: "alias/foo",
  //       returnDummyKeyOnMissing: true,
  //     });

  //     expect(Key.isLookupDummy(key)).toEqual(true);
  //   });
  // });
});
