// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/key-pair.test.ts

import { keyPair as tfKeyPair } from "@cdktf/provider-aws";
import { privateKey } from "@cdktf/provider-tls";
import { App, Testing, TerraformOutput } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  KeyPair,
  // KeyPairFormat,
  KeyPairType,
  OperatingSystemType,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("Key Pair", () => {
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

  test("basic test", () => {
    // WHEN
    new KeyPair(stack, "KeyPair");

    // THEN
    Template.resources(stack, tfKeyPair.KeyPair).toHaveLength(1);
  });

  it("automatically generates a name", () => {
    // WHEN
    const keyPair = new KeyPair(stack, "TestKeyPair");

    // THEN
    expect(keyPair.keyPairName).toBeTruthy();
    Template.synth(stack).toHaveResourceWithProperties(tfKeyPair.KeyPair, {
      key_name: expect.stringMatching(/\\w{1,255}/),
    });
  });

  it("defaults to RSA type", () => {
    // WHEN
    const keyPair = new KeyPair(stack, "TestKeyPair");

    // THEN
    expect(keyPair.type).toBe(KeyPairType.RSA);
  });

  it("correctly renders RSA", () => {
    // WHEN
    new KeyPair(stack, "TestKeyPair", {
      type: KeyPairType.RSA,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(privateKey.PrivateKey, {
      algorithm: "RSA",
    });
  });

  it("correctly renders ED25519", () => {
    // WHEN
    new KeyPair(stack, "TestKeyPair", {
      type: KeyPairType.ED25519,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(privateKey.PrivateKey, {
      KeyType: "ED25519",
    });
  });

  // it("correctly renders PEM", () => {
  //   // WHEN
  //   new KeyPair(stack, "TestKeyPair", {
  //     format: KeyPairFormat.PEM,
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties("AWS::EC2::KeyPair", {
  //     KeyFormat: "pem",
  //   });
  // });

  // it("correctly renders PPK", () => {
  //   // WHEN
  //   new KeyPair(stack, "TestKeyPair", {
  //     format: KeyPairFormat.PPK,
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties("AWS::EC2::KeyPair", {
  //     KeyFormat: "ppk",
  //   });
  // });

  it("asserts unknown type is compatible with all OSes", () => {
    // WHEN
    const keyPair = KeyPair.fromKeyPairName(stack, "KeyPair", "KeyPairName");

    // THEN
    expect(keyPair._isOsCompatible(OperatingSystemType.LINUX)).toBe(true);
    expect(keyPair._isOsCompatible(OperatingSystemType.WINDOWS)).toBe(true);
    expect(keyPair._isOsCompatible(OperatingSystemType.UNKNOWN)).toBe(true);
  });

  it("asserts RSA keys are compatible with all OSes", () => {
    // WHEN
    const keyPair = new KeyPair(stack, "KeyPair", {
      type: KeyPairType.RSA,
    });

    // THEN
    expect(keyPair._isOsCompatible(OperatingSystemType.LINUX)).toBe(true);
    expect(keyPair._isOsCompatible(OperatingSystemType.WINDOWS)).toBe(true);
    expect(keyPair._isOsCompatible(OperatingSystemType.UNKNOWN)).toBe(true);
  });

  it("aserts ED25519 keys are incompatible with Windows", () => {
    // WHEN
    const keyPair = new KeyPair(stack, "KeyPair", {
      type: KeyPairType.ED25519,
    });

    // THEN
    expect(keyPair._isOsCompatible(OperatingSystemType.WINDOWS)).toBe(false);
  });

  it("forbids specifying both publicKeyMaterial and type", () => {
    // THEN
    expect(
      () =>
        new KeyPair(stack, "KeyPair", {
          publicKeyMaterial: "ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAA",
          type: KeyPairType.ED25519,
        }),
    ).toThrow("Cannot specify 'type' for keys with imported material");
  });

  it("returns a reference to SSM parameter for non-imported keys", () => {
    // WHEN
    const keyPair = new KeyPair(stack, "TestKeyPair");
    new TerraformOutput(stack, "TestOutput", {
      value: keyPair.privateKey.parameterName,
    });

    // THEN
    expect(keyPair.privateKey).toBeTruthy();
    Template.expectOutput(stack, "TestOutput").toMatchObject({
      value: stack.resolve(`/ec2/keypair/${keyPair.keyPairId}`),
    });
  });

  it("throws an error when accessing the SSM parameter for an imported key", () => {
    // WHEN
    const keyPair = new KeyPair(stack, "TestKeyPair", {
      publicKeyMaterial:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7jpNzG+YG0s+xIGWbxrxIZiiozHOEuzIJacvASP0mq",
    });

    // THEN
    expect(() => keyPair.privateKey).toThrow(
      "An SSM parameter with private key material is not created for imported keys",
    );
  });
});
