import { iamRole } from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat } from "../arn";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import { Grant } from "./grant";
import { IIdentity } from "./identity-base";
import { IManagedPolicy } from "./managed-policy";
import { Policy } from "./policy";
import { PolicyDocument } from "./policy-document";
import { PolicyStatement } from "./policy-statement";
import {
  AccountPrincipal,
  AddToPrincipalPolicyResult,
  ArnPrincipal,
  IPrincipal,
  PrincipalPolicyFragment,
  ServicePrincipal,
} from "./principals";
import { Duration } from "../..";
import { MutatingPolicyDocumentAdapter } from "./private/adapter";
import { defaultAddPrincipalToAssumeRole } from "./private/assume-role-policy";
import { ImmutableRole } from "./private/immutable-role";
import { ImportedRole } from "./private/imported-role";
// import { PrecreatedRole } from "./private/precreated-role";
import { AttachedPolicies, UniqueStringSet } from "./private/util";
import { TokenComparison, tokenCompareStrings } from "../../token";

// TODO: Re-Add LazyRole?
// ref: https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-iam/lib/lazy-role.ts

// TODO: re-implement iam role policy splitting
// const MAX_INLINE_SIZE = 10000;
// const MAX_MANAGEDPOL_SIZE = 6000;
const IAM_ROLE_SYMBOL = Symbol.for("terraconstructs/lib/aws/iam.Role");

/**
 * Properties for defining an IAM Role
 */
export interface RoleProps extends AwsConstructProps {
  /**
   * The IAM principal (i.e. `new ServicePrincipal('sns.amazonaws.com')`)
   * which can assume this role.
   *
   * You can later modify the assume role policy document by accessing it via
   * the `assumeRolePolicy` property.
   */
  readonly assumedBy: IPrincipal;

  /**
   * ID that the role assumer needs to provide when assuming this role
   *
   * If the configured and provided external IDs do not match, the
   * AssumeRole operation will fail.
   *
   * @deprecated see `externalIds`
   *
   * @default No external ID required
   */
  readonly externalId?: string;

  /**
   * List of IDs that the role assumer needs to provide one of when assuming this role
   *
   * If the configured and provided external IDs do not match, the
   * AssumeRole operation will fail.
   *
   * @default No external ID required
   */
  readonly externalIds?: string[];

  /**
   * A list of managed policies associated with this role.
   *
   * You can add managed policies later using
   * `addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName(policyName))`.
   *
   * @default - No managed policies.
   */
  readonly managedPolicies?: IManagedPolicy[];

  /**
   * A list of named policies to inline into this role. These policies will be
   * created with the role, whereas those added by ``addToPolicy`` are added
   * using a separate CloudFormation resource (allowing a way around circular
   * dependencies that could otherwise be introduced).
   *
   * @default - No policy is inlined in the Role resource.
   */
  readonly inlinePolicies?: { [name: string]: PolicyDocument };

  /**
   * The path associated with this role. For information about IAM paths, see
   * Friendly Names and Paths in IAM User Guide.
   *
   * @default /
   */
  readonly path?: string;

  /**
   * AWS supports permissions boundaries for IAM entities (users or roles).
   * A permissions boundary is an advanced feature for using a managed policy
   * to set the maximum permissions that an identity-based policy can grant to
   * an IAM entity. An entity's permissions boundary allows it to perform only
   * the actions that are allowed by both its identity-based policies and its
   * permissions boundaries.
   *
   * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-iam-role.html#cfn-iam-role-permissionsboundary
   * @link https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html
   *
   * @default - No permissions boundary.
   */
  readonly permissionsBoundary?: IManagedPolicy;

  /**
   * A name for the IAM role. For valid values, see the RoleName parameter for
   * the CreateRole action in the IAM API Reference.
   *
   * IMPORTANT: If you specify a name, you cannot perform updates that require
   * replacement of this resource. You can perform updates that require no or
   * some interruption. If you must replace the resource, specify a new name.
   *
   * Use [Terraform Resource Meta Arguments](https://developer.hashicorp.com/terraform/language/resources/syntax#meta-arguments)
   * to control lifecycle when replacing the role.
   *
   * See [IAM Identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/Using_Identifiers.html)
   * for more information
   *
   * @default - If omitted, Refer to `roleNamePrefix`.
   */
  readonly roleName?: string;

