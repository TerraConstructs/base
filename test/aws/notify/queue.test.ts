import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Duration } from "../../../src/";
import { notify, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("Queue", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "HelloWorld");
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth and match SnapShot with prefix", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "HelloWorld", {
      namePrefix: "hello-world",
      // encryption: QueueEncryption.KMS_MANAGED, //TODO: Re-add KMS encryption
      messageRetentionSeconds: Duration.days(14).toSeconds(),
      visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth with DLQ and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    const deadLetterQueue = new notify.Queue(stack, "DLQ", {
      // encryption: QueueEncryption.KMS_MANAGED, //TODO: Re-add KMS encryption
      messageRetentionSeconds: Duration.days(14).toSeconds(),
      visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
    });
    new notify.Queue(stack, "Queue", {
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: deadLetterQueue,
      },
      // encryption: QueueEncryption.KMS_MANAGED, //TODO: Re-add KMS encryption
      messageRetentionSeconds: Duration.days(14).toSeconds(),
      visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth with fifo suffix and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "Queue", {
      namePrefix: "queue.fifo",
      // encryption: QueueEncryption.KMS_MANAGED, //TODO: Re-add KMS encryption
      messageRetentionSeconds: Duration.days(14).toSeconds(),
      visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should synth with contentBasedDeduplication and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    new notify.Queue(stack, "Queue", {
      // encryption: QueueEncryption.KMS_MANAGED, //TODO: Re-add KMS encryption
      contentBasedDeduplication: true,
      messageRetentionSeconds: Duration.days(14).toSeconds(),
      visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
    });
    // THEN
    stack.prepareStack(); // may generate additional resources
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
