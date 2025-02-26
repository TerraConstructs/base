// https://github.com/aws/aws-cdk/blob/23238774aa3ca9a80dd406a43e51c3a6bbb68d42/packages/aws-cdk-lib/aws-kms/test/key.test.ts

import { kmsKey, dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { App, Testing, TerraformOutput, Fn } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack, Tags } from "../../../src/aws";
import { IKey, Key, KeySpec, KeyUsage } from "../../../src/aws/encryption/key";
import * as iam from "../../../src/aws/iam";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const ADMIN_ACTIONS: string[] = [
  "kms:Create*",
  "kms:Describe*",
  "kms:Enable*",
  "kms:List*",
  "kms:Put*",
  "kms:Update*",
  "kms:Revoke*",
  "kms:Disable*",
  "kms:Get*",
  "kms:Delete*",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:ScheduleKeyDeletion",
  "kms:CancelKeyDeletion",
];

describe("key", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Spec props?
      // account: "1234",
      // region: "us-east-1",
    });
  });

  test("default", () => {
    new Key(stack, "MyKey");
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kms:*"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                ],
                type: "AWS",
              },
            ],
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResource("AWS::KMS::Key", {
    //   Properties: {
    //     KeyPolicy: {
    //       Statement: [
    //         {
    //           Action: "kms:*",
    //           Effect: "Allow",
    //           Principal: {
    //             AWS: {
    //               "Fn::Join": [
    //                 "",
    //                 [
    //                   "arn:",
    //                   { Ref: "AWS::Partition" },
    //                   ":iam::",
    //                   { Ref: "AWS::AccountId" },
    //                   ":root",
    //                 ],
    //               ],
    //             },
    //           },
    //           Resource: "*",
    //         },
    //       ],
    //       Version: "2012-10-17",
    //     },
    //   },
    //   DeletionPolicy: "Retain",
    //   UpdateReplacePolicy: "Retain",
    // });
  });

  // test("default with no retention", () => {
  //   new Key(stack, "MyKey", { removalPolicy: cdk.RemovalPolicy.DESTROY });

  //    Template.synth(stack).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResource("AWS::KMS::Key", {
  //   //   DeletionPolicy: "Delete",
  //   //   UpdateReplacePolicy: "Delete",
  //   // });
  // });

  describe("policies", () => {
    test("can specify a default key policy", () => {
      const policy = new iam.PolicyDocument(stack, "Policy");
      const statement = new iam.PolicyStatement({
        resources: ["*"],
        actions: ["kms:Put*"],
      });
      statement.addArnPrincipal("arn:aws:iam::111122223333:root");
      policy.addStatements(statement);

      new Key(stack, "MyKey", { policy });

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["kms:Put*"],
              effect: "Allow",
              principals: [
                {
                  identifiers: ["arn:aws:iam::111122223333:root"],
                  type: "AWS",
                },
              ],
              resources: ["*"],
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:Put*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: "arn:aws:iam::111122223333:root",
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    test("cross region key with iam role grant", () => {
      const key = Key.fromKeyArn(
        stack,
        "Key",
        "arn:aws:kms:eu-north-1:000000000000:key/e3ab59e5-3dc3-4bc4-9c3f-c790231d2287",
      );

      const roleSpec = new AwsStack(app, "RoleStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
        // TODO: Should support passing account via Spec props?
        // account: "1234",
        // env: { account: "000000000000", region: "eu-north-1" },
      });
      const role = new iam.Role(roleSpec, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });
      key.grantEncryptDecrypt(role);

      Template.synth(roleSpec).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "kms:Decrypt",
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              resources: ["*"],
            },
          ],
        },
      );
      // TODO: This does not match AWS-CDK behavior
      // Template.fromStack(roleSpec).hasResourceProperties("AWS::IAM::Policy", {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Effect: "Allow",
      //         Resource:
      //           "arn:aws:kms:eu-north-1:000000000000:key/e3ab59e5-3dc3-4bc4-9c3f-c790231d2287",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    // test("cross region key with iam role grant when feature flag is disabled", () => {
    //   // env: { account: "000000000000", region: "us-west-2" },
    //   const key = Key.fromKeyArn(
    //     stack,
    //     "Key",
    //     "arn:aws:kms:eu-north-1:000000000000:key/e3ab59e5-3dc3-4bc4-9c3f-c790231d2287",
    //   );

    //   const roleSpec = new AwsStack(app, "RoleStack", {
    //     environmentName,
    //     gridUUID,
    //     providerConfig,
    //     gridBackendConfig,
    //     // TODO: Should support passing account via Spec props?
    //     // account: "1234",
    //     // env: { account: "000000000000", region: "eu-north-1" },
    //   });
    //   const role = new iam.Role(roleSpec, "Role", {
    //     assumedBy: new iam.AccountPrincipal("000000000000"),
    //   });
    //   key.grantEncryptDecrypt(role);

    //   // Template.synth(roleSpec).toMatchSnapshot();
    //   // Template.fromStack(roleStack).hasResourceProperties("AWS::IAM::Policy", {
    //   //   PolicyDocument: {
    //   //     Statement: [
    //   //       {
    //   //         Effect: "Allow",
    //   //         Resource: "*",
    //   //       },
    //   //     ],
    //   //     Version: "2012-10-17",
    //   //   },
    //   // });
    // });

    test("can append to the default key policy", () => {
      const statement = new iam.PolicyStatement({
        resources: ["*"],
        actions: ["kms:Put*"],
      });
      statement.addArnPrincipal("arn:aws:iam::111122223333:root");

      const key = new Key(stack, "MyKey");
      key.addToResourcePolicy(statement);

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["kms:*"],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                  ],
                  type: "AWS",
                },
              ],
              resources: ["*"],
            },
            {
              actions: ["kms:Put*"],
              effect: "Allow",
              principals: [
                {
                  identifiers: ["arn:aws:iam::111122223333:root"],
                  type: "AWS",
                },
              ],
              resources: ["*"],
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //       {
      //         Action: "kms:Put*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: "arn:aws:iam::111122223333:root",
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    test("decrypt", () => {
      // GIVEN
      const key = new Key(stack, "Key");
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.ServicePrincipal("sns"),
      });

      // WHEN
      key.grantDecrypt(role);

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            // Key policy should be unmodified by the grant.

            Key_Policy_48E51E45: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
            // Role policy should have been updated.
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: ["kms:Decrypt"],
                  effect: "Allow",
                  resources: ["${aws_kms_key.Key_961B73FD.arn}"],
                },
              ],
            },
          },
        },
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });

      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: "kms:Decrypt",
      //         Effect: "Allow",
      //         Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    test("encrypt", () => {
      // GIVEN
      const key = new Key(stack, "Key");
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.ServicePrincipal("sns"),
      });

      // WHEN
      key.grantEncrypt(role);

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            // Key policy should be unmodified by the grant.
            Key_Policy_48E51E45: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
            // Role policy should have been updated.
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: [
                    "kms:Encrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                  ],
                  effect: "Allow",
                  resources: ["${aws_kms_key.Key_961B73FD.arn}"],
                },
              ],
            },
          },
        },
      });
      // Key policy should be unmodified by the grant.
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });

      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: ["kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
      //         Effect: "Allow",
      //         Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    // TODO: Fix cyclic dependency resolving cross stack references
    test("grant for a principal in a dependent stack works correctly", () => {
      const principalSpec = new AwsStack(app, "PrincipalStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
        // TODO: Should support passing account via Spec props?
        // account: "1234",
        // region: "us-east-1",
      });
      const principal = new iam.Role(principalSpec, "Role", {
        assumedBy: new iam.AnyPrincipal(),
      });

      const key = new Key(stack, "Key");

      //TODO: principalSpec.addDependency causes Template.synth(stack) (at prepareStack() -> expression.resolve())
      // to throw cyclic dependency resolving cross stack references
      // at https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/terraform-stack.ts#L444
      // at https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/app.ts#L177
      // at https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/tfExpression.ts#L172
      principalSpec.addDependency(stack);

      key.grantEncrypt(principal);

      Template.synth(principalSpec).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              resources: ["*"], // TODO: AWS-CDK cross stack ref to key ARN here
            },
          ],
        },
      );
      // // NOTE: keyStack DOES include cross-stack reference to principalStack
      // Template.synth(stack).toHaveDataSourceWithProperties(
      //   dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      //   {
      //     statement: expect.arrayContaining([
      //       {
      //         actions: [
      //           "kms:Encrypt",
      //           "kms:ReEncrypt*",
      //           "kms:GenerateDataKey*",
      //         ],
      //         effect: "Allow",
      //         principals: [
      //           {
      //             identifiers: [
      //               "${data.terraform_remote_state.cross-stack-reference-input-PrincipalStack.outputs.cross-stack-output-aws_iam_roleRole_1ABCC5F0arn}",
      //             ],
      //             type: "AWS",
      //           },
      //         ],
      //         resources: ["*"],
      //       },
      //     ]),
      //   },
      // );
      // Template.fromStack(principalSpec).hasResourceProperties(
      //   "AWS::IAM::Policy",
      //   {
      //     PolicyDocument: {
      //       Statement: [
      //         {
      //           Action: [
      //             "kms:Encrypt",
      //             "kms:ReEncrypt*",
      //             "kms:GenerateDataKey*",
      //           ],
      //           Effect: "Allow",
      //           Resource: {
      //             "Fn::ImportValue":
      //               "KeyStack:ExportsOutputFnGetAttKey961B73FDArn5A860C43",
      //           },
      //         },
      //       ],
      //       Version: "2012-10-17",
      //     },
      //   },
      // );
    });

    test("grant for a principal in a different region", () => {
      const principalSpec = new AwsStack(app, "PrincipalStack", {
        environmentName,
        gridUUID,
        gridBackendConfig,
        // TODO: Should support passing account via Spec props?
        // env: { region: "testregion1" },
        providerConfig: {
          region: "testregion1",
        },
      });
      const principal = new iam.Role(principalSpec, "Role", {
        assumedBy: new iam.AnyPrincipal(),
        roleName: "MyRolePhysicalName",
      });

      // env: { region: "testregion2" },
      const key = new Key(stack, "Key");

      key.grantEncrypt(principal);

      // Do prepare run to resolve/add all Terraform resources
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            {
              actions: [
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    // TODO: AWS-CDK refers to iam role ARN instead...
                    // "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:role/MyRolePhysicalName",
                    "${data.terraform_remote_state.cross-stack-reference-input-PrincipalStack.outputs.cross-stack-output-aws_iam_roleRole_1ABCC5F0arn}",
                  ],
                  type: "AWS",
                },
              ],
              resources: ["*"],
            },
          ]),
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: Match.arrayWith([
      //       {
      //         Action: ["kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":role/MyRolePhysicalName",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ]),
      //     Version: "2012-10-17",
      //   },
      // });
      Template.synth(principalSpec).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              resources: ["*"],
            },
          ],
        },
      );
      // Template.fromStack(principalStack).hasResourceProperties(
      //   "AWS::IAM::Policy",
      //   {
      //     PolicyDocument: {
      //       Statement: [
      //         {
      //           Action: [
      //             "kms:Encrypt",
      //             "kms:ReEncrypt*",
      //             "kms:GenerateDataKey*",
      //           ],
      //           Effect: "Allow",
      //           Resource: "*",
      //         },
      //       ],
      //       Version: "2012-10-17",
      //     },
      //   },
      // );
    });

    // TODO: cross account only works if the account can be provided through Spec props
    test("grant for a principal in a different account", () => {
      const principalStack = new AwsStack(app, "PrincipalStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
        // TODO: Should support passing account via Spec props?
        // env: { account: "0123456789012" },
      });
      const principal = new iam.Role(principalStack, "Role", {
        assumedBy: new iam.AnyPrincipal(),
        roleName: "MyRolePhysicalName",
      });

      // env: { account: "111111111111" },
      const key = new Key(stack, "Key");

      key.grantEncrypt(principal);

      // Do prepare run to resolve/add all Terraform resources
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: expect.arrayContaining([
            {
              actions: [
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              principals: [
                {
                  identifiers: [
                    // TODO: AWS-CDK refers to iam role ARN instead...
                    // "arn:${data.aws_partition.Partitition.partition}:iam::0123456789012:role/MyRolePhysicalName",
                    "${data.terraform_remote_state.cross-stack-reference-input-PrincipalStack.outputs.cross-stack-output-aws_iam_roleRole_1ABCC5F0arn}",
                  ],
                  type: "AWS",
                },
              ],
              resources: ["*"],
            },
          ]),
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: Match.arrayWith([
      //       {
      //         Action: ["kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::0123456789012:role/MyRolePhysicalName",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ]),
      //     Version: "2012-10-17",
      //   },
      // });
      Template.synth(principalStack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "kms:Encrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
              ],
              effect: "Allow",
              resources: ["*"],
            },
          ],
        },
      );
      // Template.fromStack(principalStack).hasResourceProperties(
      //   "AWS::IAM::Policy",
      //   {
      //     PolicyDocument: {
      //       Statement: [
      //         {
      //           Action: [
      //             "kms:Encrypt",
      //             "kms:ReEncrypt*",
      //             "kms:GenerateDataKey*",
      //           ],
      //           Effect: "Allow",
      //           Resource: "*",
      //         },
      //       ],
      //       Version: "2012-10-17",
      //     },
      //   },
      // );
    });

    test("grant for an immutable role", () => {
      const principalStack = new AwsStack(app, "PrincipalStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
        // TODO: Should support passing account via Spec props?
        // env: { account: "0123456789012" },
      });
      const principal = new iam.Role(principalStack, "Role", {
        assumedBy: new iam.AnyPrincipal(),
        roleName: "MyRolePhysicalName",
      });

      // env: { account: "111111111111" },
      const key = new Key(stack, "Key");
      //TODO: This causes stack.prepareStack() to throw cyclic dependency resolving cross stack references
      // at https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/terraform-stack.ts#L444
      // at https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/app.ts#L177
      // principalStack.addDependency(stack);
      key.grantEncrypt(principal.withoutPolicyUpdates());

      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            Key_Policy_48E51E45: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
                {
                  actions: [
                    "kms:Encrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                  ],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        // TODO: AWS-CDK refers to account principal ARN instead...
                        // "arn:${data.aws_partition.Partitition.partition}:iam::0123456789012:root",
                        "${data.terraform_remote_state.cross-stack-reference-input-PrincipalStack.outputs.cross-stack-output-aws_iam_roleRole_1ABCC5F0arn}",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
          },
        },
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: Match.arrayWith([
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::111111111111:root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //       {
      //         Action: ["kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::0123456789012:root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ]),
      //     Version: "2012-10-17",
      //   },
      // });
    });

    test("additional key admins can be specified (with imported/immutable principal)", () => {
      const adminRole = iam.Role.fromRoleArn(
        stack,
        "Admin",
        "arn:aws:iam::123456789012:role/TrustedAdmin",
      );
      new Key(stack, "MyKey", { admins: [adminRole] });

      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            MyKey_Policy_A23B479B: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
                {
                  actions: ADMIN_ACTIONS,
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:aws:iam::123456789012:role/TrustedAdmin",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
            Admin_Policy_A549F37C: {
              statement: [
                {
                  actions: ADMIN_ACTIONS,
                  effect: "Allow",
                  resources: ["${aws_kms_key.MyKey_6AB29FA6.arn}"],
                },
              ],
            },
          },
        },
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //       {
      //         Action: ADMIN_ACTIONS,
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: "arn:aws:iam::123456789012:role/TrustedAdmin",
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    test("additional key admins can be specified (with owned/mutable principal)", () => {
      const adminRole = new iam.Role(stack, "AdminRole", {
        assumedBy: new iam.AccountRootPrincipal(),
      });
      new Key(stack, "MyKey", { admins: [adminRole] });

      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            // Unmodified - default key policy
            MyKey_Policy_A23B479B: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
            AdminRole_DefaultPolicy_81DC999B: {
              statement: [
                {
                  actions: ADMIN_ACTIONS,
                  effect: "Allow",
                  resources: ["${aws_kms_key.MyKey_6AB29FA6.arn}"],
                },
              ],
            },
          },
        },
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     // Unmodified - default key policy
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: ADMIN_ACTIONS,
      //         Effect: "Allow",
      //         Resource: { "Fn::GetAtt": ["MyKey6AB29FA6", "Arn"] },
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });
  });

  test("with some options", () => {
    const key = new Key(stack, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
      pendingWindow: Duration.days(7),
      rotationPeriod: Duration.days(180),
    });

    Tags.of(key).add("tag1", "value1");
    Tags.of(key).add("tag2", "value2");
    Tags.of(key).add("tag3", "");

    Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
      deletion_window_in_days: 7,
      enable_key_rotation: true,
      is_enabled: false,
      policy: "${data.aws_iam_policy_document.MyKey_Policy_A23B479B.json}",
      rotation_period_in_days: 180,
      tags: {
        tag1: "value1",
        tag2: "value2",
        tag3: "",
      },
    });

    // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
    //   Enabled: false,
    //   EnableKeyRotation: true,
    //   PendingWindowInDays: 7,
    //   RotationPeriodInDays: 180,
    //   Tags: [
    //     {
    //       Key: "tag1",
    //       Value: "value1",
    //     },
    //     {
    //       Key: "tag2",
    //       Value: "value2",
    //     },
    //     {
    //       Key: "tag3",
    //       Value: "",
    //     },
    //   ],
    // });
  });

  test("set rotationPeriod without enabling enableKeyRotation", () => {
    new Key(stack, "MyKey", {
      rotationPeriod: Duration.days(180),
    });

    Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
      enable_key_rotation: true,
      rotation_period_in_days: 180,
    });
    // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
    //   EnableKeyRotation: true,
    //   RotationPeriodInDays: 180,
    // });
  });

  test("setting pendingWindow value to not in allowed range will throw", () => {
    expect(
      () =>
        new Key(stack, "MyKey", {
          enableKeyRotation: true,
          pendingWindow: Duration.days(6),
        }),
    ).toThrow("'pendingWindow' value must between 7 and 30 days. Received: 6");
  });

  test.each([89, 2561])(
    "throw if rotationPeriod is not in allowed range",
    (period) => {
      expect(
        () =>
          new Key(stack, "MyKey", {
            enableKeyRotation: true,
            rotationPeriod: Duration.days(period),
          }),
      ).toThrow(
        `'rotationPeriod' value must between 90 and 2650 days. Received: ${period}`,
      );
    },
  );

  // describe("trustAccountIdentities is deprecated", () => {
  //   test("setting trustAccountIdentities to false will throw (when the defaultKeyPolicies feature flag is enabled)", () => {
  //     expect(
  //       () => new Key(stack, "MyKey", { trustAccountIdentities: false }),
  //     ).toThrow(
  //       "`trustAccountIdentities` cannot be false if the @aws-cdk/aws-kms:defaultKeyPolicies feature flag is set",
  //     );
  //   });
  // });

  test("addAlias creates an alias", () => {
    const key = new Key(stack, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
    });

    const alias = key.addAlias("alias/xoo");
    expect(alias.aliasName).toBeDefined();

    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_kms_alias: {
          MyKey_Alias_1B45D9DA: {
            name: "alias/xoo",
            target_key_id: "${aws_kms_key.MyKey_6AB29FA6.arn}",
          },
        },
      },
    });
    // Template.fromStack(stack).resourceCountIs("AWS::KMS::Alias", 1);
    // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: "alias/xoo",
    //   TargetKeyId: {
    //     "Fn::GetAtt": ["MyKey6AB29FA6", "Arn"],
    //   },
    // });
  });

  test("can run multiple addAlias", () => {
    const key = new Key(stack, "MyKey", {
      enableKeyRotation: true,
      enabled: false,
    });

    const alias1 = key.addAlias("alias/alias1");
    const alias2 = key.addAlias("alias/alias2");
    expect(alias1.aliasName).toBeDefined();
    expect(alias2.aliasName).toBeDefined();

    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_kms_alias: {
          MyKey_Alias_1B45D9DA: {
            name: "alias/alias1",
            target_key_id: "${aws_kms_key.MyKey_6AB29FA6.arn}",
          },
          "MyKey_Aliasalias--alias2_EC56BD3E": {
            name: "alias/alias2",
            target_key_id: "${aws_kms_key.MyKey_6AB29FA6.arn}",
          },
        },
      },
    });
    // Template.fromStack(stack).resourceCountIs("AWS::KMS::Alias", 2);
    // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: "alias/alias1",
    //   TargetKeyId: {
    //     "Fn::GetAtt": ["MyKey6AB29FA6", "Arn"],
    //   },
    // });
    // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Alias", {
    //   AliasName: "alias/alias2",
    //   TargetKeyId: {
    //     "Fn::GetAtt": ["MyKey6AB29FA6", "Arn"],
    //   },
    // });
  });

  test("keyId resolves to a Ref", () => {
    const key = new Key(stack, "MyKey");

    new TerraformOutput(stack, "Out", {
      value: key.keyId,
    });

    Template.fromStack(stack).toMatchObject({
      output: {
        Out: {
          value: "${aws_kms_key.MyKey_6AB29FA6.id}",
        },
      },
    });
    // Template.fromStack(stack).hasOutput("Out", {
    //   Value: { Ref: "MyKey6AB29FA6" },
    // });
  });

  test("fails if key policy has no actions", () => {
    const key = new Key(stack, "MyKey");

    key.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );

    expect(() => app.synth()).toThrow(
      /A PolicyStatement must specify at least one \'action\' or \'notAction\'/,
    );
  });

  test("fails if key policy has no IAM principals", () => {
    const key = new Key(stack, "MyKey");

    key.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["kms:*"],
      }),
    );

    expect(() => app.synth()).toThrow(
      /A PolicyStatement used in a resource-based policy must specify at least one IAM principal/,
    );
  });

  test("multi-region primary key", () => {
    new Key(stack, "MyKey", {
      multiRegion: true,
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_kms_key: {
          MyKey_6AB29FA6: {
            multi_region: true,
          },
        },
      },
    });
    // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
    //   MultiRegion: true,
    // });
  });

  describe("imported keys", () => {
    test("throw an error when providing something that is not a valid key ARN", () => {
      expect(() => {
        Key.fromKeyArn(
          stack,
          "Imported",
          "arn:aws:kms:us-east-1:123456789012:key",
        );
      }).toThrow(
        /KMS key ARN must be in the format 'arn:<partition>:kms:<region>:<account>:key\/<keyId>', got: 'arn:aws:kms:us-east-1:123456789012:key'/,
      );
    });

    test("can have aliases added to them", () => {
      const myKeyImported = Key.fromKeyArn(
        stack,
        "MyKeyImported",
        "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012",
      );

      // addAlias can be called on imported keys.
      myKeyImported.addAlias("alias/hello");

      expect(myKeyImported.keyId).toEqual(
        "12345678-1234-1234-1234-123456789012",
      );

      Template.fromStack(stack).toMatchObject({
        resource: {
          aws_kms_alias: {
            MyKeyImported_Alias_B1C5269F: {
              name: "alias/hello",
              target_key_id:
                "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012",
            },
          },
        },
      });
      // Template.fromStack(stack).templateMatches({
      //   Resources: {
      //     MyKeyImportedAliasB1C5269F: {
      //       Type: "AWS::KMS::Alias",
      //       Properties: {
      //         AliasName: "alias/hello",
      //         TargetKeyId:
      //           "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012",
      //       },
      //     },
      //   },
      // });
    });
  });

  describe("fromTfKey()", () => {
    let tfKey: kmsKey.KmsKey;
    let key: IKey;

    beforeEach(() => {
      tfKey = new kmsKey.KmsKey(stack, "TfKey", {
        policy: JSON.stringify({
          Statement: [
            {
              Action: "kms:*",
              Effect: "Allow",
              Principal: {
                AWS: `arn:\${data.aws_partition.Partitition.partition}:iam::000000000000:root`,
              },
              Resource: "*",
            },
          ],
          Version: "2012-10-17",
        }),
      });
      key = Key.fromTfKey(tfKey);
    });

    test("correctly resolves the 'keyId' property", () => {
      expect(stack.resolve(key.keyId)).toStrictEqual("${aws_kms_key.TfKey.id}");
    });

    test("correctly resolves the 'keyArn' property", () => {
      expect(stack.resolve(key.keyArn)).toStrictEqual(
        "${aws_kms_key.TfKey.arn}",
      );
    });

    test("preserves the KMS Key resource", () => {
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            TfKey_Policy_ADFAE4B9: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::000000000000:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
          },
        },
        resource: {
          aws_kms_key: {
            TfKey: {
              policy:
                "${data.aws_iam_policy_document.TfKey_Policy_ADFAE4B9.json}",
            },
          },
        },
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
      // Template.fromStack(stack).resourceCountIs("AWS::KMS::Key", 1);
    });

    describe("calling 'addToResourcePolicy()' on the returned Key", () => {
      let addToResourcePolicyResult: iam.AddToResourcePolicyResult;

      beforeEach(() => {
        addToResourcePolicyResult = key.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ["kms:action"],
            resources: ["*"],
            principals: [new iam.AnyPrincipal()],
          }),
        );
      });

      test("the AddToResourcePolicyResult returned has 'statementAdded' set to 'true'", () => {
        expect(addToResourcePolicyResult.statementAdded).toBeTruthy();
      });

      test("preserves the mutating call in the resulting template", () => {
        Template.fromStack(stack).toMatchObject({
          data: {
            aws_iam_policy_document: {
              TfKey_Policy_ADFAE4B9: {
                statement: [
                  {
                    actions: ["kms:*"],
                    effect: "Allow",
                    principals: [
                      {
                        identifiers: [
                          "arn:${data.aws_partition.Partitition.partition}:iam::000000000000:root",
                        ],
                        type: "AWS",
                      },
                    ],
                    resources: ["*"],
                  },
                  {
                    actions: ["kms:action"],
                    effect: "Allow",
                    principals: [
                      {
                        identifiers: ["*"],
                        type: "AWS",
                      },
                    ],
                    resources: ["*"],
                  },
                ],
              },
            },
          },
        });
        // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
        //   KeyPolicy: {
        //     Statement: [
        //       {
        //         Action: "kms:*",
        //         Effect: "Allow",
        //         Principal: {
        //           AWS: {
        //             "Fn::Join": [
        //               "",
        //               [
        //                 "arn:",
        //                 { Ref: "AWS::Partition" },
        //                 ":iam::",
        //                 { Ref: "AWS::AccountId" },
        //                 ":root",
        //               ],
        //             ],
        //           },
        //         },
        //         Resource: "*",
        //       },
        //       {
        //         Action: "kms:action",
        //         Effect: "Allow",
        //         Principal: { AWS: "*" },
        //         Resource: "*",
        //       },
        //     ],
        //     Version: "2012-10-17",
        //   },
        // });
      });
    });

    describe("calling fromTfKey() again", () => {
      beforeEach(() => {
        key = Key.fromTfKey(tfKey);
      });

      describe("and using it for grantDecrypt() on a Role", function () {
        beforeEach(() => {
          const role = new iam.Role(stack, "Role", {
            assumedBy: new iam.AnyPrincipal(),
          });
          key.grantDecrypt(role);
        });

        test("creates the correct IAM Policy", () => {
          Template.fromStack(stack).toMatchObject({
            data: {
              aws_iam_policy_document: {
                Role_DefaultPolicy_2E5E5E0B: {
                  statement: [
                    {
                      actions: ["kms:Decrypt"],
                      effect: "Allow",
                      resources: ["${aws_kms_key.TfKey.arn}"],
                    },
                  ],
                },
              },
            },
          });
          // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
          //   PolicyDocument: {
          //     Statement: [
          //       {
          //         Action: "kms:Decrypt",
          //         Effect: "Allow",
          //         Resource: {
          //           "Fn::GetAtt": ["CfnKey", "Arn"],
          //         },
          //       },
          //     ],
          //   },
          // });
        });

        test("correctly mutates the Policy of the underlying CfnKey", () => {
          Template.fromStack(stack).toMatchObject({
            data: {
              aws_iam_policy_document: {
                TfKey_Policy_ADFAE4B9: {
                  statement: [
                    {
                      actions: ["kms:*"],
                      effect: "Allow",
                      principals: [
                        {
                          identifiers: [
                            "arn:${data.aws_partition.Partitition.partition}:iam::000000000000:root",
                          ],
                          type: "AWS",
                        },
                      ],
                      resources: ["*"],
                    },
                    {
                      actions: ["kms:Decrypt"],
                      effect: "Allow",
                      principals: [
                        {
                          identifiers: ["${aws_iam_role.Role_1ABCC5F0.arn}"],
                          type: "AWS",
                        },
                      ],
                      resources: ["*"],
                    },
                  ],
                },
              },
            },
          });
          // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
          //   KeyPolicy: {
          //     Statement: [
          //       {
          //         Action: "kms:*",
          //         Effect: "Allow",
          //         Principal: {
          //           AWS: {
          //             "Fn::Join": [
          //               "",
          //               [
          //                 "arn:",
          //                 { Ref: "AWS::Partition" },
          //                 ":iam::",
          //                 { Ref: "AWS::AccountId" },
          //                 ":root",
          //               ],
          //             ],
          //           },
          //         },
          //         Resource: "*",
          //       },
          //       {
          //         Action: "kms:Decrypt",
          //         Effect: "Allow",
          //         Principal: {
          //           AWS: {
          //             "Fn::GetAtt": ["Role1ABCC5F0", "Arn"],
          //           },
          //         },
          //         Resource: "*",
          //       },
          //     ],
          //     Version: "2012-10-17",
          //   },
          // });
        });
      });
    });

    describe("called with a tfKey that has an 'Fn' passed as the KeyPolicy", () => {
      beforeEach(() => {
        tfKey = new kmsKey.KmsKey(stack, "CfnKey2", {
          policy: Fn.element(
            [
              JSON.stringify({
                Statement: [
                  {
                    Action: "kms:action1",
                    Effect: "Allow",
                    Principal: "*",
                    Resource: "*",
                  },
                ],
                Version: "2012-10-17",
              }),
              JSON.stringify({
                Statement: [
                  {
                    Action: "kms:action2",
                    Effect: "Allow",
                    Principal: "*",
                    Resource: "*",
                  },
                ],
                Version: "2012-10-17",
              }),
            ],
            0,
          ),
        });
      });

      test("throws a descriptive exception", () => {
        expect(() => {
          Key.fromTfKey(tfKey);
        }).toThrow(/Could not resolve the passed aws_kms_key policy attribute/);
      });
    });

    describe("called with a tfKey that has an 'Fn' passed as the Statement of a KeyPolicy", () => {
      beforeEach(() => {
        tfKey = new kmsKey.KmsKey(stack, "CfnKey2", {
          policy: JSON.stringify({
            Statement: Fn.element(
              [
                {
                  Action: "kms:action1",
                  Effect: "Allow",
                  Principal: "*",
                  Resource: "*",
                },
                {
                  Action: "kms:action2",
                  Effect: "Allow",
                  Principal: "*",
                  Resource: "*",
                },
              ],
              0,
            ),
            Version: "2012-10-17",
          }),
        });
      });

      test("throws a descriptive exception", () => {
        expect(() => {
          Key.fromTfKey(tfKey);
        }).toThrow(/Could not resolve the passed aws_kms_key policy attribute/);
      });
    });

    // describe("called with a CfnKey that has an 'Fn::If' passed as one of the statements of a KeyPolicy", () => {
    //   beforeEach(() => {
    //     tfKey = new kms.CfnKey(stack, "CfnKey2", {
    //       keyPolicy: {
    //         Statement: [
    //           cdk.Fn.conditionIf(
    //             "AlwaysTrue",
    //             {
    //               Action: "kms:action1",
    //               Effect: "Allow",
    //               Principal: "*",
    //               Resource: "*",
    //             },
    //             {
    //               Action: "kms:action2",
    //               Effect: "Allow",
    //               Principal: "*",
    //               Resource: "*",
    //             },
    //           ),
    //         ],
    //         Version: "2012-10-17",
    //       },
    //     });
    //   });

    //   test("throws a descriptive exception", () => {
    //     expect(() => {
    //       kms.Key.fromCfnKey(tfKey);
    //     }).toThrow(
    //       /Could not parse the PolicyDocument of the passed AWS::KMS::Key/,
    //     );
    //   });
    // });

    // describe("called with a CfnKey that has an 'Fn::If' passed for the Action in one of the statements of a KeyPolicy", () => {
    //   beforeEach(() => {
    //     tfKey = new kms.CfnKey(stack, "CfnKey2", {
    //       keyPolicy: {
    //         Statement: [
    //           {
    //             Action: cdk.Fn.conditionIf(
    //               "AlwaysTrue",
    //               "kms:action1",
    //               "kms:action2",
    //             ),
    //             Effect: "Allow",
    //             Principal: "*",
    //             Resource: "*",
    //           },
    //         ],
    //         Version: "2012-10-17",
    //       },
    //     });
    //   });

    //   test("throws a descriptive exception", () => {
    //     expect(() => {
    //       key = kms.Key.fromCfnKey(tfKey);
    //     }).toThrow(
    //       /Could not parse the PolicyDocument of the passed AWS::KMS::Key/,
    //     );
    //   });
    // });
  });

  describe("addToResourcePolicy allowNoOp and there is no policy", () => {
    test("succeed if set to true (default)", () => {
      const key = Key.fromKeyArn(
        stack,
        "Imported",
        "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012",
      );

      key.addToResourcePolicy(
        new iam.PolicyStatement({ resources: ["*"], actions: ["*"] }),
      );
    });

    test("fails if set to false", () => {
      const key = Key.fromKeyArn(
        stack,
        "Imported",
        "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012",
      );

      expect(() => {
        key.addToResourcePolicy(
          new iam.PolicyStatement({ resources: ["*"], actions: ["*"] }),
          /* allowNoOp */ false,
        );
      }).toThrow(
        'Unable to add statement to IAM resource policy for KMS key: "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"',
      );
    });
  });

  describe("key specs and key usages", () => {
    test("both usage and spec are specified", () => {
      new Key(stack, "Key", {
        keySpec: KeySpec.ECC_SECG_P256K1,
        keyUsage: KeyUsage.SIGN_VERIFY,
      });

      Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
        customer_master_key_spec: KeySpec.ECC_SECG_P256K1,
        key_usage: KeyUsage.SIGN_VERIFY,
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeySpec: "ECC_SECG_P256K1",
      //   KeyUsage: "SIGN_VERIFY",
      // });
    });

    test("only key usage is specified", () => {
      new Key(stack, "Key", { keyUsage: KeyUsage.ENCRYPT_DECRYPT });

      Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
        key_usage: KeyUsage.ENCRYPT_DECRYPT,
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyUsage: "ENCRYPT_DECRYPT",
      // });
    });

    test("only key spec is specified", () => {
      new Key(stack, "Key", { keySpec: KeySpec.RSA_4096 });

      Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
        customer_master_key_spec: KeySpec.RSA_4096,
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeySpec: "RSA_4096",
      // });
    });

    test.each(generateInvalidKeySpecKeyUsageCombinations())(
      "invalid combinations of key specs and key usages (%s)",
      ({ keySpec, keyUsage }) => {
        expect(() => new Key(stack, "Key1", { keySpec, keyUsage })).toThrow(
          `key spec \'${keySpec}\' is not valid with usage \'${keyUsage.toString()}\'`,
        );
      },
    );

    test("invalid combinations of default key spec and key usage SIGN_VERIFY", () => {
      expect(
        () => new Key(stack, "Key1", { keyUsage: KeyUsage.SIGN_VERIFY }),
      ).toThrow(
        "key spec 'SYMMETRIC_DEFAULT' is not valid with usage 'SIGN_VERIFY'",
      );
    });

    test("fails if key rotation enabled on asymmetric key", () => {
      expect(
        () =>
          new Key(stack, "Key", {
            enableKeyRotation: true,
            keySpec: KeySpec.RSA_3072,
          }),
      ).toThrow("key rotation cannot be enabled on asymmetric keys");
    });
  });

  describe("Key.fromKeyArn()", () => {
    // env: { account: "111111111111", region: "stack-region" },
    describe("for a key in a different account and region", () => {
      let key: IKey;

      beforeEach(() => {
        key = Key.fromKeyArn(
          stack,
          "iKey",
          "arn:aws:kms:key-region:222222222222:key:key-name",
        );
      });

      test("the key's region is taken from the ARN", () => {
        expect(key.env.region).toBe("key-region");
      });

      test("the key's account is taken from the ARN", () => {
        expect(key.env.account).toBe("222222222222");
      });
    });
  });

  describe("HMAC", () => {
    test.each([
      [KeySpec.HMAC_224, "HMAC_224"],
      [KeySpec.HMAC_256, "HMAC_256"],
      [KeySpec.HMAC_384, "HMAC_384"],
      [KeySpec.HMAC_512, "HMAC_512"],
    ])("%s is not valid for default usage", (keySpec: KeySpec) => {
      expect(() => new Key(stack, "Key1", { keySpec })).toThrow(
        `key spec \'${keySpec}\' is not valid with usage \'ENCRYPT_DECRYPT\'`,
      );
    });

    test.each([
      [KeySpec.HMAC_224, "HMAC_224"],
      [KeySpec.HMAC_256, "HMAC_256"],
      [KeySpec.HMAC_384, "HMAC_384"],
      [KeySpec.HMAC_512, "HMAC_512"],
    ])("%s can not be used with key rotation", (keySpec: KeySpec) => {
      expect(
        () =>
          new Key(stack, "Key", {
            keySpec,
            keyUsage: KeyUsage.GENERATE_VERIFY_MAC,
            enableKeyRotation: true,
          }),
      ).toThrow("key rotation cannot be enabled on HMAC keys");
    });

    test.each([
      [KeySpec.HMAC_224, "HMAC_224"],
      [KeySpec.HMAC_256, "HMAC_256"],
      [KeySpec.HMAC_384, "HMAC_384"],
      [KeySpec.HMAC_512, "HMAC_512"],
    ])(
      "%s can be used for KMS key creation",
      (keySpec: KeySpec, _expected: string) => {
        new Key(stack, "Key", {
          keySpec,
          keyUsage: KeyUsage.GENERATE_VERIFY_MAC,
        });
        Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
          customer_master_key_spec: keySpec,
          key_usage: KeyUsage.GENERATE_VERIFY_MAC,
        });
        // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
        //   KeySpec: expected,
        //   KeyUsage: "GENERATE_VERIFY_MAC",
        // });
      },
    );

    test("grant generate mac policy", () => {
      const key = new Key(stack, "Key", {
        keySpec: KeySpec.HMAC_256,
        keyUsage: KeyUsage.GENERATE_VERIFY_MAC,
      });
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });

      key.grantGenerateMac(role);

      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            Key_Policy_48E51E45: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: ["kms:GenerateMac"],
                  effect: "Allow",
                  resources: ["${aws_kms_key.Key_961B73FD.arn}"],
                },
              ],
            },
          },
        },
        resource: {
          aws_kms_key: {
            Key_961B73FD: {
              policy:
                "${data.aws_iam_policy_document.Key_Policy_48E51E45.json}",
            },
          },
        },
      });

      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });

      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
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

    test("grant verify mac policy", () => {
      const key = new Key(stack, "Key", {
        keySpec: KeySpec.HMAC_256,
        keyUsage: KeyUsage.GENERATE_VERIFY_MAC,
      });
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });

      key.grantVerifyMac(role);

      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            Key_Policy_48E51E45: {
              statement: [
                {
                  actions: ["kms:*"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                      ],
                      type: "AWS",
                    },
                  ],
                  resources: ["*"],
                },
              ],
            },
            Role_DefaultPolicy_2E5E5E0B: {
              statement: [
                {
                  actions: ["kms:VerifyMac"],
                  effect: "Allow",
                  resources: ["${aws_kms_key.Key_961B73FD.arn}"],
                },
              ],
            },
          },
        },
        resource: {
          aws_kms_key: {
            Key_961B73FD: {
              policy:
                "${data.aws_iam_policy_document.Key_Policy_48E51E45.json}",
            },
          },
        },
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeyPolicy: {
      //     Statement: [
      //       {
      //         Action: "kms:*",
      //         Effect: "Allow",
      //         Principal: {
      //           AWS: {
      //             "Fn::Join": [
      //               "",
      //               [
      //                 "arn:",
      //                 { Ref: "AWS::Partition" },
      //                 ":iam::",
      //                 { Ref: "AWS::AccountId" },
      //                 ":root",
      //               ],
      //             ],
      //           },
      //         },
      //         Resource: "*",
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });

      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
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

    test("grant generate mac policy for imported key", () => {
      const keyArn =
        "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012";
      const key = Key.fromKeyArn(stack, "Key", keyArn);
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });

      key.grantGenerateMac(role);

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["kms:GenerateMac"],
              effect: "Allow",
              resources: [keyArn],
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: "kms:GenerateMac",
      //         Effect: "Allow",
      //         Resource: keyArn,
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });

    test("grant verify mac policy for imported key", () => {
      const keyArn =
        "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012";
      const key = Key.fromKeyArn(stack, "Key", keyArn);
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.AccountPrincipal("000000000000"),
      });

      key.grantVerifyMac(role);

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["kms:VerifyMac"],
              effect: "Allow",
              resources: [keyArn],
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      //   PolicyDocument: {
      //     Statement: [
      //       {
      //         Action: "kms:VerifyMac",
      //         Effect: "Allow",
      //         Resource: keyArn,
      //       },
      //     ],
      //     Version: "2012-10-17",
      //   },
      // });
    });
  });

  describe("SM2", () => {
    test("can be used for KMS key creation", () => {
      new Key(stack, "Key1", {
        keySpec: KeySpec.SM2,
      });

      Template.synth(stack).toHaveResourceWithProperties(kmsKey.KmsKey, {
        customer_master_key_spec: KeySpec.SM2,
      });
      // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
      //   KeySpec: "SM2",
      // });
    });
  });
});