  /**
   * Creates a unique name beginning with the specified prefix.
   * Conflicts with `roleName`.
   *
   * IMPORTANT: If you specify a namePrefix, you cannot perform updates that require
   * replacement of this resource. You can perform updates that require no or
   * some interruption. If you must replace the resource, specify a new name.
   *
   * Use [Terraform Resource Meta Arguments](https://developer.hashicorp.com/terraform/language/resources/syntax#meta-arguments)
   * to control lifecycle when replacing the role.
   *
   * See [IAM Identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/Using_Identifiers.html)
   * for more information
   *
   * @default - If omitted, ET will assign a random, unique name prefixed by GridUUID.
   */
  readonly roleNamePrefix?: string;

  /**
   * The maximum session duration in seconds that you want to set for the specified role.
   * This setting can have a value from 1 hour (3600sec) to 12 (43200sec) hours.
   *
   * Anyone who assumes the role from the AWS CLI or API can use the
   * DurationSeconds API parameter or the duration-seconds CLI parameter to
   * request a longer session. The MaxSessionDuration setting determines the
   * maximum duration that can be requested using the DurationSeconds
   * parameter.
   *
   * If users don't specify a value for the DurationSeconds parameter, their
   * security credentials are valid for one hour by default. This applies when
   * you use the AssumeRole* API operations or the assume-role* CLI operations
   * but does not apply when you use those operations to create a console URL.
   *
   * @link https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use.html
   *
   * @default Duration.hours(1)
   */
  readonly maxSessionDuration?: Duration;

  /**
   * A description of the role. It can be up to 1000 characters long.
   *
   * @default - No description.
   */
  readonly description?: string;

  /**
   * Whether to force detaching any policies the role has before destroying it
   * If policies are attached to the role via the `aws_iam_policy_attachment`
   * resource and you are modifying the role `name` or `path`, this must be
   * set to `true` and applied before attempting the operation otherwise you
   * will encounter a `DeleteConflict` error.
   *
   * The `aws_iam_role_policy_attachment` resource (recommended) does not
   * have this requirement.
   *
   * NOTE: The `iam.Policy` uses `aws_iam_role_policy_attachment` under
   * the hood and this should not be a concern.
   *
   * @default - false
   */
  readonly forceDetachPolicies?: boolean;
}

/**
 * Options allowing customizing the behavior of `Role.fromRoleArn`.
 */
export interface FromRoleArnOptions {
  /**
   * Whether the imported role can be modified by attaching policy resources to it.
   *
   * @default true
   */
  readonly mutable?: boolean;

  /**
   * For immutable roles: add grants to resources instead of dropping them
   *
   * If this is `false` or not specified, grant permissions added to this role are ignored.
   * It is your own responsibility to make sure the role has the required permissions.
   *
   * If this is `true`, any grant permissions will be added to the resource instead.
   *
   * @default false
   */
  readonly addGrantsToResources?: boolean;

  /**
   * Any policies created by this role will use this value as their ID, if specified.
   * Specify this if importing the same role in multiple stacks, and granting it
   * different permissions in at least two stacks. If this is not specified
   * (or if the same name is specified in more than one stack),
   * a Terraform issue will result in the policy created in whichever stack
   * is deployed last overwriting the policies created by the others.
   *
   * @default 'Policy'
   */
  readonly defaultPolicyName?: string;
}

// TODO: support for pre-created roles?
// ref: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/aws-iam/lib/role.ts#L186
// NOTE: in TerraConstruct pre-created roles are passed in through the Grid, so this seems not needed.

/**
 * Options allowing customizing the behavior of `Role.fromRoleName`.
 */
export interface FromRoleNameOptions extends FromRoleArnOptions {}

