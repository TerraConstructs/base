import {
  s3BucketWebsiteConfiguration,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { edge, storage, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("Distribution", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props to match AWS CDK cross account support
      // account: "1234",
    });
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
