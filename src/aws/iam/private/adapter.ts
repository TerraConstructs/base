import { AwsBeaconBase } from "../../beacon";
import { IPolicyDocument, PolicyDocumentOutputs } from "../policy-document";
import { PolicyStatement } from "../policy-statement";

/**
 * A PolicyDocument adapter that can modify statements flowing through it
 */
export class MutatingPolicyDocumentAdapter
  extends AwsBeaconBase
  implements IPolicyDocument
{
  constructor(
    private readonly wrapped: IPolicyDocument,
    private readonly mutator: (s: PolicyStatement) => PolicyStatement,
  ) {
    if (wrapped.node.scope === undefined) {
      throw new Error("The wrapped PolicyDocument must have a scope");
    }
    super(wrapped.node.scope, `Mutating${wrapped.node.id}`, {});
  }
  public get policyDocumentOutputs(): PolicyDocumentOutputs {
    return this.wrapped.policyDocumentOutputs;
  }
  public get isEmpty(): boolean {
    return this.wrapped.isEmpty;
  }
  public get outputs() {
    return this.wrapped.outputs;
  }
  public get statementCount(): number {
    return this.wrapped.statementCount;
  }
  public get json(): string {
    return this.wrapped.json;
  }
  public addStatements(...statements: PolicyStatement[]): void {
    for (const st of statements) {
      this.wrapped.addStatements(this.mutator(st));
    }
  }
  public validateForAnyPolicy(): string[] {
    return this.wrapped.validateForAnyPolicy();
  }
  public validateForIdentityPolicy(): string[] {
    return this.wrapped.validateForIdentityPolicy();
  }
  public validateForResourcePolicy(): string[] {
    return this.wrapped.validateForResourcePolicy();
  }
  public toDocumentJson(): any {
    return this.wrapped.toDocumentJson();
  }
}