/**
 * IAM Role
 *
 * Defines an IAM role. The role is created with an assume policy document associated with
 * the specified AWS service principal defined in `serviceAssumeRole`.
 */
export class Role extends AwsConstructBase implements IRole {
  /**
   * Import an external role by ARN.
   *
   * If the imported Role ARN is a Token (such as a
   * `CfnParameter.valueAsString` or a `Fn.importValue()`) *and* the referenced
   * role has a `path` (like `arn:...:role/AdminRoles/Alice`), the
   * `roleName` property will not resolve to the correct value. Instead it
   * will resolve to the first path component. We unfortunately cannot express
   * the correct calculation of the full path name as a CloudFormation
   * expression. In this scenario the Role ARN should be supplied without the
   * `path` in order to resolve the correct role resource.
   *
   * @param scope construct scope
   * @param id construct id
   * @param roleArn the ARN of the role to import
   * @param options allow customizing the behavior of the returned role
   */
  public static fromRoleArn(
    scope: Construct,
    id: string,
    roleArn: string,
    options: FromRoleArnOptions = {},
  ): IRole {
    const scopeStack = AwsStack.ofAwsConstruct(scope);
    const parsedArn = scopeStack.splitArn(
      roleArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    );
    const resourceName = parsedArn.resourceName!;
    const roleAccount = parsedArn.account;
    // service roles have an ARN like 'arn:aws:iam::<account>:role/service-role/<roleName>'
    // or 'arn:aws:iam::<account>:role/service-role/servicename.amazonaws.com/service-role/<roleName>'
    // we want to support these as well, so we just use the element after the last slash as role name
    const roleName = resourceName.split("/").pop()!;

    // if (getCustomizeRolesConfig(scope).enabled) {
    //   return new PrecreatedRole(scope, id, {
    //     rolePath: `${scope.node.path}/${id}`,
    //     role: new ImportedRole(scope, `Import${id}`, {
    //       account: roleAccount,
    //       roleArn,
    //       roleName,
    //       ...options,
    //     }),
    //   });
    // }

    if (
      options.addGrantsToResources !== undefined &&
      options.mutable !== false
    ) {
      throw new Error(
        "'addGrantsToResources' can only be passed if 'mutable: false'",
      );
    }

    const roleArnAndScopeStackAccountComparison = tokenCompareStrings(
      roleAccount ?? "",
      scopeStack.account,
    );
    const equalOrAnyUnresolved =
      roleArnAndScopeStackAccountComparison === TokenComparison.SAME ||
      roleArnAndScopeStackAccountComparison ===
        TokenComparison.BOTH_UNRESOLVED ||
      roleArnAndScopeStackAccountComparison === TokenComparison.ONE_UNRESOLVED;

    // if we are returning an immutable role then the 'importedRole' is just a throwaway construct
    // so give it a different id
    const mutableRoleId =
      options.mutable !== false && equalOrAnyUnresolved
        ? id
        : `MutableRole${id}`;
    const importedRole = new ImportedRole(scope, mutableRoleId, {
      roleArn,
      roleName,
      account: roleAccount,
      ...options,
    });

    // we only return an immutable Role if both accounts were explicitly provided, and different
    return options.mutable !== false && equalOrAnyUnresolved
      ? importedRole
      : new ImmutableRole(
          scope,
          id,
          importedRole,
          options.addGrantsToResources ?? false,
        );
  }

  /**
   * Return whether the given object is a Role
   */
  public static isRole(x: any): x is Role {
    return x !== null && typeof x === "object" && IAM_ROLE_SYMBOL in x;
  }

  /**
   * Import an external role by name.
   *
   * The imported role is assumed to exist in the same account as the account
   * the scope's containing Stack is being deployed to.

   * @param scope construct scope
   * @param id construct id
   * @param roleName the name of the role to import
   * @param options allow customizing the behavior of the returned role
   */
  public static fromRoleName(
    scope: Construct,
    id: string,
    roleName: string,
    options: FromRoleNameOptions = {},
  ) {
    return Role.fromRoleArn(
      scope,
      id,
      AwsStack.ofAwsConstruct(scope).formatArn({
        region: "",
        service: "iam",
        resource: "role",
        resourceName: roleName,
      }),
      options,
    );
  }

