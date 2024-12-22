// ref: https://github.com/aws/aws-cdk/tree/v2.161.1/packages/aws-cdk-lib/aws-iam/lib/policy-document.ts
// CAVEAT: instead of using IResolvable, this is a Construct and its constructor requires scope and id
// This synths directly to the terraform-provider-aws `aws_iam_policy_document` data source.
// This is not undefined when the policy document is empty.
// TODO: Add validation and errors for empty policy documents
import { dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { Lazy, IResolveContext } from "cdktf";
import { Construct } from "constructs";
import { PolicyDocumentConfig } from "./policy-document-config.generated";
import { PolicyStatement } from "./policy-statement";
import { AwsBeaconBase, IAwsBeacon } from "../beacon";
import { mergeStatements } from "./private/merge-statements";
import { PostProcessPolicyDocument } from "./private/postprocess-policy-document";

export interface PolicyDocumentOutputs {
  /**
   * The policy document JSON
   */
  readonly policy: any;
}

export interface IPolicyDocument extends IAwsBeacon {
  // strongly typed access to outputs
  readonly policyDocumentOutputs: PolicyDocumentOutputs;
  readonly isEmpty: boolean;
  readonly statementCount: number;
  readonly json: string;
  /**
   * Adds a statement to the policy document.
   *
   * @param statement the statement to add.
   */
  addStatements(...statement: PolicyStatement[]): void;
  /**
   * Validate that all policy statements in the policy document satisfies the
   * requirements for any policy.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policies-json
   *
   * @returns An array of validation error messages, or an empty array if the document is valid.
   */
  validateForAnyPolicy(): string[];
  /**
   * Validate that all policy statements in the policy document satisfies the
   * requirements for a resource-based policy.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policies-json
   *
   * @returns An array of validation error messages, or an empty array if the document is valid.
   */
  validateForResourcePolicy(): string[] /**
   * Validate that all policy statements in the policy document satisfies the
   * requirements for an identity-based policy.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policies-json
   *
   * @returns An array of validation error messages, or an empty array if the document is valid.
   */;
  validateForIdentityPolicy(): string[];
  /**
   * Get AWS IAM Policy document JSON
   *
   * NOTE: This may contain unresolved tokens, use spec.resolve() to resolve them.
   */
  toDocumentJson(): any;
}

export interface PolicyDocumentProps extends PolicyDocumentConfig {
  /**
   * Try to minimize the policy by merging statements
   *
   * To avoid overrunning the maximum policy size, combine statements if they produce
   * the same result. Merging happens according to the following rules:
   *
   * - The Effect of both statements is the same
   * - Neither of the statements have a 'Sid'
   * - Combine Principals if the rest of the statement is exactly the same.
   * - Combine Resources if the rest of the statement is exactly the same.
   * - Combine Actions if the rest of the statement is exactly the same.
   * - We will never combine NotPrincipals, NotResources or NotActions, because doing
   *   so would change the meaning of the policy document.
   *
   * @default - false, unless the feature flag `@aws-cdk/aws-iam:minimizePolicies` is set
   */
  readonly minimize?: boolean;
  /**
   * Automatically assign Statement Ids to all statements
   *
   * @default false
   */
  readonly assignSids?: boolean;
}

export class PolicyDocument extends AwsBeaconBase implements IPolicyDocument {
  /**
   * Creates a new PolicyDocument based on the object provided.
   * This will accept an object created from the `.toDocumentJson()` call
   * @param obj the PolicyDocument in object form.
   */
  public static fromJson(
    scope: Construct,
    id: string,
    obj: any,
  ): PolicyDocument {
    const newPolicyDocument = new PolicyDocument(scope, id);
    const statement = obj.Statement ?? [];
    if (statement && !Array.isArray(statement)) {
      throw new Error("Statement must be an array");
    }
    newPolicyDocument.addStatements(
      ...statement.map((s: any) => PolicyStatement.fromJson(s)),
    );
    return newPolicyDocument;
  }

  public readonly statements = new Array<PolicyStatement>();
  public readonly resource: dataAwsIamPolicyDocument.DataAwsIamPolicyDocument;
  // private readonly autoAssignSids: boolean;
  // private readonly minimize?: boolean;

  public get policyDocumentOutputs(): PolicyDocumentOutputs {
    return { policy: this.json };
  }
  public get outputs(): Record<string, any> {
    return this.policyDocumentOutputs;
  }

  public get json(): string {
    return this.resource.json;
  }
  private readonly autoAssignSids: boolean;
  private readonly minimize?: boolean;

  constructor(scope: Construct, id: string, props: PolicyDocumentProps = {}) {
    super(scope, id, props);
    this.autoAssignSids = !!props.assignSids;
    this.minimize = props.minimize ?? false;
    this.addStatements(...(props.statement || []));
    const self = this;
    // TODO: move in toTerraform() and don't generate anything if isEmpty()?
    this.resource = new dataAwsIamPolicyDocument.DataAwsIamPolicyDocument(
      this,
      "Resource",
      {
        ...props,
        statement: Lazy.anyValue({
          produce: (context: IResolveContext) => {
            this._maybeMergeStatements();
            context.registerPostProcessor(
              new PostProcessPolicyDocument(self.autoAssignSids),
            );
            return this.statements.map((s) =>
              dataAwsIamPolicyDocument.dataAwsIamPolicyDocumentStatementToTerraform(
                s.toJSON(),
              ),
            );
          },
        }),
      },
    );
  }

  /**
   * Perform statement merging (if enabled and not done yet)
   *
   * @internal
   */
  public _maybeMergeStatements(): void {
    if (this.minimize && this.statements.length > 1) {
      const result = mergeStatements(this.statements, { scope: this });
      this.statements.splice(
        0,
        this.statements.length,
        ...result.mergedStatements,
      );
    }
  }

  // /**
  //  * JSON-ify the document
  //  *
  //  * Used when JSON.stringify() is called
  //  */
  // public toJSON(): any {
  //   return {
  //     statement: this.statements.map((s) => s.toJSON()),
  //   };
  // }

  //TODO: Caution - toTerraform() returns nothing by design!
  // Adding toTerraform() will cause infinite recursion

  /**
   * Get AWS IAM Policy document JSON
   *
   * NOTE: May contain tokens, use spec.resolve() to resolve them.
   */
  public toDocumentJson(): any {
    if (this.isEmpty) {
      return undefined;
    }

    // merge resolved statements
    this._maybeMergeStatements();
    const doc = {
      Statement: this.statements.map((s) => s.toStatementJson()),
      Version: "2012-10-17",
    };

    return doc;
  }

  /**
   * Whether the policy document contains any statements.
   */
  public get isEmpty(): boolean {
    return this.statements.length === 0;
  }

  /**
   * The number of statements already added to this policy.
   * Can be used, for example, to generate unique "sid"s within the policy.
   */
  public get statementCount(): number {
    return this.statements.length;
  }

  /**
   * Adds a statement to the policy document.
   *
   * @param statement the statement to add.
   */
  public addStatements(...statement: PolicyStatement[]) {
    this.statements.push(...statement);
  }

  /**
   * Validate that all policy statements in the policy document satisfies the
   * requirements for any policy.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policies-json
   *
   * @returns An array of validation error messages, or an empty array if the document is valid.
   */
  public validateForAnyPolicy(): string[] {
    const errors = new Array<string>();
    for (const statement of this.statements) {
      errors.push(...statement.validateForAnyPolicy());
    }
    return errors;
  }

  /**
   * Validate that all policy statements in the policy document satisfies the
   * requirements for a resource-based policy.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policies-json
   *
   * @returns An array of validation error messages, or an empty array if the document is valid.
   */
  public validateForResourcePolicy(): string[] {
    const errors = new Array<string>();
    for (const statement of this.statements) {
      errors.push(...statement.validateForResourcePolicy());
    }
    return errors;
  }

  /**
   * Validate that all policy statements in the policy document satisfies the
   * requirements for an identity-based policy.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#access_policies-json
   *
   * @returns An array of validation error messages, or an empty array if the document is valid.
   */
  public validateForIdentityPolicy(): string[] {
    const errors = new Array<string>();
    for (const statement of this.statements) {
      errors.push(...statement.validateForIdentityPolicy());
    }
    return errors;
  }

  // /**
  //  * Freeze all statements
  //  */
  // private freezeStatements() {
  //   for (const statement of this.statements) {
  //     statement.freeze();
  //   }
  // }
}
