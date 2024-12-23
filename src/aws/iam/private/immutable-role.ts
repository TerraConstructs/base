import { Construct, Dependable } from "constructs";
import { AwsConstructBase, AwsStack } from "../..";
import { Grant } from "../grant";
import { IManagedPolicy } from "../managed-policy";
import { Policy } from "../policy";
import { PolicyStatement } from "../policy-statement";
import {
  AddToPrincipalPolicyResult,
  IPrincipal,
  PrincipalPolicyFragment,
} from "../principals";
import { IRole, RoleOutputs } from "../role";

/**
 * An immutable wrapper around an IRole
 *
 * This wrapper ignores all mutating operations, like attaching policies or
 * adding policy statements.
 *
 * Useful in cases where you want to turn off CDK's automatic permissions
 * management, and instead have full control over all permissions.
 *
 * Note: if you want to ignore all mutations for an externally defined role
 * which was imported into the CDK with `Role.fromRoleArn`, you don't have to use this class -
 * simply pass the property mutable = false when calling `Role.fromRoleArn`.
 */
export class ImmutableRole extends AwsConstructBase implements IRole {
  public readonly assumeRoleAction: string;
  public readonly policyFragment: PrincipalPolicyFragment;
  public readonly grantPrincipal = this;
  public readonly principalAccount: string | undefined;
  public readonly roleArn: string;
  public readonly roleName: string;
  public readonly stack: AwsStack;

  private readonly _roleOutputs: RoleOutputs;
  public get roleOutputs(): RoleOutputs {
    return this._roleOutputs;
  }
  public get outputs() {
    return this.roleOutputs;
  }

  private readonly role: IRole;

  constructor(
    scope: Construct,
    id: string,
    role: IRole,
    private readonly addGrantsToResources: boolean,
  ) {
    super(scope, id, {
      account: role.env.account,
      region: role.env.region,
    });
    this.role = role;
    this.assumeRoleAction = role.assumeRoleAction;
    this.policyFragment = this.role.policyFragment;
    this.principalAccount = this.role.principalAccount;
    this.roleArn = this.role.roleArn;
    this.roleName = this.role.roleName;
    this.stack = this.role.stack;
    // implement IDependable privately
    Dependable.implement(this, {
      dependencyRoots: [role],
    });
    this.node.defaultChild = role.node.defaultChild;
    this._roleOutputs = this.role.roleOutputs;
  }

  public attachInlinePolicy(_policy: Policy): void {
    // do nothing
  }

  public addManagedPolicy(_policy: IManagedPolicy): void {
    // do nothing
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  public addToPrincipalPolicy(
    _statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    // If we return `false`, the grants will try to add the statement to the resource
    // (if possible).
    const pretendSuccess = !this.addGrantsToResources;
    return {
      statementAdded: pretendSuccess,
      policyDependable: this.role,
    };
  }

  public grant(grantee: IPrincipal, ...actions: string[]): Grant {
    return this.role.grant(grantee, ...actions);
  }

  public grantPassRole(grantee: IPrincipal): Grant {
    return this.role.grantPassRole(grantee);
  }

  public grantAssumeRole(identity: IPrincipal): Grant {
    return this.role.grantAssumeRole(identity);
  }
}
