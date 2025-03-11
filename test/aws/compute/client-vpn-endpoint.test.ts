// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/client-vpn-endpoint.test.ts

import {
  ec2ClientVpnEndpoint,
  ec2ClientVpnNetworkAssociation,
  ec2ClientVpnAuthorizationRule,
  ec2ClientVpnRoute,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as logs from "../../../src/aws/cloudwatch";
import * as ec2 from "../../../src/aws/compute";
import { ClientVpnUserBasedAuthentication } from "../../../src/aws/compute/client-vpn-endpoint";
import { SamlMetadataDocument, SamlProvider } from "../../../src/aws/iam";
// TODO: Move RetentionDays back to "Observability" namespace?
import { RetentionDays } from "../../../src/aws/log-retention";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

let app: App;
let stack: AwsStack;
let vpc: ec2.IVpc;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new ec2.Vpc(stack, "Vpc");
});

test("client vpn endpoint", () => {
  const samlProvider = new SamlProvider(stack, "Provider", {
    metadataDocument: SamlMetadataDocument.fromXml("xml"),
  });

  const clientVpnEndpoint = vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    clientConnectionHandler: {
      functionArn: "function-arn",
      functionName: "AWSClientVPN-function-name",
    },
    dnsServers: ["8.8.8.8", "8.8.4.4"],
    userBasedAuthentication:
      ClientVpnUserBasedAuthentication.federated(samlProvider),
    registerOutputs: true,
    outputName: "TestOutput",
  });

  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    {
      authentication_options: [
        {
          root_certificate_chain_arn: "client-certificate-arn",
          type: "certificate-authentication",
        },
        {
          saml_provider_arn: "${aws_iam_saml_provider.Provider_2281708E.arn}",
          type: "federated-authentication",
        },
      ],
      client_cidr_block: "10.100.0.0/16",
      connection_log_options: {
        cloudwatch_log_group:
          "${aws_cloudwatch_log_group.Vpc_Endpoint_LogGroup_96A18897.name}",
        enabled: true,
      },
      server_certificate_arn: "server-certificate-arn",
      client_connect_options: {
        enabled: true,
        lambda_function_arn: "function-arn",
      },
      dns_servers: ["8.8.8.8", "8.8.4.4"],
      security_group_ids: [
        "${aws_security_group.Vpc_Endpoint_SecurityGroup_7B25EFDC.id}",
      ],
      vpc_id: stack.resolve(vpc.vpcId),
    },
  );

  t.resourceCountIs(
    ec2ClientVpnNetworkAssociation.Ec2ClientVpnNetworkAssociation,
    3,
  );

  t.expect.toHaveResourceWithProperties(
    ec2ClientVpnNetworkAssociation.Ec2ClientVpnNetworkAssociation,
    {
      client_vpn_endpoint_id:
        "${aws_ec2_client_vpn_endpoint.Vpc_Endpoint_6FF034F6.id}",
      subnet_id: "${aws_subnet.Vpc_PrivateSubnet1_F6513F49.id}",
    },
  );
  t.expect.toHaveResourceWithProperties(
    ec2ClientVpnNetworkAssociation.Ec2ClientVpnNetworkAssociation,
    {
      client_vpn_endpoint_id:
        "${aws_ec2_client_vpn_endpoint.Vpc_Endpoint_6FF034F6.id}",
      subnet_id: "${aws_subnet.Vpc_PrivateSubnet3_FD86EE1D.id}",
    },
  );
  t.expect.toHaveResourceWithProperties(
    ec2ClientVpnNetworkAssociation.Ec2ClientVpnNetworkAssociation,
    {
      client_vpn_endpoint_id:
        "${aws_ec2_client_vpn_endpoint.Vpc_Endpoint_6FF034F6.id}",
      subnet_id: "${aws_subnet.Vpc_PrivateSubnet1_F6513F49.id}",
    },
  );

  expect(t.outputByName("TestOutput")).toMatchObject({
    value: {
      clientVpnEndpointId: stack.resolve(clientVpnEndpoint.endpointId),
      selfServicePortalUrl: stack.resolve(
        clientVpnEndpoint.selfServicePortalUrl,
      ),
    },
  });

  t.expect.toHaveResourceWithProperties(
    ec2ClientVpnAuthorizationRule.Ec2ClientVpnAuthorizationRule,
    {
      client_vpn_endpoint_id: stack.resolve(clientVpnEndpoint.endpointId),
      target_network_cidr: stack.resolve(vpc.vpcCidrBlock),
      authorize_all_groups: true,
    },
  );
});

