import { iamRolePolicy } from "@cdktf/provider-aws";
import { TerraformElement } from "cdktf";
import { Construct } from "constructs";
import { IAwsBeacon, AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { IPolicyDocument, PolicyDocument } from "./policy-document";
import { PolicyStatement } from "./policy-statement";
import {
  AddToPrincipalPolicyResult,
  IGrantable,
  IPrincipal,
  PrincipalPolicyFragment,
} from "./principals";
import { IRole } from "./role";

export const MAX_POLICY_NAME_LEN = 128;

/**
 * Represents an IAM Policy
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_manage.html
 */
export interface IPolicy extends IAwsBeacon {
  /**
   * The name of this policy.
   *
   * @attribute
   */
  readonly policyName: string;
}

/**
 * Properties for defining an IAM inline policy document
 */
export interface PolicyProps extends AwsBeaconProps {
  /**
   * The name of the policy. If you specify multiple policies for an entity,
   * specify unique names. For example, if you specify a list of policies for
   * an IAM role, each policy must have a unique name.
   *
   * @default - Uses the logical ID of the policy resource, which is ensured
   * to be unique within the stack.
   */
  readonly policyName?: string;

  /**
   * Roles to attach this policy to.
   * You can also use `attachToRole(role)` to attach this policy to a role.
   *
   * @default - No roles.
   */
  readonly roles?: IRole[];

  /**
   * Initial set of permissions to add to this policy document.
   * You can also use `addStatements(...statement)` to add permissions later.
   *
   * @default - No statements.
   */
  readonly statements?: PolicyStatement[];

  /**
   * In cases where you know the policy must be created and it is actually
   * an error if no statements have been added to it or it remains unattached to
   * an IAM identity, you can set this to `true`.
   *
   * @default false
   */
  readonly force?: boolean;

  /**
   * Initial PolicyDocument to use for this Policy. If omited, any
   * `PolicyStatement` provided in the `statements` property will be applied
   * against the empty default `PolicyDocument`.
   *
   * @default - An empty policy.
   */
  readonly document?: IPolicyDocument;
}

/**
 * The Policy resource associates an [inline](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#inline)
 * IAM policy with IAM users, roles, or groups. For more information about IAM policies, see
 * [Overview of IAM Policies](http://docs.aws.amazon.com/IAM/latest/UserGuide/policies_overview.html)
 * in the IAM User Guide guide.
 *
 * Also refer to:
 * - [Iam Role Policy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_role_policy)
 * - [Iam Group Policy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_group_policy)
 */
export class Policy extends AwsBeaconBase implements IPolicy, IGrantable {
  /**
   * Import a policy in this app based on its name
   */
  public static fromPolicyName(
    scope: Construct,
    id: string,
    policyName: string,
  ): IPolicy {
    class Import extends AwsBeaconBase implements IPolicy {
      public readonly policyName = policyName;
      public get outputs(): Record<string, any> {
        // TODO: Support undefined outputs?
        return {};
      }
    }

    return new Import(scope, id);
  }

  /**
   * The policy document.
   */
  public readonly document: IPolicyDocument;
  public readonly grantPrincipal: IPrincipal;

  public get outputs(): Record<string, any> {
    // TODO: Support undefined outputs?
    return {};
  }

  private readonly _policyName: string;
  private readonly roles = new Array<IRole>();
  private readonly force: boolean;
  private referenceTaken = false; // TODO: do we actually use this?

  constructor(scope: Construct, id: string, props: PolicyProps = {}) {
    super(scope, id, props);
    this.document = props.document ?? new PolicyDocument(this, "Resource");
    // TODO: This is a logical ID within a resource, no need to use GridUUID
    this._policyName =
      props.policyName ||
      this.stack.uniqueResourceName(this, {
        maxLength: MAX_POLICY_NAME_LEN,
      });
    this.force = props.force ?? false;

    if (props.roles) {
      props.roles.forEach((r) => this.attachToRole(r));
    }

    if (props.statements) {
      props.statements.forEach((s) => this.addStatements(s));
    }

    this.grantPrincipal = new PolicyGrantPrincipal(this);

    this.node.addValidation({ validate: () => this.validatePolicy() });
  }

  /**
   * Adds a statement to the policy document.
   */
  public addStatements(...statement: PolicyStatement[]) {
    this.document.addStatements(...statement);
  }

  /**
   * Attaches this policy to a role.
   *
   * NOTE: Using this method will conflict with a role that has
   * exclusive management of the role's policy attachments.
   *
   * If you attempt to manage a role's policies by multiple means,
   * you will get resource cycling and/or errors.
   */
  public attachToRole(role: IRole) {
    if (this.roles.find((r) => r.roleArn === role.roleArn)) {
      return;
    }
    this.roles.push(role);
    role.attachInlinePolicy(this);
  }

  /**
   * The name of this policy.
   *
   * @attribute
   */
  public get policyName(): string {
    this.referenceTaken = true;
    return this._policyName;
  }

  private validatePolicy(): string[] {
    const result = new Array<string>();

    // validate that the policy document is not empty
    if (this.document.isEmpty) {
      if (this.force) {
        result.push(
          "Policy created with force=true is empty. You must add statements to the policy",
        );
      }
      if (!this.force && this.referenceTaken) {
        result.push(
          "This Policy has been referenced by a resource, so it must contain at least one statement.",
        );
      }
    }

    // validate that the policy is attached to at least one principal (role, user or group).
    if (!this.isAttached) {
      if (this.force) {
        result.push(
          "Policy created with force=true must be attached to at least one principal: user, group or role",
        );
      }
      if (!this.force && this.referenceTaken) {
        result.push(
          "This Policy has been referenced by a resource, so it must be attached to at least one user, group or role.",
        );
      }
    }

    result.push(...this.document.validateForIdentityPolicy());

    return result;
  }

  /**
   * Whether the policy resource has been attached to any identity
   */
  private get isAttached() {
    // return this.groups.length + this.users.length + this.roles.length > 0;
    return this.roles.length > 0;
  }

  /**
   * Adds resource to the terraform JSON output.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    /**
     * A preparing resolve run might add new resources to the stack
     *
     * should not add resources if `force` is `false` and the policy
     * document is empty or not attached
     * ref: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/aws-iam/lib/policy.ts#L149
     */
    if (!this.force && (this.document.isEmpty || !this.isAttached)) {
      return {};
    }

    // add iamRolePolicy resource for each referenced role
    // NOTE: The TerraformDependendableAspect will propgate construct dependencies on this policy to its IamRolePolicy resources
    // not sure if time.sleep is still necessary?
    // https://github.com/pulumi/pulumi-aws/issues/2260#issuecomment-1977606509
    // else need: https://github.com/hashicorp/terraform-provider-aws/issues/29828#issuecomment-1693307500
    for (let i = 0; i < this.roles.length; i++) {
      const id = `ResourceRoles${i}`;
      // TODO: Ideally we should have used IResolvable.resolve and use the IResolveContext.preparing flag
      // ref: https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-iam/lib/policy-document.ts#L48
      if (this.node.tryFindChild(id)) continue; // ignore if already generated

      const rolePolicy = new iamRolePolicy.IamRolePolicy(this, id, {
        policy: this.document.json,
        role: this.roles[i].roleName,
        name: this.policyName,
      });
      // copy any overrides to the underlying L0 resources
      for (const [key, value] of Object.entries(this.rawOverrides)) {
        rolePolicy.addOverride(key, value);
        const policyDocument = this.document.node
          .defaultChild as TerraformElement;
        policyDocument.addOverride(key, value);
      }
    }
    return {};
  }
}

class PolicyGrantPrincipal implements IPrincipal {
  public readonly assumeRoleAction = "sts:AssumeRole";
  public readonly grantPrincipal: IPrincipal;
  public readonly principalAccount?: string;

  constructor(private _policy: Policy) {
    this.grantPrincipal = this;
    this.principalAccount = _policy.env.account;
  }

  public get policyFragment(): PrincipalPolicyFragment {
    // This property is referenced to add policy statements as a resource-based policy.
    // We should fail because a policy cannot be used as a principal of a policy document.
    // cf. https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#Principal_specifying
    throw new Error(
      `Cannot use a Policy '${this._policy.node.path}' as the 'Principal' or 'NotPrincipal' in an IAM Policy`,
    );
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  public addToPrincipalPolicy(
    statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    this._policy.addStatements(statement);
    // TODO: How to support dependency group?
    // TODO: Dependable should be IResolvable for the group of policy attachments created (if any)
    return { statementAdded: true, policyDependable: this._policy };
  }
}
