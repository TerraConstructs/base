import {
  dataAwsVpcSecurityGroupRules,
  dataAwsVpcSecurityGroupRule,
} from "@cdktf/provider-aws";
import { Token, TerraformLocal, TerraformIterator } from "cdktf";
import { Construct } from "constructs";
import { AwsStack } from "../../aws-stack";

// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk/lib/context-providers/security-groups.ts
/**
 * Create singleton TerraformLocal expression which determines if a security group allows all outbound traffic
 *
 * @internal
 */
export function allowAllOutboundLocal(
  scope: Construct,
  id: string,
  securityGroupId: string,
): boolean | undefined {
  if (Token.isUnresolved(id)) {
    throw new Error(
      "All arguments to look up a security group must be concrete (no Tokens)",
    );
  }
  const stack = AwsStack.ofAwsConstruct(scope);
  const conditionName = `${id}AllowAllOutbound`;
  const allowAllOutboundCondition = stack.node.tryFindChild(
    conditionName,
  ) as TerraformLocal;
  if (allowAllOutboundCondition) {
    return allowAllOutboundCondition.expression;
  }

  const securityGroupRulesLookup =
    new dataAwsVpcSecurityGroupRules.DataAwsVpcSecurityGroupRules(
      stack,
      `${conditionName}Rules`,
      {
        filter: [
          {
            name: "group-id",
            values: [securityGroupId],
          },
        ],
      },
    );
  const securityGroupRuleIterator = TerraformIterator.fromList(
    securityGroupRulesLookup.ids,
  );
  const securityGroupRules =
    new dataAwsVpcSecurityGroupRule.DataAwsVpcSecurityGroupRule(
      scope,
      `${conditionName}Rule`,
      {
        forEach: securityGroupRuleIterator,
        securityGroupRuleId: securityGroupRuleIterator.getString("id"),
      },
    );

  const securityGroupRulesIterator =
    TerraformIterator.fromDataSources(securityGroupRules);
  // isAllProtocols and some CidrIpv4 = "0.0.0.0/0"
  const AllTrafficCidrV4 = securityGroupRulesIterator.forExpressionForList(
    "val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv4 = '0.0.0.0/0'",
  );
  // isAllProtocols and some CidrIpv6 = "::/0"
  const AllTrafficCidrV6 = securityGroupRulesIterator.forExpressionForList(
    "val.arn if val.ip_protocol = -1 && val.is_egress && cidr_ipv6 = '::/0'",
  );
  return new TerraformLocal(
    stack,
    conditionName,
    `\${length(${AllTrafficCidrV4})}+\${length(${AllTrafficCidrV6})} > 0`,
  ).expression;
}
