// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/test/service.test.ts

import {
  serviceDiscoveryHttpNamespace,
  serviceDiscoveryPrivateDnsNamespace,
  serviceDiscoveryPublicDnsNamespace,
  serviceDiscoveryService,
} from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as cloudmap from "../../../../src/aws/edge/cloudmap";
import { Template } from "../../../assertions";

describe("service", () => {
  test("Service for HTTP namespace with custom health check", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "http",
    });

    namespace.createService("MyService", {
      name: "service",
      description: "service description",
      customHealthCheck: {
        failureThreshold: 3,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryHttpNamespace.ServiceDiscoveryHttpNamespace,
      {
        name: "http",
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        description: "service description",
        health_check_custom_config: {
          failure_threshold: 3,
        },
        name: "service",
        namespace_id: stack.resolve(namespace.namespaceId),
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::HttpNamespace',
    //       Properties: {
    //         Name: 'http',
    //       },
    //     },
    //     MyNamespaceMyService365E2470: {
    //       Type: 'AWS::ServiceDiscovery::Service',
    //       Properties: {
    //         Description: 'service description',
    //         HealthCheckCustomConfig: {
    //           FailureThreshold: 3,
    //         },
    //         Name: 'service',
    //         NamespaceId: {
    //           'Fn::GetAtt': [
    //             'MyNamespaceD0BB8558',
    //             'Id',
    //           ],
    //         },
    //       },
    //     },
    //   },
    // });
  });

  test("Service for HTTP namespace with health check", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "http",
    });

    namespace.createService("MyService", {
      name: "service",
      description: "service description",
      healthCheck: {
        type: cloudmap.HealthCheckType.HTTP,
        resourcePath: "/check",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryHttpNamespace.ServiceDiscoveryHttpNamespace,
      {
        name: "http",
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        description: "service description",
        health_check_config: {
          failure_threshold: 1,
          resource_path: "/check",
          type: "HTTP",
        },
        name: "service",
        namespace_id: stack.resolve(namespace.namespaceId),
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::HttpNamespace',
    //       Properties: {
    //         Name: 'http',
    //       },
    //     },
    //     MyNamespaceMyService365E2470: {
    //       Type: 'AWS::ServiceDiscovery::Service',
    //       Properties: {
    //         Description: 'service description',
    //         HealthCheckConfig: {
    //           FailureThreshold: 1,
    //           ResourcePath: '/check',
    //           Type: 'HTTP',
    //         },
    //         Name: 'service',
    //         NamespaceId: {
    //           'Fn::GetAtt': [
    //             'MyNamespaceD0BB8558',
    //             'Id',
    //           ],
    //         },
    //       },
    //     },
    //   },
    // });
  });

  test("Service for Public DNS namespace", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "dns",
    });

    namespace.createService("MyService", {
      name: "service",
      description: "service description",
      customHealthCheck: {
        failureThreshold: 3,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace,
      {
        name: "dns",
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        description: "service description",
        dns_config: {
          dns_records: [
            {
              ttl: 60,
              type: "A",
            },
          ],
          namespace_id: stack.resolve(namespace.namespaceId),
          routing_policy: "MULTIVALUE",
        },
        health_check_custom_config: {
          failure_threshold: 3,
        },
        name: "service",
        namespace_id: stack.resolve(namespace.namespaceId),
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::PublicDnsNamespace',
    //       Properties: {
    //         Name: 'dns',
    //       },
    //     },
    //     MyNamespaceMyService365E2470: {
    //       Type: 'AWS::ServiceDiscovery::Service',
    //       Properties: {
    //         Description: 'service description',
    //         DnsConfig: {
    //           DnsRecords: [
    //             {
    //               TTL: 60,
    //               Type: 'A',
    //             },
    //           ],
    //           NamespaceId: {
    //             'Fn::GetAtt': [
    //               'MyNamespaceD0BB8558',
    //               'Id',
    //             ],
    //           },
    //           RoutingPolicy: 'MULTIVALUE',
    //         },
    //         HealthCheckCustomConfig: {
    //           FailureThreshold: 3,
    //         },
    //         Name: 'service',
    //         NamespaceId: {
    //           'Fn::GetAtt': [
    //             'MyNamespaceD0BB8558',
    //             'Id',
    //           ],
    //         },
    //       },
    //     },
    //   },
    // });
  });

  test("Service for Public DNS namespace with A and AAAA records", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "dns",
    });

    namespace.createService("MyService", {
      dnsRecordType: cloudmap.DnsRecordType.A_AAAA,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace,
      {
        name: "dns",
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        dns_config: {
          dns_records: [
            {
              ttl: 60,
              type: "A",
            },
            {
              ttl: 60,
              type: "AAAA",
            },
          ],
          namespace_id: stack.resolve(namespace.namespaceId),
          routing_policy: "MULTIVALUE",
        },
        namespace_id: stack.resolve(namespace.namespaceId),
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::PublicDnsNamespace',
    //       Properties: {
    //         Name: 'dns',
    //       },
    //     },
    //     MyNamespaceMyService365E2470: {
    //       Type: 'AWS::ServiceDiscovery::Service',
    //       Properties: {
    //         DnsConfig: {
    //           DnsRecords: [
    //             {
    //               TTL: 60,
    //               Type: 'A',
    //             },
    //             {
    //               TTL: 60,
    //               Type: 'AAAA',
    //             },
    //           ],
    //           NamespaceId: {
    //             'Fn::GetAtt': [
    //               'MyNamespaceD0BB8558',
    //               'Id',
    //             ],
    //           },
    //           RoutingPolicy: 'MULTIVALUE',
    //         },
    //         NamespaceId: {
    //           'Fn::GetAtt': [
    //             'MyNamespaceD0BB8558',
    //             'Id',
    //           ],
    //         },
    //       },
    //     },
    //   },
    // });
  });

  test("Defaults to WEIGHTED routing policy for CNAME", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "dns",
    });

    namespace.createService("MyService", {
      dnsRecordType: cloudmap.DnsRecordType.CNAME,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace,
      {
        name: "dns",
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        dns_config: {
          dns_records: [
            {
              ttl: 60,
              type: "CNAME",
            },
          ],
          namespace_id: stack.resolve(namespace.namespaceId),
          routing_policy: "WEIGHTED",
        },
        namespace_id: stack.resolve(namespace.namespaceId),
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::PublicDnsNamespace',
    //       Properties: {
    //         Name: 'dns',
    //       },
    //     },
    //     MyNamespaceMyService365E2470: {
    //       Type: 'AWS::ServiceDiscovery::Service',
    //       Properties: {
    //         DnsConfig: {
    //           DnsRecords: [
    //             {
    //               TTL: 60,
    //               Type: 'CNAME',
    //             },
    //           ],
    //           NamespaceId: {
    //             'Fn::GetAtt': [
    //               'MyNamespaceD0BB8558',
    //               'Id',
    //             ],
    //           },
    //           RoutingPolicy: 'WEIGHTED',
    //         },
    //         NamespaceId: {
    //           'Fn::GetAtt': [
    //             'MyNamespaceD0BB8558',
    //             'Id',
    //           ],
    //         },
    //       },
    //     },
    //   },
    // });
  });

  test("Throws when specifying both healthCheckConfig and healthCheckCustomConfig on PublicDnsNamespace", () => {
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "name",
    });

    // THEN
    expect(() => {
      namespace.createService("MyService", {
        name: "service",
        healthCheck: {
          resourcePath: "/",
        },
        customHealthCheck: {
          failureThreshold: 1,
        },
      });
    }).toThrow(/`healthCheckConfig`.+`healthCheckCustomConfig`/);
  });

  test("Throws when specifying healthCheckConfig on PrivateDnsNamespace", () => {
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");

    const namespace = new cloudmap.PrivateDnsNamespace(stack, "MyNamespace", {
      name: "name",
      vpc,
    });

    // THEN
    expect(() => {
      namespace.createService("MyService", {
        name: "service",
        healthCheck: {
          resourcePath: "/",
        },
        customHealthCheck: {
          failureThreshold: 1,
        },
      });
    }).toThrow(/`healthCheckConfig`.+`healthCheckCustomConfig`/);
  });

  test("Throws when using CNAME and Multivalue routing policy", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "name",
    });

    // THEN
    expect(() => {
      namespace.createService("MyService", {
        name: "service",
        dnsRecordType: cloudmap.DnsRecordType.CNAME,
        routingPolicy: cloudmap.RoutingPolicy.MULTIVALUE,
      });
    }).toThrow(
      /Cannot use `CNAME` record when routing policy is `Multivalue`./,
    );
  });

  test("Throws when specifying resourcePath with TCP", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "name",
    });

    // THEN
    expect(() => {
      namespace.createService("MyService", {
        name: "service",
        healthCheck: {
          type: cloudmap.HealthCheckType.TCP,
          resourcePath: "/check",
        },
      });
    }).toThrow(/`resourcePath`.+`TCP`/);
  });

  test("Throws when specifying loadbalancer with wrong DnsRecordType", () => {
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "name",
    });

    // THEN
    expect(() => {
      namespace.createService("MyService", {
        name: "service",
        dnsRecordType: cloudmap.DnsRecordType.CNAME,
        loadBalancer: true,
      });
    }).toThrow(/Must support `A` or `AAAA` records to register loadbalancers/);
  });

  test("Throws when specifying loadbalancer with Multivalue routing Policy", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "http",
    });

    // THEN
    expect(() => {
      namespace.createService("MyService", {
        loadBalancer: true,
        routingPolicy: cloudmap.RoutingPolicy.MULTIVALUE,
      });
    }).toThrow(
      /Cannot register loadbalancers when routing policy is `Multivalue`./,
    );
  });

  test("Throws when specifying discovery type of DNS within a HttpNamespace", () => {
    // GIVEN
    const stack = new AwsStack();

    const namespace = new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "http",
    });

    // THEN
    expect(() => {
      new cloudmap.Service(stack, "Service", {
        namespace,
        discoveryType: cloudmap.DiscoveryType.DNS_AND_API,
      });
    }).toThrow(
      /Cannot specify `discoveryType` of DNS_AND_API when using an HTTP namespace./,
    );
  });

  test("Service for Private DNS namespace", () => {
    // GIVEN
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");

    const namespace = new cloudmap.PrivateDnsNamespace(stack, "MyNamespace", {
      name: "private",
      vpc,
    });

    namespace.createService("MyService", {
      name: "service",
      description: "service description",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
      {
        name: "private",
      },
    );

    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        description: "service description",
        dns_config: {
          dns_records: [
            {
              ttl: 60,
              type: "A",
            },
          ],
          namespace_id: stack.resolve(namespace.namespaceId),
          routing_policy: "MULTIVALUE",
        },
        name: "service",
        namespace_id: stack.resolve(namespace.namespaceId),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', {
    //   Name: 'private',
    // });
    //
    // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::Service', {
    //   Description: 'service description',
    //   DnsConfig: {
    //     DnsRecords: [
    //       {
    //         TTL: 60,
    //         Type: 'A',
    //       },
    //     ],
    //     NamespaceId: {
    //       'Fn::GetAtt': [
    //         'MyNamespaceD0BB8558',
    //         'Id',
    //       ],
    //     },
    //     RoutingPolicy: 'MULTIVALUE',
    //   },
    //   Name: 'service',
    //   NamespaceId: {
    //     'Fn::GetAtt': [
    //       'MyNamespaceD0BB8558',
    //       'Id',
    //     ],
    //   },
    // });
  });

  test("Service for DNS namespace with API only discovery", () => {
    // GIVEN
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");

    const namespace = new cloudmap.PrivateDnsNamespace(stack, "MyNamespace", {
      name: "private",
      vpc,
    });

    namespace.createService("MyService", {
      name: "service",
      description: "service description",
      discoveryType: cloudmap.DiscoveryType.API,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
      {
        name: "private",
      },
    );

    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryService.ServiceDiscoveryService,
      {
        description: "service description",
        name: "service",
        namespace_id: stack.resolve(namespace.namespaceId),
        type: "HTTP",
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', {
    //   Name: 'private',
    // });
    //
    // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::Service', {
    //   Description: 'service description',
    //   Name: 'service',
    //   NamespaceId: {
    //     'Fn::GetAtt': [
    //       'MyNamespaceD0BB8558',
    //       'Id',
    //     ],
    //   },
    //   Type: 'HTTP',
    // });
  });
});

// NOTE: not present upstream — added per repo convention requiring a
// round-trip test for every `from*Attributes` static (Service.fromServiceAttributes).
describe("service import", () => {
  test("Service.fromServiceAttributes round trip", () => {
    // GIVEN
    const stack = new AwsStack();
    const namespace = new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "http",
    });

    // WHEN
    const imported = cloudmap.Service.fromServiceAttributes(stack, "Imported", {
      namespace,
      serviceName: "service",
      serviceId: "service-id",
      serviceArn:
        "arn:aws:servicediscovery:us-east-1:123456789012:service/service-id",
      dnsRecordType: cloudmap.DnsRecordType.A,
      routingPolicy: cloudmap.RoutingPolicy.MULTIVALUE,
    });

    // THEN
    expect(imported.serviceName).toEqual("service");
    expect(imported.serviceId).toEqual("service-id");
    expect(imported.serviceArn).toEqual(
      "arn:aws:servicediscovery:us-east-1:123456789012:service/service-id",
    );
    expect(imported.dnsRecordType).toEqual(cloudmap.DnsRecordType.A);
    expect(imported.routingPolicy).toEqual(cloudmap.RoutingPolicy.MULTIVALUE);
    expect(imported.namespace).toEqual(namespace);
    // discoveryType defaults via defaultDiscoveryType(namespace) when omitted;
    // an HTTP namespace defaults to API-only discovery.
    expect(imported.discoveryType).toEqual(cloudmap.DiscoveryType.API);
  });
});

describe("service snapshots", () => {
  test("Service for HTTP namespace should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    const namespace = new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "http",
    });
    // WHEN
    namespace.createService("MyService", {
      name: "service",
      description: "service description",
      customHealthCheck: {
        failureThreshold: 3,
      },
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Service for Public DNS namespace should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    const namespace = new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "dns",
    });
    // WHEN
    namespace.createService("MyService", {
      dnsRecordType: cloudmap.DnsRecordType.A_AAAA,
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Service for Private DNS namespace should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");
    const namespace = new cloudmap.PrivateDnsNamespace(stack, "MyNamespace", {
      name: "private",
      vpc,
    });
    // WHEN
    namespace.createService("MyService", {
      name: "service",
      description: "service description",
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
