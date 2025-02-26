// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/connections.test.ts

import {
  securityGroup as tfSecurityGroup,
  vpcSecurityGroupEgressRule,
  vpcSecurityGroupIngressRule,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  Connections,
  IConnectable,
  Port,
  SecurityGroup,
  IVpc,
  Vpc,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("connections", () => {
  let app: App;
  let stack: AwsStack;
  let vpc: IVpc;
  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    vpc = new Vpc(stack, "Vpc");
  });
  test("peering between two security groups does not recursive infinitely", () => {
    // GIVEN
    // env: { account: "12345678", region: "dummy" },
    const sg1 = new SecurityGroup(stack, "SG1", { vpc });
    const sg2 = new SecurityGroup(stack, "SG2", { vpc });

    const conn1 = new SomethingConnectable(
      new Connections({ securityGroups: [sg1] }),
    );
    const conn2 = new SomethingConnectable(
      new Connections({ securityGroups: [sg2] }),
    );

    // WHEN
    conn1.connections.allowTo(conn2, Port.tcp(80), "Test");

    // THEN -- it finishes!
  });

  test("(imported) SecurityGroup can be used as target of .allowTo()", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SomeSecurityGroup", {
      vpc,
      allowAllOutbound: false,
    });
    const somethingConnectable = new SomethingConnectable(
      new Connections({ securityGroups: [sg1] }),
    );

    const securityGroup = SecurityGroup.fromSecurityGroupId(
      stack,
      "ImportedSG",
      "sg-12345",
    );

    // WHEN
    somethingConnectable.connections.allowTo(
      securityGroup,
      Port.allTcp(),
      "Connect there",
    );

    // THEN: rule to generated security group to connect to imported
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        group_id: stack.resolve(sg1.securityGroupId),
        ip_protocol: "tcp",
        description: "Connect there",
        destination_security_group_id: "sg-12345",
        from_port: 0,
        to_port: 65535,
      },
    );

    // THEN: rule to imported security group to allow connections from generated
    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        ip_protocol: "tcp",
        description: "Connect there",
        from_port: 0,
        group_id: "sg-12345",
        source_security_group_id: stack.resolve(sg1.securityGroupId),
        to_port: 65535,
      },
    );
  });

  test("security groups added to connections after rule still gets rule", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SecurityGroup1", {
      vpc,
      allowAllOutbound: false,
    });
    const sg2 = new SecurityGroup(stack, "SecurityGroup2", {
      vpc,
      allowAllOutbound: false,
    });
    const connections = new Connections({ securityGroups: [sg1] });

    // WHEN
    connections.allowFromAnyIpv4(Port.tcp(88));
    connections.addSecurityGroup(sg2);

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(tfSecurityGroup.SecurityGroup, {
      group_description: "Default/SecurityGroup1",
      ingress: [
        {
          description: "from 0.0.0.0/0:88",
          cidr_ip: "0.0.0.0/0",
          from_port: 88,
          to_port: 88,
          ip_protocol: "tcp",
        },
      ],
    });

    template.toHaveResourceWithProperties(tfSecurityGroup.SecurityGroup, {
      group_description: "Default/SecurityGroup2",
      ingress: [
        {
          description: "from 0.0.0.0/0:88",
          cidr_ip: "0.0.0.0/0",
          from_port: 88,
          to_port: 88,
          ip_protocol: "tcp",
        },
      ],
    });
  });

  test("when security groups are added to target they also get the rule", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SecurityGroup1", {
      vpc,
      allowAllOutbound: false,
    });
    const sg2 = new SecurityGroup(stack, "SecurityGroup2", {
      vpc,
      allowAllOutbound: false,
    });
    const sg3 = new SecurityGroup(stack, "SecurityGroup3", {
      vpc,
      allowAllOutbound: false,
    });
    const connections1 = new Connections({ securityGroups: [sg1] });
    const connections2 = new Connections({ securityGroups: [sg2] });
    const connectable = new SomethingConnectable(connections2);

    // WHEN
    connections1.allowTo(connectable, Port.tcp(88));
    connections2.addSecurityGroup(sg3);

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        group_id: stack.resolve(sg2.securityGroupId),
        source_security_group_id: stack.resolve(sg1.securityGroupId),
        from_port: 88,
        to_port: 88,
      },
    );

    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        group_id: stack.resolve(sg3.securityGroupId),
        source_security_group_id: stack.resolve(sg1.securityGroupId),
        from_port: 88,
        to_port: 88,
      },
    );
  });

  test("multiple security groups allows internally between them", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SecurityGroup1", {
      vpc,
      allowAllOutbound: false,
    });
    const sg2 = new SecurityGroup(stack, "SecurityGroup2", {
      vpc,
      allowAllOutbound: false,
    });
    const connections = new Connections({ securityGroups: [sg1] });

    // WHEN
    connections.allowInternally(Port.tcp(88));
    connections.addSecurityGroup(sg2);

    // THEN
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        group_id: stack.resolve(sg1.securityGroupId),
        source_security_group_id: stack.resolve(sg1.securityGroupId),
        from_port: 88,
        to_port: 88,
      },
    );

    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        destination_security_group_id: stack.resolve(sg1.securityGroupId),
        group_id: stack.resolve(sg1.securityGroupId),
        from_port: 88,
        to_port: 88,
      },
    );
  });

  test("can establish cross stack Security Group connections - allowFrom", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SecurityGroup", {
      vpc: vpc,
      allowAllOutbound: false,
    });

    const stack2 = new AwsStack(app, "MyStack2", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });
    const vpc2 = new Vpc(stack2, "VPC");
    const sg2 = new SecurityGroup(stack2, "SecurityGroup", {
      vpc: vpc2,
      allowAllOutbound: false,
    });

    // WHEN
    sg2.connections.allowFrom(sg1, Port.tcp(100));

    // THEN -- both rules are in Stack2
    const template = Template.synth(stack2);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        group_id: stack2.resolve(sg2.securityGroupId),
        // remote state reference
        source_security_group_id:
          "${data.Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09}",
      },
    );

    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        group_id:
          "${data.Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09}",
        destination_security_group_id: stack2.resolve(sg2.securityGroupId),
      },
    );
  });

  test("can establish cross stack Security Group connections - allowTo", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SecurityGroup", {
      vpc: vpc,
      allowAllOutbound: false,
    });

    const stack2 = new AwsStack(app, "MyStack2", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });
    const vpc2 = new Vpc(stack2, "VPC");
    const sg2 = new SecurityGroup(stack2, "SecurityGroup", {
      vpc: vpc2,
      allowAllOutbound: false,
    });

    // WHEN
    sg2.connections.allowTo(sg1, Port.tcp(100));

    // THEN -- both rules are in Stack2
    const template = Template.synth(stack2);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        // remote state reference
        group_id:
          "${data.Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09}",
        source_security_group_id: stack2.resolve(sg2.securityGroupId),
      },
    );

    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        group_id: stack2.resolve(sg2.securityGroupId),
        destination_security_group_id:
          "${data.Stack1:ExportsOutputFnGetAttSecurityGroupDD263621GroupIdDF6F8B09}",
      },
    );
  });

  test("can establish multiple cross-stack SGs", () => {
    // GIVEN
    const sg1a = new SecurityGroup(stack, "SecurityGroupA", {
      vpc: vpc,
      allowAllOutbound: false,
    });
    const sg1b = new SecurityGroup(stack, "SecurityGroupB", {
      vpc: vpc,
      allowAllOutbound: false,
    });

    const stack2 = new AwsStack(app, "MyStack2", {
      environmentName,
      gridUUID, // should be different
      providerConfig,
      gridBackendConfig,
    });
    const vpc2 = new Vpc(stack2, "VPC");
    const sg2 = new SecurityGroup(stack2, "SecurityGroup", {
      vpc: vpc2,
      allowAllOutbound: false,
    });

    // WHEN
    sg2.connections.allowFrom(sg1a, Port.tcp(100));
    sg2.connections.allowFrom(sg1b, Port.tcp(100));

    // THEN -- both egress rules are in Stack2
    const template = Template.synth(stack2);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        group_id:
          "${Stack1:ExportsOutputFnGetAttSecurityGroupAED40ADC5GroupId1D10C76A}",
        destination_security_group_id: stack2.resolve(sg2.securityGroupId),
      },
    );

    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        group_id:
          "${data.Stack1:ExportsOutputFnGetAttSecurityGroupB04591F90GroupIdFA7208D5}",
        destination_security_group_id: stack2.resolve(sg2.securityGroupId),
      },
    );
  });
  test("Imported SecurityGroup does not create egress rule", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SomeSecurityGroup", {
      vpc,
      allowAllOutbound: false,
    });
    const somethingConnectable = new SomethingConnectable(
      new Connections({ securityGroups: [sg1] }),
    );

    const securityGroup = SecurityGroup.fromSecurityGroupId(
      stack,
      "ImportedSG",
      "sg-12345",
    );

    // WHEN
    somethingConnectable.connections.allowFrom(
      securityGroup,
      Port.allTcp(),
      "Connect there",
    );

    // THEN: rule to generated security group to connect to imported
    Template.fromStack(stack).toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        GroupId: { "Fn::GetAtt": ["SomeSecurityGroupEF219AD6", "GroupId"] },
        IpProtocol: "tcp",
        Description: "Connect there",
        SourceSecurityGroupId: "sg-12345",
        FromPort: 0,
        ToPort: 65535,
      },
    );

    // THEN: rule to imported security group to allow connections from generated
    Template.resources(
      stack,
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
    ).toHaveLength(0);
  });
  test("Imported SecurityGroup with allowAllOutbound: false DOES create egress rule", () => {
    // GIVEN
    const sg1 = new SecurityGroup(stack, "SomeSecurityGroup", {
      vpc,
      allowAllOutbound: false,
    });
    const somethingConnectable = new SomethingConnectable(
      new Connections({ securityGroups: [sg1] }),
    );

    const securityGroup = SecurityGroup.fromSecurityGroupId(
      stack,
      "ImportedSG",
      "sg-12345",
      {
        allowAllOutbound: false,
      },
    );

    // WHEN
    somethingConnectable.connections.allowFrom(
      securityGroup,
      Port.allTcp(),
      "Connect there",
    );

    // THEN: rule to generated security group to connect to imported
    const template = Template.synth(stack);
    template.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        group_id: stack.resolve(securityGroup.securityGroupId),
        ip_protocol: "tcp",
        description: "Connect there",
        source_security_group_id: "sg-12345",
        from_port: 0,
        to_port: 65535,
      },
    );

    // THEN: rule to imported security group to allow connections from generated
    template.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        ip_protocol: "tcp",
        description: "Connect there",
        from_port: 0,
        group_id: "sg-12345",
        destination_security_group_id: stack.resolve(
          securityGroup.securityGroupId,
        ),
        to_port: 65535,
      },
    );
  });
});

class SomethingConnectable implements IConnectable {
  constructor(public readonly connections: Connections) {}
}
