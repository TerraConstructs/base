// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/domains.test.ts

import {
  apiGatewayDomainName,
  apiGatewayBasePathMapping,
  apiGatewayRestApi,
  apiGatewayDeployment,
  apiGatewayStage,
  apigatewayv2ApiMapping,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as compute from "../../../src/aws/compute";
import * as edge from "../../../src/aws/edge";
import * as storage from "../../../src/aws/storage";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

/* eslint-disable quote-props */

describe("domains", () => {
  let stack: AwsStack;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("can define either an EDGE or REGIONAL domain name", () => {
    // GIVEN
    const cert = new edge.PublicCertificate(stack, "Cert", {
      domainName: "example.com",
    });

    // WHEN
    const regionalDomain = new compute.DomainName(stack, "my-domain", {
      domainName: "example.com",
      certificate: cert,
      endpointType: compute.EndpointType.REGIONAL,
    });

    const edgeDomain = new compute.DomainName(stack, "your-domain", {
      domainName: "example.com",
      certificate: cert,
      endpointType: compute.EndpointType.EDGE,
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn: stack.resolve(cert.certificateArn),
      },
    );

    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "example.com",
        endpoint_configuration: { types: ["EDGE"] },
        certificate_arn: stack.resolve(cert.certificateArn),
      },
    );

    expect(stack.resolve(regionalDomain.domainNameAliasDomainName)).toEqual(
      "${aws_api_gateway_domain_name.my-domain_592C948B.regional_domain_name}",
    );
    expect(stack.resolve(regionalDomain.domainNameAliasHostedZoneId)).toEqual(
      "${aws_api_gateway_domain_name.my-domain_592C948B.regional_zone_id}",
    );
    expect(stack.resolve(edgeDomain.domainNameAliasDomainName)).toEqual(
      "${aws_api_gateway_domain_name.your-domain_5FE30C81.cloudfront_domain_name}",
    );
    expect(stack.resolve(edgeDomain.domainNameAliasHostedZoneId)).toEqual(
      "${aws_api_gateway_domain_name.your-domain_5FE30C81.cloudfront_zone_id}",
    );
  });

  test("default endpoint type is REGIONAL", () => {
    // GIVEN
    const cert = new edge.PublicCertificate(stack, "Cert", {
      domainName: "example.com",
    });

    // WHEN
    new compute.DomainName(stack, "my-domain", {
      domainName: "example.com",
      certificate: cert,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn: stack.resolve(cert.certificateArn),
      },
    );
  });

  test("accepts different security policies", () => {
    // GIVEN
    const cert = new edge.PublicCertificate(stack, "Cert", {
      domainName: "example.com",
    });

    // WHEN
    new compute.DomainName(stack, "my-domain", {
      domainName: "old.example.com",
      certificate: cert,
      securityPolicy: compute.SecurityPolicy.TLS_1_0,
    });

    new compute.DomainName(stack, "your-domain", {
      domainName: "new.example.com",
      certificate: cert,
      securityPolicy: compute.SecurityPolicy.TLS_1_2,
    });

    new compute.DomainName(stack, "default-domain", {
      domainName: "default.example.com",
      certificate: cert,
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "old.example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn: stack.resolve(cert.certificateArn),
        security_policy: "TLS_1_0",
      },
    );

    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "new.example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn: stack.resolve(cert.certificateArn),
        security_policy: "TLS_1_2",
      },
    );

    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "default.example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn: stack.resolve(cert.certificateArn),
        // Or check that the property is not present
        //security_policy: undefined,
      },
    );
  });

  test('"mapping" can be used to automatically map this domain to the deployment stage of an API', () => {
    // GIVEN
    const api = new compute.RestApi(stack, "api");
    api.root.addMethod("GET");

    // WHEN
    new compute.DomainName(stack, "Domain", {
      domainName: "foo.com",
      certificate: edge.PublicCertificate.fromCertificateArn(
        stack,
        "cert",
        "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
      ),
      endpointType: compute.EndpointType.EDGE,
      mapping: api,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name: stack.resolve(
          "${aws_api_gateway_domain_name.Domain_66AC69E0.domain_name}",
        ),
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });

  describe("multi-level mapping", () => {
    test("can add a multi-level path", () => {
      // GIVEN
      const api = new compute.RestApi(stack, "api");
      api.root.addMethod("GET");

      // WHEN
      new compute.DomainName(stack, "Domain", {
        domainName: "foo.com",
        certificate: edge.PublicCertificate.fromCertificateArn(
          stack,
          "cert",
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        ),
        endpointType: compute.EndpointType.REGIONAL,
        mapping: api,
        basePath: "v1/api",
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        apigatewayv2ApiMapping.Apigatewayv2ApiMapping,
        {
          // DomainName for ApiMapping is the ID of the DomainName resource
          domain_name:
            "${aws_api_gateway_domain_name.Domain_66AC69E0.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage: stack.resolve(api.deploymentStage.stageName),
          api_mapping_key: "v1/api",
        },
      );
    });

    test("throws if endpointType is not REGIONAL", () => {
      // GIVEN
      const api = new compute.RestApi(stack, "api");
      api.root.addMethod("GET");

      // THEN
      expect(() => {
        new compute.DomainName(stack, "Domain", {
          domainName: "foo.com",
          certificate: edge.PublicCertificate.fromCertificateArn(
            stack,
            "cert",
            "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
          ),
          endpointType: compute.EndpointType.EDGE,
          mapping: api,
          basePath: "v1/api",
        });
      }).toThrow(
        /multi-level basePath is only supported when endpointType is EndpointType.REGIONAL/,
      );
    });

    test("throws if securityPolicy is not TLS_1_2", () => {
      // GIVEN
      const api = new compute.RestApi(stack, "api");
      api.root.addMethod("GET");

      // THEN
      expect(() => {
        new compute.DomainName(stack, "Domain", {
          domainName: "foo.com",
          certificate: edge.PublicCertificate.fromCertificateArn(
            stack,
            "cert",
            "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
          ),
          mapping: api,
          basePath: "v1/api",
          securityPolicy: compute.SecurityPolicy.TLS_1_0,
        });
      }).toThrow(
        /securityPolicy must be set to TLS_1_2 if multi-level basePath is provided/,
      );
    });

    test("can use addApiMapping", () => {
      // GIVEN
      const api = new compute.RestApi(stack, "api");
      api.root.addMethod("GET");

      // WHEN
      const domain = new compute.DomainName(stack, "Domain", {
        domainName: "foo.com",
        certificate: edge.PublicCertificate.fromCertificateArn(
          stack,
          "cert",
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        ),
      });
      domain.addApiMapping(api.deploymentStage);
      domain.addApiMapping(api.deploymentStage, { basePath: "//" });
      domain.addApiMapping(api.deploymentStage, {
        basePath: "v1/my-api",
      });
      domain.addApiMapping(api.deploymentStage, {
        basePath: "v1//my-api",
      });

      // THEN
      const template = Template.synth(stack);
      template.toHaveResourceWithProperties(
        apigatewayv2ApiMapping.Apigatewayv2ApiMapping,
        {
          domain_name:
            "${aws_api_gateway_domain_name.Domain_66AC69E0.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage: stack.resolve(api.deploymentStage.stageName),
          // Root mapping
          // api_mapping_key: undefined,
        },
      );
      template.toHaveResourceWithProperties(
        apigatewayv2ApiMapping.Apigatewayv2ApiMapping,
        {
          domain_name:
            "${aws_api_gateway_domain_name.Domain_66AC69E0.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage: stack.resolve(api.deploymentStage.stageName),
          api_mapping_key: "//",
        },
      );
      template.toHaveResourceWithProperties(
        apigatewayv2ApiMapping.Apigatewayv2ApiMapping,
        {
          domain_name:
            "${aws_api_gateway_domain_name.Domain_66AC69E0.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage: stack.resolve(api.deploymentStage.stageName),
          api_mapping_key: "v1/my-api",
        },
      );
      template.toHaveResourceWithProperties(
        apigatewayv2ApiMapping.Apigatewayv2ApiMapping,
        {
          domain_name:
            "${aws_api_gateway_domain_name.Domain_66AC69E0.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage: stack.resolve(api.deploymentStage.stageName),
          api_mapping_key: "v1//my-api",
        },
      );
    });

    test("can use addDomainName", () => {
      // GIVEN
      const api = new compute.RestApi(stack, "api");
      api.root.addMethod("GET");

      const domain = api.addDomainName("Domain", {
        domainName: "foo.com",
        certificate: edge.PublicCertificate.fromCertificateArn(
          stack,
          "cert",
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        ),
      });

      // WHEN
      domain.addApiMapping(api.deploymentStage, {
        basePath: "v1/my-api",
      });

      // THEN
      const template = Template.synth(stack);
      template.toHaveResourceWithProperties(
        apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
        {
          domain_name:
            "${aws_api_gateway_domain_name.api_Domain_6D60CEFD.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage_name: stack.resolve(api.deploymentStage.stageName),
        },
      );
      template.toHaveResourceWithProperties(
        apigatewayv2ApiMapping.Apigatewayv2ApiMapping,
        {
          domain_name:
            "${aws_api_gateway_domain_name.api_Domain_6D60CEFD.domain_name}",
          api_id: stack.resolve(api.restApiId),
          stage: stack.resolve(api.deploymentStage.stageName),
          api_mapping_key: "v1/my-api",
        },
      );
    });

    test("throws if addBasePathMapping tries to add a mapping for a path that is already mapped", () => {
      // GIVEN
      const api = new compute.RestApi(stack, "api");
      api.root.addMethod("GET");

      // WHEN
      const domain = new compute.DomainName(stack, "Domain", {
        domainName: "foo.com",
        certificate: edge.PublicCertificate.fromCertificateArn(
          stack,
          "cert",
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        ),
        mapping: api,
        basePath: "v1/path",
        endpointType: compute.EndpointType.REGIONAL, // Required for multi-level basePath in constructor
        securityPolicy: compute.SecurityPolicy.TLS_1_2, // Required for multi-level basePath in constructor
      });

      // THEN
      expect(() => {
        domain.addApiMapping(api.deploymentStage, {
          basePath: "v1/path",
        });
      }).toThrow(/DomainName Domain already has a mapping for path v1\/path/);
    });
  });

  test('"addBasePathMapping" can be used to add base path mapping to the domain', () => {
    // GIVEN
    const api1 = new compute.RestApi(stack, "api1");
    const api2 = new compute.RestApi(stack, "api2");
    const domain = new compute.DomainName(stack, "my-domain", {
      domainName: "example.com",
      certificate: edge.PublicCertificate.fromCertificateArn(
        stack,
        "cert",
        "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
      ),
      endpointType: compute.EndpointType.REGIONAL,
    });
    api1.root.addMethod("GET");
    api2.root.addMethod("GET");

    // WHEN
    domain.addBasePathMapping(api1, { basePath: "api1" });
    domain.addBasePathMapping(api2, { basePath: "api2" });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.my-domain_592C948B.domain_name}",
        base_path: "api1",
        api_id: stack.resolve(api1.restApiId),
        stage_name: stack.resolve(api1.deploymentStage.stageName),
      },
    );

    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.my-domain_592C948B.domain_name}",
        base_path: "api2",
        api_id: stack.resolve(api2.restApiId),
        stage_name: stack.resolve(api2.deploymentStage.stageName),
      },
    );
  });

  test("a domain name can be defined with the API", () => {
    // GIVEN
    const domainName = "my.domain.com";
    const certificate = new edge.PublicCertificate(stack, "cert", {
      domainName: "my.domain.com",
    });

    // WHEN
    const api = new compute.RestApi(stack, "api", {
      domainName: { domainName, certificate },
    });

    api.root.addMethod("GET");

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "my.domain.com",
        endpoint_configuration: {
          types: ["REGIONAL"],
        },
        regional_certificate_arn: stack.resolve(certificate.certificateArn),
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.api_CustomDomain_64773C4F.domain_name}",
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });

  test("a domain name can be added later", () => {
    // GIVEN
    const domainName = "my.domain.com";
    const certificate = new edge.PublicCertificate(stack, "cert", {
      domainName: "my.domain.com",
    });

    // WHEN
    const api = new compute.RestApi(stack, "api", {});

    api.root.addMethod("GET");

    api.addDomainName("domainId", { domainName, certificate });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: domainName,
        endpoint_configuration: {
          types: ["REGIONAL"],
        },
        regional_certificate_arn: stack.resolve(certificate.certificateArn),
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.api_domainId_102F8DAA.domain_name}",
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });

  test("a base path can be defined when adding a domain name", () => {
    // GIVEN
    const domainName = "my.domain.com";
    const basePath = "users";
    const certificate = new edge.PublicCertificate(stack, "cert", {
      domainName: "my.domain.com",
    });

    // WHEN
    const api = new compute.RestApi(stack, "api", {});

    api.root.addMethod("GET");

    api.addDomainName("domainId", { domainName, certificate, basePath });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        base_path: "users",
        api_id: stack.resolve(api.restApiId),
      },
    );
  });

  test("additional base paths can added if addDomainName was called with a non-empty base path", () => {
    // GIVEN
    const domainName = "my.domain.com";
    const basePath = "users";
    const certificate = new edge.PublicCertificate(stack, "cert", {
      domainName: "my.domain.com",
    });

    // WHEN
    const api = new compute.RestApi(stack, "api", {});

    api.root.addMethod("GET");

    const dn = api.addDomainName("domainId", {
      domainName,
      certificate,
      basePath,
    });
    dn.addBasePathMapping(api, {
      basePath: "books",
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        base_path: "users",
        api_id: stack.resolve(api.restApiId),
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        base_path: "books",
        api_id: stack.resolve(api.restApiId),
      },
    );
  });

  test("domain name cannot contain uppercase letters", () => {
    // GIVEN
    const certificate = new edge.PublicCertificate(stack, "cert", {
      domainName: "someDomainWithUpercase.domain.com",
    });

    // WHEN & THEN
    expect(() => {
      new compute.DomainName(stack, "someDomain", {
        domainName: "someDomainWithUpercase.domain.com",
        certificate,
      });
    }).toThrow(/uppercase/);
  });

  test("multiple domain names can be added", () => {
    // GIVEN
    const domainName = "my.domain.com";
    const certificate = new edge.PublicCertificate(stack, "cert", {
      domainName: "my.domain.com",
    });

    // WHEN
    const api = new compute.RestApi(stack, "api", {});

    api.root.addMethod("GET");

    const domainName1 = api.addDomainName("domainId", {
      domainName,
      certificate,
    });
    api.addDomainName("domainId1", {
      domainName: "your.domain.com",
      certificate,
    });
    api.addDomainName("domainId2", {
      domainName: "our.domain.com",
      certificate,
    });

    expect(api.domainName).toEqual(domainName1);

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "my.domain.com",
        endpoint_configuration: {
          types: ["REGIONAL"],
        },
        regional_certificate_arn: stack.resolve(certificate.certificateArn),
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "your.domain.com",
        endpoint_configuration: {
          types: ["REGIONAL"],
        },
        regional_certificate_arn: stack.resolve(certificate.certificateArn),
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "our.domain.com",
        endpoint_configuration: {
          types: ["REGIONAL"],
        },
        regional_certificate_arn: stack.resolve(certificate.certificateArn),
      },
    );
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.api_domainId_102F8DAA.domain_name}",
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });

  test('"addBasePathMapping" can be used to add base path mapping to the domain with specific stage', () => {
    // GIVEN
    const api1 = new compute.RestApi(stack, "api1");
    const api2 = new compute.RestApi(stack, "api2");
    const domain = new compute.DomainName(stack, "my-domain", {
      domainName: "example.com",
      certificate: edge.PublicCertificate.fromCertificateArn(
        stack,
        "cert",
        "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
      ),
      endpointType: compute.EndpointType.REGIONAL,
    });
    api1.root.addMethod("GET");
    api2.root.addMethod("GET");

    const testDeployment = new compute.Deployment(stack, "test-deployment", {
      api: api1,
    });

    const testStage = new compute.Stage(stack, "test-stage", {
      deployment: testDeployment,
    });

    // WHEN
    domain.addBasePathMapping(api1, { basePath: "api1", stage: testStage });
    domain.addBasePathMapping(api2, { basePath: "api2" });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.my-domain_592C948B.domain_name}",
        base_path: "api1",
        api_id: stack.resolve(api1.restApiId),
        stage_name: stack.resolve(testStage.stageName),
      },
    );

    template.toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name:
          "${aws_api_gateway_domain_name.my-domain_592C948B.domain_name}",
        base_path: "api2",
        api_id: stack.resolve(api2.restApiId),
        stage_name: stack.resolve(api2.deploymentStage.stageName),
      },
    );
  });

  test("accepts a mutual TLS configuration", () => {
    const bucket = storage.Bucket.fromBucketName(
      stack,
      "testBucket",
      "example-bucket",
    );
    new compute.DomainName(stack, "another-domain", {
      domainName: "example.com",
      mtls: {
        bucket,
        key: "someca.pem",
      },
      certificate: edge.PublicCertificate.fromCertificateArn(
        stack,
        "cert",
        "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
      ),
    });

    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn:
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        mutual_tls_authentication: {
          truststore_uri: "s3://example-bucket/someca.pem",
        },
      },
    );
  });

  test("mTLS should allow versions to be set on the s3 bucket", () => {
    const bucket = storage.Bucket.fromBucketName(
      stack,
      "testBucket",
      "example-bucket",
    );
    new compute.DomainName(stack, "another-domain", {
      domainName: "example.com",
      certificate: edge.PublicCertificate.fromCertificateArn(
        stack,
        "cert2",
        "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
      ),
      mtls: {
        bucket,
        key: "someca.pem",
        version: "version",
      },
    });
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayDomainName.ApiGatewayDomainName,
      {
        domain_name: "example.com",
        endpoint_configuration: { types: ["REGIONAL"] },
        regional_certificate_arn:
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        mutual_tls_authentication: {
          truststore_uri: "s3://example-bucket/someca.pem",
          truststore_version: "version",
        },
      },
    );
  });

  test("base path mapping configures stage for RestApi creation", () => {
    // GIVEN
    const api = new compute.RestApi(stack, "restApiWithStage", {
      domainName: {
        domainName: "example.com",
        certificate: edge.PublicCertificate.fromCertificateArn(
          stack,
          "cert",
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        ),
        endpointType: compute.EndpointType.REGIONAL,
      },
    });
    api.root.addMethod("GET");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name: stack.resolve(api.domainName?.domainName),
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });

  test("base path mapping configures stage for SpecRestApi creation", () => {
    // GIVEN
    const definition = {
      key1: "val1",
    };

    const api = new compute.SpecRestApi(stack, "specRestApiWithStage", {
      apiDefinition: compute.ApiDefinition.fromInline(definition),
      domainName: {
        domainName: "example.com",
        certificate: edge.PublicCertificate.fromCertificateArn(
          stack,
          "cert",
          "arn:aws:acm:us-east-1:1111111:certificate/11-3336f1-44483d-adc7-9cd375c5169d",
        ),
        endpointType: compute.EndpointType.REGIONAL,
      },
    });
    api.root.addMethod("GET"); // SpecRestApi might not have a root property like this, but for test consistency.

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      apiGatewayBasePathMapping.ApiGatewayBasePathMapping,
      {
        domain_name: stack.resolve(api.domainName?.domainName),
        api_id: stack.resolve(api.restApiId),
        stage_name: stack.resolve(api.deploymentStage.stageName),
      },
    );
  });
});
