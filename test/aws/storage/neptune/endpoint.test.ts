// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/endpoint.test.ts

import { Token } from "cdktn";
import { Endpoint } from "../../../../src/aws/storage/neptune";

const CDK_NUMERIC_TOKEN = Token.asNumber({ Ref: "abc" });

describe("Endpoint", () => {
  test("accepts tokens for the port value", () => {
    // GIVEN
    const token = CDK_NUMERIC_TOKEN;

    // WHEN
    const endpoint = new Endpoint("127.0.0.1", token);

    // THEN
    expect(endpoint.port).toBe(token);
  });

  test("accepts valid port string numbers", () => {
    // GIVEN
    for (const port of [1, 50, 65535]) {
      // WHEN
      const endpoint = new Endpoint("127.0.0.1", port);

      // THEN
      expect(endpoint.port).toBe(port);
    }
  });

  describe(".socketAddress", () => {
    test("combines hostname and port", () => {
      // GIVEN
      const endpoint = new Endpoint("127.0.0.1", 1500);

      // THEN
      expect(endpoint.socketAddress).toBe("127.0.0.1:1500");
    });

    test("stringifies port tokens", () => {
      // GIVEN
      const port = CDK_NUMERIC_TOKEN;
      const endpoint = new Endpoint("127.0.0.1", port);

      // WHEN
      const result = endpoint.socketAddress;

      // THEN
      // Should embed a string token (not just the raw numeric token's own
      // string representation).
      expect(Token.isUnresolved(result)).toBeTruthy();
      expect(result).not.toBe(`127.0.0.1:${port.toString()}`);
    });
  });
});
