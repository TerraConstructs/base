// https://github.com/aws/aws-cdk/blob/6126413bc6bbc700edf46509a6934ef615f8bbb1/packages/aws-cdk-lib/aws-kms/test/alias.test.ts

import { kmsAlias, dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { App, Testing, TerraformOutput } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec, Arn } from "../../../src/aws";
// import { Grant, IAwsBeaconWithPolicy } from "../../../src/aws/iam/grant";
// import { ManagedPolicy } from "../../../src/aws/iam/managed-policy";
// import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { Alias } from "../../../src/aws/encryption/alias";
import { IKey, Key } from "../../../src/aws/encryption/key";
import { PolicyStatement } from "../../../src/aws/iam/policy-statement";
import {
  ArnPrincipal,
  ServicePrincipal,
} from "../../../src/aws/iam/principals";
import { Role } from "../../../src/aws/iam/role";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("alias", () => {
  let app: App;
  let spec: AwsSpec;

  beforeEach(() => {
    app = Testing.app();
    spec = new AwsSpec(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Spec props to match AWS CDK cross account support
      // account: "1234",
    });
  });

  test("default", () => {
    const key = new Key(spec, "Key");

    new Alias(spec, "Alias", { targetKey: key, aliasName: "alias/foo" });

    Template.synth(spec).toHaveResourceWithProperties(kmsAlias.KmsAlias, {
      name: "alias/foo",
      target_key_id: spec.resolve(key.keyArn),
    });
    // Template.fromStack(spec).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: "alias/foo",
    //   TargetKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
    // });
  });

  test('add "alias/" prefix if not given.', () => {
    const key = new Key(spec, "Key", {
      enableKeyRotation: true,
      enabled: false,
    });

    new Alias(spec, "Alias", {
      aliasName: "foo",
      targetKey: key,
    });

    Template.synth(spec).toHaveResourceWithProperties(kmsAlias.KmsAlias, {
      name: "alias/foo",
      target_key_id: spec.resolve(key.keyArn),
    });
    // Template.fromStack(spec).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: "alias/foo",
    //   TargetKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
    // });
  });

  test("can create alias directly while creating the key", () => {
    const key = new Key(spec, "Key", {
      enableKeyRotation: true,
      enabled: false,
      alias: "foo",
    });

    Template.synth(spec).toHaveResourceWithProperties(kmsAlias.KmsAlias, {
      name: "alias/foo",
      target_key_id: spec.resolve(key.keyArn),
    });
    // Template.fromStack(spec).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: "alias/foo",
    //   TargetKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
    // });
  });

  test('fails if alias is "alias/" (and nothing more)', () => {
    const key = new Key(spec, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
    });

    expect(
      () =>
        new Alias(spec, "Alias", {
          aliasName: "alias/",
          targetKey: key,
        }),
    ).toThrow(/Alias must include a value after/);
  });

  test("fails if alias contains illegal characters", () => {
    const key = new Key(spec, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
    });

    expect(
      () =>
        new Alias(spec, "Alias", {
          aliasName: "alias/@Nope",
          targetKey: key,
        }),
    ).toThrow("a-zA-Z0-9:/_-");
  });

  test('fails if alias starts with "alias/aws/"', () => {
    const key = new Key(spec, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
    });

    expect(
      () =>
        new Alias(spec, "Alias1", {
          aliasName: "alias/aws/",
          targetKey: key,
        }),
    ).toThrow(/Alias cannot start with alias\/aws\/: alias\/aws\//);

    expect(
      () =>
        new Alias(spec, "Alias2", {
          aliasName: "alias/aws/Awesome",
          targetKey: key,
        }),
    ).toThrow(/Alias cannot start with alias\/aws\/: alias\/aws\/Awesome/);

    expect(
      () =>
        new Alias(spec, "Alias3", {
          aliasName: "alias/AWS/awesome",
          targetKey: key,
        }),
    ).toThrow(/Alias cannot start with alias\/aws\/: alias\/AWS\/awesome/);
  });

  // TODO: KMS_ALIAS_NAME_REF feature flag is always true?
  test("keyId includes reference to alias under feature flag", () => {
    // GIVEN
    const myKey = new Key(spec, "MyKey", {
      enableKeyRotation: true,
      enabled: true,
    });
    const myAlias = new Alias(spec, "MyAlias", {
      targetKey: myKey,
      aliasName: "alias/myAlias",
    });

    // WHEN
    new AliasOutputsConstruct(spec, "AliasOutputsConstruct", myAlias);

    // THEN - keyId includes reference to the alias itself
    Template.fromStack(spec).toMatchObject({
      output: {
        OutArn: {
          value:
            "arn:${data.aws_partition.Partitition.partition}:kms:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:${aws_kms_alias.MyAlias_9A08CB8C.name}",
        },
        OutId: {
          value: "${aws_kms_alias.MyAlias_9A08CB8C.name}",
        },
      },
    });
    // Template.fromStack(spec).hasOutput("OutId", {
    //   Value: {
    //     Ref: "MyAlias9A08CB8C",
    //   },
    // });
  });

  test("can be used wherever a key is expected", () => {
    const myKey = new Key(spec, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
    });
    const myAlias = new Alias(spec, "MyAlias", {
      targetKey: myKey,
      aliasName: "alias/myAlias",
    });

    new AliasOutputsConstruct(spec, "AliasOutputsConstruct", myAlias);

    // THEN
    Template.fromStack(spec).toMatchObject({
      // NOTE: AWS CDK doesn't use a token for the alias name
      output: {
        OutArn: {
          value:
            "arn:${data.aws_partition.Partitition.partition}:kms:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:${aws_kms_alias.MyAlias_9A08CB8C.name}",
        },
        OutId: {
          value: "${aws_kms_alias.MyAlias_9A08CB8C.name}",
        },
      },
    });
    // Template.fromStack(spec).hasOutput("OutId", {
    //   Value: "alias/myAlias",
    // });
    // Template.fromStack(spec).hasOutput("OutArn", {
    //   Value: {
    //     "Fn::Join": [
    //       "",
    //       [
    //         "arn:",
    //         { Ref: "AWS::Partition" },
    //         ":kms:",
    //         { Ref: "AWS::Region" },
    //         ":",
    //         { Ref: "AWS::AccountId" },
    //         ":alias/myAlias",
    //       ],
    //     ],
    //   },
    // });
  });

  test("imported alias by name - can be used where a key is expected", () => {
    const myAlias = Alias.fromAliasName(spec, "MyAlias", "alias/myAlias");

    new AliasOutputsConstruct(spec, "AliasOutputsConstruct", myAlias);

    // THEN

    Template.fromStack(spec).toMatchObject({
      output: {
        OutArn: {
          value:
            "arn:${data.aws_partition.Partitition.partition}:kms:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:alias/myAlias",
        },
        OutId: {
          value: "alias/myAlias",
        },
      },
    });
    // Template.fromStack(spec).hasOutput("OutId", {
    //   Value: "alias/myAlias",
    // });
    // Template.fromStack(spec).hasOutput("OutArn", {
    //   Value: {
    //     "Fn::Join": [
    //       "",
    //       [
    //         "arn:",
    //         { Ref: "AWS::Partition" },
    //         ":kms:",
    //         { Ref: "AWS::Region" },
    //         ":",
    //         { Ref: "AWS::AccountId" },
    //         ":alias/myAlias",
    //       ],
    //     ],
    //   },
    // });
  });

  test("imported alias by name - will throw an error when accessing the key", () => {
    const myAlias = Alias.fromAliasName(spec, "MyAlias", "alias/myAlias");

    expect(() => myAlias.aliasTargetKey).toThrow(
      "Cannot access aliasTargetKey on an Alias imported by Alias.fromAliasName().",
    );
  });

  test("fails if alias policy is invalid", () => {
    const key = new Key(spec, "MyKey");
    const alias = new Alias(spec, "Alias", {
      targetKey: key,
      aliasName: "alias/foo",
    });

    alias.addToResourcePolicy(
      new PolicyStatement({
        resources: ["*"],
        principals: [new ArnPrincipal("arn")],
      }),
    );

    expect(() => app.synth()).toThrow(
      /A PolicyStatement must specify at least one \'action\' or \'notAction\'/,
    );
  });

  test("grants generate mac to the alias target key", () => {
    const key = new Key(spec, "Key");
    const alias = new Alias(spec, "Alias", {
      targetKey: key,
      aliasName: "alias/foo",
    });
    const role = new Role(spec, "Role", {
      assumedBy: new ServicePrincipal("sns"),
    });

    alias.grantGenerateMac(role);

    // THEN
    Template.synth(spec).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kms:GenerateMac"],
            effect: "Allow",
            resources: [spec.resolve(key.keyArn)],
          },
        ],
      },
    );
    // Template.fromStack(spec).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "kms:GenerateMac",
    //         Effect: "Allow",
    //         Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    // });
  });

  test("grants generate mac to the alias target key", () => {
    const key = new Key(spec, "Key");
    const alias = new Alias(spec, "Alias", {
      targetKey: key,
      aliasName: "alias/foo",
    });
    const role = new Role(spec, "Role", {
      assumedBy: new ServicePrincipal("sns"),
    });

    alias.grantVerifyMac(role);

    // THEN
    Template.synth(spec).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kms:VerifyMac"],
            effect: "Allow",
            resources: [spec.resolve(key.keyArn)],
          },
        ],
      },
    );
    // Template.fromStack(spec).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "kms:VerifyMac",
    //         Effect: "Allow",
    //         Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    // });
  });

  test("adds alias prefix if its token with valid string prefix", () => {
    const key = new Key(spec, "Key", {
      alias: `MyKey${spec.account}`,
    });

    // THEN
    Template.synth(spec).toHaveResourceWithProperties(kmsAlias.KmsAlias, {
      name: "alias/MyKey${data.aws_caller_identity.CallerIdentity.account_id}",
      target_key_id: spec.resolve(key.keyArn),
    });
    // Template.fromStack(spec).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: {
    //     "Fn::Join": [
    //       "",
    //       [
    //         "alias/MyKey",
    //         {
    //           Ref: "AWS::AccountId",
    //         },
    //       ],
    //     ],
    //   },
    //   TargetKeyId: {
    //     "Fn::GetAtt": ["Key961B73FD", "Arn"],
    //   },
    // });
  });

  test("does not add alias again if already set", () => {
    const key = new Key(spec, "Key", {
      alias: `alias/MyKey${spec.account}`,
    });

    // THEN
    Template.synth(spec).toHaveResourceWithProperties(kmsAlias.KmsAlias, {
      name: "alias/MyKey${data.aws_caller_identity.CallerIdentity.account_id}",
      target_key_id: spec.resolve(key.keyArn),
    });
    // Template.fromStack(spec).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: {
    //     "Fn::Join": [
    //       "",
    //       [
    //         "alias/MyKey",
    //         {
    //           Ref: "AWS::AccountId",
    //         },
    //       ],
    //     ],
    //   },
    //   TargetKeyId: {
    //     "Fn::GetAtt": ["Key961B73FD", "Arn"],
    //   },
    // });
  });

  test("throws error when alias contains illegal characters", () => {
    expect(() => {
      new Key(spec, "Key", {
        alias: `MyK*y${spec.account}`,
      });
    }).toThrow();
  });

  test("does not add alias if starts with token", () => {
    const key = new Key(spec, "Key", {
      alias: `${spec.account}MyKey`,
    });

    // THEN
    Template.synth(spec).toHaveResourceWithProperties(kmsAlias.KmsAlias, {
      name: "${data.aws_caller_identity.CallerIdentity.account_id}MyKey",
      target_key_id: spec.resolve(key.keyArn),
    });
    // Template.fromStack(spec).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: {
    //     "Fn::Join": [
    //       "",
    //       [
    //         {
    //           Ref: "AWS::AccountId",
    //         },
    //         "MyKey",
    //       ],
    //     ],
    //   },
    //   TargetKeyId: {
    //     "Fn::GetAtt": ["Key961B73FD", "Arn"],
    //   },
    // });
  });

  test("aliasArn and keyArn from alias should match", () => {
    const key = new Key(spec, "Key");

    const alias = new Alias(spec, "Alias", {
      targetKey: key,
      aliasName: "alias/foo",
    });

    expect(alias.aliasArn).toEqual(alias.keyArn);
  });

  test("aliasArn should be a valid ARN", () => {
    const key = new Key(spec, "Key");

    const alias = new Alias(spec, "Alias", {
      targetKey: key,
      aliasName: "alias/foo",
    });

    expect(alias.aliasArn).toEqual(
      Arn.format(
        {
          service: "kms",
          // aliasName already contains the '/'
          resource: alias.aliasName,
        },
        spec,
      ),
    );
  });
});

class AliasOutputsConstruct extends Construct {
  constructor(scope: Construct, id: string, key: IKey) {
    super(scope, id);

    new TerraformOutput(scope, "OutId", {
      value: key.keyId,
    });
    new TerraformOutput(scope, "OutArn", {
      value: key.keyArn,
    });
  }
}
