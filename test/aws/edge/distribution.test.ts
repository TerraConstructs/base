import {
  s3BucketWebsiteConfiguration,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { edge, storage, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};
describe("Distribution", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app);
    new HttpBackend(stack, gridBackendConfig);
  });

  test("Should synth with OAI and match SnapShot", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
      },
    });
    // THEN
    Template.synth(stack, { snapshot: true }).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["s3:GetObject"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${aws_cloudfront_origin_access_identity.HelloWorld_OriginAccessIdentity_5B20D425.iam_arn}",
                ],
                type: "AWS",
              },
            ],
            resources: [`${stack.resolve(bucket.bucketArn)}/*`],
          },
        ],
      },
    );
  });
  test("Should synth with websiteConfig and match SnapShot", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      websiteConfig: {
        enabled: true,
      },
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
      },
    });
    // THEN
    Template.synth(stack, { snapshot: true }).toHaveResourceWithProperties(
      s3BucketWebsiteConfiguration.S3BucketWebsiteConfiguration,
      {
        bucket: stack.resolve(bucket.bucketName),
      },
    );
  });
  test("Should throw error if bucket has no OAI or website config", () => {
    // WHEN
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
    });
    // THEN
    expect(() => {
      new edge.Distribution(stack, "HelloWorldDistribution", {
        defaultBehavior: {
          origin: new edge.S3Origin(bucket),
        },
      });
    }).toThrow("must have an origin access identity");
  });
  test("Should support multiple origins and cache behaviors", () => {
    // GIVEN
    const bucket0 = new storage.Bucket(stack, "Bucket0", {
      namePrefix: "bucket-0",
      websiteConfig: {
        enabled: true,
      },
    });
    const bucket1 = new storage.Bucket(stack, "Bucket1", {
      namePrefix: "bucket-1",
      websiteConfig: {
        enabled: true,
      },
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket0),
      },
      additionalBehaviors: {
        "/images/*": {
          origin: new edge.S3Origin(bucket1),
        },
      },
    });
    // THEN
    Template.fromStack(stack, { snapshot: true }).toMatchObject({
      resource: {
        aws_s3_bucket_website_configuration: {
          Bucket0_WebsiteConfig_F3339C3F: {
            bucket: stack.resolve(bucket0.bucketName),
            index_document: {
              suffix: "index.html",
            },
          },
          Bucket1_WebsiteConfig_0DE2B7DD: {
            bucket: stack.resolve(bucket1.bucketName),
            index_document: {
              suffix: "index.html",
            },
          },
        },
      },
    });
  });
  test("Should render functionAssociations on default and ordered cache behaviors", () => {
    // GIVEN
    const bucket0 = new storage.Bucket(stack, "Bucket0", {
      namePrefix: "bucket-0",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const bucket1 = new storage.Bucket(stack, "Bucket1", {
      namePrefix: "bucket-1",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const viewerRequestFn = new edge.Function(stack, "ViewerRequestFn", {
      nameSuffix: "viewer-request",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    const viewerResponseFn = new edge.Function(stack, "ViewerResponseFn", {
      nameSuffix: "viewer-response",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket0),
        functionAssociations: [
          {
            function: viewerRequestFn,
            eventType: edge.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/images/*": {
          origin: new edge.S3Origin(bucket1),
          functionAssociations: [
            {
              function: viewerResponseFn,
              eventType: edge.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
      },
    });
    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_cloudfront_distribution: {
          HelloWorldDistribution_E7735130: {
            default_cache_behavior: {
              function_association: [
                {
                  event_type: "viewer-request",
                  function_arn: stack.resolve(viewerRequestFn.functionArn),
                },
              ],
            },
            ordered_cache_behavior: [
              {
                path_pattern: "/images/*",
                function_association: [
                  {
                    event_type: "viewer-response",
                    function_arn: stack.resolve(viewerResponseFn.functionArn),
                  },
                ],
              },
            ],
          },
        },
      },
    });
  });
  test("Should throw on duplicate function association event types", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const fn = new edge.Function(stack, "Fn", {
      nameSuffix: "duplicate",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    // WHEN - default behavior renders lazily, so the error surfaces at synth
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
        functionAssociations: [
          {
            function: fn,
            eventType: edge.FunctionEventType.VIEWER_REQUEST,
          },
          {
            function: fn,
            eventType: edge.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
    // THEN
    expect(() => {
      Template.fromStack(stack);
    }).toThrow("Only one function association is allowed per event type");
  });
  test("Should include functionAssociations pushed onto the array after construction", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const fn = new edge.Function(stack, "Fn", {
      nameSuffix: "late-push",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    const functionAssociations: edge.FunctionAssociation[] = [];
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
        functionAssociations,
      },
    });
    // Associations pushed onto the caller-held array *after* construction
    // must still be picked up, since rendering is deferred to synth time.
    functionAssociations.push({
      function: fn,
      eventType: edge.FunctionEventType.VIEWER_REQUEST,
    });
    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_cloudfront_distribution: {
          HelloWorldDistribution_E7735130: {
            default_cache_behavior: {
              function_association: [
                {
                  event_type: "viewer-request",
                  function_arn: stack.resolve(fn.functionArn),
                },
              ],
            },
          },
        },
      },
    });
  });
  test("Should throw on duplicate function association event types in additional behaviors", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const fn = new edge.Function(stack, "Fn", {
      nameSuffix: "duplicate",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    // WHEN - additionalBehaviors render lazily, so the error surfaces at synth
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
      },
      additionalBehaviors: {
        "/images/*": {
          origin: new edge.S3Origin(bucket),
          functionAssociations: [
            {
              function: fn,
              eventType: edge.FunctionEventType.VIEWER_RESPONSE,
            },
            {
              function: fn,
              eventType: edge.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
      },
    });
    // THEN
    expect(() => {
      Template.fromStack(stack);
    }).toThrow("Only one function association is allowed per event type");
  });
  test("Should throw when associating a function created with autoPublish: false", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const fn = new edge.Function(stack, "Fn", {
      nameSuffix: "unpublished",
      code: edge.FunctionCode.fromInline("whatever"),
      autoPublish: false,
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
        functionAssociations: [
          {
            function: fn,
            eventType: edge.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
    // THEN
    expect(() => {
      Template.fromStack(stack);
    }).toThrow(/autoPublish: false/);
  });
  test("Should throw when associating an autoPublish: false function via additional behaviors", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const fn = new edge.Function(stack, "Fn", {
      nameSuffix: "unpublished",
      code: edge.FunctionCode.fromInline("whatever"),
      autoPublish: false,
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
      },
      additionalBehaviors: {
        "/images/*": {
          origin: new edge.S3Origin(bucket),
          functionAssociations: [
            {
              function: fn,
              eventType: edge.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
    });
    // THEN
    expect(() => {
      Template.fromStack(stack);
    }).toThrow(/autoPublish: false/);
  });
  test("Should allow associating a function created with autoPublish: true (default)", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    const fn = new edge.Function(stack, "Fn", {
      nameSuffix: "published",
      code: edge.FunctionCode.fromInline("whatever"),
      autoPublish: true,
    });
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
        functionAssociations: [
          {
            function: fn,
            eventType: edge.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
    // THEN
    expect(() => {
      Template.fromStack(stack);
    }).not.toThrow();
  });
  test("Should not reject an imported (non-Function) IFunction association", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    // An imported/general IFunction implementation is unverifiable and
    // therefore must not be rejected, even though it can't be proven to be
    // published to the LIVE stage.
    // NOTE: edge.Function has no static import method yet (see the
    // `TODO: Add static fromLookup?` in src/aws/edge/function.ts); when one
    // is added, switch this cast to use it.
    const importedFn: edge.IFunction = {
      functionArn:
        "arn:aws:cloudfront::123456789012:function/imported-function",
    } as unknown as edge.IFunction;
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
        functionAssociations: [
          {
            function: importedFn,
            eventType: edge.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
    // THEN
    expect(() => {
      Template.fromStack(stack);
    }).not.toThrow();
  });
  test("Should support custom Response Header Policy", () => {
    // GIVEN
    const bucket = new storage.Bucket(stack, "Bucket", {
      namePrefix: "bucket",
      cloudfrontAccess: {
        enabled: true,
      },
    });
    // With COOP/COEP headers
    const responseHeadersPolicy = new edge.ResponseHeadersPolicy(
      stack,
      "ResponseHeadersPolicy",
      {
        responseHeadersPolicyName: "CrossOriginIsolation",
        // ref: https://webcontainers.io/guides/configuring-headers
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Cross-Origin-Embedder-Policy",
              value: "require-corp",
              override: true,
            },
            {
              header: "Cross-Origin-Opener-Policy",
              value: "same-origin",
              override: true,
            },
          ],
        },
      },
    );
    // WHEN
    new edge.Distribution(stack, "HelloWorldDistribution", {
      defaultBehavior: {
        origin: new edge.S3Origin(bucket),
        responseHeadersPolicy,
      },
    });
    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_cloudfront_distribution: {
          HelloWorldDistribution_E7735130: {
            default_cache_behavior: {
              response_headers_policy_id: stack.resolve(
                responseHeadersPolicy.responseHeadersPolicyId,
              ),
            },
          },
        },
      },
    });
  });
});
