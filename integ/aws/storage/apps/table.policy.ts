// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/%40aws-cdk-testing/framework-integ/test/aws-dynamodb/test/integ.dynamodb.policy.ts
import { App, LocalBackend } from "cdktf";
import { Construct } from "constructs";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "table.policy";
const awsAccountId = process.env.AWS_ACCOUNT_ID ?? "020602600951";

// import { IntegTest } from "@aws-cdk/integ-tests-alpha";

export class TestStack extends aws.AwsStack {
  readonly table: aws.storage.Table;
  readonly tableTwo: aws.storage.Table;

  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const doc = new aws.iam.PolicyDocument(this, "ResourcePolicy", {
      statement: [
        new aws.iam.PolicyStatement({
          actions: ["dynamodb:*"],
          principals: [new aws.iam.AccountRootPrincipal()],
          resources: ["*"],
        }),
      ],
    });

    this.table = new aws.storage.Table(this, "TableTest1", {
      partitionKey: {
        name: "id",
        type: aws.storage.AttributeType.STRING,
      },
      // removalPolicy: RemovalPolicy.DESTROY,
      resourcePolicy: doc,
    });

    this.tableTwo = new aws.storage.Table(this, "TableTest2", {
      partitionKey: {
        name: "PK",
        type: aws.storage.AttributeType.STRING,
      },
      // removalPolicy: RemovalPolicy.DESTROY,
    });

    this.tableTwo.grantReadData(new aws.iam.AccountPrincipal(awsAccountId));
  }
}

const app = new App({
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

app.synth();