function generateInvalidKeySpecKeyUsageCombinations() {
  // Copied from Key class
  const denyLists = {
    [KeyUsage.ENCRYPT_DECRYPT]: [
      KeySpec.ECC_NIST_P256,
      KeySpec.ECC_NIST_P384,
      KeySpec.ECC_NIST_P521,
      KeySpec.ECC_SECG_P256K1,
      KeySpec.HMAC_224,
      KeySpec.HMAC_256,
      KeySpec.HMAC_384,
      KeySpec.HMAC_512,
    ],
    [KeyUsage.SIGN_VERIFY]: [
      KeySpec.SYMMETRIC_DEFAULT,
      KeySpec.HMAC_224,
      KeySpec.HMAC_256,
      KeySpec.HMAC_384,
      KeySpec.HMAC_512,
    ],
    [KeyUsage.GENERATE_VERIFY_MAC]: [
      KeySpec.RSA_2048,
      KeySpec.RSA_3072,
      KeySpec.RSA_4096,
      KeySpec.ECC_NIST_P256,
      KeySpec.ECC_NIST_P384,
      KeySpec.ECC_NIST_P521,
      KeySpec.ECC_SECG_P256K1,
      KeySpec.SYMMETRIC_DEFAULT,
      KeySpec.SM2,
    ],
    [KeyUsage.KEY_AGREEMENT]: [
      KeySpec.SYMMETRIC_DEFAULT,
      KeySpec.RSA_2048,
      KeySpec.RSA_3072,
      KeySpec.RSA_4096,
      KeySpec.ECC_SECG_P256K1,
      KeySpec.HMAC_224,
      KeySpec.HMAC_256,
      KeySpec.HMAC_384,
      KeySpec.HMAC_512,
    ],
  };
  const testCases: {
    keySpec: KeySpec;
    keyUsage: KeyUsage;
    toString: () => string;
  }[] = [];
  for (const keySpec in KeySpec) {
    for (const keyUsage in KeyUsage) {
      if (denyLists[keyUsage as KeyUsage].includes(keySpec as KeySpec)) {
        testCases.push({
          keySpec: keySpec as KeySpec,
          keyUsage: keyUsage as KeyUsage,
          toString: () => `${keySpec} can not be used for ${keyUsage}`,
        });
      }
    }
  }
  // Sorting for debugging purposes to see if test cases match deny list
  testCases.sort((a, b) => a.keyUsage.localeCompare(b.keyUsage));
  return testCases;
}
