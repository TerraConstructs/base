// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-s3/test/notification.test.ts
import {
  dataAwsIamPolicyDocument,
  iamRole,
  iamRolePolicy,
  lambdaFunction,
  s3Bucket,
} from "@cdktn/provider-aws";
import { customResource } from "@cdktn/provider-cfncompat";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as iam from "../../../src/aws/iam";
import * as storage from "../../../src/aws/storage";
import { Template } from "../../assertions";

// The literal context key from `src/aws/cx-api.ts`
// (`S3_KEEP_NOTIFICATION_IN_IMPORTED_BUCKET`). Not imported directly: cx-api.ts is not
// part of the public API (see `addEventNotification`'s JSDoc, which documents this key).
const KEEP_NOTIFICATION_IN_IMPORTED_BUCKET =
  "@terraconstructs/aws-s3:keepNotificationInImportedBucket";

describe("notification custom resource", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack");
    // Every test in this file exercises `BucketNotificationsResource` (the
    // `Custom::S3BucketNotifications` port) rather than the default native
    // `aws_s3_bucket_notification` path exercised by `notification.test.ts` - so an owned
    // bucket must opt in via the context key. Imported buckets always use the custom
    // resource regardless, so this has no effect on those cases below.
    stack.node.setContext(KEEP_NOTIFICATION_IN_IMPORTED_BUCKET, true);
  });

  test("when notification is added a custom s3 bucket notification resource is provisioned", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN - two s3 buckets: MyBucket, plus the per-stack custom resource
    // response bucket created lazily by the first `CustomResource`.
    const template = new Template(stack);
    template.resourceCountIs(s3Bucket.S3Bucket, 2);
    template.resourceCountIs(customResource.CustomResource, 1);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_type: "Custom::S3BucketNotifications",
        resource_properties: expect.objectContaining({
          Managed: "false",
          NotificationConfiguration: {
            TopicConfigurations: [
              {
                Events: ["s3:ObjectCreated:*"],
                TopicArn: "ARN",
              },
            ],
          },
        }),
      }),
    ]);
  });

  test("can specify a custom role for the notifications handler of imported buckets", () => {
    // GIVEN - imported buckets always use the custom resource; no context key needed.
    const importedRole = iam.Role.fromRoleArn(
      stack,
      "role",
      "arn:aws:iam::111111111111:role/DevsNotAllowedToTouch",
    );

    const bucket = storage.Bucket.fromBucketAttributes(stack, "MyBucket", {
      bucketName: "foo-bar",
      notificationsHandlerRole: importedRole,
    });

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        description:
          'AWS CloudFormation handler for "Custom::S3BucketNotifications" resources (@aws-cdk/aws-s3)',
        role: "arn:aws:iam::111111111111:role/DevsNotAllowedToTouch",
      }),
    ]);
    // no default handler role is created since an explicit role was provided
    template.resourceCountIs(iamRole.IamRole, 0);
  });

  test("can specify prefix and suffix filter rules", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

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
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: expect.objectContaining({
          NotificationConfiguration: {
            TopicConfigurations: [
              {
                Events: ["s3:ObjectCreated:*"],
                Filter: {
                  Key: {
                    FilterRules: [
                      { Name: "suffix", Value: ".png" },
                      { Name: "prefix", Value: "images/" },
                    ],
                  },
                },
                TopicArn: "ARN",
              },
            ],
          },
        }),
      }),
    ]);
  });

  test("throws with multiple prefix rules in a filter", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

    // WHEN / THEN
    expect(() =>
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
      ),
    ).toThrow(/prefix rule/);
  });

  test("throws with multiple suffix rules in a filter", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

    // WHEN / THEN
    expect(() =>
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
      ),
    ).toThrow(/suffix rule/);
  });

  test("the notification lambda handler must depend on the role to prevent executing too early", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN - the handler's own Lambda function resource depends on its role
    // (and the role's inline policy), so the handler can never execute before
    // it has the permissions this construct grants it.
    const template = new Template(stack);
    const fns = template.resourcesByType(
      lambdaFunction.LambdaFunction,
    ) as Record<string, any>;
    const [fnKey, fn] = Object.entries(fns)[0];
    expect(fnKey).toContain(
      "BucketNotificationsHandler050a0587b7544547bf325f094a3db834",
    );
    expect(fn.depends_on).toEqual(
      expect.arrayContaining([expect.stringContaining("iam_role.")]),
    );
  });

  test("custom resource must not depend on bucket policy if bucket policy does not exists", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN - the resource always depends on the handler (role/policy/function),
    // but never on a bucket policy that was never created.
    const template = new Template(stack);
    const resources = template.resourcesByType(
      customResource.CustomResource,
    ) as Record<string, any>;
    const [, resource] = Object.entries(resources)[0];
    expect(resource.depends_on).not.toEqual(
      expect.arrayContaining([expect.stringContaining("s3_bucket_policy")]),
    );
  });

  test("custom resource must depend on bucket policy to prevent executing too early", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket", {
      enforceSSL: true, // adds bucket policy for test
    });

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN
    const template = new Template(stack);
    const resources = template.resourcesByType(
      customResource.CustomResource,
    ) as Record<string, any>;
    const [, resource] = Object.entries(resources)[0];
    expect(resource.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringContaining("s3_bucket_policy.MyBucket_Policy"),
      ]),
    );
  });

  test("custom resource must depend on bucket policy even if bucket policy is added after notification", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "MyBucket");

    // WHEN
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

    // THEN
    const template = new Template(stack);
    const resources = template.resourcesByType(
      customResource.CustomResource,
    ) as Record<string, any>;
    const [, resource] = Object.entries(resources)[0];
    expect(resource.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringContaining("s3_bucket_policy.MyBucket_Policy"),
      ]),
    );
  });

  test("EventBridge notification custom resource", () => {
    // GIVEN / WHEN
    new storage.Bucket(stack, "MyBucket", {
      eventBridgeEnabled: true,
    });

    // THEN - two s3 buckets: MyBucket, plus the per-stack custom resource
    // response bucket created lazily by the first `CustomResource`.
    const template = new Template(stack);
    template.resourceCountIs(s3Bucket.S3Bucket, 2);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: expect.objectContaining({
          NotificationConfiguration: {
            EventBridgeConfiguration: {},
          },
        }),
      }),
    ]);
  });

  test("Notification custom resource uses always treat bucket as unmanaged", () => {
    // GIVEN / WHEN - context key is already set to true in beforeEach
    new storage.Bucket(stack, "MyBucket", {
      eventBridgeEnabled: true,
    });

    // THEN - two s3 buckets: MyBucket, plus the per-stack custom resource
    // response bucket created lazily by the first `CustomResource`.
    const template = new Template(stack);
    template.resourceCountIs(s3Bucket.S3Bucket, 2);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: expect.objectContaining({
          NotificationConfiguration: {
            EventBridgeConfiguration: {},
          },
          // Must be the *string* "false", never a bool.
          Managed: "false",
        }),
      }),
    ]);
    // `bucket.bucketArn` is an unresolved token pre-synth, so match the
    // resolved reference by shape (`${aws_s3_bucket.MyBucket_*.arn}`) instead.
    template
      .expectDataSources(dataAwsIamPolicyDocument.DataAwsIamPolicyDocument)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["s3:PutBucketNotification"],
                effect: "Allow",
                resources: [
                  expect.stringMatching(
                    /^\$\{aws_s3_bucket\.MyBucket_\w+\.arn\}$/,
                  ),
                ],
              }),
              expect.objectContaining({
                actions: ["s3:GetBucketNotification"],
                effect: "Allow",
                resources: [
                  expect.stringMatching(
                    /^\$\{aws_s3_bucket\.MyBucket_\w+\.arn\}$/,
                  ),
                ],
              }),
            ]),
          }),
        ]),
      );
  });

  test("check notifications handler runtime version", () => {
    // GIVEN - imported bucket; no context key needed.
    const bucket = storage.Bucket.fromBucketAttributes(stack, "MyBucket", {
      bucketName: "foo-bar",
    });

    // WHEN
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN - tcons pins python3.12, upstream (v2.233) pins python3.13
    const template = new Template(stack);
    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        runtime: "python3.12",
      }),
    ]);
  });

  test("skip destination validation is only rendered when enabled", () => {
    // GIVEN - default: not set
    const bucket = storage.Bucket.fromBucketAttributes(stack, "MyBucket", {
      bucketName: "foo-bar",
    });
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN - not rendered at all (the handler already defaults to "false")
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: expect.not.objectContaining({
          SkipDestinationValidation: expect.anything(),
        }),
      }),
    ]);
  });

  test('skip destination validation renders the string "true" when enabled', () => {
    // GIVEN - imported bucket; no context key needed.
    const bucket = storage.Bucket.fromBucketAttributes(stack, "MyBucket", {
      bucketName: "foo-bar",
      notificationsSkipDestinationValidation: true,
    });
    bucket.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });

    // THEN
    const template = new Template(stack);
    template.expectResources(customResource.CustomResource).toEqual([
      expect.objectContaining({
        resource_properties: expect.objectContaining({
          SkipDestinationValidation: "true",
        }),
      }),
    ]);
  });

  // tcons-only addition
  test("only one handler is created for multiple buckets in the same stack", () => {
    // GIVEN
    const bucket1 = new storage.Bucket(stack, "Bucket1");
    const bucket2 = new storage.Bucket(stack, "Bucket2");

    // WHEN
    bucket1.addEventNotification(storage.EventType.OBJECT_CREATED, {
      bind: () => ({
        arn: "ARN1",
        type: storage.BucketNotificationDestinationType.TOPIC,
      }),
    });
    bucket2.addEventNotification(storage.EventType.OBJECT_REMOVED, {
      bind: () => ({
        arn: "ARN2",
        type: storage.BucketNotificationDestinationType.QUEUE,
      }),
    });

    // THEN - only one singleton handler Lambda function (and role) for the whole stack
    const template = new Template(stack);
    template.resourceCountIs(lambdaFunction.LambdaFunction, 1);
    template.resourceCountIs(iamRole.IamRole, 1);
    template.resourceCountIs(customResource.CustomResource, 2);
  });

  // not ported: `add service-role permission if no Roles are provided` - the resulting
  // AWS::IAM::Role/AWS::IAM::Policy shape is already asserted by
  // "Notification custom resource uses always treat bucket as unmanaged" and
  // "only one handler is created for multiple buckets in the same stack" above.
  // not ported: `no warnings are shown if no Roles are provided, as CDK will be adding
  // required roles & policies` - tcons' `CustomResourceHandler`/`iam.Role` do not
  // reproduce CDK's `IRoleCantBeUsedWithIManagedPolicy` warning machinery.
  // not ported: `service-role permission are not added if IRole is provided` - covered by
  // "can specify a custom role for the notifications handler of imported buckets" above
  // (asserts zero default `IamRole` resources when a role is supplied).
  // not ported: `warning is thrown when IRole is provided and not policies are added` -
  // tcons' `iam.Role`/`CustomResourceHandler` do not reproduce this CDK-specific warning.
  // not ported: `If Role is provided, PutBucketNotification, GetBucketNotification will be
  // added along with service-role/AWSLambdaBasicExecutionRole` - same machinery gap.
  // not ported: `If Role is provided, No warnings are thrown` - same machinery gap.
  // not ported: `multiple buckets in same stack result in consolidated policy with all
  // bucket ARNs` - v2.263-only behavior (a per-bucket `iam.Policy` child); this port is
  // pinned to v2.233's `handler.addToRolePolicy` shape (see provenance header on
  // `bucket-notifications-resource.ts`).
});
