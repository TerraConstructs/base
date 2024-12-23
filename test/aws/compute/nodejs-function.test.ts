import path from "path";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { compute, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("Function", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new compute.NodejsFunction(stack, "HelloWorld", {
      path: path.join(__dirname, "fixtures", "hello-world.ts"),
    });
    // THEN
    Template.synth(stack).toMatchSnapshot();
  });
  test("Should support adding vpc configuration", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new compute.NodejsFunction(stack, "HelloWorld", {
      path: path.join(__dirname, "fixtures", "hello-world.ts"),
      networkConfig: {
        vpcId: "vpc-123",
        subnetIds: ["subnet-12345678"],
      },
    });
    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_security_group",
      },
      {
        vpc_id: "vpc-123",
      },
    );
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_iam_role",
      },
      {
        managed_policy_arns: [
          "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
        ],
      },
    );
    template.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_lambda_function",
      },
      {
        vpc_config: {
          subnet_ids: ["subnet-12345678"],
          security_group_ids: expect.arrayContaining([
            expect.stringContaining("HelloWorld") &&
              expect.stringContaining("aws_security_group"),
          ]),
        },
      },
    );
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
