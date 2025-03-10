// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/security-group.test.ts

import {
  securityGroup as tfSecurityGroup,
  vpcSecurityGroupEgressRule as tfVpcSecurityGroupEgressRule,
  vpcSecurityGroupIngressRule as tfVpcSecurityGroupIngressRule,
} from "@cdktf/provider-aws";
import { App, Token, Lazy, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  Peer,
  Port,
  SecurityGroup,
  SecurityGroupProps,
  Vpc,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

// Defaults to true in TerraConstructs
// const SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY =
//   "@aws-cdk/aws-ec2.securityGroupDisableInlineRules";

describe("security group", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });
  test("security group can allows all outbound traffic by default", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new SecurityGroup(stack, "SG1", { vpc, allowAllOutbound: true });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        egress: [
          // must wrap for nested attributes
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow all outbound traffic by default",
            protocol: "-1",
            from_port: 0,
            to_port: 0,
          }),
        ],
      },
    );
  });

  test("security group can allows all ipv6 outbound traffic by default", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new SecurityGroup(stack, "SG1", { vpc, allowAllIpv6Outbound: true });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        egress: [
          // must wrap for nested attributes
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow all outbound traffic by default",
            protocol: "-1",
            from_port: 0,
            to_port: 0,
          }),
          expect.objectContaining({
            description: "Allow all outbound ipv6 traffic by default",
            ipv6_cidr_blocks: ["::/0"],
            protocol: "-1",
            from_port: 0,
            to_port: 0,
          }),
        ],
      },
    );
  });

  test("can add ipv6 rules even if allowAllOutbound=true", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    const sg = new SecurityGroup(stack, "SG1", { vpc });
    sg.addEgressRule(Peer.ipv6("2001:db8::/128"), Port.tcp(80));

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        egress: [
          // must wrap for nested attributes
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow all outbound traffic by default",
            protocol: "-1",
            from_port: 0,
            to_port: 0,
          }),
          expect.objectContaining({
            description: "from 2001:db8::/128:80",
            from_port: 80,
            ipv6_cidr_blocks: ["2001:db8::/128"],
            protocol: "tcp",
            to_port: 80,
          }),
        ],
      },
    );
  });

  test("no new outbound rule is added if we are allowing all traffic anyway", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    const sg = new SecurityGroup(stack, "SG1", { vpc, allowAllOutbound: true });
    sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "This does not show up");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        egress: [
          // must wrap for nested attributes
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "Allow all outbound traffic by default",
            protocol: "-1",
            from_port: 0,
            to_port: 0,
          }),
        ],
      },
    );
  });

  test("security group disallow outbound traffic by default", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    new SecurityGroup(stack, "SG1", { vpc, allowAllOutbound: false });

    // THEN
    Template.synth(stack).not.toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        egress: expect.anything(),
      },
    );
  });

  test("bogus outbound rule disappears if another rule is added", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    const sg = new SecurityGroup(stack, "SG1", {
      vpc,
      allowAllOutbound: false,
    });
    sg.addEgressRule(
      Peer.anyIpv4(),
      Port.tcp(86),
      "This replaces the other one",
    );

    // THEN
    // Terraform requires explicit allow all outbound rule
    Template.synth(stack).toHaveResourceWithProperties(
      tfSecurityGroup.SecurityGroup,
      {
        egress: [
          // must wrap for nested attributes
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "This replaces the other one",
            from_port: 86,
            protocol: "tcp",
            to_port: 86,
          }),
          // expect.objectContaining({
          //   cidr_blocks: ["0.0.0.0/0"],
          //   description: "Allow all outbound traffic by default",
          //   protocol: "-1",
          //   from_port: 0,
          //   to_port: 0,
          // }),
        ],
      },
    );
  });

  test("all outbound rule cannot be added after creation", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    const sg = new SecurityGroup(stack, "SG1", {
      vpc,
      allowAllOutbound: false,
    });
    expect(() => {
      sg.addEgressRule(Peer.anyIpv4(), Port.allTraffic(), "All traffic");
    }).toThrow(/Cannot add/);
  });

  test("all ipv6 outbound rule cannot be added after creation", () => {
    // GIVEN
    const vpc = new Vpc(stack, "VPC");

    // WHEN
    const sg = new SecurityGroup(stack, "SG1", {
      vpc,
      allowAllOutbound: false,
    });
    expect(() => {
      sg.addEgressRule(Peer.anyIpv6(), Port.allTraffic(), "All traffic");
    }).toThrow(/Cannot add/);
  });

  test("immutable imports do not add rules", () => {
    // WHEN
    const sg = SecurityGroup.fromSecurityGroupId(stack, "SG1", "test-id", {
      mutable: false,
    });
    sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "This rule was not added");
    sg.addIngressRule(Peer.anyIpv4(), Port.tcp(86), "This rule was not added");

    const template = new Template(stack);
    // THEN
    template.expectResources(tfSecurityGroup.SecurityGroup).not.toEqual(
      expect.arrayContaining([
        {
          // no security group has this egress rule
          egress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "This rule was not added",
              from_port: 86,
              ip_protocol: "tcp",
              to_port: 86,
            }),
          ],
        },
      ]),
    );
    template.expectResources(tfSecurityGroup.SecurityGroup).not.toEqual(
      expect.arrayContaining([
        {
          // no security group has this ingress rule
          ingress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "This rule was not added",
              from_port: 86,
              ip_protocol: "tcp",
              to_port: 86,
            }),
          ],
        },
      ]),
    );
  });

  describe("Inline Rule Control", () => {
    //Not inlined
    describe("When props.disableInlineRules is true", () => {
      testRulesAreNotInlined(undefined, true);
    });
    // TODO: We don't have a way to set context.disableInlineRules
    // describe("When context.disableInlineRules is true", () => {
    //   testRulesAreNotInlined(true, undefined);
    // });
    // describe("When context.disableInlineRules is true and props.disableInlineRules is true", () => {
    //   testRulesAreNotInlined(true, true);
    // });
    describe("When context.disableInlineRules is false and props.disableInlineRules is true", () => {
      testRulesAreNotInlined(false, true);
    });
    describe("When props.disableInlineRules is true and context.disableInlineRules is null", () => {
      testRulesAreNotInlined(null, true);
    });
    //Inlined
    describe("When context.disableInlineRules is false and props.disableInlineRules is false", () => {
      testRulesAreInlined(false, false);
    });
    // describe("When context.disableInlineRules is true and props.disableInlineRules is false", () => {
    //   testRulesAreInlined(true, false);
    // });
    describe("When context.disableInlineRules is false", () => {
      testRulesAreInlined(false, undefined);
    });
    describe("When props.disableInlineRules is false", () => {
      testRulesAreInlined(undefined, false);
    });
    describe("When neither props.disableInlineRules nor context.disableInlineRules are defined", () => {
      testRulesAreInlined(undefined, undefined);
    });
    describe("When props.disableInlineRules is undefined and context.disableInlineRules is null", () => {
      testRulesAreInlined(null, undefined);
    });
    describe("When props.disableInlineRules is false and context.disableInlineRules is null", () => {
      testRulesAreInlined(null, false);
    });
  });

  test("peer between all types of peers and port range types", () => {
    // GIVEN
    // TODO: Work with Stack that has an environment (not env agnostic)
    // env: { account: "12345678", region: "dummy" },
    const vpc = new Vpc(stack, "VPC");
    const sg = new SecurityGroup(stack, "SG", {
      vpc,
      allowAllIpv6Outbound: true,
    });

    const peers = [
      new SecurityGroup(stack, "PeerGroup", { vpc }),
      Peer.anyIpv4(),
      Peer.anyIpv6(),
      Peer.prefixList("pl-012345"),
      Peer.securityGroupId("sg-012345678"),
    ];

    const ports = [
      Port.tcp(1234),
      Port.tcp(Lazy.numberValue({ produce: () => 5000 })),
      Port.allTcp(),
      Port.tcpRange(80, 90),
      Port.udp(2345),
      Port.udp(Lazy.numberValue({ produce: () => 7777 })),
      Port.allUdp(),
      Port.udpRange(85, 95),
      Port.icmpTypeAndCode(5, 1),
      Port.icmpType(8),
      Port.allIcmp(),
      Port.icmpPing(),
      Port.allTraffic(),
    ];

    // WHEN
    for (const peer of peers) {
      for (const port of ports) {
        sg.connections.allowTo(peer, port);
        sg.connections.allowFrom(peer, port);
      }
    }

    // THEN -- no crash
  });

  test("can add multiple rules using tokens on same security group", () => {
    // GIVEN
    // env: { account: "12345678", region: "dummy" },
    // TODO: Work with Stack that has an environment (not env agnostic)
    const vpc = new Vpc(stack, "VPC");
    const sg = new SecurityGroup(stack, "SG", { vpc });

    const p1 = Lazy.stringValue({ produce: () => "dummyid1" });
    const p2 = Lazy.stringValue({ produce: () => "dummyid2" });
    const peer1 = Peer.prefixList(p1);
    const peer2 = Peer.prefixList(p2);

    // WHEN
    sg.addIngressRule(peer1, Port.tcp(5432), "Rule 1");
    sg.addIngressRule(peer2, Port.tcp(5432), "Rule 2");

    // THEN -- no crash
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        description: "Rule 1",
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        description: "Rule 2",
      },
    );
  });

  test("if tokens are used in ports, `canInlineRule` should be false to avoid cycles", () => {
    // GIVEN
    const p1 = Lazy.numberValue({ produce: () => 80 });
    const p2 = Lazy.numberValue({ produce: () => 5000 });

    // WHEN
    const ports = [
      Port.tcp(p1),
      Port.tcp(p2),
      Port.tcpRange(p1, 90),
      Port.tcpRange(80, p2),
      Port.tcpRange(p1, p2),
      Port.udp(p1),
      Port.udpRange(p1, 95),
      Port.udpRange(85, p2),
      Port.udpRange(p1, p2),
      Port.icmpTypeAndCode(p1, 1),
      Port.icmpTypeAndCode(5, p1),
      Port.icmpTypeAndCode(p1, p2),
      Port.icmpType(p1),
    ];

    // THEN
    for (const range of ports) {
      expect(range.canInlineRule).toEqual(false);
    }
  });

  describe("Peer IP CIDR validation", () => {
    test("passes with valid IPv4 CIDR block", () => {
      // GIVEN
      const cidrIps = ["0.0.0.0/0", "192.168.255.255/24"];

      // THEN
      for (const cidrIp of cidrIps) {
        expect(Peer.ipv4(cidrIp).uniqueId).toEqual(cidrIp);
      }
    });

    // test("passes with unresolved IP CIDR token", () => {
    //   // GIVEN
    //   Token.asString(new Intrinsic("ip"));

    //   // THEN: don't throw
    // });

    test("throws if invalid IPv4 CIDR block", () => {
      // THEN
      expect(() => {
        Peer.ipv4("invalid");
      }).toThrow(/Invalid IPv4 CIDR/);
    });

    test("throws if missing mask in IPv4 CIDR block", () => {
      expect(() => {
        Peer.ipv4("0.0.0.0");
      }).toThrow(/CIDR mask is missing in IPv4/);
    });

    test("passes with valid IPv6 CIDR block", () => {
      // GIVEN
      const cidrIps = [
        "::/0",
        "2001:db8::/32",
        "2001:0db8:0000:0000:0000:8a2e:0370:7334/32",
        "2001:db8::8a2e:370:7334/32",
      ];

      // THEN
      for (const cidrIp of cidrIps) {
        expect(Peer.ipv6(cidrIp).uniqueId).toEqual(cidrIp);
      }
    });

    test("throws if invalid IPv6 CIDR block", () => {
      // THEN
      expect(() => {
        Peer.ipv6("invalid");
      }).toThrow(/Invalid IPv6 CIDR/);
    });

    test("throws if missing mask in IPv6 CIDR block", () => {
      expect(() => {
        Peer.ipv6("::");
      }).toThrow(/IDR mask is missing in IPv6/);
    });
  });

  describe("Peer security group ID validation", () => {
    test("passes with valid security group ID", () => {
      //GIVEN
      const securityGroupIds = ["sg-12345678", "sg-0123456789abcdefg"];

      // THEN
      for (const securityGroupId of securityGroupIds) {
        expect(Peer.securityGroupId(securityGroupId).uniqueId).toEqual(
          securityGroupId,
        );
      }
    });

    test("passes with valid security group ID and source owner id", () => {
      //GIVEN
      const securityGroupIds = ["sg-12345678", "sg-0123456789abcdefg"];
      const ownerIds = ["000000000000", "000000000001"];

      // THEN
      for (const securityGroupId of securityGroupIds) {
        for (const ownerId of ownerIds) {
          expect(
            Peer.securityGroupId(securityGroupId, ownerId).uniqueId,
          ).toEqual(securityGroupId);
        }
      }
    });

    test("passes with unresolved security group id token or owner id token", () => {
      // GIVEN
      Token.asString("securityGroupId");

      const securityGroupId = Lazy.stringValue({
        produce: () => "sg-01234567",
      });
      const ownerId = Lazy.stringValue({ produce: () => "000000000000" });
      Peer.securityGroupId(securityGroupId);
      Peer.securityGroupId(securityGroupId, ownerId);

      // THEN: don't throw
    });

    test("throws if invalid security group ID", () => {
      // THEN
      expect(() => {
        Peer.securityGroupId("invalid");
      }).toThrow(/Invalid security group ID/);
    });

    test("throws if invalid source security group id", () => {
      // THEN
      expect(() => {
        Peer.securityGroupId("sg-12345678", "invalid");
      }).toThrow(/Invalid security group owner ID/);
    });
  });

  // TODO: Terraform provider aws does not support sourceSecurityGroupOwnerId
  describe("SourceSecurityGroupOwnerId property validation", () => {
    // TODO: Terraform provider aws does not support sourceSecurityGroupOwnerId
    test("SourceSecurityGroupOwnerId property is not present when value is not provided to ingress rule", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const sg = new SecurityGroup(stack, "SG", { vpc });

      //WHEN
      sg.addIngressRule(
        Peer.securityGroupId("sg-123456789"),
        Port.allTcp(),
        "no owner id property",
      );

      //THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          ingress: [
            expect.objectContaining({
              security_groups: ["sg-123456789"],
              description: "no owner id property",
              protocol: "tcp",
              from_port: 0,
              to_port: 65535,
            }),
          ],
        },
      );
    });

    // TODO: Terraform provider aws does not support sourceSecurityGroupOwnerId
    test("SourceSecurityGroupOwnerId property is present when value is provided to ingress rule", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const sg = new SecurityGroup(stack, "SG", { vpc });

      //WHEN
      sg.addIngressRule(
        Peer.securityGroupId("sg-123456789", "000000000000"),
        Port.allTcp(),
        "contains owner id property",
      );

      //THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          ingress: [
            expect.objectContaining({
              security_groups: ["sg-123456789"],
              description: "contains owner id property",
              // sourceSecurityGroupOwnerId: "000000000000",
              protocol: "tcp",
              from_port: 0,
              to_port: 65535,
            }),
          ],
        },
      );
    });

    test("SourceSecurityGroupOwnerId property is not present when value is provided to egress rule", () => {
      // GIVEN
      const vpc = new Vpc(stack, "VPC");
      const sg = new SecurityGroup(stack, "SG", {
        vpc,
        allowAllOutbound: false,
      });

      //WHEN
      sg.addEgressRule(
        Peer.securityGroupId("sg-123456789", "000000000000"),
        Port.allTcp(),
        "no owner id property",
      );

      //THEN
      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          egress: [
            expect.objectContaining({
              security_groups: ["sg-123456789"],
              description: "no owner id property",
              from_port: 0,
              to_port: 65535,
              protocol: "tcp",
            }),
          ],
        },
      );
    });

    test("Static well-known ports are well-defined", () => {
      // THEN
      expect(Port.SSH).toEqual(Port.tcp(22));
      expect(Port.DNS_UDP).toEqual(Port.udp(53));
    });
  });
});

