// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk/custom-resource-handlers/test/core/nodejs-entrypoint-handler.test.ts
import * as assert from "assert";
import * as fs from "fs";
import { OutgoingHttpHeaders } from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as url from "url";

// The handler is vendored as pre-transpiled CommonJS (no type declarations).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const entrypoint: Entrypoint = require("../../../src/aws/custom-resource-handlers/core/nodejs-entrypoint-handler/index.js");

// Minimal local stand-ins for the `aws-lambda` types used upstream.
type CloudFormationCustomResourceEvent = { [key: string]: any };
type CloudFormationCustomResourceResponse = { [key: string]: any };
type HandlerResponse =
  | undefined
  | {
      Data?: any;
      PhysicalResourceId?: string;
      Reason?: string;
      NoEcho?: boolean;
    };
type Handler = (
  event: CloudFormationCustomResourceEvent,
  context: any,
) => Promise<HandlerResponse | void>;
interface Entrypoint {
  external: {
    sendHttpRequest: (
      options: https.RequestOptions,
      requestBody: string,
    ) => Promise<void>;
    log: (...args: any[]) => void;
    includeStackTraces: boolean;
    userHandlerIndex: string;
  };
  handler: (
    event: CloudFormationCustomResourceEvent,
    context: any,
  ) => Promise<void>;
  withRetries: <A extends Array<any>, B>(
    options: { attempts: number; sleep: number },
    fn: (...xs: A) => Promise<B>,
  ) => (...xs: A) => Promise<B>;
}

describe("nodejs entrypoint", () => {
  describe("handler return value is sent back to cloudformation as a success response", () => {
    test("physical resource id (ref)", async () => {
      // GIVEN
      const createEvent = makeEvent({ RequestType: "Create" });

      // WHEN
      const { response } = await invokeHandler(createEvent, async (_) => ({
        PhysicalResourceId: "returned-from-handler",
      }));

      // THEN
      expect(response.Status).toEqual("SUCCESS");
      expect(response.PhysicalResourceId).toEqual("returned-from-handler");
    });

    test("data (attributes)", async () => {
      // GIVEN
      const createEvent = makeEvent({ RequestType: "Create" });

      // WHEN
      const { response } = await invokeHandler(createEvent, async (_) => {
        return {
          Data: {
            Attribute1: "hello",
            Attribute2: {
              Foo: 1111,
            },
          },
        };
      });

      // THEN
      expect(response.Status).toEqual("SUCCESS");
      expect(response.PhysicalResourceId).toEqual("<RequestId>");
      expect(response.Data).toEqual({
        Attribute1: "hello",
        Attribute2: {
          Foo: 1111,
        },
      });
    });

    test("no echo", async () => {
      // GIVEN
      const createEvent = makeEvent({ RequestType: "Create" });

      // WHEN
      const { response } = await invokeHandler(createEvent, async (_) => ({
        NoEcho: true,
      }));

      // THEN
      expect(response.Status).toEqual("SUCCESS");
      expect(response.NoEcho).toEqual(true);
    });

    test("reason", async () => {
      // GIVEN
      const createEvent = makeEvent({ RequestType: "Create" });

      // WHEN
      const { response } = await invokeHandler(createEvent, async (_) => ({
        Reason: "hello, reason",
      }));

      // THEN
      expect(response.Status).toEqual("SUCCESS");
      expect(response.Reason).toEqual("hello, reason");
    });

    test("utf8 is supported", async () => {
      // GIVEN
      const createEvent = makeEvent({ RequestType: "Create" });
      const { request: emptyDataRequest } = await invokeHandler(
        createEvent,
        async (_) => ({
          Data: {
            Attribute: "", // 0 bytes
          },
        }),
      );

      // WHEN
      const { request: utf8DataRequest } = await invokeHandler(
        createEvent,
        async (_) => ({
          Data: {
            Attribute: "ÅÄÖ", // 6 bytes
          },
        }),
      );

      // THEN
      const emptyLength = (emptyDataRequest.headers as OutgoingHttpHeaders)?.[
        "content-length"
      ] as number;
      const utf8Length = (utf8DataRequest.headers as OutgoingHttpHeaders)?.[
        "content-length"
      ] as number;
      expect(utf8Length - emptyLength).toEqual(6);
    });
  });

  test("an error thrown by the handler is sent as a failure response to cloudformation", async () => {
    // GIVEN
    const createEvent = makeEvent({ RequestType: "Create" });

    // WHEN
    const { response } = await invokeHandler(createEvent, async (_) => {
      throw new Error("this is an error");
    });

    // THEN
    expect(response).toEqual({
      Status: "FAILED",
      Reason: "this is an error",
      StackId: "<StackId>",
      RequestId: "<RequestId>",
      PhysicalResourceId:
        "AWSCDK::CustomResourceProviderFramework::CREATE_FAILED",
      LogicalResourceId: "<LogicalResourceId>",
    });
  });

  test("physical resource id cannot be changed in DELETE", async () => {
    // GIVEN
    const event = makeEvent({ RequestType: "Delete" });

    // WHEN
    const { response } = await invokeHandler(event, async (_) => ({
      PhysicalResourceId: "Changed",
    }));

    // THEN
    expect(response).toEqual({
      Status: "FAILED",
      Reason:
        'DELETE: cannot change the physical resource ID from "undefined" to "Changed" during deletion',
      StackId: "<StackId>",
      RequestId: "<RequestId>",
      PhysicalResourceId:
        "AWSCDK::CustomResourceProviderFramework::MISSING_PHYSICAL_ID",
      LogicalResourceId: "<LogicalResourceId>",
    });
  });

  test("DELETE after CREATE is ignored with success", async () => {
    // GIVEN
    const event = makeEvent({
      RequestType: "Delete",
      PhysicalResourceId:
        "AWSCDK::CustomResourceProviderFramework::CREATE_FAILED",
    });

    // WHEN
    const { response } = await invokeHandler(event, async (_) => {
      throw new Error("handler should not be called");
    });

    // THEN
    expect(response).toEqual({
      Status: "SUCCESS",
      Reason: "SUCCESS",
      StackId: "<StackId>",
      RequestId: "<RequestId>",
      PhysicalResourceId:
        "AWSCDK::CustomResourceProviderFramework::CREATE_FAILED",
      LogicalResourceId: "<LogicalResourceId>",
    });
  });

  // TerraConstructs: cfncompat_custom_resource presigns the S3 PUT response URL
  // without a Content-Type, so the wrapper must keep PUTting with an empty one.
  test("response is PUT to the response URL with an empty content-type", async () => {
    // GIVEN
    const event = makeEvent({
      RequestType: "Update",
      PhysicalResourceId: "existing-id",
      ResponseURL:
        "https://bucket.s3.us-east-1.amazonaws.com/responses/abc?X-Amz-Signature=sig",
    });

    // WHEN
    const { request, response } = await invokeHandler(
      event,
      async (_) => undefined,
    );

    // THEN
    expect(request.method).toEqual("PUT");
    expect(request.hostname).toEqual("bucket.s3.us-east-1.amazonaws.com");
    expect(request.path).toEqual("/responses/abc?X-Amz-Signature=sig");
    expect((request.headers as OutgoingHttpHeaders)["content-type"]).toEqual(
      "",
    );
    // Update keeps the physical id when the handler returns none
    expect(response.Status).toEqual("SUCCESS");
    expect(response.PhysicalResourceId).toEqual("existing-id");
  });

  // TerraConstructs: exercise the retry helper used by submitResponse.
  test("withRetries retries failed attempts", async () => {
    // GIVEN
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) {
        throw new Error(`attempt ${calls} failed`);
      }
      return "ok";
    };

    // WHEN
    const result = await entrypoint.withRetries(
      { attempts: 5, sleep: 1 },
      flaky,
    )();

    // THEN
    expect(result).toEqual("ok");
    expect(calls).toEqual(3);
    await expect(
      entrypoint.withRetries({ attempts: 1, sleep: 1 }, async () => {
        throw new Error("always");
      })(),
    ).rejects.toThrow(/always/);
  });
});

