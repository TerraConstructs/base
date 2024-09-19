import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Duration } from "../../../src/";
import { notify, AwsSpec } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("Queue", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const spec = getAwsSpec();
    // WHEN
    new notify.Queue(spec, "HelloWorld", {
      nameSuffix: "hello-world",
      // encryption: QueueEncryption.KMS_MANAGED, //TODO: Re-add KMS encryption
      messageRetentionSeconds: Duration.days(14).toSeconds(),
      visibilityTimeoutSeconds: Duration.minutes(15).toSeconds(),
    });
    // THEN
    spec.prepareStack(); // may generate additional resources
    expect(Testing.synth(spec)).toMatchSnapshot();
  });
});

function getAwsSpec(): AwsSpec {
  const app = Testing.app();
  return new AwsSpec(app, "TestSpec", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}