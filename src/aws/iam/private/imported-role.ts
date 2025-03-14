import { Annotations } from "cdktf";
import { Construct } from "constructs";
import { TokenComparison, tokenCompareStrings } from "../../../token";
import { AwsConstructBase } from "../../aws-construct";
import { Grant } from "../grant";
import { IManagedPolicy } from "../managed-policy";
import { Policy, IPolicy } from "../policy";
import { PolicyStatement } from "../policy-statement";
import {
  IComparablePrincipal,
  IPrincipal,
  ArnPrincipal,
  AddToPrincipalPolicyResult,
  PrincipalPolicyFragment,
} from "../principals";
import { IRole, FromRoleArnOptions, RoleOutputs } from "../role";

export interface ImportedRoleProps extends FromRoleArnOptions {
  readonly roleArn: string;
  readonly roleName: string;
  readonly account?: string;
}

export class ImportedRole
  extends AwsConstructBase
  implements IRole, IComparablePrincipal
{
  public readonly grantPrincipal: IPrincipal = this;
  public readonly principalAccount?: string;
  public readonly assumeRoleAction: string = "sts:AssumeRole";
  public readonly policyFragment: PrincipalPolicyFragment;
  public readonly roleArn: string;
  public readonly roleName: string;
  private readonly attachedPolicies = new AttachedPolicies();
  private readonly defaultPolicyName?: string;
  private defaultPolicy?: Policy;

  private _roleOutputs: RoleOutputs;
  public get roleOutputs(): RoleOutputs {
    return this._roleOutputs;
  }
  public get outputs() {
    return this.roleOutputs;
  }

  constructor(scope: Construct, id: string, props: ImportedRoleProps) {
    super(scope, id, {
      account: props.account,
    });
    this.roleArn = props.roleArn;
    this.roleName = props.roleName;
    this.policyFragment = new ArnPrincipal(this.roleArn).policyFragment;
    this.defaultPolicyName = props.defaultPolicyName;
    this.principalAccount = props.account;
    this._roleOutputs = {
      name: this.roleName,
      arn: this.roleArn,
    };
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  public addToPrincipalPolicy(
    statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    if (!this.defaultPolicy) {
      this.defaultPolicy = new Policy(
        this,
        this.defaultPolicyName ?? "Policy",
        {
          policyName: undefined, // let the policy name be auto-generated
        },
      );
      this.attachInlinePolicy(this.defaultPolicy);
    }
    this.defaultPolicy.addStatements(statement);
    return { statementAdded: true, policyDependable: this.defaultPolicy };
  }

  public attachInlinePolicy(policy: Policy): void {
    const thisAndPolicyAccountComparison = tokenCompareStrings(
      this.env.account,
      policy.env.account,
    );
    const equalOrAnyUnresolved =
      thisAndPolicyAccountComparison === TokenComparison.SAME ||
      thisAndPolicyAccountComparison === TokenComparison.BOTH_UNRESOLVED ||
      thisAndPolicyAccountComparison === TokenComparison.ONE_UNRESOLVED;
    if (equalOrAnyUnresolved) {
      this.attachedPolicies.attach(policy);
      policy.attachToRole(this);
    }
  }

  public addManagedPolicy(policy: IManagedPolicy): void {
    Annotations.of(this).addWarning(
      `Not adding managed policy: ${policy.managedPolicyArn} to imported role: ${this.roleName}`,
    );
  }

  public grantPassRole(identity: IPrincipal): Grant {
    return this.grant(identity, "iam:PassRole");
  }

  public grantAssumeRole(identity: IPrincipal): Grant {
    return this.grant(identity, "sts:AssumeRole");
  }

  public grant(grantee: IPrincipal, ...actions: string[]): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [this.roleArn],
      scope: this,
    });
  }

  public dedupeString(): string | undefined {
    return `ImportedRole:${this.roleArn}`;
  }
}

/**
 * Helper class that maintains the set of attached policies for a principal.
 */
export class AttachedPolicies {
  private policies = new Array<IPolicy>();

  /**
   * Adds a policy to the list of attached policies.
   *
   * If this policy is already, attached, returns false.
   * If there is another policy attached with the same name, throws an exception.
   */
  public attach(policy: IPolicy) {
    if (this.policies.find((p) => p === policy)) {
      return; // already attached
    }

    if (this.policies.find((p) => p.policyName === policy.policyName)) {
      throw new Error(
        `A policy named "${policy.policyName}" is already attached`,
      );
    }

    this.policies.push(policy);
  }
}
