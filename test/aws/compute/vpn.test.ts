// https://github.com/aws/aws-cdk/blob/3c7ca516c8f9c46f16def62870143197644e2807/packages/aws-cdk-lib/aws-ec2/test/vpn.test.ts

import {
  customerGateway as tfCustomerGateway,
  vpnConnection as tfVpnConnection,
  vpnConnectionRoute as tfVpnConnectionRoute,
  vpnGateway as tfVpnGateway,
} from "@cdktf/provider-aws";
import { App, Testing, Token } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
// import { SecretValue} from "../../../src";
import { PublicSubnet, Vpc, VpnConnection } from "../../../src/aws/compute";
import { Duration } from "../../../src/duration";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("vpn", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "IPAMTestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("can add a vpn connection to a vpc with a vpn gateway", () => {
    // WHEN
    new Vpc(stack, "VpcNetwork", {
      vpnConnections: {
        VpnConnection: {
          asn: 65001,
          ip: "192.0.2.1",
        },
      },
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfCustomerGateway.CustomerGateway, {
      bgp_asn: 65001,
      ip_address: "192.0.2.1",
      type: "ipsec.1",
    });
    template.toHaveResourceWithProperties(tfVpnGateway.VpnGateway, {
      vpc_id: "${aws_vpc.VpcNetwork.id}",
    });
    template.toHaveResourceWithProperties(tfVpnConnection.VpnConnection, {
      customer_gateway_id: "${aws_customer_gateway.CustomerGateway.id}",
      type: "${aws_customer_gateway.CustomerGateway.type}",
      vpn_gateway_id: "${aws_vpn_gateway.VpnGateway.id}",
      static_routes_only: false,
    });
  });

  test("with static routing", () => {
    // WHEN
    new Vpc(stack, "VpcNetwork", {
      vpnConnections: {
        static: {
          ip: "192.0.2.1",
          staticRoutes: ["192.168.10.0/24", "192.168.20.0/24"],
        },
      },
    });

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfVpnConnection.VpnConnection, {
      customer_gateway_id: "${aws_customer_gateway.CustomerGateway.id}",
      type: "${aws_customer_gateway.CustomerGateway.type}",
      vpn_gateway_id: "${aws_vpn_gateway.VpnGateway.id}",
      static_routes_only: true,
    });

    template.toHaveResourceWithProperties(
      tfVpnConnectionRoute.VpnConnectionRoute,
      {
        destination_cidr_block: "192.168.10.0/24",
        vpn_connection_id: "${aws_vpn_connection.VpnConnection.id}",
      },
    );

    template.toHaveResourceWithProperties(
      tfVpnConnectionRoute.VpnConnectionRoute,
      {
        destination_cidr_block: "192.168.20.0/24",
        vpn_connection_id: "${aws_vpn_connection.VpnConnection.id}",
      },
    );
  });

  // // TODO: Add better support for Secrets Handling
  // test("with tunnel options, using secret value", () => {
  //   // GIVEN
  //   new Vpc(stack, "VpcNetwork", {
  //     vpnConnections: {
  //       VpnConnection: {
  //         ip: "192.0.2.1",
  //         tunnelOptions: [
  //           {
  //             preSharedKeySecret: SecretValue.unsafePlainText("secretkey1234"),
  //             tunnelInsideCidr: "169.254.10.0/30",
  //           },
  //         ],
  //       },
  //     },
  //   });

  //   Template.fromStack(stack).hasResourceProperties("AWS::EC2::VPNConnection", {
  //     CustomerGatewayId: {
  //       Ref: "VpcNetworkVpnConnectionCustomerGateway8B56D9AF",
  //     },
  //     Type: "ipsec.1",
  //     VpnGatewayId: {
  //       Ref: "VpcNetworkVpnGateway501295FA",
  //     },
  //     StaticRoutesOnly: false,
  //     VpnTunnelOptionsSpecifications: [
  //       {
  //         PreSharedKey: "secretkey1234",
  //         TunnelInsideCidr: "169.254.10.0/30",
  //       },
  //     ],
  //   });
  // });

  test("with tunnel options, using secret", () => {
    // GIVEN
    new Vpc(stack, "VpcNetwork", {
      vpnConnections: {
        VpnConnection: {
          ip: "192.0.2.1",
          tunnelOptions: [
            {
              preSharedKey: "secretkey1234",
              tunnelInsideCidr: "169.254.10.0/30",
            },
          ],
        },
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(
      tfVpnConnection.VpnConnection,
      {
        customer_gateway_id: "${aws_customer_gateway.CustomerGateway.id}",
        type: "${aws_customer_gateway.CustomerGateway.type}",
        vpn_gateway_id: "${aws_vpn_gateway.VpnGateway.id}",
        static_routes_only: false,
        tunnel1_preshared_key: "secretkey1234",
        tunnel1_inside_cidr: "169.254.10.0/30",
      },
    );
  });

  test("fails when ip is invalid", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnConnections: {
            VpnConnection: {
              ip: "192.0.2.256",
            },
          },
        }),
    ).toThrow(/`ip`.+IPv4/);
  });

  test("fails when specifying more than two tunnel options", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnConnections: {
            VpnConnection: {
              ip: "192.0.2.1",
              tunnelOptions: [
                // TODO: Provider secret support
                {
                  preSharedKey: "secretkey1234",
                },
                {
                  preSharedKey: "secretkey1234",
                },
                {
                  preSharedKey: "secretkey1234",
                },
              ],
            },
          },
        }),
    ).toThrow(/two.+`tunnelOptions`/);
  });

  test("fails with duplicate tunnel inside cidr", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnConnections: {
            VpnConnection: {
              ip: "192.0.2.1",
              tunnelOptions: [
                {
                  tunnelInsideCidr: "169.254.10.0/30",
                },
                {
                  tunnelInsideCidr: "169.254.10.0/30",
                },
              ],
            },
          },
        }),
    ).toThrow(/`tunnelInsideCidr`.+both tunnels/);
  });

  test("with two tunnel options and no tunnelInsideCidr", () => {
    // GIVEN
    // WHEN
    new Vpc(stack, "VpcNetwork", {
      vpnConnections: {
        VpnConnection: {
          ip: "192.0.2.1",
          tunnelOptions: [
            {
              preSharedKey: "secretkey1234",
            },
            {
              preSharedKey: "secretkey5678",
            },
          ],
        },
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpnConnection.VpnConnection,
      {
        customer_gateway_id: "${aws_customer_gateway.CustomerGateway.id}",
        type: "${aws_customer_gateway.CustomerGateway.type}",
        vpn_gateway_id: "${aws_vpn_gateway.VpnGateway.id}",
        static_routes_only: false,
        tunnel1_preshared_key: "secretkey1234",
        tunnel2_preshared_key: "secretkey5678",
      },
    );
  });

  test("fails when specifying an invalid pre-shared key", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnConnections: {
            VpnConnection: {
              ip: "192.0.2.1",
              tunnelOptions: [
                {
                  preSharedKey: "0invalid",
                },
              ],
            },
          },
        }),
    ).toThrow(/`preSharedKey`/);
  });

  test("fails when specifying a reserved tunnel inside cidr", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnConnections: {
            VpnConnection: {
              ip: "192.0.2.1",
              tunnelOptions: [
                {
                  tunnelInsideCidr: "169.254.1.0/30",
                },
              ],
            },
          },
        }),
    ).toThrow(/`tunnelInsideCidr`.+reserved/);
  });

  test("fails when specifying an invalid tunnel inside cidr", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnConnections: {
            VpnConnection: {
              ip: "192.0.2.1",
              tunnelOptions: [
                {
                  tunnelInsideCidr: "169.200.10.0/30",
                },
              ],
            },
          },
        }),
    ).toThrow(/`tunnelInsideCidr`.+size/);
  });

  test("can use metricTunnelState on a vpn connection", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VpcNetwork", {
      vpnGateway: true,
    });

    const vpn = vpc.addVpnConnection("Vpn", {
      ip: "192.0.2.1",
    });

    // THEN
    expect(stack.resolve(vpn.metricTunnelState())).toEqual({
      namespace: "AWS/VPN",
      dimensions: { VpnId: "${aws_vpn_gateway.VpcNetworkVpnA476C58D.id" },
      metricName: "TunnelState",
      period: Duration.minutes(5),
      statistic: "Average",
    });
  });

  test("can import a vpn connection from attributes", () => {
    // GIVEN
    const vpn = VpnConnection.fromVpnConnectionAttributes(stack, "Connection", {
      vpnId: "idv",
      customerGatewayIp: "ip",
      customerGatewayId: "idc",
      customerGatewayAsn: 6500,
    });

    expect(vpn.vpnId).toEqual("idv");
    expect(vpn.customerGatewayAsn).toEqual(6500);
    expect(vpn.customerGatewayId).toEqual("idc");
    expect(vpn.customerGatewayIp).toEqual("ip");

    expect(stack.resolve(vpn.metricTunnelState())).toEqual({
      dimensions: { VpnId: "idv" },
      namespace: "AWS/VPN",
      metricName: "TunnelState",
      period: Duration.minutes(5),
      statistic: "Average",
    });

    expect(stack.resolve(vpn.metricTunnelDataIn())).toEqual({
      dimensions: { VpnId: "idv" },
      namespace: "AWS/VPN",
      metricName: "TunnelDataIn",
      period: Duration.minutes(5),
      statistic: "Sum",
    });

    expect(stack.resolve(vpn.metricTunnelDataOut())).toEqual({
      dimensions: { VpnId: "idv" },
      namespace: "AWS/VPN",
      metricName: "TunnelDataOut",
      period: Duration.minutes(5),
      statistic: "Sum",
    });
  });

  test("can use metricAllTunnelDataOut", () => {
    // THEN
    expect(stack.resolve(VpnConnection.metricAllTunnelDataOut())).toEqual({
      namespace: "AWS/VPN",
      metricName: "TunnelDataOut",
      period: Duration.minutes(5),
      statistic: "Sum",
    });
  });

  test("fails when enabling vpnGateway without having subnets", () => {
    // GIVEN
    expect(
      () =>
        new Vpc(stack, "VpcNetwork", {
          vpnGateway: true,
          subnetConfiguration: [],
        }),
    ).toThrow(/VPN gateway/);
  });

  test("can add a vpn connection later to a vpc that initially had no subnets", () => {
    // GIVEN
    // WHEN
    const vpc = new Vpc(stack, "VpcNetwork", {
      subnetConfiguration: [],
    });
    const subnet = new PublicSubnet(stack, "Subnet", {
      vpcId: vpc.vpcId,
      availabilityZone: "eu-central-1a",
      cidrBlock: "10.0.0.0/28",
    });
    vpc.publicSubnets.push(subnet);
    vpc.addVpnConnection("VPNConnection", {
      ip: "1.2.3.4",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfCustomerGateway.CustomerGateway,
      {
        type: "ipsec.1",
      },
    );
  });
  test("can add a vpn connection with a Token as customer gateway ip", () => {
    // GIVEN
    const token = Token.asAny("192.0.2.1");

    // WHEN
    new Vpc(stack, "VpcNetwork", {
      vpnConnections: {
        VpnConnection: {
          ip: token as any,
        },
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfCustomerGateway.CustomerGateway,
      {
        ip_address: "192.0.2.1",
      },
    );
  });
});
