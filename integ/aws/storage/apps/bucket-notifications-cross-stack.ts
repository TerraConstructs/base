// No upstream integ equivalent: three stacks (a/b/c) each add their own prefix-filtered
// notification entry to one shared bucket, owned by stack a and only ever imported
// (`Bucket.fromBucketName`) by b/c, exercising `BucketNotificationsResource` and the
// `@terraconstructs/aws-s3:keepNotificationInImportedBucket` context key end to end.
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "bucket-notifications-cross-stack";
const suffix = process.env.SUFFIX;
if (!suffix) {
  throw new Error(
    "Missing required env var 'SUFFIX'. Set it before synth/deploy (e.g. `SUFFIX=k3m9x1 npx cdktn synth`).",
  );
}

// Shared bucket name every stack derives independently from SUFFIX: b/c never read a's
// outputs, so the stacks stay genuinely independent.
const bucketName = `s3n-${suffix}`;

type Owner = "a" | "b" | "c";

const app = new App({
  outdir,
  // Forces every `addEventNotification` call below through the
  // `Custom::S3BucketNotifications` custom resource - the only mechanism that lets b/c
  // add notification entries to a bucket they do not own, and lets a share its own
  // bucket with them without clobbering their entries on every apply.
  context: {
    "@terraconstructs/aws-s3:keepNotificationInImportedBucket": true,
  },
});

function buildStack(scope: Construct, owner: Owner): void {
  const stack = new aws.AwsStack(scope, `${stackName}-${owner}`, {
    gridUUID: `g${owner}12345678-1234`,
    environmentName,
    providerConfig: {
      region,
    },
  });
  new LocalBackend(stack, {
    path: `${stackName}-${owner}.tfstate`,
  });

  // Only stack `a` owns the bucket; `b` and `c` only ever import it by name.
  const bucket: aws.storage.IBucket =
    owner === "a"
      ? new aws.storage.Bucket(stack, "Bucket", {
          bucketName,
          forceDestroy: true,
        })
      : aws.storage.Bucket.fromBucketName(stack, "Bucket", bucketName);

  const queue = new aws.notify.Queue(stack, "ResultsQueue", {
    queueName: `s3n-${suffix}-${owner}-results`,
  });

  const fn = new aws.compute.LambdaFunction(stack, "Function", {
    functionName: `s3n-${suffix}-${owner}`,
    runtime: aws.compute.Runtime.NODEJS_22_X,
    handler: "index.handler",
    // Forwards every S3 event record to this stack's own "results" queue so the
    // terratest harness can observe which stack's target received the event.
    // CommonJS, no bundling: nodejs22.x bundles @aws-sdk v3.
    code: aws.compute.Code.fromInline(`
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const sqs = new SQSClient({});
const queueUrl = process.env.RESULTS_QUEUE_URL;
const owner = process.env.STACK_NAME || "unknown";

exports.handler = async (event) => {
  const records = event.Records || [];
  console.log(JSON.stringify({ owner, records: records.length, event }));
  for (const r of records) {
    const body = {
      owner,
      bucket: r.s3 && r.s3.bucket && r.s3.bucket.name,
      key: decodeURIComponent(((r.s3 && r.s3.object && r.s3.object.key) || "").replace(/\\+/g, " ")),
      eventName: r.eventName,
    };
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(body) }));
  }
  return { forwarded: records.length };
};
`),
    environment: {
      RESULTS_QUEUE_URL: queue.queueUrl,
      STACK_NAME: owner,
    },
  });
  queue.grantSendMessages(fn);

  bucket.addEventNotification(
    aws.storage.EventType.OBJECT_CREATED,
    new aws.storage.targets.FunctionDestination(fn),
    { prefix: `${owner}/` },
  );

  // Flat outputs (not `registerOutputs`, which emits one nested object output) so
  // terratest can read each id directly with `terraform.Output`.
  new TerraformOutput(stack, "bucket_name", { value: bucketName, staticId: true });
  new TerraformOutput(stack, "lambda_arn", { value: fn.functionArn, staticId: true });
  new TerraformOutput(stack, "queue_url", { value: queue.queueUrl, staticId: true });
  new TerraformOutput(stack, "owner", { value: owner, staticId: true });
}

buildStack(app, "a");
buildStack(app, "b");
buildStack(app, "c");

app.synth();
