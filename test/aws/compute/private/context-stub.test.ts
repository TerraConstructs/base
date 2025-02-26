import { Testing, TerraformOutput } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { allowAllOutboundLocal } from "../../../../src/aws/compute/private/context-stub";
import { Template } from "../../../assertions";

describe("allowAllOutboundLocal", () => {
  let stack: AwsStack;

  beforeEach(() => {
    stack = new AwsStack(Testing.app(), `TestStack`, {
      environmentName: "Test",
      gridUUID: "123e4567-e89b-12d3",
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });
  test("evaluates all security group rules", () => {
    // GIVEN
    new TerraformOutput(stack, "AllowsAllOutBound", {
      value: allowAllOutboundLocal(stack, "MySecurityGroup", "sg-12345678"),
    });
    // THEN
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_vpc_security_group_rules: {
          MySecurityGroupAllowAllOutboundRules: {
            filter: [
              {
                name: "group-id",
                values: ["sg-12345678"],
              },
            ],
          },
        },
        aws_vpc_security_group_rule: {
          MySecurityGroupAllowAllOutboundRule: {
            for_each:
              "${toset(data.aws_vpc_security_group_rules.MySecurityGroupAllowAllOutboundRules.ids)}",
            security_group_rule_id: "${each.value.id}",
          },
        },
      },
      locals: {
        MySecurityGroupAllowAllOutbound:
          "${length([ for key, val in data.aws_vpc_security_group_rule.MySecurityGroupAllowAllOutboundRule: val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv4 = '0.0.0.0/0'])}+${length([ for key, val in data.aws_vpc_security_group_rule.MySecurityGroupAllowAllOutboundRule: val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv6 = '::/0'])} > 0",
      },
      output: {
        AllowsAllOutBound: {
          value: "${local.MySecurityGroupAllowAllOutbound}",
        },
      },
    });
  });
  test("ensures singleton per id", () => {
    // GIVEN
    new TerraformOutput(stack, "AllowsAllOutBound1", {
      value: allowAllOutboundLocal(stack, "MySecurityGroup1", "sg-12345678"),
    });
    new TerraformOutput(stack, "AllowsAllOutBound2", {
      value: allowAllOutboundLocal(stack, "MySecurityGroup1", "sg-12345678"),
    });
    new TerraformOutput(stack, "AllowsAllOutBound3", {
      value: allowAllOutboundLocal(stack, "MySecurityGroup2", "sg-97654321"),
    });
    // THEN
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_vpc_security_group_rules: {
          MySecurityGroup1AllowAllOutboundRules: {
            filter: [
              {
                name: "group-id",
                values: ["sg-12345678"],
              },
            ],
          },
          aws_vpc_security_group_rule: {
            MySecurityGroup1AllowAllOutboundRule: {
              for_each:
                "${toset(data.aws_vpc_security_group_rules.MySecurityGroup1AllowAllOutboundRules.ids)}",
              security_group_rule_id: "${each.value.id}",
            },
            MySecurityGroup2AllowAllOutboundRule: {
              for_each:
                "${toset(data.aws_vpc_security_group_rules.MySecurityGroup2AllowAllOutboundRules.ids)}",
              security_group_rule_id: "${each.value.id}",
            },
          },
          MySecurityGroup2AllowAllOutboundRules: {
            filter: [
              {
                name: "group-id",
                values: ["sg-97654321"],
              },
            ],
          },
        },
      },
      locals: {
        MySecurityGroup1AllowAllOutbound:
          "${length([ for key, val in data.aws_vpc_security_group_rule.MySecurityGroup1AllowAllOutboundRule: val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv4 = '0.0.0.0/0'])}+${length([ for key, val in data.aws_vpc_security_group_rule.MySecurityGroup1AllowAllOutboundRule: val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv6 = '::/0'])} > 0",
        MySecurityGroup2AllowAllOutbound:
          "${length([ for key, val in data.aws_vpc_security_group_rule.MySecurityGroup2AllowAllOutboundRule: val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv4 = '0.0.0.0/0'])}+${length([ for key, val in data.aws_vpc_security_group_rule.MySecurityGroup2AllowAllOutboundRule: val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv6 = '::/0'])} > 0",
      },
      output: {
        AllowsAllOutBound1: {
          value: "${local.MySecurityGroup1AllowAllOutbound}",
        },
        AllowsAllOutBound2: {
          value: "${local.MySecurityGroup1AllowAllOutbound}",
        },
        AllowsAllOutBound3: {
          value: "${local.MySecurityGroup2AllowAllOutbound}",
        },
      },
    });
  });
});
