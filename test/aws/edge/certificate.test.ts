import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { edge, AwsStack } from "../../../src/aws";

describe("PublicCertificate", () => {
  test("Create should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
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
    const stack = new AwsStack();
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
    const stack = new AwsStack();
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
