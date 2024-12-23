import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { render } from "./private/render-util";
import { AwsStack } from "../../../src/aws";
import { Pass, Wait, WaitTime } from "../../../src/aws/compute";
import { Duration } from "../../../src/duration";

describe("Wait State", () => {
  test("wait time from ISO8601 timestamp", () => {
    // GIVEN
    const timestamp = "2025-01-01T00:00:00Z";

    // WHEN
    const waitTime = WaitTime.timestamp(timestamp);

    // THEN
    expect(waitTime).toEqual({
      json: {
        Timestamp: "2025-01-01T00:00:00Z",
      },
    });
  });

  test("wait time from seconds path in state object", () => {
    // GIVEN
    const secondsPath = "$.waitSeconds";

    // WHEN
    const waitTime = WaitTime.secondsPath(secondsPath);

    // THEN
    expect(waitTime).toEqual({
      json: {
        SecondsPath: "$.waitSeconds",
      },
    });
  });

  test("wait time from timestamp path in state object", () => {
    // GIVEN
    const path = "$.timestampPath";

    // WHEN
    const waitTime = WaitTime.timestampPath(path);

    // THEN
    expect(waitTime).toEqual({
      json: {
        TimestampPath: "$.timestampPath",
      },
    });
  });

  describe("supports adding", () => {
    let stack: AwsStack;
    beforeEach(() => {
      // GIVEN
      stack = new AwsStack(Testing.app(), `TestStack`, {
        environmentName: "Test",
        gridUUID: "123e4567-e89b-12d3",
        providerConfig: {
          region: "us-east-1",
        },
        gridBackendConfig: {
          address: "http://localhost:3000",
        },
      });
    });
    test("supports adding a next state", () => {
      // GIVEN
      const chain = new Wait(stack, "myWaitState", {
        time: WaitTime.duration(Duration.seconds(30)),
      });

      // WHEN
      chain.next(new Pass(stack, "final pass", {}));

      // THEN
      expect(render(stack, chain)).toEqual({
        StartAt: "myWaitState",
        States: {
          "final pass": {
            End: true,
            Type: "Pass",
          },
          myWaitState: {
            Next: "final pass",
            Seconds: 30,
            Type: "Wait",
          },
        },
      });
    });

    test("supports adding a custom state name", () => {
      // GIVEN
      const waitTime = new Wait(stack, "myWaitState", {
        stateName: "wait-state-custom-name",
        time: WaitTime.duration(Duration.seconds(30)),
      });

      // THEN
      expect(render(stack, waitTime)).toEqual({
        StartAt: "wait-state-custom-name",
        States: {
          "wait-state-custom-name": {
            Seconds: 30,
            Type: "Wait",
            End: true,
          },
        },
      });
    });
  });
});
