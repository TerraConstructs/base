import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { storage, AwsSpec, iam } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("notification", () => {
  let app: App;
  let spec: AwsSpec;

  beforeEach(() => {
    app = Testing.app();
    spec = new AwsSpec(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Spec props?
      // account: "1234",
      // region: "us-east-1",
    });
  });

  test("when notification is added a custom s3 bucket notification resource is provisioned", () => {
    // GIVEN
    const bucket = new storage.Bucket(spec, "MyBucket");

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN

    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    expect(synthesized).toMatchSnapshot();
    // Template.fromStack(spec).resourceCountIs("AWS::S3::Bucket", 1);
    // Template.fromStack(spec).hasResourceProperties(
    //   "Custom::S3BucketNotifications",
    //   {
    //     NotificationConfiguration: {
    //       TopicConfigurations: [
    //         {
    //           Events: ["s3:ObjectCreated:*"],
    //           TopicArn: "ARN",
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  // test("can specify a custom role for the notifications handler of imported buckets", () => {
  //   const importedRole = iam.Role.fromRoleArn(
  //     spec,
  //     "role",
  //     "arn:aws:iam::111111111111:role/DevsNotAllowedToTouch",
  //   );

  //   const bucket = storage.Bucket.fromBucketAttributes(spec, "MyBucket", {
  //     bucketName: "foo-bar",
  //     notificationsHandlerRole: importedRole,
  //   });

  //   bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
  //     bind: () => ({
  //       arn: "ARN",
  //       type: storage.BucketNotificationDestinationType.TOPIC,
  //     }),
  //   });

  //   // Do prepare run to resolve/add all Terraform resources
  //   spec.prepareStack();
  //   const synthesized = Testing.synth(spec);
  //   // refer to full snapshot for debug
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(spec).hasResourceProperties("AWS::Lambda::Function", {
  //   //   Description:
  //   //     'AWS CloudFormation handler for "Custom::S3BucketNotifications" resources (@aws-cdk/aws-s3)',
  //   //   Role: "arn:aws:iam::111111111111:role/DevsNotAllowedToTouch",
  //   // });
  // });

  test("can specify prefix and suffix filter rules", () => {
    // GIVEN
    const bucket = new storage.Bucket(spec, "MyBucket");

    // WHEN
    bucket.addEventNotification(
      storage.EventType.OBJECT_CREATED,
      {
        bind: () => ({
          arn: "ARN",
          type: storage.BucketNotificationDestinationType.TOPIC,
        }),
      },
      { prefix: "images/", suffix: ".png" },
    );

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    expect(synthesized).toMatchSnapshot();
    // Template.fromStack(spec).hasResourceProperties(
    //   "Custom::S3BucketNotifications",
    //   {
    //     NotificationConfiguration: {
    //       TopicConfigurations: [
    //         {
    //           Events: ["s3:ObjectCreated:*"],
    //           Filter: {
    //             Key: {
    //               FilterRules: [
    //                 {
    //                   Name: "suffix",
    //                   Value: ".png",
    //                 },
    //                 {
    //                   Name: "prefix",
    //                   Value: "images/",
    //                 },
    //               ],
    //             },
    //           },
    //           TopicArn: "ARN",
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  // TODO: We do not use custom handler to manage bucket notifications
  test.skip("the notification lambda handler must depend on the role to prevent executing too early", () => {
    // GIVEN
    const bucket = new storage.Bucket(spec, "MyBucket");

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    expect(synthesized).toMatchSnapshot();
    // Template.fromStack(spec).hasResource("AWS::Lambda::Function", {
    //   Type: "AWS::Lambda::Function",
    //   Properties: {
    //     Role: {
    //       "Fn::GetAtt": [
    //         "BucketNotificationsHandler050a0587b7544547bf325f094a3db834RoleB6FB88EC",
    //         "Arn",
    //       ],
    //     },
    //   },
    //   DependsOn: [
    //     "BucketNotificationsHandler050a0587b7544547bf325f094a3db834RoleDefaultPolicy2CF63D36",
    //     "BucketNotificationsHandler050a0587b7544547bf325f094a3db834RoleB6FB88EC",
    //   ],
    // });
  });

  test("must not depend on bucket policy if bucket policy does not exists", () => {
    const bucket = new storage.Bucket(spec, "MyBucket");

    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    expect(
      JSON.parse(synthesized).resource.aws_s3_bucket_notification
        .MyBucket_Notifications_46AC0CD2,
    ).not.toHaveProperty("depends_on");
    // Template.fromStack(spec).hasResource("Custom::S3BucketNotifications", {
    //   Type: "Custom::S3BucketNotifications",
    //   DependsOn: Match.absent(),
    // });
  });

  test("must depend on bucket policy to prevent executing too early", () => {
    const bucket = new storage.Bucket(spec, "MyBucket", {
      enforceSSL: true, // adds bucket policy for test
    });

    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            depends_on: [
              "data.aws_iam_policy_document.MyBucket_Policy_F89E7330",
              "aws_s3_bucket_policy.MyBucket_Policy_E7FBAC7B",
            ],
          },
        },
      },
    });
    // Template.fromStack(spec).hasResource("Custom::S3BucketNotifications", {
    //   Type: "Custom::S3BucketNotifications",
    //   DependsOn: ["MyBucketPolicyE7FBAC7B"],
    // });
  });

  test("must depend on bucket policy even if bucket policy is added after notification", () => {
    const bucket = new storage.Bucket(spec, "MyBucket");

    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [bucket.bucketArn],
        actions: ["s3:GetBucketAcl"],
        principals: [new iam.AnyPrincipal()],
      }),
    );

    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            depends_on: [
              "data.aws_iam_policy_document.MyBucket_Policy_F89E7330",
              "aws_s3_bucket_policy.MyBucket_Policy_E7FBAC7B",
            ],
          },
        },
      },
    });
  });

  // TODO: Terraform doesn't have this limitation?
  test("does not throw if both prefix or suffix set for a filter", () => {
    const bucket = new storage.Bucket(spec, "MyBucket");

    bucket.addEventNotification(
      storage.EventType.OBJECT_CREATED,
      {
        bind: () => ({
          arn: "ARN",
          type: storage.BucketNotificationDestinationType.TOPIC,
        }),
      },
      { prefix: "foo/", suffix: "bar/" },
    );
    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            eventbridge: false,
            topic: [
              {
                events: ["s3:ObjectCreated:*"],
                filter_prefix: "foo/",
                filter_suffix: "bar/",
                topic_arn: "ARN",
              },
            ],
          },
        },
      },
    });
    // expect(() =>
    //   bucket.addEventNotification(
    //     storage.EventType.OBJECT_CREATED,
    //     {
    //       bind: () => ({
    //         arn: "ARN",
    //         type: storage.BucketNotificationDestinationType.TOPIC,
    //       }),
    //     },
    //     { prefix: "foo/", suffix: "bar/" },
    //   ),
    // ).toThrow(/`prefix` and\/or `suffix`/);
  });

  // TODO: Terraform doesn't have this limitation?
  test("does not throw  with multiple prefix rules in a filter", () => {
    const bucket = new storage.Bucket(spec, "MyBucket");
    bucket.addEventNotification(
      storage.EventType.OBJECT_CREATED,
      {
        bind: () => ({
          arn: "ARN",
          type: storage.BucketNotificationDestinationType.TOPIC,
        }),
      },
      { prefix: "images/" },
      { prefix: "archive/" },
    );
    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            eventbridge: false,
            topic: [
              {
                events: ["s3:ObjectCreated:*"],
                filter_prefix: "images/",
                topic_arn: "ARN",
              },
              {
                events: ["s3:ObjectCreated:*"],
                filter_prefix: "archive/",
                topic_arn: "ARN",
              },
            ],
          },
        },
      },
    });
    // expect(() =>
    //   bucket.addEventNotification(
    //     storage.EventType.OBJECT_CREATED,
    //     {
    //       bind: () => ({
    //         arn: "ARN",
    //         type: storage.BucketNotificationDestinationType.TOPIC,
    //       }),
    //     },
    //     { prefix: "images/" },
    //     { prefix: "archive/" },
    //   ),
    // ).toThrow(/prefix rule/);
  });

  // TODO: Terraform doesn't have this limitation?
  test("does not throw with multiple suffix rules in a filter", () => {
    const bucket = new storage.Bucket(spec, "MyBucket");

    bucket.addEventNotification(
      storage.EventType.OBJECT_CREATED,
      {
        bind: () => ({
          arn: "ARN",
          type: storage.BucketNotificationDestinationType.TOPIC,
        }),
      },
      { suffix: ".png" },
      { suffix: ".zip" },
    );
    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            eventbridge: false,
            topic: [
              {
                events: ["s3:ObjectCreated:*"],
                filter_suffix: ".png",
                topic_arn: "ARN",
              },
              {
                events: ["s3:ObjectCreated:*"],
                filter_suffix: ".zip",
                topic_arn: "ARN",
              },
            ],
          },
        },
      },
    });
    // expect(() =>
    //   bucket.addEventNotification(
    //     storage.EventType.OBJECT_CREATED,
    //     {
    //       bind: () => ({
    //         arn: "ARN",
    //         type: storage.BucketNotificationDestinationType.TOPIC,
    //       }),
    //     },
    //     { suffix: ".png" },
    //     { suffix: ".zip" },
    //   ),
    // ).toThrow(/suffix rule/);
  });

  test("EventBridge notification resource", () => {
    // WHEN
    new storage.Bucket(spec, "MyBucket", {
      eventBridgeEnabled: true,
    });

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    spec.prepareStack();
    const synthesized = Testing.synth(spec);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            eventbridge: true,
          },
        },
      },
    });
    // Template.fromStack(spec).resourceCountIs("AWS::S3::Bucket", 1);
    // Template.fromStack(spec).hasResourceProperties(
    //   "Custom::S3BucketNotifications",
    //   {
    //     NotificationConfiguration: {
    //       EventBridgeConfiguration: {},
    //     },
    //   },
    // );
  });

  // test("skip destination validation is set to false by default", () => {
  //   // GIVEN
  //   const stack = new cdk.Stack();

  //   // WHEN
  //   const bucket = new storage.Bucket(stack, "MyBucket", {
  //     bucketName: "foo-bar",
  //   });
  //   bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
  //     bind: () => ({
  //       arn: "ARN",
  //       type: storage.BucketNotificationDestinationType.TOPIC,
  //     }),
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "Custom::S3BucketNotifications",
  //     {
  //       SkipDestinationValidation: false,
  //     },
  //   );
  // });
});
