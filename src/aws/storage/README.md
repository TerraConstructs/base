# Storage constructs

## Notifications on imported / shared buckets

`Bucket.addEventNotification` and `Bucket.enableEventBridgeNotification` have two
implementations, because S3 keeps the notification configuration on the bucket
itself and allows only one of them per bucket.

**Native (default, owned buckets).** A bucket created in this stack renders an
`aws_s3_bucket_notification` resource. That resource owns the bucket's *entire* notification
configuration: it overwrites entries configured elsewhere, and a second
`aws_s3_bucket_notification` against the same bucket produces a perpetual diff. It cannot be
used at all for a bucket this stack does not own, since the stack has no Terraform resource
for that bucket.

**Custom resource (imported buckets, or opted in).** `Bucket.fromBucketName` /
`fromBucketArn` / `fromBucketAttributes` always route notifications through a
`Custom::S3BucketNotifications` custom resource instead. An owned bucket switches to the same
implementation when the context key below is truthy:

```ts
const app = new App({
  context: { "@terraconstructs/aws-s3:keepNotificationInImportedBucket": true },
});
```

The key can also be set per stack (`stack.node.setContext(...)`), in `cdktn.json`, or on the
CLI. It is read with `node.tryGetContext`; jsii has no exported constants, so the literal
string is the API (`S3_KEEP_NOTIFICATION_IN_IMPORTED_BUCKET` in `src/aws/cx-api.ts` is the
internal definition).

### What the custom resource does

`BucketNotificationsResource` provisions a `cfncompat_custom_resource` backed by a
stack-singleton Python Lambda function (`NotificationsResourceHandler`, AWS CDK's handler
verbatim). The custom resource always runs the handler in *unmanaged* mode
(`Managed: "false"`): on every apply the handler `GetBucketNotification`s the bucket, keeps
every entry it does not recognise, and merges in only this stack's own entries — identified
by an `Id` prefixed with the stack's `gridUUID`. On destroy it removes only that stack's
entries.

That merge-instead-of-overwrite behaviour is what lets several stacks — the owning stack
included — attach notifications to one bucket without clobbering each other. Set
`notificationsHandlerRole` on `BucketAttributes` to supply the handler's IAM role, and
`notificationsSkipDestinationValidation` to skip S3's destination validation.

### Response transport

The custom resource delivers the handler's response through a pre-signed S3 URL. By default
each stack lazily creates one `CustomResourceResponsesBucket` (`force_destroy`) for this,
exposed as `AwsStack.customResourceResponseBucket`. Set
`cfncompatProviderConfig.customResourceBucket` on `AwsStackProps` to use a bucket of your own
instead, in which case no per-stack bucket is created.

### Migrating an existing owned bucket

Turning the context key on for a bucket that is already deployed with an
`aws_s3_bucket_notification` resource is a migration, not a no-op: the plan destroys the
native resource (which wipes the bucket's whole notification configuration) and creates the
custom resource, and Terraform does not order the destroy against the custom resource's
`PutBucketNotificationConfiguration`. Expect notifications to be briefly — or, if the destroy
lands last, persistently — missing. Apply the switch in a maintenance window and verify the
resulting configuration, or recreate the notifications in a follow-up apply.
