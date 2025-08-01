// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/security-group.ts

import {
  dataAwsSecurityGroup,
  securityGroup,
  vpcSecurityGroupEgressRule,
  vpcSecurityGroupIngressRule,
} from "@cdktf/provider-aws";
import { Annotations, Lazy, Token } from "cdktf";
import { Construct } from "constructs";
import { Connections } from "./connections";
import { IPeer, Peer } from "./peer";
import { Port } from "./port";
import { IVpc } from "./vpc";
import {
  AwsConstructBase,
  IAwsConstruct,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
// import { allowAllOutboundLocal } from "./private/context-stub";

const SECURITY_GROUP_SYMBOL = Symbol.for(
  "terraconstructs/lib/aws/compute.SecurityGroup",
);

const SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY =
  "terraconstructs/aws/compute.securityGroupDisableInlineRules";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface SecurityGroupOutputs {
  /**
   * ID for the current security group
   * @attribute
   */
  readonly securityGroupId: string;
}

/**
 * Interface for security group-like objects
 */
export interface ISecurityGroup extends IAwsConstruct, IPeer {
  /** Strongly typed outputs */
  readonly securityGroupOutputs: SecurityGroupOutputs;

  /**
   * ID for the current security group
   * @attribute
   */
  readonly securityGroupId: string;

  /**
   * Whether the SecurityGroup has been configured to allow all outbound traffic
   */
  readonly allowAllOutbound: boolean;

  /**
   * Add an ingress rule for the current security group
   *
   * `remoteRule` controls where the Rule object is created if the peer is also a
   * securityGroup and they are in different stack. If false (default) the
   * rule object is created under the current SecurityGroup object. If true and the
   * peer is also a SecurityGroup, the rule object is created under the remote
   * SecurityGroup object.
   */
  addIngressRule(
    peer: IPeer,
    connection: Port,
    description?: string,
    remoteRule?: boolean,
  ): void;

  /**
   * Add an egress rule for the current security group
   *
   * `remoteRule` controls where the Rule object is created if the peer is also a
   * securityGroup and they are in different stack. If false (default) the
   * rule object is created under the current SecurityGroup object. If true and the
   * peer is also a SecurityGroup, the rule object is created under the remote
   * SecurityGroup object.
   */
  addEgressRule(
    peer: IPeer,
    connection: Port,
    description?: string,
    remoteRule?: boolean,
  ): void;
}

/**
 * A SecurityGroup that is not created in this template
 */
abstract class SecurityGroupBase
  extends AwsConstructBase
  implements ISecurityGroup
{
  /**
   * Return whether the indicated object is a security group
   */
  public static isSecurityGroup(x: any): x is SecurityGroupBase {
    return SECURITY_GROUP_SYMBOL in x;
  }

  public abstract readonly securityGroupId: string;
  public get securityGroupOutputs(): SecurityGroupOutputs {
    return {
      securityGroupId: this.securityGroupId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.securityGroupOutputs;
  }
  public abstract readonly allowAllOutbound: boolean;
  public abstract readonly allowAllIpv6Outbound: boolean;

  public readonly canInlineRule = false;
  public readonly connections: Connections = new Connections({
    securityGroups: [this],
  });
  public readonly defaultPort?: Port;

  private peerAsTokenCount: number = 0;

  constructor(scope: Construct, id: string, props?: AwsConstructProps) {
    super(scope, id, props);

    Object.defineProperty(this, SECURITY_GROUP_SYMBOL, { value: true });
  }

  public get uniqueId() {
    return AwsStack.uniqueId(this.node);
  }

  public addIngressRule(
    peer: IPeer,
    connection: Port,
    description?: string,
    remoteRule?: boolean,
  ) {
    if (description === undefined) {
      description = `from ${peer.uniqueId}:${connection}`;
    }

    const { scope, id } = this.determineRuleScope(
      peer,
      connection,
      "from",
      remoteRule,
    );

    // Skip duplicates
    if (scope.node.tryFindChild(id) === undefined) {
      new vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule(scope, id, {
        securityGroupId: this.securityGroupId,
        ...peer.toIngressRuleConfig(),
        ...connection.toRuleJson(),
        description,
      });
    }
  }

  public addEgressRule(
    peer: IPeer,
    connection: Port,
    description?: string,
    remoteRule?: boolean,
  ) {
    if (description === undefined) {
      description = `to ${peer.uniqueId}:${connection}`;
    }

    const { scope, id } = this.determineRuleScope(
      peer,
      connection,
      "to",
      remoteRule,
    );

    // Skip duplicates
    if (scope.node.tryFindChild(id) === undefined) {
      new vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule(scope, id, {
        securityGroupId: this.securityGroupId,
        ...peer.toEgressRuleConfig(),
        ...connection.toRuleJson(),
        description,
      });
    }
  }

  public toIngressRuleConfig(): any {
    return this.toRuleConfig();
  }

  public toEgressRuleConfig(): any {
    return this.toRuleConfig();
  }

  // Terraform does not use different properties between ingress and egress rules
  private toRuleConfig(): any {
    return { referencedSecurityGroupId: this.securityGroupId };
  }

  /**
   * Determine where to parent a new ingress/egress rule
   *
   * A SecurityGroup rule is parented under the group it's related to, UNLESS
   * we're in a cross-stack scenario with another Security Group. In that case,
   * we respect the 'remoteRule' flag and will parent under the other security
   * group.
   *
   * This is necessary to avoid cyclic dependencies between stacks, since both
   * ingress and egress rules will reference both security groups, and a naive
   * parenting will lead to the following situation:
   *
   *   ╔════════════════════╗         ╔════════════════════╗
   *   ║  ┌───────────┐     ║         ║    ┌───────────┐   ║
   *   ║  │  GroupA   │◀────╬─┐   ┌───╬───▶│  GroupB   │   ║
   *   ║  └───────────┘     ║ │   │   ║    └───────────┘   ║
   *   ║        ▲           ║ │   │   ║          ▲         ║
   *   ║        │           ║ │   │   ║          │         ║
   *   ║        │           ║ │   │   ║          │         ║
   *   ║  ┌───────────┐     ║ └───┼───╬────┌───────────┐   ║
   *   ║  │  EgressA  │─────╬─────┘   ║    │ IngressB  │   ║
   *   ║  └───────────┘     ║         ║    └───────────┘   ║
   *   ║                    ║         ║                    ║
   *   ╚════════════════════╝         ╚════════════════════╝
   *
   * By having the ability to switch the parent, we avoid the cyclic reference by
   * keeping all rules in a single stack.
   *
   * If this happens, we also have to change the construct ID, because
   * otherwise we might have two objects with the same ID if we have
   * multiple reversed security group relationships.
   *
   *   ╔═══════════════════════════════════╗
   *   ║┌───────────┐                      ║
   *   ║│  GroupB   │                      ║
   *   ║└───────────┘                      ║
   *   ║      ▲                            ║
   *   ║      │              ┌───────────┐ ║
   *   ║      ├────"from A"──│ IngressB  │ ║
   *   ║      │              └───────────┘ ║
   *   ║      │              ┌───────────┐ ║
   *   ║      ├─────"to B"───│  EgressA  │ ║
   *   ║      │              └───────────┘ ║
   *   ║      │              ┌───────────┐ ║
   *   ║      └─────"to B"───│  EgressC  │ ║  <-- oops
   *   ║                     └───────────┘ ║
   *   ╚═══════════════════════════════════╝
   */

  protected determineRuleScope(
    peer: IPeer,
    connection: Port,
    fromTo: "from" | "to",
    remoteRule?: boolean,
  ): RuleScope {
    if (
      remoteRule &&
      SecurityGroupBase.isSecurityGroup(peer) &&
      differentStacks(this, peer)
    ) {
      // Reversed
      const reversedFromTo = fromTo === "from" ? "to" : "from";
      return {
        scope: peer,
        id: `${this.uniqueId}:${connection} ${reversedFromTo}`,
      };
    } else {
      // Regular (do old ID escaping in order to not disturb existing deployments)
      return {
        scope: this,
        id: `${fromTo} ${this.renderPeer(peer)}:${connection}`.replace(
          "/",
          "_",
        ),
      };
    }
  }

  private renderPeer(peer: IPeer) {
    if (Token.isUnresolved(peer.uniqueId)) {
      // Need to return a unique value each time a peer
      // is an unresolved token, else the duplicate skipper
      // in `sg.addXxxRule` can detect unique rules as duplicates
      return this.peerAsTokenCount++
        ? `'{IndirectPeer${this.peerAsTokenCount}}'`
        : "{IndirectPeer}";
    } else {
      return peer.uniqueId;
    }
  }
}

/**
 * The scope and id in which a given SecurityGroup rule should be defined.
 */
export interface RuleScope {
  /**
   * The SecurityGroup in which a rule should be scoped.
   */
  readonly scope: ISecurityGroup;
  /**
   * The construct ID to use for the rule.
   */
  readonly id: string;
}

function differentStacks(group1: SecurityGroupBase, group2: SecurityGroupBase) {
  return AwsStack.of(group1) !== AwsStack.of(group2);
}

export interface SecurityGroupProps extends AwsConstructProps {
  /**
   * The name of the security group. For valid values, see the GroupName
   * parameter of the CreateSecurityGroup action in the Amazon EC2 API
   * Reference.
   *
   * It is not recommended to use an explicit group name.
   *
   * @default If you don't specify a GroupName, AWS CloudFormation generates a
   * unique physical ID and uses that ID for the group name.
   */
  readonly securityGroupName?: string;

  /**
   * A description of the security group.
   *
   * Forces new resource
   *
   * Security group description. Defaults to `Managed by Terraform`. Cannot be `""`.
   *
   * NOTE: This field maps to the AWS `GroupDescription` attribute, for which there is no Update API.
   * If you'd like to classify your security groups in a way that can be updated, use tags.
   *
   * @default The default name will be the construct's CDK path.
   */
  readonly description?: string;

  /**
   * The VPC in which to create the security group.
   */
  readonly vpc: IVpc;

  /**
   * Whether to allow all outbound traffic by default.
   *
   * If this is set to true, there will only be a single egress rule which allows all
   * outbound traffic. If this is set to false, no outbound traffic will be allowed by
   * default and all egress traffic must be explicitly authorized.
   *
   * To allow all ipv6 traffic use allowAllIpv6Outbound
   *
   * @default true
   */
  readonly allowAllOutbound?: boolean;

  /**
   * Whether to allow all outbound ipv6 traffic by default.
   *
   * If this is set to true, there will only be a single egress rule which allows all
   * outbound ipv6 traffic. If this is set to false, no outbound traffic will be allowed by
   * default and all egress ipv6 traffic must be explicitly authorized.
   *
   * To allow all ipv4 traffic use allowAllOutbound
   *
   * @default false
   */
  readonly allowAllIpv6Outbound?: boolean;

  /**
   * Whether to disable inline ingress and egress rule optimization.
   *
   * If this is set to true, ingress and egress rules will not be declared under the
   * SecurityGroup in cloudformation, but will be separate elements.
   *
   * Inlining rules is an optimization for producing smaller stack templates. Sometimes
   * this is not desirable, for example when security group access is managed via tags.
   *
   * The default value can be overriden globally by setting the context variable
   * '@aws-cdk/aws-ec2.securityGroupDisableInlineRules'.
   *
   * @default false
   */
  readonly disableInlineRules?: boolean;
}

/**
 * Additional options for imported security groups
 */
export interface SecurityGroupImportOptions {
  /**
   * Mark the SecurityGroup as having been created allowing all outbound traffic
   *
   * Only if this is set to false will egress rules be added to this security
   * group. Be aware, this would undo any potential "all outbound traffic"
   * default.
   *
   *
   * @default true
   */
  readonly allowAllOutbound?: boolean;

  /**
   * Mark the SecurityGroup as having been created allowing all outbound ipv6 traffic
   *
   * Only if this is set to false will egress rules for ipv6 be added to this security
   * group. Be aware, this would undo any potential "all outbound traffic"
   * default.
   *
   * @default false
   */
  readonly allowAllIpv6Outbound?: boolean;

  /**
   * If a SecurityGroup is mutable CDK can add rules to existing groups
   *
   * Beware that making a SecurityGroup immutable might lead to issue
   * due to missing ingress/egress rules for new resources.
   *
   *
   * @default true
   */
  readonly mutable?: boolean;
}

/**
 * Creates an Amazon EC2 security group within a VPC.
 *
 * Security Groups act like a firewall with a set of rules, and are associated
 * with any AWS resource that has or creates Elastic Network Interfaces (ENIs).
 * A typical example of a resource that has a security group is an Instance (or
 * Auto Scaling Group of instances)
 *
 * If you are defining new infrastructure in CDK, there is a good chance you
 * won't have to interact with this class at all. Like IAM Roles, Security
 * Groups need to exist to control access between AWS resources, but CDK will
 * automatically generate and populate them with least-privilege permissions
 * for you so you can concentrate on your business logic.
 *
 * All Constructs that require Security Groups will create one for you if you
 * don't specify one at construction. After construction, you can selectively
 * allow connections to and between constructs via--for example-- the `instance.connections`
 * object. Think of it as "allowing connections to your instance", rather than
 * "adding ingress rules a security group". See the [Allowing
 * Connections](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-cdk-lib.aws_ec2-readme.html#allowing-connections)
 * section in the library documentation for examples.
 *
 * Direct manipulation of the Security Group through `addIngressRule` and
 * `addEgressRule` is possible, but mutation through the `.connections` object
 * is recommended. If you peer two constructs with security groups this way,
 * appropriate rules will be created in both.
 *
 * If you have an existing security group you want to use in your CDK application,
 * you would import it like this:
 *
 * ```ts
 * const securityGroup = compute.SecurityGroup.fromSecurityGroupId(this, 'SG', 'sg-12345', {
 *   mutable: false
 * });
 * ```
 */
export class SecurityGroup extends SecurityGroupBase {
  /**
   * Look up a security group by id.
   */
  public static fromLookupById(
    scope: Construct,
    id: string,
    securityGroupId: string,
    allowAllOutbound?: boolean,
  ) {
    return this.fromLookupAttributes(scope, id, {
      securityGroupId,
      allowAllOutbound,
    });
  }

  /**
   * Look up a security group by name.
   */
  public static fromLookupByName(
    scope: Construct,
    id: string,
    securityGroupName: string,
    vpc: IVpc,
    allowAllOutbound?: boolean,
  ) {
    return this.fromLookupAttributes(scope, id, {
      securityGroupName,
      vpc,
      allowAllOutbound,
    });
  }

  /**
   * Import an existing security group into this app.
   *
   * This method will assume that the Security Group has a rule in it which allows
   * all outbound traffic, and so will not add egress rules to the imported Security
   * Group (only ingress rules).
   *
   * If your existing Security Group needs to have egress rules added, pass the
   * `allowAllOutbound: false` option on import.
   */
  public static fromSecurityGroupId(
    scope: Construct,
    id: string,
    securityGroupId: string,
    options: SecurityGroupImportOptions = {},
  ): ISecurityGroup {
    class MutableImport extends SecurityGroupBase {
      public securityGroupId = securityGroupId;
      public allowAllOutbound = options.allowAllOutbound ?? true;
      public allowAllIpv6Outbound = options.allowAllIpv6Outbound ?? false;

      public addEgressRule(
        peer: IPeer,
        connection: Port,
        description?: string,
        remoteRule?: boolean,
      ) {
        // Only if allowAllOutbound has been disabled
        if (options.allowAllOutbound === false) {
          super.addEgressRule(peer, connection, description, remoteRule);
        }
      }
    }

    class ImmutableImport extends SecurityGroupBase {
      public securityGroupId = securityGroupId;
      public allowAllOutbound = options.allowAllOutbound ?? true;
      public allowAllIpv6Outbound = options.allowAllIpv6Outbound ?? false;

      public addEgressRule(
        _peer: IPeer,
        _connection: Port,
        _description?: string,
        _remoteRule?: boolean,
      ) {
        // do nothing
      }

      public addIngressRule(
        _peer: IPeer,
        _connection: Port,
        _description?: string,
        _remoteRule?: boolean,
      ) {
        // do nothing
      }
    }

    return options.mutable !== false
      ? new MutableImport(scope, id)
      : new ImmutableImport(scope, id);
  }

  /**
   * Look up a security group.
   */
  private static fromLookupAttributes(
    scope: Construct,
    id: string,
    options: SecurityGroupLookupOptions,
  ) {
    if (
      Token.isUnresolved(options.securityGroupId) ||
      Token.isUnresolved(options.securityGroupName) ||
      Token.isUnresolved(options.vpc?.vpcId)
    ) {
      throw new Error(
        "All arguments to look up a security group must be concrete (no Tokens)",
      );
    }

    const data = new dataAwsSecurityGroup.DataAwsSecurityGroup(scope, id, {
      vpcId: options.vpc?.vpcId,
      id: options.securityGroupId,
      name: options.securityGroupName,
    });

    // TODO: Use Grid as contextProvider
    // Warning: using data source to determine if the security group allows
    // all outbound with allowAllOutboundLocal(scope, id, data.id)
    // would force all depending code to deal with Tokens
    return SecurityGroup.fromSecurityGroupId(scope, id, data.id, {
      allowAllOutbound: options.allowAllOutbound ?? true,
      mutable: true,
    });
  }

  /**
   * The ID of the security group
   *
   * @attribute
   */
  public readonly securityGroupId: string;

  /**
   * The VPC ID this security group is part of.
   *
   * @attribute
   */
  public readonly securityGroupVpcId: string;

  /**
   * Whether the SecurityGroup has been configured to allow all outbound traffic
   */
  public readonly allowAllOutbound: boolean;

  /**
   * Whether the SecurityGroup has been configured to allow all outbound ipv6 traffic
   */
  public readonly allowAllIpv6Outbound: boolean;

  private readonly securityGroup: securityGroup.SecurityGroup;
  private readonly directIngressRules: securityGroup.SecurityGroupIngress[] =
    [];
  private readonly directEgressRules: securityGroup.SecurityGroupEgress[] = [];

  /**
   * Whether to disable optimization for inline security group rules.
   */
  private readonly disableInlineRules: boolean;

  constructor(scope: Construct, id: string, props: SecurityGroupProps) {
    super(scope, id, props);
    const groupName =
      props.securityGroupName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    const groupDescription = props.description || this.node.path;

    this.allowAllOutbound = props.allowAllOutbound !== false;
    this.allowAllIpv6Outbound = props.allowAllIpv6Outbound ?? false;

    this.disableInlineRules =
      props.disableInlineRules !== undefined
        ? !!props.disableInlineRules
        : !!this.node.tryGetContext(
            SECURITY_GROUP_DISABLE_INLINE_RULES_CONTEXT_KEY,
          );

    this.securityGroup = new securityGroup.SecurityGroup(this, "Resource", {
      name: groupName,
      description: groupDescription,
      ingress: Lazy.anyValue(
        {
          produce: () =>
            this.directIngressRules.map(
              securityGroup.securityGroupIngressToTerraform,
            ),
        },
        { omitEmptyArray: true },
      ),
      egress: Lazy.anyValue(
        {
          produce: () =>
            this.directEgressRules.map(
              securityGroup.securityGroupEgressToTerraform,
            ),
        },
        { omitEmptyArray: true },
      ),
      vpcId: props.vpc.vpcId,
    });

    this.securityGroupId = this.securityGroup.id;
    this.securityGroupVpcId = this.securityGroup.vpcId;

    this.addDefaultEgressRule();
    this.addDefaultIpv6EgressRule();
  }

  public addIngressRule(
    peer: IPeer,
    connection: Port,
    description?: string,
    remoteRule?: boolean,
  ) {
    if (
      !peer.canInlineRule ||
      !connection.canInlineRule ||
      this.disableInlineRules
    ) {
      super.addIngressRule(peer, connection, description, remoteRule);
      return;
    }

    if (description === undefined) {
      description = `from ${peer.uniqueId}:${connection}`;
    }

    this.addDirectIngressRule({
      ...peer.toIngressRuleConfig(),
      ...connection.toRuleJson(),
      description,
    });
  }

  public addEgressRule(
    peer: IPeer,
    connection: Port,
    description?: string,
    remoteRule?: boolean,
  ) {
    const isIpv6 = peer.toEgressRuleConfig().hasOwnProperty("cidrIpv6");

    if (!isIpv6 && this.allowAllOutbound) {
      // In the case of "allowAllOutbound", we don't add any more rules. There
      // is only one rule which allows all traffic and that subsumes any other
      // rule.
      if (!remoteRule) {
        // Warn only if addEgressRule() was explicitely called
        // "@aws-cdk/aws-ec2:ipv4IgnoreEgressRule",
        Annotations.of(this).addWarning(
          "Ignoring Egress rule since 'allowAllOutbound' is set to true; To add customized rules, set allowAllOutbound=false on the SecurityGroup",
        );
      }
      return;
    }

    if (isIpv6 && this.allowAllIpv6Outbound) {
      // In the case of "allowAllIpv6Outbound", we don't add any more rules. There
      // is only one rule which allows all traffic and that subsumes any other
      // rule.
      if (!remoteRule) {
        // Warn only if addEgressRule() was explicitely called
        // "@aws-cdk/aws-ec2:ipv6IgnoreEgressRule",
        Annotations.of(this).addWarning(
          "Ignoring Egress rule since 'allowAllIpv6Outbound' is set to true; To add customized rules, set allowAllIpv6Outbound=false on the SecurityGroup",
        );
      }
      return;
    }

    if (
      !peer.canInlineRule ||
      !connection.canInlineRule ||
      this.disableInlineRules
    ) {
      super.addEgressRule(peer, connection, description, remoteRule);
      return;
    }

    if (description === undefined) {
      description = `from ${peer.uniqueId}:${connection}`;
    }

    const rule = {
      ...peer.toEgressRuleConfig(),
      ...connection.toRuleJson(),
      description,
    };

    if (isAllTrafficRule(rule)) {
      // We cannot allow this; if someone adds the rule in this way, it will be
      // removed again if they add other rules. We also can't automatically switch
      // to "allOutbound=true" mode, because we might have already emitted
      // EgressRule objects (which count as rules added later) and there's no way
      // to recall those. Better to prevent this for now.
      throw new Error(
        'Cannot add an "all traffic" egress rule in this way; set allowAllOutbound=true (for ipv6) or allowAllIpv6Outbound=true (for ipv6) on the SecurityGroup instead.',
      );
    }

    this.addDirectEgressRule(rule);
  }

  /**
   * Add a direct ingress rule
   */
  private addDirectIngressRule(rule: securityGroup.SecurityGroupIngress) {
    const r = normalizeDirectRule(rule);
    if (!this.hasIngressRule(r)) {
      this.directIngressRules.push(r);
    }
  }

  /**
   * Return whether the given ingress rule exists on the group
   */
  private hasIngressRule(rule: securityGroup.SecurityGroupIngress): boolean {
    return (
      this.directIngressRules.findIndex((r) => ingressRulesEqual(r, rule)) > -1
    );
  }

  /**
   * Add a direct egress rule
   */
  private addDirectEgressRule(rule: securityGroup.SecurityGroupEgress) {
    const r = normalizeDirectRule(rule);
    if (!this.hasEgressRule(r)) {
      this.directEgressRules.push(r);
    }
  }

  /**
   * Return whether the given egress rule exists on the group
   */
  private hasEgressRule(rule: securityGroup.SecurityGroupEgress): boolean {
    return (
      this.directEgressRules.findIndex((r) => egressRulesEqual(r, rule)) > -1
    );
  }

  /**
   * Add the default egress rule to the securityGroup
   *
   * By default, AWS creates an `ALLOW ALL` egress rule when creating a new Security Group inside of a VPC.
   * When creating a new Security Group inside a VPC, Terraform will remove this default rule, and require
   * you specifically re-create it if you desire that rule.
   *
   * This depends on allowAllOutbound
   *
   * - If allowAllOutbound is true, we will add an allow all rule.
   * - If allowAllOutbound is false, we don't do anything since TF does not add
   *   a default allow all ipv4 rule.
   */
  private addDefaultEgressRule() {
    if (!this.allowAllOutbound) {
      return;
    }
    if (this.disableInlineRules) {
      super.addEgressRule(
        ALL_TRAFFIC_PEER,
        ALL_TRAFFIC_PORT,
        ALLOW_ALL_RULE.description,
        false,
      );
    } else {
      this.directEgressRules.push(ALLOW_ALL_RULE);
    }
  }

  /**
   * Add a allow all ipv6 egress rule to the securityGroup
   *
   * This depends on allowAllIpv6Outbound:
   *
   * - If allowAllIpv6Outbound is true, we will add an allow all rule.
   * - If allowAllOutbound is false, we don't do anything since EC2 does not add
   *   a default allow all ipv6 rule.
   */
  private addDefaultIpv6EgressRule() {
    const description = "Allow all outbound ipv6 traffic by default";
    const peer = Peer.anyIpv6();
    if (this.allowAllIpv6Outbound) {
      if (this.disableInlineRules) {
        super.addEgressRule(peer, Port.allTraffic(), description, false);
      } else {
        this.directEgressRules.push({
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          ipv6CidrBlocks: [peer.uniqueId],
          description,
        });
      }
    }
  }
}

/**
 * Fix up a direct rule to have fromPort/toPort defined
 */
function normalizeDirectRule(
  rule: securityGroup.SecurityGroupEgress | securityGroup.SecurityGroupIngress,
): securityGroup.SecurityGroupEgress | securityGroup.SecurityGroupIngress {
  // Unlike security_group_(in|e)gress_rule, TF Security Group direct rules
  // can't have fromPort/toPort undefined.
  // refs:
  // - https://registry.terraform.io/providers/hashicorp/aws/5.88.0/docs/resources/vpc_security_group_egress_rule#ip_protocol-1
  //   vs
  // - https://registry.terraform.io/providers/hashicorp/aws/5.88.0/docs/resources/security_group#protocol-1
  return {
    ...rule,
    fromPort: rule.fromPort ?? 0,
    toPort: rule.toPort ?? 0,
  };
}

/**
 * Egress rule that matches all traffic
 */
const ALLOW_ALL_RULE: securityGroup.SecurityGroupEgress = {
  cidrBlocks: ["0.0.0.0/0"],
  description: "Allow all outbound traffic by default",
  /**
   * If you select a protocol of -1 (semantically equivalent to all, which is not a valid value here),
   * you must specify a from_port and to_port equal to 0.
   */
  protocol: "-1",
  fromPort: 0,
  toPort: 0,
};

const ALL_TRAFFIC_PEER = Peer.anyIpv4();
const ALL_TRAFFIC_PORT = Port.allTraffic();

export interface ConnectionRule {
  /**
   * The IP protocol name (tcp, udp, icmp) or number (see Protocol Numbers).
   * Use -1 to specify all protocols. If you specify -1, or a protocol number
   * other than tcp, udp, icmp, or 58 (ICMPv6), traffic on all ports is
   * allowed, regardless of any ports you specify. For tcp, udp, and icmp, you
   * must specify a port range. For protocol 58 (ICMPv6), you can optionally
   * specify a port range; if you don't, traffic for all types and codes is
   * allowed.
   *
   * @default tcp
   */
  readonly protocol?: string;

  /**
   * Start of port range for the TCP and UDP protocols, or an ICMP type number.
   *
   * If you specify icmp for the IpProtocol property, you can specify
   * -1 as a wildcard (i.e., any ICMP type number).
   */
  readonly fromPort: number;

  /**
   * End of port range for the TCP and UDP protocols, or an ICMP code.
   *
   * If you specify icmp for the IpProtocol property, you can specify -1 as a
   * wildcard (i.e., any ICMP code).
   *
   * @default If toPort is not specified, it will be the same as fromPort.
   */
  readonly toPort?: number;

  /**
   * Description of this connection. It is applied to both the ingress rule
   * and the egress rule.
   *
   * @default No description
   */
  readonly description?: string;
}

/**
 * Compare two ingress rules for equality the same way CloudFormation would (discarding description)
 */
function ingressRulesEqual(
  a: securityGroup.SecurityGroupIngress,
  b: securityGroup.SecurityGroupIngress,
) {
  return (
    a.cidrBlocks === b.cidrBlocks &&
    a.ipv6CidrBlocks === b.ipv6CidrBlocks &&
    a.fromPort === b.fromPort &&
    a.toPort === b.toPort &&
    a.protocol === b.protocol &&
    a.prefixListIds === b.prefixListIds &&
    a.securityGroups === b.securityGroups
  );
}

/**
 * Compare two egress rules for equality the same way CloudFormation would (discarding description)
 */
function egressRulesEqual(
  a: securityGroup.SecurityGroupEgress,
  b: securityGroup.SecurityGroupEgress,
) {
  return (
    a.cidrBlocks === b.cidrBlocks &&
    a.ipv6CidrBlocks === b.ipv6CidrBlocks &&
    a.fromPort === b.fromPort &&
    a.toPort === b.toPort &&
    a.protocol === b.protocol &&
    a.prefixListIds === b.prefixListIds &&
    a.securityGroups === b.securityGroups
  );
}

/**
 * Whether this rule refers to all traffic
 */
function isAllTrafficRule(rule: any) {
  return (
    (rule.cidrIpv4 === "0.0.0.0/0" ||
      (rule.cidrBlocks && rule.cidrBlocks[0] === "0.0.0.0/0") ||
      rule.cidrIpv6 === "::/0") &&
    rule.ipProtocol === "-1"
  );
}

/**
 * Properties for looking up an existing SecurityGroup.
 *
 * Either `securityGroupName` or `securityGroupId` has to be specified.
 */
interface SecurityGroupLookupOptions {
  /**
   * The name of the security group
   *
   * If given, will import the SecurityGroup with this name.
   *
   * @default Don't filter on securityGroupName
   */
  readonly securityGroupName?: string;

  /**
   * The ID of the security group
   *
   * If given, will import the SecurityGroup with this ID.
   *
   * @default Don't filter on securityGroupId
   */
  readonly securityGroupId?: string;

  /**
   * The VPC of the security group
   *
   * If given, will filter the SecurityGroup based on the VPC.
   *
   * @default Don't filter on VPC
   */
  readonly vpc?: IVpc;

  /**
   * Mark the SecurityGroup as allowing all outbound traffic
   *
   * Only if this is set to false will egress rules be added to this security
   * group. Be aware, this would undo any potential "all outbound traffic"
   * default.
   *
   * @default true
   */
  readonly allowAllOutbound?: boolean; // TODO: Use Grid as contextProvider
}
