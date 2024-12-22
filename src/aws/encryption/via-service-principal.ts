// https://github.com/aws/aws-cdk/blob/2.170.0/packages/aws-cdk-lib/aws-kms/lib/via-service-principal.ts

import * as iam from "../iam";

/**
 * A principal to allow access to a key if it's being used through another AWS service
 */
export class ViaServicePrincipal extends iam.PrincipalBase {
  private readonly basePrincipal: iam.IPrincipal;

  constructor(
    private readonly serviceName: string,
    basePrincipal?: iam.IPrincipal,
  ) {
    super();
    this.basePrincipal = basePrincipal ? basePrincipal : new iam.AnyPrincipal();
  }

  public get policyFragment(): iam.PrincipalPolicyFragment {
    // Make a copy of the base policyFragment to add a condition to it
    const base = this.basePrincipal.policyFragment;
    const conditions = [...base.conditions];
    const principals = [...base.principals];

    conditions.push({
      test: "StringEquals",
      variable: "kms:ViaService",
      values: [this.serviceName],
    });

    return new iam.PrincipalPolicyFragment(principals, conditions);
  }

  public dedupeString(): string | undefined {
    const base = iam.ComparablePrincipal.dedupeStringFor(this.basePrincipal);
    return base !== undefined
      ? `ViaServicePrincipal:${this.serviceName}:${base}`
      : undefined;
  }
}