  // TODO: Support custom role creation
  // https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/aws-iam/lib/role.ts#L355

  public readonly grantPrincipal: IPrincipal = this;
  public readonly principalAccount: string | undefined = this.env.account;

  public readonly assumeRoleAction: string = "sts:AssumeRole";

  /**
   * The assume role policy document associated with this role.
   */
  public readonly assumeRolePolicy?: PolicyDocument;

  /**
   * Returns the ARN of this role.
   */
  public readonly roleArn: string;

  /**
   * Returns the name of the role.
   */
  public readonly roleName: string;

  /**
   * Returns the role.
   */
  public readonly policyFragment: PrincipalPolicyFragment;

  /**
   * Returns the permissions boundary attached to this role
   */
  public readonly permissionsBoundary?: IManagedPolicy;

  /** Strongly typed Outputs */
  public get roleOutputs(): RoleOutputs {
    return {
      arn: this.roleArn,
      name: this.roleName,
    };
  }
  public get outputs(): Record<string, any> {
    return this.roleOutputs;
  }
  /**
   * Direct access to the underlying Terraform resource.
   */
  public readonly resource: iamRole.IamRole;
  private defaultPolicy?: Policy;
  private readonly managedPolicies: IManagedPolicy[] = [];
  private readonly attachedPolicies = new AttachedPolicies();
  private readonly inlinePolicies: { [name: string]: PolicyDocument };
  // private readonly dependables = new Map<PolicyStatement, DependencyGroup>();
  private immutableRole?: IRole;
  // private _didSplit = false;
  private readonly _roleId: string;

  constructor(scope: Construct, id: string, props: RoleProps) {
    super(scope, id, props);

    if (
      props.roleName &&
      !Token.isUnresolved(props.roleName) &&
      !/^[\w+=,.@-]{1,64}$/.test(props.roleName)
    ) {
      throw new Error(
        "Invalid roleName. The name must be a string of characters consisting of upper and lowercase alphanumeric characters with no spaces. You can also include any of the following characters: _+=,.@-. Length must be between 1 and 64 characters.",
      );
    }

    if (props.roleName && props.roleNamePrefix) {
      throw new Error(
        "Cannot specify both 'roleName' and 'roleNamePrefix'. Use only one.",
      );
    }

    const externalIds = props.externalIds || [];
    if (props.externalId) {
      externalIds.push(props.externalId);
    }

    this.assumeRolePolicy = createAssumeRolePolicy(
      this,
      "AssumeRolePolicy",
      props.assumedBy,
      externalIds,
    );
    this.managedPolicies.push(...(props.managedPolicies || []));
    this.inlinePolicies = props.inlinePolicies || {};
    this.permissionsBoundary = props.permissionsBoundary;
    const maxSessionDuration =
      props.maxSessionDuration && props.maxSessionDuration.toSeconds();
    validateMaxSessionDuration(maxSessionDuration);
    const description =
      props.description && props.description?.length > 0
        ? props.description
        : undefined;

    if (description && description.length > 1000) {
      throw new Error(
        "Role description must be no longer than 1000 characters.",
      );
    }

    validateRolePath(props.path);

    // pre-created role snipped
    // https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/aws-iam/lib/role.ts#L439

    const namePrefix = this.stack.uniqueResourceNamePrefix(this, {
      prefix: props.roleNamePrefix ?? this.gridUUID + "-",
      allowedSpecialCharacters: "_+=,.@-",
      maxLength: 64,
    });

    this.resource = new iamRole.IamRole(this, "Resource", {
      ...props, // copy over Terraform Meta Arguments from ConstructProps
      assumeRolePolicy: this.assumeRolePolicy.json,
      managedPolicyArns: UniqueStringSet.from(() =>
        this.managedPolicies.map((p) => p.managedPolicyArn),
      ),
      inlinePolicy: _flatten(this.inlinePolicies),
      path: props.path,
      permissionsBoundary: this.permissionsBoundary
        ? this.permissionsBoundary.managedPolicyArn
        : undefined,
      name: props.roleName,
      namePrefix: !props.roleName ? namePrefix : undefined,
      maxSessionDuration,
      description,
      forceDetachPolicies: props.forceDetachPolicies,
    });

    // Stable and unique string identifying the role.
    this._roleId = this.resource.uniqueId;

    // TODO: Need to handle cross env ARN refs?
    // CDK: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/core/lib/resource.ts#L288
    this.roleArn = this.resource.arn;
    // TODO: Need to handle cross env Name refs?
    // CDK: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/core/lib/resource.ts#L254
    this.roleName = this.resource.name;

    // TODO: Re-add policy splitting?
    // Aspects.of(this).add({
    //   visit: (c) => {
    //     if (c === this) {
    //       this.splitLargePolicy();
    //     }
    //   },
    // });

    this.policyFragment = new ArnPrincipal(this.roleArn).policyFragment;

    function _flatten(policies?: { [name: string]: PolicyDocument }) {
      if (policies == null || Object.keys(policies).length === 0) {
        return undefined;
      }
      const result = new Array<iamRole.IamRoleInlinePolicy>();
      for (const policyName of Object.keys(policies)) {
        const policyDocument = policies[policyName];
        result.push({
          name: policyName,
          policy: policyDocument.json,
        });
      }
      return result;
    }

    this.node.addValidation({ validate: () => this.validateRole() });
  }

