// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-dynamodb/test/integ.dynamodb.mixed-key-gsi.ts

/**
 * This aimes to verify we can deploy a DynamoDB table with an attribute being
 * a key attribute in one GSI, and a non-key attribute in another.
 *
 * See https://github.com/aws/aws-cdk/issues/4398
 */

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "bucket-notifications";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});

const table = new aws.storage.Table(stack, "Table", {
  partitionKey: { name: "pkey", type: aws.storage.AttributeType.NUMBER },
  // removalPolicy: RemovalPolicy.DESTROY,
});

table.addGlobalSecondaryIndex({
  indexName: "IndexA",
  partitionKey: { name: "foo", type: aws.storage.AttributeType.STRING },
  projectionType: aws.storage.ProjectionType.INCLUDE,
  nonKeyAttributes: ["bar"],
});

table.addGlobalSecondaryIndex({
  indexName: "IndexB",
  partitionKey: { name: "baz", type: aws.storage.AttributeType.STRING },
  sortKey: { name: "bar", type: aws.storage.AttributeType.STRING },
  projectionType: aws.storage.ProjectionType.INCLUDE,
  nonKeyAttributes: ["blah"],
});

new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();