test("client vpn endpoint with custom security groups", () => {
  vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    securityGroups: [
      new ec2.SecurityGroup(stack, "SG1", { vpc }),
      new ec2.SecurityGroup(stack, "SG2", { vpc }),
    ],
  });

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    {
      security_group_ids: [
        "${aws_security_group.SG1_BA065B6E.id}",
        "${aws_security_group.SG2_0CE3219C.id}",
      ],
    },
  );
});

test("client vpn endpoint with custom logging", () => {
  const logGroup = new logs.LogGroup(stack, "LogGroup", {
    retention: RetentionDays.TWO_MONTHS,
  });
  vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    logGroup,
    logStream: logGroup.addStream("LogStream"),
  });

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    {
      connection_log_options: {
        cloudwatch_log_group: stack.resolve(logGroup.logGroupName),
        cloudwatch_log_stream:
          "${aws_cloudwatch_log_stream.LogGroup_LogStream_245D76D6.name}",
        enabled: true,
      },
    },
  );
});

test("client vpn endpoint with logging disabled", () => {
  vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    logging: false,
  });

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    {
      connection_log_options: {
        enabled: false,
      },
    },
  );
});

test("client vpn endpoint with custom authorization rules", () => {
  const endpoint = vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    authorizeAllUsersToVpcCidr: false,
  });

  endpoint.addAuthorizationRule("Rule", {
    cidr: "10.0.10.0/32",
    groupId: "group-id",
  });

  Template.resources(
    stack,
    ec2ClientVpnAuthorizationRule.Ec2ClientVpnAuthorizationRule,
  ).toHaveLength(1);

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnAuthorizationRule.Ec2ClientVpnAuthorizationRule,
    {
      access_group_id: "group-id",
      authorize_all_groups: false,
      client_vpn_endpoint_id:
        "${aws_ec2_client_vpn_endpoint.Vpc_Endpoint_6FF034F6.id}",
      target_network_cidr: "10.0.10.0/32",
    },
  );
});

test("client vpn endpoint with custom route", () => {
  const endpoint = vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    authorizeAllUsersToVpcCidr: false,
  });

  endpoint.addRoute("Route", {
    cidr: "10.100.0.0/16",
    target: ec2.ClientVpnRouteTarget.local(),
  });

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnRoute.Ec2ClientVpnRoute,
    {
      client_vpn_endpoint_id: stack.resolve(endpoint.endpointId),
      destination_cidr_block: "10.100.0.0/16",
      target_vpc_subnet_id: "local",
      depends_on: [
        "aws_ec2_client_vpn_network_association.Vpc_Endpoint_Association0_6B066321",
        "aws_ec2_client_vpn_network_association.Vpc_Endpoint_Association1_2B51A67F",
        "aws_ec2_client_vpn_network_association.Vpc_Endpoint_Association2_32E0750F",
      ],
    },
  );
});

test("client vpn endpoint with custom session timeout", () => {
  vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    sessionTimeout: ec2.ClientVpnSessionTimeout.TEN_HOURS,
  });

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    {
      session_timeout_hours: 10,
    },
  );
});

test("client vpn endpoint with client login banner", () => {
  vpc.addClientVpnEndpoint("Endpoint", {
    cidr: "10.100.0.0/16",
    serverCertificateArn: "server-certificate-arn",
    clientCertificateArn: "client-certificate-arn",
    clientLoginBanner: "Welcome!",
  });

  Template.synth(stack).toHaveResourceWithProperties(
    ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint,
    {
      client_login_banner_options: {
        enabled: true,
        banner_text: "Welcome!",
      },
    },
  );
});

test("throws with more than 2 dns servers", () => {
  expect(() =>
    vpc.addClientVpnEndpoint("Endpoint", {
      cidr: "10.100.0.0/16",
      serverCertificateArn: "server-certificate-arn",
      clientCertificateArn: "client-certificate-arn",
      dnsServers: ["1.1.1.1", "2.2.2.2", "3.3.3.3"],
    }),
  ).toThrow(/A client VPN endpoint can have up to two DNS servers/);
});

test("throws when specifying logGroup with logging disabled", () => {
  expect(() =>
    vpc.addClientVpnEndpoint("Endpoint", {
      cidr: "10.100.0.0/16",
      serverCertificateArn: "server-certificate-arn",
      clientCertificateArn: "client-certificate-arn",
      logging: false,
      logGroup: new logs.LogGroup(stack, "LogGroup"),
    }),
  ).toThrow(
    /Cannot specify `logGroup` or `logStream` when logging is disabled/,
  );
});

test("throws without authentication options", () => {
  expect(() =>
    vpc.addClientVpnEndpoint("Endpoint", {
      cidr: "10.100.0.0/16",
      serverCertificateArn: "server-certificate-arn",
    }),
  ).toThrow(
    /A client VPN endpoint must use at least one authentication option/,
  );
});