  /**
   * Adds a permission to the role's default policy document.
   * If there is no default policy attached to this role, it will be created.
   * @param statement The permission statement to add to the policy document
   */
  public addToPrincipalPolicy(
    statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    if (!this.defaultPolicy) {
      this.defaultPolicy = new Policy(this, "DefaultPolicy");
      this.attachInlinePolicy(this.defaultPolicy);
    }
    this.defaultPolicy.addStatements(statement);

    // // We might split this statement off into a different policy, so we'll need to
    // // late-bind the dependable.
    // const policyDependable = new DependencyGroup();
    // this.dependables.set(statement, policyDependable);

    return { statementAdded: true, policyDependable: this };
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  /**
   * Attaches a managed policy to this role.
   *
   * NOTE: Using this method will force the role to take over
   * exclusive management of the role's ManagedPolicy attachments
   * These arguments are incompatible with other ways of managing
   * a role's such as attaching the policy to the role through its
   * `policy.attachToRole(role)` method.
   *
   * If you attempt to manage a role's policies by multiple means,
   * you will get resource cycling and/or errors.
   *
   * ```typescript
   * const policy1 = new iam.ManagedPolicy(this, 'Policy', {
   *   managedPolicyName: 'MyPolicy1',
   *   description: 'A description of the policy',
   * });
   * const policy2 = new iam.ManagedPolicy(this, 'Policy', {
   *   managedPolicyName: 'MyPolicy2',
   *   description: 'A description of the policy',
   * });
   *
   * const role = new iam.Role(this, 'Role', {
   *  assumedBy: new iam.ServicePrincipal('sns.amazonaws.com'),
   * });
   * // role becomes the manager of all attached policies
   * role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecurityAudit'));
   * role.addManagedPolicy(policy1);
   *
   * // this introduces resource cycling
   * // DON'T DO THIS
   * policy2.attachToRole(role);
   *
   * // DO THIS INSTEAD
   * role.addManagedPolicy(policy2);
   * ```
   * @param policy The the managed policy to attach.
   */
  public addManagedPolicy(policy: IManagedPolicy) {
    if (
      this.managedPolicies.some(
        (mp) => mp.managedPolicyArn === policy.managedPolicyArn,
      )
    ) {
      return;
    }
    this.managedPolicies.push(policy);
  }

  /**
   * Attaches a policy to this role.
   *
   * NOTE: Using this method will force the role to take over
   * exclusive management of the role's inline Policy attachments
   * These arguments are incompatible with other ways of managing
   * a role's such as attaching a policy to the role.
   * If you attempt to manage a role's policies by multiple means,
   * you will get resource cycling and/or errors.
   *
   * @param policy The policy to attach
   */
  public attachInlinePolicy(policy: Policy) {
    this.attachedPolicies.attach(policy);
    policy.attachToRole(this);
  }

  /**
   * Grant the actions defined in actions to the identity Principal on this resource.
   */
  public grant(grantee: IPrincipal, ...actions: string[]) {
    return Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [this.roleArn],
      scope: this,
    });
  }

  /**
   * Grant permissions to the given principal to pass this role.
   */
  public grantPassRole(identity: IPrincipal) {
    return this.grant(identity, "iam:PassRole");
  }

  /**
   * Grant permissions to the given principal to assume this role.
   */
  public grantAssumeRole(identity: IPrincipal) {
    // Service and account principals must use assumeRolePolicy
    if (
      identity instanceof ServicePrincipal ||
      identity instanceof AccountPrincipal
    ) {
      throw new Error(
        "Cannot use a service or account principal with grantAssumeRole, use assumeRolePolicy instead.",
      );
    }
    return this.grant(identity, "sts:AssumeRole");
  }

  /**
   * Returns the stable and unique string identifying the role. For example,
   * AIDAJQABLZS4A3QDU576Q.
   *
   * @attribute
   */
  public get roleId(): string {
    return this._roleId;
  }

  /**
   * Return a copy of this Role object whose Policies will not be updated
   *
   * Use the object returned by this method if you want this Role to be used by
   * a construct without it automatically updating the Role's Policies.
   *
   * If you do, you are responsible for adding the correct statements to the
   * Role's policies yourself.
   */
  public withoutPolicyUpdates(
    options: WithoutPolicyUpdatesOptions = {},
  ): IRole {
    if (!this.immutableRole) {
      this.immutableRole = new ImmutableRole(
        this.node.scope as Construct,
        `ImmutableRole${this.node.id}`,
        this,
        options.addGrantsToResources ?? false,
      );
    }

    return this.immutableRole;
  }

  private validateRole(): string[] {
    const errors = new Array<string>();
    errors.push(...(this.assumeRolePolicy?.validateForResourcePolicy() ?? []));
    for (const policy of Object.values(this.inlinePolicies)) {
      errors.push(...policy.validateForIdentityPolicy());
    }

    return errors;
  }

  // /**
  //  * Split large inline policies into managed policies
  //  *
  //  * This gets around the 10k bytes limit on role policies.
  //  */
  // private splitLargePolicy() {
  //   if (!this.defaultPolicy || this._didSplit) {
  //     return;
  //   }
  //   this._didSplit = true;

  //   const self = this;
  //   const originalDoc = this.defaultPolicy.document;

  //   const splitOffDocs = originalDoc._splitDocument(
  //     this,
  //     MAX_INLINE_SIZE,
  //     MAX_MANAGEDPOL_SIZE,
  //   );
  //   // Includes the "current" document

  //   const mpCount = this.managedPolicies.length + (splitOffDocs.size - 1);
  //   if (mpCount > 20) {
  //     Annotations.of(this).addWarningV2(
  //       "@aws-cdk/aws-iam:rolePolicyTooLarge",
  //       `Policy too large: ${mpCount} exceeds the maximum of 20 managed policies attached to a Role`,
  //     );
  //   } else if (mpCount > 10) {
  //     Annotations.of(this).addWarningV2(
  //       "@aws-cdk/aws-iam:rolePolicyLarge",
  //       `Policy large: ${mpCount} exceeds 10 managed policies attached to a Role, this requires a quota increase`,
  //     );
  //   }

  //   // Create the managed policies and fix up the dependencies
  //   markDeclaringConstruct(originalDoc, this.defaultPolicy);

  //   let i = 1;
  //   for (const newDoc of splitOffDocs.keys()) {
  //     if (newDoc === originalDoc) {
  //       continue;
  //     }

  //     const mp = new AwsManagedPolicy(this, `OverflowPolicy${i++}`, {
  //       description: `Part of the policies for ${this.node.path}`,
  //       document: newDoc,
  //       roles: [this],
  //     });
  //     markDeclaringConstruct(newDoc, mp);
  //   }

  //   /**
  //    * Update the Dependables for the statements in the given PolicyDocument to point to the actual declaring construct
  //    */
  //   function markDeclaringConstruct(
  //     doc: PolicyDocument,
  //     declaringConstruct: IConstruct,
  //   ) {
  //     for (const original of splitOffDocs.get(doc) ?? []) {
  //       self.dependables.get(original)?.add(declaringConstruct);
  //     }
  //   }
  // }
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface RoleOutputs {
  readonly arn: string;
  readonly name: string;
}