// describe("security group lookup", () => {
//   // DEPRECATED
//   test("can look up a security group", () => {
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     const securityGroup = SecurityGroup.fromLookup(stack, "stack", "sg-1234");

//     expect(securityGroup.securityGroupId).toEqual("sg-12345678");
//     expect(securityGroup.allowAllOutbound).toEqual(true);
//   });

//   test("can look up a security group by id", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     // WHEN
//     const securityGroup = SecurityGroup.fromLookupById(
//       stack,
//       "SG1",
//       "sg-12345",
//     );

//     // THEN
//     expect(securityGroup.securityGroupId).toEqual("sg-12345678");
//     expect(securityGroup.allowAllOutbound).toEqual(true);
//   });

//   test("can look up a security group by name and vpc", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     const vpc = Vpc.fromVpcAttributes(stack, "VPC", {
//       vpc_id: "vpc-1234",
//       availabilityZones: ["dummy1a", "dummy1b", "dummy1c"],
//     });

//     // WHEN
//     const securityGroup = SecurityGroup.fromLookupByName(
//       stack,
//       "SG1",
//       "sg-12345",
//       vpc,
//     );

//     // THEN
//     expect(securityGroup.securityGroupId).toEqual("sg-12345678");
//     expect(securityGroup.allowAllOutbound).toEqual(true);
//   });

