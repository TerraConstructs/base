import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { edge, storage, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
const ipAddress = "123.123.123.0";
describe("DnsZone", () => {
  test("Create should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      websiteConfig: {
        enabled: true,
      },
    });
    const distribution = new edge.Distribution(
      stack,
      "HelloWorldDistribution",
      {
        defaultBehavior: {
          origin: new edge.S3Origin(bucket),
        },
      },
    );
    // WHEN
    const zone = new edge.DnsZone(stack, "Zone", {
      zoneName: "example.com",
    });
    new edge.ARecord(stack, "ARecordApex", {
      zone,
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "ARecordBar", {
      zone,
      recordName: "bar",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "BucketAlias", {
      zone,
      recordName: "hello-world-bucket",
      target: edge.RecordTarget.fromAlias(new edge.BucketWebsiteTarget(bucket)),
    });
    new edge.ARecord(stack, "CdnAlias", {
      zone,
      recordName: "hello-world-cdn",
      target: edge.RecordTarget.fromAlias(
        new edge.DistributionTarget(distribution),
      ),
    });
    // Weighted routing policy
    new edge.ARecord(stack, "WeightedA", {
      zone,
      recordName: "weighted",
      weight: 80,
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "WeightedB", {
      zone,
      recordName: "weighted",
      weight: 20,
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    // Latency routing policy
    new edge.ARecord(stack, "LatencyA", {
      zone,
      recordName: "latency",
      region: "us-east-1",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "LatencyB", {
      zone,
      recordName: "latency",
      region: "ap-southeast-1",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Import should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    // WHEN
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    new edge.ARecord(stack, "ARecordApex", {
      zone, // without recordName should point to data source zoneName
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "ARecordBar", {
      zone, // with recordName
      recordName: "bar",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should throw error if bucket has no website config", () => {
    // GIVEN
    const stack = getAwsStack();
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    // WHEN
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
    });
    // THEN
    expect(() => {
      new edge.ARecord(stack, "HelloWorldAlias", {
        zone,
        target: edge.RecordTarget.fromAlias(
          new edge.BucketWebsiteTarget(bucket),
        ),
      });
    }).toThrow("Cannot use a non-website bucket");
  });
  test("Should throw error if multiple routing policies are provided", () => {
    // GIVEN
    const stack = getAwsStack();
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    // THEN
    expect(() => {
      new edge.ARecord(stack, "HelloWorldRouting", {
        zone,
        weight: 80,
        region: "us-east-1",
        target: edge.RecordTarget.fromValues(ipAddress),
      });
    }).toThrow("Only one of");
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
