import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { edge, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("KeyValueStore", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new edge.KeyValueStore(stack, "Store", {
      nameSuffix: "hello-world",
      data: edge.KeyValuePairs.fromInline({
        key1: "value1",
        key2: {
          "key2.1": "value2.1",
        },
        key3: ["value3.1", "value3.2"],
      }),
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should associate with edge.Function and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    const store = new edge.KeyValueStore(stack, "Store", {
      nameSuffix: "hello-world",
      data: edge.KeyValuePairs.fromInline({
        key1: "value1",
        key2: "value2",
      }),
    });
    // WHEN
    new edge.Function(stack, "Function", {
      nameSuffix: "hello-world",
      comment: "Hello World",
      code: edge.FunctionCode.fromInline("whatever"),
      keyValueStore: store,
    });
    // THEN
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
