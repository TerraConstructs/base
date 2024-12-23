import path from "path";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Duration } from "../../../src/";
import { compute, storage, notify, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("Function with Storage", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    const fn = new compute.NodejsFunction(stack, "HelloWorld", {
      path: path.join(__dirname, "fixtures", "hello-world.ts"),
    });
    const bucket = new storage.Bucket(stack, "HelloWorldBucket", {
      namePrefix: "hello-world",
    });
    bucket.grantRead(fn);
    // THEN
    stack.prepareStack(); // required to add last minute resources to the stack
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

describe("Function with event rules", () => {
  test("Should handle dependencies on permissions", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    const fn = new compute.NodejsFunction(stack, "HelloWorld", {
      path: path.join(__dirname, "fixtures", "hello-world.ts"),
    });
    const rule = new notify.Rule(stack, "HelloWorldRule", {
      schedule: notify.Schedule.rate(Duration.days(1)),
    });
    rule.addTarget(new notify.targets.LambdaFunction(fn));
    // THEN
    stack.prepareStack(); // required to add last minute resources to the stack
    expect(Testing.synth(stack)).toMatchSnapshot();
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
