import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { edge, AwsStack } from "../../../src/aws";

describe("KeyValueStore", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
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
    const stack = new AwsStack();
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
