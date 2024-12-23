import {
  iamPolicy,
  dataAwsIamPolicy,
  iamRolePolicyAttachment,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { PolicyDocument } from "./policy-document";
import { PolicyStatement } from "./policy-statement";
import {
  AddToPrincipalPolicyResult,
  IGrantable,
  IPrincipal,
  PrincipalPolicyFragment,
} from "./principals";
import { IRole } from "./role";
import { Arn } from "../arn";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface ManagedPolicyOutputs {
  readonly arn: string;
}

/**
 * A managed policy
 */
export interface IManagedPolicy extends IAwsConstruct {
  /**
   * Strongly typed managed policy outputs
   *
   * @attribute
   */
  readonly managedPolicyOutputs: ManagedPolicyOutputs;
  /**
   * The ARN of the managed policy
   * @attribute
   */
  readonly managedPolicyArn: string;
  /**
   * Attaches this policy to a role.
   *
   * NOTE: Using this method will conflict with a role that has
   * exclusive management of the role's policy attachments.
   *
   * If you attempt to manage a role's policies by multiple means,
   * you will get resource cycling and/or errors.
   */
  attachToRole(role: IRole): void;
}

/**
 * Properties for defining an IAM managed policy
 */
export interface ManagedPolicyProps extends AwsConstructProps {
  /**
   * The name of the managed policy. If you specify multiple policies for an entity,
   * specify unique names. For example, if you specify a list of policies for
   * an IAM role, each policy must have a unique name.
   *
   * Forces new resource
   *
   * @default - If omitted, Refer to `managedPolicyNamePrefix`.
   */
  readonly managedPolicyName?: string;

  /**
   * Creates a unique name beginning with the specified prefix.
   * Conflicts with `managedPolicyName`.
   *
   * The name of the managed policy. If you specify multiple policies for an entity,
   * specify unique names. For example, if you specify a list of policies for
   * an IAM role, each policy must have a unique name.
   *
   * Forces new resource
   *
   * @default - If omitted, ET will assign a random, unique name prefixed by GridUUID.
   */
  readonly managedPolicyNamePrefix?: string;

  /**
   * A description of the managed policy. Typically used to store information about the
   * permissions defined in the policy. For example, "Grants access to production DynamoDB tables."
   * The policy description is immutable. After a value is assigned, it cannot be changed.
   *
   * Forces new resource
   *
   * @default - Terraform will generate a description
   */
  readonly description?: string;

  //TODO: Confirm terraform generates a description for iam_policy?

  /**
   * The path for the policy. This parameter allows (through its regex pattern) a string of characters
   * consisting of either a forward slash (/) by itself or a string that must begin and end with forward slashes.
   * In addition, it can contain any ASCII character from the ! (\u0021) through the DEL character (\u007F),
   * including most punctuation characters, digits, and upper and lowercased letters.
   *
   * For more information about paths, see IAM Identifiers in the IAM User Guide.
   *
   * @default - "/"
   */
  readonly path?: string;

  /**
   * Roles to attach this policy to.
   * You can also use `attachToRole(role)` to attach this policy to a role.
   *
   * @default - No roles.
   */
  readonly roles?: IRole[];

  /**
   * Initial set of permissions to add to this policy document.
   * You can also use `addPermission(statement)` to add permissions later.
   *
   * @default - No statements.
   */
  readonly statements?: PolicyStatement[];

  /**
   * Initial PolicyDocument to use for this ManagedPolicy. If omited, any
   * `PolicyStatement` provided in the `statements` property will be applied
   * against the empty default `PolicyDocument`.
   *
   * @default - An empty policy.
   */
  readonly document?: PolicyDocument;
}

/**
 * Attributes to reference ManagedPolicy for plan time failures and strict external dependencies.
 */
export interface ManagedPolicyAttributes
  extends dataAwsIamPolicy.DataAwsIamPolicyConfig {}

/**
 * Managed policy base
 */
abstract class ManagedPolicyBase
  extends AwsConstructBase
  implements IManagedPolicy
{
  /**
   * Returns the ARN of this managed policy.
   *
   * @attribute
   */
  public abstract get managedPolicyArn(): string;
  public get managedPolicyOutputs(): ManagedPolicyOutputs {
    return { arn: this.managedPolicyArn };
  }
  public get outputs(): Record<string, any> {
    return this.managedPolicyOutputs;
  }
  private readonly roles = new Array<IRole>();
  constructor(scope: Construct, id: string, props: ManagedPolicyProps = {}) {
    super(scope, id, props);
  }
  public attachToRole(role: IRole) {
    if (this.roles.find((r) => r.roleArn === role.roleArn)) {
      return;
    }
    this.roles.push(role);
  }
  /**
   * Adds resource to the terraform JSON output.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    // add iamRolePolicy resource for each referenced role
    for (let i = 0; i < this.roles.length; i++) {
      const id = `Roles${i}`;
      // TODO: Ideally we should have used IResolvable.resolve and use the IResolveContext.preparing flag
      // ref: https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-iam/lib/policy-document.ts#L48
      if (this.node.tryFindChild(id)) continue; // ignore if already generated

      new iamRolePolicyAttachment.IamRolePolicyAttachment(this, id, {
        policyArn: this.managedPolicyArn,
        role: this.roles[i].roleName,
      });
    }
    return {};
  }
}

/**
 * Managed policy
 */
export class ManagedPolicy
  extends ManagedPolicyBase
  implements IManagedPolicy, IGrantable
{
  /**
   * Import a customer managed policy from the managedPolicyName.
   *
   * For this managed policy, you only need to know the name to be able to use it.
   *
   */
  public static fromManagedPolicyName(
    scope: Construct,
    id: string,
    managedPolicyName: string,
  ): IManagedPolicy {
    class Import extends ManagedPolicyBase {
      public readonly managedPolicyArn = AwsStack.ofAwsConstruct(
        scope,
      ).formatArn({
        service: "iam",
        region: "", // no region for managed policy
        account: this.env.account,
        resource: "policy",
        resourceName: managedPolicyName,
      });
    }
    return new Import(scope, id, {});
  }

  /**
   * Import an external managed policy by ARN.
   *
   * For this managed policy, you only need to know the ARN to be able to use it.
   * This can be useful if you got the ARN from the Grid.
   *
   * If the imported Managed Policy ARN is a Token (such as a
   * `dataAwsSsmParameter.value` *and* the referenced
   * managed policy has a `path` (like `arn:...:policy/AdminPolicy/AdminAllow`), the
   * `managedPolicyName` property will not resolve to the correct value. Instead it
   * will resolve to the first path component.
   * In this scenario the Managed Policy ARN should be supplied without the
   * `path` in order to resolve the correct managed policy resource.
   *
   * @param scope construct scope
   * @param id construct id
   * @param managedPolicyArn the ARN of the managed policy to import
   */
  public static fromManagedPolicyArn(
    scope: Construct,
    id: string, // TODO: remove this, use managedPolicyArn as id?
    managedPolicyArn: string,
  ): IManagedPolicy {
    // TODO: Check scope if child already exist and return that?
    class Import extends ManagedPolicyBase {
      public readonly managedPolicyArn = managedPolicyArn;
    }
    return new Import(scope, id);
  }

  /**
   * Import a managed policy from one of the policies that AWS manages.
   *
   * For this managed policy, you only need to know the name and scope
   * to be able to use it.
   *
   * Some managed policy names start with "service-role/", some start with
   * "job-function/", and some don't start with anything. Include the
   * prefix when constructing this object.
   */
  public static fromAwsManagedPolicyName(
    scope: Construct,
    id: string, //TODO: use managedPolicyName as id instead?
    managedPolicyName: string,
  ): IManagedPolicy {
    class AwsManagedPolicy extends ManagedPolicyBase {
      public readonly managedPolicyArn = Arn.format({
        partition: this.env.partition,
        service: "iam",
        region: "", // no region for managed policy
        account: "aws", // the account for a managed policy is 'aws'
        resource: "policy",
        resourceName: managedPolicyName,
      });
    }
    return new AwsManagedPolicy(scope, id);
  }

  /**
   * Reference a ManagedPolicy for plan time failures and external dependencies.
   */
  public static fromPolicyAttributes(
    parentScope: Construct,
    parentId: string,
    attr: ManagedPolicyAttributes,
  ): IManagedPolicy {
    class Import extends ManagedPolicyBase {
      /**
       * Direct access to the underlying Terraform resource.
       *
       * Use to define dependencies on this ManagedPolicy.
       */
      public readonly resource: dataAwsIamPolicy.DataAwsIamPolicy;
      public readonly managedPolicyArn: string;
      constructor(scope: Construct, id: string) {
        super(scope, id, attr);
        this.resource = new dataAwsIamPolicy.DataAwsIamPolicy(
          this,
          "Resource",
          attr,
        );
        this.managedPolicyArn = this.resource.arn;
      }
    }

    return new Import(parentScope, parentId);
  }
  /**
   * Returns the ARN of this managed policy.
   *
   * @attribute
   */
  public get managedPolicyArn(): string {
    return this.resource.arn;
  }

  /**
   * The policy document.
   */
  public readonly document: PolicyDocument;

  /**
   * The name of this policy.
   *
   * @attribute
   */
  public get managedPolicyName(): string {
    return this.resource.name;
  }

  /**
   * The description of this policy.
   *
   * @attribute
   */
  public readonly description?: string;

  /**
   * The path of this policy.
   *
   * @attribute
   */
  public readonly path: string;

  public readonly grantPrincipal: IPrincipal;

  /**
   * Direct access to the underlying Terraform resource.
   *
   * Use to define dependencies on this ManagedPolicy.
   */
  public resource: iamPolicy.IamPolicy;

  // TODO: Add support for pre-created policies?
  // NOTE: in TerraConstruct pre-created policies are passed in through the Grid, so this seems not needed.
  // private readonly _precreatedPolicy?: IManagedPolicy;

  constructor(scope: Construct, id: string, props: ManagedPolicyProps = {}) {
    super(scope, id, props);

    this.description = props.description;
    this.path = props.path || "/";

    this.document = props.document ?? new PolicyDocument(this, "Policy");

    if (props.managedPolicyName && props.managedPolicyNamePrefix) {
      throw new Error(
        "Cannot specify both 'managedPolicyName' and 'managedPolicyNamePrefix'. Use only one.",
      );
    }

    const managedPolicyNamePrefix = this.stack.uniqueResourceNamePrefix(this, {
      prefix: props.managedPolicyNamePrefix ?? this.gridUUID + "-",
      allowedSpecialCharacters: "_+=,.@-",
      maxLength: 128,
    });

    this.resource = new iamPolicy.IamPolicy(this, "Resource", {
      ...props, // copy over Terraform Meta Arguments from ConstructProps
      name: props.managedPolicyName,
      namePrefix: !props.managedPolicyName
        ? managedPolicyNamePrefix
        : undefined,
      description: this.description,
      path: this.path,
      policy: this.document.json,
    });

    if (props.roles) {
      props.roles.forEach((r) => this.attachToRole(r));
    }

    if (props.statements) {
      props.statements.forEach((p) => this.addStatements(p));
    }

    this.grantPrincipal = new ManagedPolicyGrantPrincipal(this);

    this.node.addValidation({ validate: () => this.validateManagedPolicy() });
  }

  /**
   * Adds a statement to the policy document.
   */
  public addStatements(...statement: PolicyStatement[]) {
    this.document.addStatements(...statement);
  }

  private validateManagedPolicy(): string[] {
    const result = new Array<string>();

    // validate that the policy document is not empty
    if (this.document.isEmpty) {
      result.push(
        "Managed Policy is empty. You must add statements to the policy",
      );
    }

    result.push(...this.document.validateForIdentityPolicy());
    return result;
  }
}

class ManagedPolicyGrantPrincipal implements IPrincipal {
  public readonly assumeRoleAction = "sts:AssumeRole";
  public readonly grantPrincipal: IPrincipal;
  public readonly principalAccount?: string;

  constructor(private _managedPolicy: ManagedPolicy) {
    this.grantPrincipal = this;
    this.principalAccount = _managedPolicy.env.account;
  }

  public get policyFragment(): PrincipalPolicyFragment {
    // This property is referenced to add policy statements as a resource-based policy.
    // We should fail because a managed policy cannot be used as a principal of a policy document.
    // cf. https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#Principal_specifying
    throw new Error(
      `Cannot use a ManagedPolicy '${this._managedPolicy.node.path}' as the 'Principal' or 'NotPrincipal' in an IAM Policy`,
    );
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  public addToPrincipalPolicy(
    statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    this._managedPolicy.addStatements(statement);
    return { statementAdded: true, policyDependable: this._managedPolicy };
  }
}
