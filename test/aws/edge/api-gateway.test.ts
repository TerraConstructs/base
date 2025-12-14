// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/aws-route53-targets/test/apigateway-target.test.ts

import "cdktf/lib/testing/adapters/jest";
import { route53Record } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import { edge, AwsStack, compute } from "../../../src/aws";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

test("edge.ApiGatewayTarget can be used to the default domain of an APIGW", () => {
  // GIVEN
  const stack = getAwsStack();
  const cert = new edge.PublicCertificate(stack, "cert", {
    domainName: "example.com",
  });
  const api = new compute.RestApi(stack, "api", {
    domainName: {
      domainName: "example.com",
      certificate: cert,
    },
  });
  const zone = new edge.DnsZone(stack, "zone", {
    zoneName: "example.com",
  });
  api.root.addMethod("GET");

  // WHEN
  new edge.ARecord(stack, "A", {
    zone,
    target: edge.RecordTarget.fromAlias(new edge.ApiGatewayTarget(api)),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    route53Record.Route53Record,
    {
      alias: {
        evaluate_target_health: true,
        name: stack.resolve(api.domainName?.domainNameAliasDomainName),
        zone_id: stack.resolve(api.domainName?.domainNameAliasHostedZoneId),
      },
    },
  );
});

test("edge.ApiGatewayDomain can be used to directly reference a domain", () => {
  // GIVEN
  const stack = getAwsStack();
  const cert = new edge.PublicCertificate(stack, "cert", {
    domainName: "example.com",
  });
  const domain = new compute.DomainName(stack, "domain", {
    domainName: "example.com",
    certificate: cert,
  });
  const zone = new edge.DnsZone(stack, "zone", {
    zoneName: "example.com",
  });

  // WHEN
  new edge.ARecord(stack, "A", {
    zone,
    target: edge.RecordTarget.fromAlias(new edge.ApiGatewayDomain(domain)),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    route53Record.Route53Record,
    {
      alias: {
        evaluate_target_health: true,
        name: stack.resolve(domain.domainNameAliasDomainName),
        zone_id: stack.resolve(domain.domainNameAliasHostedZoneId),
      },
    },
  );
});

test("fails if an ApiGateway is used with an API that does not define a domain name", () => {
  // GIVEN
  const stack = getAwsStack();
  const api = new compute.RestApi(stack, "api");
  const zone = new edge.DnsZone(stack, "zone", {
    zoneName: "example.com",
  });
  api.root.addMethod("GET");

  // THEN
  expect(() => {
    new edge.ARecord(stack, "A", {
      zone,
      target: edge.RecordTarget.fromAlias(new edge.ApiGatewayTarget(api)),
    });
  }).toThrow(/API does not define a default domain name/);
});

test("edge.ApiGatewayTarget accepts a SpecRestApi", () => {
  // GIVEN
  const stack = getAwsStack();
  const cert = new edge.PublicCertificate(stack, "cert", {
    domainName: "example.com",
  });
  const api = new compute.SpecRestApi(stack, "api", {
    domainName: {
      domainName: "example.com",
      certificate: cert,
    },
    apiDefinition: compute.ApiDefinition.fromInline({
      key1: "val1",
    }),
  });
  const zone = new edge.DnsZone(stack, "zone", {
    zoneName: "example.com",
  });
  api.root.addMethod("GET");

  // WHEN
  new edge.ARecord(stack, "A", {
    zone,
    target: edge.RecordTarget.fromAlias(new edge.ApiGatewayTarget(api)),
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    route53Record.Route53Record,
    {
      alias: {
        evaluate_target_health: true,
        name: stack.resolve(api.domainName?.domainNameAliasDomainName),
        zone_id: stack.resolve(api.domainName?.domainNameAliasHostedZoneId),
      },
    },
  );
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
