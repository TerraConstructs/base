import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { edge, AwsStack } from "../../../src/aws";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };
describe("PublicCertificate", () => {
  test("Create should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    const zone = new edge.DnsZone(stack, "Zone", {
      zoneName: "example.com",
    });
    // WHEN
    new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.com",
      subjectAlternativeNames: ["*.example.com"],
      validation: {
        method: edge.ValidationMethod.DNS,
        hostedZone: zone,
      },
      lifecycle: {
        createBeforeDestroy: true,
      },
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Create multi-zone should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    const zone1 = new edge.DnsZone(stack, "ExampleNetZone", {
      zoneName: "example.net",
    });
    const zone2 = new edge.DnsZone(stack, "ExampleComZone", {
      zoneName: "example.com",
    });
    // WHEN
    new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.net",
      subjectAlternativeNames: [
        "*.example.net",
        "example.com",
        "*.example.com",
      ],
      validation: {
        method: edge.ValidationMethod.DNS,
        hostedZones: {
          "example.net": zone1,
          "example.com": zone2,
        },
      },
      lifecycle: {
        createBeforeDestroy: true,
      },
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Imported DnsZone should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    // WHEN
    new edge.PublicCertificate(stack, "Certificate", {
      domainName: "example.com",
      subjectAlternativeNames: ["*.example.com"],
      validation: {
        method: edge.ValidationMethod.DNS,
        hostedZone: zone,
      },
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
