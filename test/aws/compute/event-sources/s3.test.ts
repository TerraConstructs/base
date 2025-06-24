import { lambdaPermission, s3BucketNotification } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { TestFunction } from "./test-function";
import { compute, storage, AwsStack } from "../../../../src/aws";
import { Template } from "../../../assertions";

 

describe("S3EventSource", () => {
  let stack: AwsStack;
  beforeEach(() => {
    stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID: "123e4567-e89b-12d3",
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });

  test("sufficiently complex example", () => {
    // GIVEN
    const fn = new TestFunction(stack, "Fn");
    const bucket = new storage.Bucket(stack, "B");

    // WHEN
    fn.addEventSource(
      new compute.sources.S3EventSource(bucket, {
        events: [
          storage.EventType.OBJECT_CREATED,
          storage.EventType.OBJECT_REMOVED,
        ],
        filters: [{ prefix: "prefix/" }, { suffix: ".png" }],
      }),
    );

    // THEN
    const expected = Template.synth(stack);
    expected.toHaveResourceWithProperties(
      s3BucketNotification.S3BucketNotification,
      {
        bucket: "${aws_s3_bucket.B_08E7C7AF.bucket}",
        depends_on: [
          "aws_lambda_permission.B_AllowBucketNotificationsToTestStackFnDC3B58FB_79790E98",
        ],
        eventbridge: false,
        lambda_function: [
          {
            events: ["s3:ObjectCreated:*"],
            filter_prefix: "prefix/", // TODO: does terraform allow prefix and suffix on same filter?
            lambda_function_arn: stack.resolve(fn.functionArn),
          },
          {
            events: ["s3:ObjectCreated:*"],
            filter_suffix: ".png",
            lambda_function_arn: stack.resolve(fn.functionArn),
          },
          {
            events: ["s3:ObjectRemoved:*"],
            filter_prefix: "prefix/",
            lambda_function_arn: stack.resolve(fn.functionArn),
          },
          {
            events: ["s3:ObjectRemoved:*"],
            filter_suffix: ".png",
            lambda_function_arn: stack.resolve(fn.functionArn),
          },
        ],
      },
    );
    expected.toHaveResourceWithProperties(lambdaPermission.LambdaPermission, {
      action: "lambda:InvokeFunction",
      function_name: stack.resolve(fn.functionArn),
      principal: "s3.amazonaws.com",
      source_account: "${data.aws_caller_identity.CallerIdentity.account_id}",
      source_arn: stack.resolve(bucket.bucketArn),
    });
    // Template.fromStack(spec).hasResourceProperties(
    //   "Custom::S3BucketNotifications",
    //   {
    //     NotificationConfiguration: {
    //       LambdaFunctionConfigurations: [
    //         {
    //           Events: ["s3:ObjectCreated:*"],
    //           Filter: {
    //             Key: {
    //               FilterRules: [
    //                 {
    //                   Name: "prefix",
    //                   Value: "prefix/",
    //                 },
    //                 {
    //                   Name: "suffix",
    //                   Value: ".png",
    //                 },
    //               ],
    //             },
    //           },
    //           LambdaFunctionArn: {
    //             "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
    //           },
    //         },
    //         {
    //           Events: ["s3:ObjectRemoved:*"],
    //           Filter: {
    //             Key: {
    //               FilterRules: [
    //                 {
    //                   Name: "prefix",
    //                   Value: "prefix/",
    //                 },
    //                 {
    //                   Name: "suffix",
    //                   Value: ".png",
    //                 },
    //               ],
    //             },
    //           },
    //           LambdaFunctionArn: {
    //             "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
    //           },
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  // test("test S3EventSource with IBucket", () => {
  //   // GIVEN
  //   const fn = new TestFunction(spec, "Fn");
  //   const bucket = storage.Bucket.fromBucketName(spec, "Bucket", "bucket-name");

  //   // WHEN
  //   fn.addEventSource(
  //     new compute.sources.S3EventSource(bucket, {
  //       events: [
  //         storage.EventType.OBJECT_CREATED,
  //         storage.EventType.OBJECT_REMOVED,
  //       ],
  //       filters: [{ prefix: "prefix/" }, { suffix: ".png" }],
  //     }),
  //   );

  //   // THEN
  //   Template.fromStack(spec).hasResourceProperties(
  //     "Custom::S3BucketNotifications",
  //     {
  //       NotificationConfiguration: {
  //         LambdaFunctionConfigurations: [
  //           {
  //             Events: ["s3:ObjectCreated:*"],
  //             Filter: {
  //               Key: {
  //                 FilterRules: [
  //                   {
  //                     Name: "prefix",
  //                     Value: "prefix/",
  //                   },
  //                   {
  //                     Name: "suffix",
  //                     Value: ".png",
  //                   },
  //                 ],
  //               },
  //             },
  //             LambdaFunctionArn: {
  //               "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
  //             },
  //           },
  //           {
  //             Events: ["s3:ObjectRemoved:*"],
  //             Filter: {
  //               Key: {
  //                 FilterRules: [
  //                   {
  //                     Name: "prefix",
  //                     Value: "prefix/",
  //                   },
  //                   {
  //                     Name: "suffix",
  //                     Value: ".png",
  //                   },
  //                 ],
  //               },
  //             },
  //             LambdaFunctionArn: {
  //               "Fn::GetAtt": ["Fn9270CBC0", "Arn"],
  //             },
  //           },
  //         ],
  //       },
  //     },
  //   );
  // });
});