/**
 * A Role object
 */
export interface IRole extends IIdentity {
  /**
   * strongly typed roleOutputs
   *
   * @attribute
   */
  readonly roleOutputs: RoleOutputs;
  /**
   * Returns the ARN of this role.
   *
   * @attribute
   */
  readonly roleArn: string;

  /**
   * Returns the name of this role.
   *
   * @attribute
   */
  readonly roleName: string;

  /**
   * Grant the actions defined in actions to the identity Principal on this resource.
   */
  grant(grantee: IPrincipal, ...actions: string[]): Grant;

  /**
   * Grant permissions to the given principal to pass this role.
   */
  grantPassRole(grantee: IPrincipal): Grant;

  /**
   * Grant permissions to the given principal to assume this role.
   */
  grantAssumeRole(grantee: IPrincipal): Grant;
}

function createAssumeRolePolicy(
  scope: Construct,
  id: string,
  principal: IPrincipal,
  externalIds: string[],
) {
  const actualDoc = new PolicyDocument(scope, id);

  // If requested, add externalIds to every statement added to this doc
  const addDoc =
    externalIds.length === 0
      ? actualDoc
      : new MutatingPolicyDocumentAdapter(actualDoc, (statement) => {
          statement.addCondition({
            test: "StringEquals",
            variable: "sts:ExternalId",
            values: externalIds,
          });
          return statement;
        });

  defaultAddPrincipalToAssumeRole(principal, addDoc);

  return actualDoc;
}