//   test("can look up a security group by id and vpc", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     const vpc = Vpc.fromVpcAttributes(stack, "VPC", {
//       vpc_id: "vpc-1234",
//       availabilityZones: ["dummy1a", "dummy1b", "dummy1c"],
//     });

//     // WHEN
//     const securityGroup = SecurityGroup.fromLookupByName(
//       stack,
//       "SG1",
//       "my-security-group",
//       vpc,
//     );

//     // THEN
//     expect(securityGroup.securityGroupId).toEqual("sg-12345678");
//     expect(securityGroup.allowAllOutbound).toEqual(true);
//   });

//   test("can look up a security group and use it as a peer", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     const vpc = Vpc.fromVpcAttributes(stack, "VPC", {
//       vpcId: "vpc-1234",
//       availabilityZones: ["dummy1a", "dummy1b", "dummy1c"],
//     });

//     // WHEN
//     const securityGroup = SecurityGroup.fromLookupByName(
//       stack,
//       "SG1",
//       "my-security-group",
//       vpc,
//     );

//     // THEN
//     expect(() => {
//       Peer.securityGroupId(securityGroup.securityGroupId);
//     }).not.toThrow();
//   });

//   test("throws if securityGroupId is tokenized", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     // WHEN
//     expect(() => {
//       SecurityGroup.fromLookupById(
//         stack,
//         "stack",
//         Lazy.stringValue({ produce: () => "sg-12345" }),
//       );
//     }).toThrow(
//       "All arguments to look up a security group must be concrete (no Tokens)",
//     );
//   });

