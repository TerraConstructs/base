// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-dynamodb/test/integ.global.ts

import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "table-global";

// import { IntegTest } from "@aws-cdk/integ-tests-alpha";

class TestStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const table = new aws.storage.Table(this, "Table", {
      tableName: "my-global-table", // Fixed name for testing
      partitionKey: {
        name: "id",
        type: aws.storage.AttributeType.STRING,
      },
      // removalPolicy: RemovalPolicy.DESTROY,
      replicationRegions: ["eu-west-2", "eu-central-1"],
      registerOutputs: true,
      outputName: "table",
    });

    /*
     * Stack verification steps:
     *  - aws dynamodb describe-global-table --global-table-name <get-tf-output>
     *  - aws dynamodb describe-table --table-name <get-tf-output>
     *
     * Verify that the global table has replicas in eu-west-2 and eu-central-1,
     * and that the global secondary index "my-index" exists.
     */

    table.addGlobalSecondaryIndex({
      indexName: "my-index",
      partitionKey: {
        name: "key",
        type: aws.storage.AttributeType.STRING,
      },
    });
  }
}

const app = new App({
  // postCliContext: {
  //   "@aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy": false,
  // },
  outdir,
});
const stack = new TestStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// new IntegTest(app, "cdk-aws.storage-global-20191121-test", {
//   testCases: [stack],
//   diffAssets: true,
// });

app.synth();