function makeEvent(
  req: Partial<CloudFormationCustomResourceEvent>,
): CloudFormationCustomResourceEvent {
  return {
    LogicalResourceId: "<LogicalResourceId>",
    RequestId: "<RequestId>",
    ResourceType: "<ResourceType>",
    ResponseURL: "<ResponseURL>",
    ServiceToken: "<ServiceToken>",
    StackId: "<StackId>",
    ResourceProperties: {
      ServiceToken: "<ServiceToken>",
      ...req.ResourceProperties,
    },
    ...req,
  } as any;
}

async function invokeHandler(
  req: CloudFormationCustomResourceEvent,
  userHandler: Handler,
) {
  const parsedResponseUrl = url.parse(req.ResponseURL);

  // stage entry point and user handler.
  const workdir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cdk-custom-resource-provider-handler-test-"),
  );
  process.on("exit", () => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });
  entrypoint.external.userHandlerIndex = path.join(workdir, "index.js");
  fs.writeFileSync(
    entrypoint.external.userHandlerIndex,
    `exports.handler = ${userHandler.toString()};`,
  );

  // do not include stack traces in failure responses so we can assert against them.
  entrypoint.external.includeStackTraces = false;

  // disable logging
  entrypoint.external.log = () => {
    return;
  };

  let actualResponse;
  let actualRequest;
  entrypoint.external.sendHttpRequest = async (
    options: https.RequestOptions,
    responseBody: string,
  ): Promise<void> => {
    assert.ok(
      options.hostname === parsedResponseUrl.hostname,
      "request hostname expected to be based on response URL",
    );
    assert.ok(
      options.path === parsedResponseUrl.path,
      "request path expected to be based on response URL",
    );
    assert.ok(options.method === "PUT", "request method is expected to be PUT");
    actualResponse = responseBody;
    actualRequest = options;
  };

  await entrypoint.handler(req, {});
  if (!actualRequest || !actualResponse) {
    throw new Error("no response sent to cloudformation");
  }

  return {
    response: JSON.parse(
      actualResponse,
    ) as CloudFormationCustomResourceResponse,
    request: actualRequest as https.RequestOptions,
  };
}