//   test("throws if securityGroupName is tokenized", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     // WHEN
//     expect(() => {
//       SecurityGroup.fromLookupById(
//         stack,
//         "stack",
//         Lazy.stringValue({ produce: () => "my-security-group" }),
//       );
//     }).toThrow(
//       "All arguments to look up a security group must be concrete (no Tokens)",
//     );
//   });

//   test("throws if vpc id is tokenized", () => {
//     // GIVEN
//     const app = new App();
//     const stack = new AwsStack(app, "stack", {
//       env: {
//         account: "1234",
//         region: "us-east-1",
//       },
//     });

//     const vpc = Vpc.fromVpcAttributes(stack, "VPC", {
//       vpcId: Lazy.stringValue({ produce: () => "vpc-1234" }),
//       availabilityZones: ["dummy1a", "dummy1b", "dummy1c"],
//     });

//     // WHEN
//     expect(() => {
//       SecurityGroup.fromLookupByName(stack, "stack", "my-security-group", vpc);
//     }).toThrow(
//       "All arguments to look up a security group must be concrete (no Tokens)",
//     );
//   });
// });

function testRulesAreInlined(
  contextDisableInlineRules: boolean | undefined | null,
  optionsDisableInlineRules: boolean | undefined,
) {
  describe("When allowAllOutbound", () => {
    let app: App;
    let stack: AwsStack;

    beforeEach(() => {
      app = Testing.app();
      stack = new AwsStack(app, "TestStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });
    test("new SecurityGroup will create an inline SecurityGroupEgress rule to allow all traffic", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      new SecurityGroup(stack, "SG1", props);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
          egress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "Allow all outbound traffic by default",
              protocol: "-1",
              from_port: 0,
              to_port: 0,
            }),
          ],
        },
      );
      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addEgressRule rule will not modify egress rules", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
          egress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "Allow all outbound traffic by default",
              protocol: "-1",
              from_port: 0,
              to_port: 0,
            }),
          ],
        },
      );

      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addIngressRule will add a new ingress rule", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addIngressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      Template.synth(stack).toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
          ingress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "An external Rule",
              from_port: 86,
              protocol: "tcp",
              to_port: 86,
            }),
          ],
          egress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "Allow all outbound traffic by default",
              protocol: "-1",
              from_port: 0,
              to_port: 0,
            }),
          ],
        },
      );
    });
  });

  describe("When do not allowAllOutbound", () => {
    let app: App;
    let stack: AwsStack;

    beforeEach(() => {
      app = Testing.app();
      stack = new AwsStack(app, "TestStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });
    test("new SecurityGroup rule will create an egress rule that denies all traffic", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      new SecurityGroup(stack, "SG1", props);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
          // egress blocking rule is not present in Terraform
          // egress: [
          //   {
          //     cidr_blocks: ["255.255.255.255/32"],
          //     description: "Disallow all traffic",
          //     protocol: "icmp",
          //     from_port: 252,
          //     to_port: 86,
          //   },
          // ],
        },
      );
      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });
    test("addEgressRule rule will add a new inline egress rule and remove the denyAllTraffic rule", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "An inline Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
          egress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "An inline Rule",
              protocol: "tcp",
              from_port: 86,
              to_port: 86,
            }),
          ],
        },
      );

      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addIngressRule will add a new ingress rule", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addIngressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
          ingress: [
            expect.objectContaining({
              cidr_blocks: ["0.0.0.0/0"],
              description: "An external Rule",
              from_port: 86,
              to_port: 86,
              protocol: "tcp",
            }),
          ],
          // egress blocking rule is not present in Terraform
          // egress: [
          //   {
          //     CidrIp: "255.255.255.255/32",
          //     Description: "Disallow all traffic",
          //     IpProtocol: "icmp",
          //     FromPort: 252,
          //     ToPort: 86,
          //   },
          // ],
        },
      );

      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });
  });
}

