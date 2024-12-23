import { sfnActivity, dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { iam, compute, AwsStack } from "../../../src/aws";
// import { Duration } from "../../../src/duration";

const gridUUID = "123e4567-e89b-12d3";
describe("Activity", () => {
  let stack: AwsStack;
  beforeEach(() => {
    // GIVEN
    stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });
  test("instantiate Activity", () => {
    // WHEN
    new compute.Activity(stack, "Activity");

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(sfnActivity.SfnActivity, {
      name: "123e4567-e89b-12d3-TestStackActivityFBB08750",
    });
  });

  // test("Activity exposes metrics", () => {
  //   // WHEN
  //   const activity = new compute.Activity(stack, "Activity");

  //   // THEN
  //   const sharedMetric = {
  //     period: Duration.minutes(5),
  //     namespace: "AWS/States",
  //     dimensions: { ActivityArn: { Ref: "Activity04690B0A" } },
  //   };
  //   expect(stack.resolve(activity.metricRunTime())).toEqual({
  //     ...sharedMetric,
  //     metricName: "ActivityRunTime",
  //     statistic: "Average",
  //   });

  //   expect(stack.resolve(activity.metricFailed())).toEqual({
  //     ...sharedMetric,
  //     metricName: "ActivitiesFailed",
  //     statistic: "Sum",
  //   });
  // });

  test("Activity can grant permissions to a role", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    const activity = new compute.Activity(stack, "Activity");

    // WHEN
    activity.grant(role, "states:SendTaskSuccess");

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["states:SendTaskSuccess"],
            effect: "Allow",
            resources: ["${aws_sfn_activity.Activity_04690B0A.id}"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: Match.arrayWith([
    //       Match.objectLike({
    //         Action: "states:SendTaskSuccess",
    //         Effect: "Allow",
    //         Resource: {
    //           Ref: "Activity04690B0A",
    //         },
    //       }),
    //     ]),
    //   },
    // });
  });

  // test("Instantiate Activity with EncryptionConfiguration using Customer Managed Key", () => {
  //   // GIVEN
  //   const kmsKey = new encryption.Key(stack, "Key");

  //   // WHEN
  //   new compute.Activity(stack, "Activity", {
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(
  //         kmsKey,
  //         cdk.Duration.seconds(75),
  //       ),
  //   });

  //   // THEN
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::StepFunctions::Activity",
  //   //   {
  //   //     Name: "Activity",
  //   //     EncryptionConfiguration: Match.objectEquals({
  //   //       KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //   //       KmsDataKeyReusePeriodSeconds: 75,
  //   //       Type: "CUSTOMER_MANAGED_KMS_KEY",
  //   //     }),
  //   //   },
  //   // );

  //   // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
  //   //   KeyPolicy: {
  //   //     Statement: [
  //   //       {
  //   //         Action: "kms:*",
  //   //         Effect: "Allow",
  //   //         Principal: {
  //   //           AWS: {
  //   //             "Fn::Join": [
  //   //               "",
  //   //               [
  //   //                 "arn:",
  //   //                 {
  //   //                   Ref: "AWS::Partition",
  //   //                 },
  //   //                 ":iam::",
  //   //                 {
  //   //                   Ref: "AWS::AccountId",
  //   //                 },
  //   //                 ":root",
  //   //               ],
  //   //             ],
  //   //           },
  //   //         },
  //   //         Resource: "*",
  //   //       },
  //   //       {
  //   //         Action: ["kms:Decrypt", "kms:GenerateDataKey"],
  //   //         Condition: {
  //   //           StringEquals: {
  //   //             "kms:EncryptionContext:aws:states:activityArn": {
  //   //               "Fn::Join": [
  //   //                 "",
  //   //                 [
  //   //                   "arn:",
  //   //                   {
  //   //                     Ref: "AWS::Partition",
  //   //                   },
  //   //                   ":states:",
  //   //                   {
  //   //                     Ref: "AWS::Region",
  //   //                   },
  //   //                   ":",
  //   //                   {
  //   //                     Ref: "AWS::AccountId",
  //   //                   },
  //   //                   ":activity:Activity",
  //   //                 ],
  //   //               ],
  //   //             },
  //   //           },
  //   //         },
  //   //         Effect: "Allow",
  //   //         Principal: {
  //   //           Service: "states.amazonaws.com",
  //   //         },
  //   //         Resource: "*",
  //   //       },
  //   //     ],
  //   //     Version: "2012-10-17",
  //   //   },
  //   // });
  // });

  // test("Instantiate Activity with EncryptionConfiguration using Customer Managed Key - defaults to 300 secs for KmsDataKeyReusePeriodSeconds", () => {
  //   // GIVEN
  //   const kmsKey = new encryption.Key(stack, "Key");

  //   // WHEN
  //   new compute.Activity(stack, "Activity", {
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(kmsKey),
  //   });

  //   // THEN
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::StepFunctions::Activity",
  //   //   {
  //   //     Name: "Activity",
  //   //     EncryptionConfiguration: Match.objectEquals({
  //   //       KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //   //       KmsDataKeyReusePeriodSeconds: 300,
  //   //       Type: "CUSTOMER_MANAGED_KMS_KEY",
  //   //     }),
  //   //   },
  //   // );
  // });

  // test("Instantiate Activity with invalid KmsDataKeyReusePeriodSeconds throws error", () => {
  //   // GIVEN
  //   const kmsKey = new encryption.Key(stack, "Key");

  //   // FAIL
  //   expect(() => {
  //     // WHEN
  //     new compute.Activity(stack, "Activity", {
  //       encryptionConfiguration:
  //         new compute.CustomerManagedEncryptionConfiguration(
  //           kmsKey,
  //           cdk.Duration.seconds(5),
  //         ),
  //     });
  //   }).toThrow(
  //     "kmsDataKeyReusePeriodSeconds must have a value between 60 and 900 seconds",
  //   );
  // });

  // test("Instantiate Activity with EncryptionConfiguration using AWS Owned Key", () => {
  //   // WHEN
  //   new compute.Activity(stack, "Activity", {
  //     encryptionConfiguration: new compute.AwsOwnedEncryptionConfiguration(),
  //   });

  //   // THEN
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::StepFunctions::Activity",
  //   //   {
  //   //     Name: "Activity",
  //   //     EncryptionConfiguration: Match.objectLike({
  //   //       Type: "AWS_OWNED_KEY",
  //   //     }),
  //   //   },
  //   // );
  // });
});