function validateRolePath(path?: string) {
  if (path === undefined || Token.isUnresolved(path)) {
    return;
  }

  const validRolePath = /^(\/|\/[\u0021-\u007F]+\/)$/;

  if (path.length == 0 || path.length > 512) {
    throw new Error(
      `Role path must be between 1 and 512 characters. The provided role path is ${path.length} characters.`,
    );
  } else if (!validRolePath.test(path)) {
    throw new Error(
      "Role path must be either a slash or valid characters (alphanumerics and symbols) surrounded by slashes. " +
        `Valid characters are unicode characters in [\\u0021-\\u007F]. However, ${path} is provided.`,
    );
  }
}

function validateMaxSessionDuration(duration?: number) {
  if (duration === undefined) {
    return;
  }

  if (duration < 3600 || duration > 43200) {
    throw new Error(
      `maxSessionDuration is set to ${duration}, but must be >= 3600sec (1hr) and <= 43200sec (12hrs)`,
    );
  }
}

/**
 * Options for the `withoutPolicyUpdates()` modifier of a Role
 */
export interface WithoutPolicyUpdatesOptions {
  /**
   * Add grants to resources instead of dropping them
   *
   * If this is `false` or not specified, grant permissions added to this role are ignored.
   * It is your own responsibility to make sure the role has the required permissions.
   *
   * If this is `true`, any grant permissions will be added to the resource instead.
   *
   * @default false
   */
  readonly addGrantsToResources?: boolean;
}

Object.defineProperty(Role.prototype, IAM_ROLE_SYMBOL, {
  value: true,
  enumerable: false,
  writable: false,
});