function testRulesAreNotInlined(
  contextDisableInlineRules: boolean | undefined | null,
  optionsDisableInlineRules: boolean | undefined,
) {
  describe("When allowAllOutbound", () => {
    let app: App;
    let stack: AwsStack;

    beforeEach(() => {
      app = Testing.app();
      stack = new AwsStack(app, "TestStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });

    test("new SecurityGroup will create an external SecurityGroupEgress rule", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );
      // the allow all egress rule should be present
      template.expect.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "Allow all outbound traffic by default",
          ip_protocol: "-1",
        },
      );
      template.expect.not.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          from_port: expect.anything(),
          to_port: expect.anything(),
        },
      );
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addIngressRule rule will not remove external allowAllOutbound rule", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );

      // the allow all egress rule should be present
      template.expect.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "Allow all outbound traffic by default",
          ip_protocol: "-1",
        },
      );
      template.expect.not.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          from_port: expect.anything(),
          to_port: expect.anything(),
        },
      );

      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addIngressRule rule will not add a new egress rule", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );
      // the allow all egress rule should be present
      template.expect.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "Allow all outbound traffic by default",
          ip_protocol: "-1",
        },
      );
      template.expect.not.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          from_port: expect.anything(),
          to_port: expect.anything(),
        },
      );

      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .not.toEqual(
          expect.arrayContaining([
            {
              group_id: stack.resolve(sg.securityGroupId),
              description: "An external Rule",
            },
          ]),
        );

      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addIngressRule rule will add a new external ingress rule even if it could have been inlined", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: true,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addIngressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = Template.synth(stack);
      template.toHaveResourceWithProperties(tfSecurityGroup.SecurityGroup, {
        description: "TestStack/SG1",
        vpc_id: stack.resolve(vpc.vpcId),
      });

      template.toHaveResourceWithProperties(
        tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "An external Rule",
          from_port: 86,
          ip_protocol: "tcp",
          to_port: 86,
        },
      );

      template.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "Allow all outbound traffic by default",
          ip_protocol: "-1",
        },
      );
      template.not.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          from_port: expect.anything(),
          to_port: expect.anything(),
        },
      );
    });
  });

  describe("When do not allowAllOutbound", () => {
    let app: App;
    let stack: AwsStack;

    beforeEach(() => {
      app = Testing.app();
      stack = new AwsStack(app, "TestStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
    });
    test("new SecurityGroup rule will create an external egress rule that denies all traffic", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      new SecurityGroup(stack, "SG1", props);

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
      // Terraform should not create allow all egress rule
      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      // template.expect.toHaveResourceWithProperties(
      //   tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      //   {
      //     GroupId: stack.resolve(sg.securityGroupId),
      //     CidrIp: "255.255.255.255/32",
      //     Description: "Disallow all traffic",
      //     IpProtocol: "icmp",
      //     FromPort: 252,
      //     ToPort: 86,
      //   },
      // );
    });

    test("addEgressRule rule will remove the rule that denies all traffic if another egress rule is added", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );
      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);

      // the allow all egress rule should not be present
      template.expect.not.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "Allow all outbound traffic by default",
          ip_protocol: "-1",
        },
      );
      // TODO: Verify the egress rule has not been added
      // const egressGroups = Template.fromStack(stack).findResources(
      //   tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      //   {
      //     GroupId: stack.resolve(sg.securityGroupId),
      //     CidrIp: "255.255.255.255/32",
      //   },
      // );
      // expect(Object.keys(egressGroups).length).toBe(0);
    });

    test("addEgressRule rule will add a new external egress rule even if it could have been inlined", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addEgressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );

      template.expect.toHaveResourceWithProperties(
        tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "An external Rule",
          from_port: 86,
          ip_protocol: "tcp",
          to_port: 86,
        },
      );

      template
        .expectResources(
          tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        )
        .toHaveLength(0);
    });

    test("addIngressRule will add a new external ingress rule even if it could have been inlined", () => {
      // GIVEN
      // stack.node.setContext(
      //   SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
      //   contextDisableInlineRules,
      // );
      const vpc = new Vpc(stack, "VPC");
      const props: SecurityGroupProps = {
        vpc,
        allowAllOutbound: false,
        disableInlineRules: optionsDisableInlineRules,
      };

      // WHEN
      const sg = new SecurityGroup(stack, "SG1", props);
      sg.addIngressRule(Peer.anyIpv4(), Port.tcp(86), "An external Rule");

      const template = new Template(stack);
      template.expect.toHaveResourceWithProperties(
        tfSecurityGroup.SecurityGroup,
        {
          description: "TestStack/SG1",
          vpc_id: stack.resolve(vpc.vpcId),
        },
      );

      template.expect.toHaveResourceWithProperties(
        tfVpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        {
          security_group_id: stack.resolve(sg.securityGroupId),
          cidr_ipv4: "0.0.0.0/0",
          description: "An external Rule",
          from_port: 86,
          ip_protocol: "tcp",
          to_port: 86,
        },
      );

      // Terraform should not create blocking egress rule
      template
        .expectResources(
          tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
        )
        .toHaveLength(0);
      // template.expect.toHaveResourceWithProperties(
      //   tfVpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      //   {
      //     GroupId: stack.resolve(sg.securityGroupId),
      //     CidrIp: "255.255.255.255/32",
      //     Description: "Disallow all traffic",
      //     IpProtocol: "icmp",
      //     FromPort: 252,
      //     ToPort: 86,
      //   },
      // );
    });
  });
}
