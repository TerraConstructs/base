import { Token, IResolvable, IResolveContext } from "cdktf";
import { IDependable } from "constructs";
import { AwsSpec } from "../spec";
import { IOpenIdConnectProvider } from "./oidc-provider";
import { IPolicyDocument } from "./policy-document";
import {
  PolicyStatement,
  Condition,
  Conditions,
  isStringOrArrayOfStrings,
  toConditionJson,
  fromConditionJson,
  validateConditionObject,
  ConditionMap,
  toConditions,
} from "./policy-statement";
import { ISamlProvider } from "./saml-provider";
/**
 * Terraform Principal Props
 *
 * The `principals` and `not_principals` blocks of a policy statement
 *
 * Ref: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document#principals-and-not_principals
 */
export interface PrincipalProps {
  /**
   * List of identifiers for principals.
   *
   * When type is AWS, these are IAM principal ARNs, e.g., arn:aws:iam::12345678901:role/yak-role.
   *
   * When type is Service, these are AWS Service roles, e.g., lambda.amazonaws.com.
   *
   * When type is Federated, these are web identity users or SAML provider ARNs,
   * e.g., accounts.google.com or arn:aws:iam::12345678901:saml-provider/yak-saml-provider.
   *
   * When type is CanonicalUser, these are canonical user IDs,
   * e.g., 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be.
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/data-sources/iam_policy_document#identifiers DataAwsIamPolicyDocument#identifiers}
   */
  readonly identifiers: string[];
  /**
   * Type of principal.
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/data-sources/iam_policy_document#type DataAwsIamPolicyDocument#type}
   */
  readonly type: PrincipalType;
}

export enum PrincipalType {
  AWS = "AWS",
  FEDERATED = "Federated",
  SERVICE = "Service",
  CANONICALUSER = "CanonicalUser",
  ANY = "*",
}

function isValidPrincipalType(value: string): boolean {
  const upperCaseValue = value.toUpperCase();
  return upperCaseValue in PrincipalType;
}

/**
 * Any object that has an associated principal that a permission can be granted to
 */
export interface IGrantable {
  /**
   * The principal to grant permissions to
   */
  readonly grantPrincipal: IPrincipal;
}

/**
 * Represents a logical IAM principal.
 *
 * An IPrincipal describes a logical entity that can perform AWS API calls
 * against sets of resources, optionally under certain conditions.
 *
 * Examples of simple principals are IAM objects that you create, such
 * as Users or Roles.
 *
 * An example of a more complex principals is a `ServicePrincipal` (such as
 * `new ServicePrincipal("sns.amazonaws.com")`, which represents the Simple
 * Notifications Service).
 *
 * A single logical Principal may also map to a set of physical principals.
 * For example, `new OrganizationPrincipal('o-1234')` represents all
 * identities that are part of the given AWS Organization.
 */
export interface IPrincipal extends IGrantable {
  /**
   * When this Principal is used in an AssumeRole policy, the action to use.
   */
  readonly assumeRoleAction: string;

  /**
   * Return the policy fragment that identifies this principal in a Policy.
   */
  readonly policyFragment: PrincipalPolicyFragment;

  /**
   * The AWS account ID of this principal.
   * Can be undefined when the account is not known
   * (for example, for service principals).
   * Can be a Token - in that case,
   * it's assumed to be a reference to the DataAwsCallerIdentity
   */
  readonly principalAccount?: string;

  /**
   * Add to the policy of this principal.
   *
   * @returns true if the statement was added, false if the principal in
   * question does not have a policy document to add the statement to.
   *
   * @deprecated Use `addToPrincipalPolicy` instead.
   */
  addToPolicy(statement: PolicyStatement): boolean;

  /**
   * Add to the policy of this principal.
   */
  addToPrincipalPolicy(statement: PolicyStatement): AddToPrincipalPolicyResult;
}

/**
 * A collection of the fields in a PolicyStatement that can be used to identify a principal.
 *
 * This consists of the Terraform PrincipalProps representing the
 * `principals` block(s) in a policy statement.
 *
 * Generally, AWS principal JSON looks like:
 *
 *     { '<TYPE>': ['ID', 'ID', ...] }
 *
 * And this is also the type of the field `principalJson`.
 *
 * However, there is a special type of principal that is just the string '*',
 * which is treated differently by some services.
 *
 * To represent that principal, `principalJson` should contain `*`.
 * To represent that principal in Terraform principals block(s), the
 * type should be `PrincipalType.ANY` and the identifiers should be `['*']`.
 */
export class PrincipalPolicyFragment {
  /**
   * Parses a JSON object with the AWS IAM Principal structure
   *
   * Refer to the `fromPrincipalJson` and `fromConditionJson` functions for more information
   */
  public static fromJson(
    principalJson: any,
    conditionsJson: { [key: string]: any } = {},
  ): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      fromPrincipalJson(principalJson),
      fromConditionJson(conditionsJson),
    );
  }

  // TODO: Should this actually be used anywhere?
  public get principalJson(): AwsPrincipalJson {
    return toPrincipalJson(...this.principals);
  }
  public get conditionsJson(): { [key: string]: any } {
    return toConditionJson(...this.conditions);
  }

  /**
   *
   * @param principals Array of "principals" block in a policy statement
   * @param conditions conditions that need to be applied to this policy
   */
  constructor(
    public readonly principals: Array<PrincipalProps>,
    /**
     * The conditions under which the policy is in effect.
     * See [the IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
     */
    public readonly conditions: Conditions = [],
  ) {}
}

/**
 * Typed representation of AWS Principal JSON
 */
export type AwsPrincipalJson = string | { [key: string]: string | string[] };

/**
 * Read from AWS Principal JSON to Terraform principals block(s)
 *
 * Handles special case: if principal is "*" and turns it into the `StarPrincipal`,
 *
 * Even though the IAM Documentation states that "Principal": "*" and "Principal": {"AWS": "*"} are equivalent,
 * those principal elements have different behavior in some situations, e.g., IAM Role Trust Policy.
 *
 * To have Terraform render JSON containing "Principal": "*", use type = "*" and identifiers = ["*"].
 * To have Terraform render JSON containing "Principal": {"AWS": "*"}, use type = "AWS" and identifiers = ["*"].
 */
export function fromPrincipalJson(principalJson: any = {}): PrincipalProps[] {
  if (typeof principalJson === "string") {
    if (principalJson === "*") {
      return [{ type: PrincipalType.ANY, identifiers: ["*"] }];
    } else {
      // TODO: Should this handle other scenarios (i.e. Tokens?)
      throw new Error(`Invalid principal type: ${principalJson}`);
    }
  }
  if (typeof principalJson !== "object") {
    throw new Error(
      `JSON IAM principal should be an object, got ${JSON.stringify(principalJson)}`,
    );
  }
  const result = new Array<PrincipalProps>();
  for (const [key, identifiers] of Object.entries(principalJson)) {
    if (!isValidPrincipalType(key)) {
      throw new Error(
        `Invalid principal type: ${key}, valid values are: ${Object.values(PrincipalType)}`,
      );
    }
    result.push({
      identifiers: Array.isArray(identifiers) ? identifiers : [identifiers],
      type: key as PrincipalType,
    });
  }
  return result;
}

/**
 * Convert Terraform principals blocks back to AWS Principal JSON
 */
export function toPrincipalJson(
  ...principalProps: PrincipalProps[]
): AwsPrincipalJson {
  if (
    principalProps.length === 1 &&
    principalProps[0].type === PrincipalType.ANY &&
    principalProps[0].identifiers.length === 1 &&
    principalProps[0].identifiers[0] === "*"
  )
    return "*";

  const result: { [key: string]: string | string[] } = {};
  for (const principal of principalProps) {
    result[principal.type] =
      principal.identifiers.length === 1
        ? principal.identifiers[0]
        : principal.identifiers;
  }
  return result;
}

/**
 * A type of principal that has more control over its own representation in AssumeRolePolicyDocuments
 *
 * More complex types of identity providers need more control over Role's policy documents
 * than simply `{ Effect: 'Allow', Action: 'AssumeRole', Principal: <Whatever> }`.
 *
 * If that control is necessary, they can implement `IAssumeRolePrincipal` to get full
 * access to a Role's AssumeRolePolicyDocument.
 */
export interface IAssumeRolePrincipal extends IPrincipal {
  /**
   * Add the principal to the AssumeRolePolicyDocument
   *
   * Add the statements to the AssumeRolePolicyDocument necessary to give this principal
   * permissions to assume the given role.
   */
  addToAssumeRolePolicy(document: IPolicyDocument): void;
}

/**
 * Result of calling `addToPrincipalPolicy`
 */
export interface AddToPrincipalPolicyResult {
  /**
   * Whether the statement was added to the identity's policies.
   *
   */
  readonly statementAdded: boolean;

  /**
   * Dependable which allows depending on the policy change being applied
   *
   * @default - Required if `statementAdded` is true.
   */
  readonly policyDependable?: IDependable;
}

/**
 * Base class for policy principals
 */
export abstract class PrincipalBase implements IAssumeRolePrincipal {
  public readonly grantPrincipal: IPrincipal = this;
  public readonly principalAccount: string | undefined = undefined;

  /**
   * Return the policy fragment that identifies this principal in a Policy.
   */
  public abstract readonly policyFragment: PrincipalPolicyFragment;

  /**
   * When this Principal is used in an AssumeRole policy, the action to use.
   */
  public readonly assumeRoleAction: string = "sts:AssumeRole";

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  public addToPrincipalPolicy(
    _statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    // This base class is used for non-identity principals. None of them
    // have a PolicyDocument to add to.
    return { statementAdded: false };
  }

  public addToAssumeRolePolicy(document: IPolicyDocument): void {
    // Default implementation of this protocol
    document.addStatements(
      new PolicyStatement({
        actions: [this.assumeRoleAction],
        principals: [this],
      }),
    );
  }

  public toString() {
    // This is a first pass to make the object readable. Descendant principals
    // should return something nicer.
    return JSON.stringify(this.policyFragment.principalJson);
  }

  /**
   * JSON-ify the principal
   *
   * Used when JSON.stringify() is called
   */
  public toJSON() {
    // Have to implement toJSON() because the default will lead to infinite recursion.
    return this.policyFragment.principalJson;
  }

  /**
   * Returns a new PrincipalWithConditions using this principal as the base, with the
   * passed conditions added.
   *
   * When there is a value for the same operator and key in both the principal and the
   * conditions parameter, the value from the conditions parameter will be used.
   *
   * @returns a new PrincipalWithConditions object.
   */
  public withConditions(...conditions: Conditions): PrincipalBase {
    return new PrincipalWithConditions(this, conditions);
  }

  /**
   * Returns a new principal using this principal as the base, with session tags enabled.
   *
   * @returns a new SessionTagsPrincipal object.
   */
  public withSessionTags(): PrincipalBase {
    return new SessionTagsPrincipal(this);
  }

  /**
   * Return whether or not this principal is equal to the given principal
   */
  public abstract dedupeString(): string | undefined;
}

/**
 * Specify a principal by the Amazon Resource Name (ARN).
 * You can specify AWS accounts, IAM users, Federated SAML users, IAM roles, and specific assumed-role sessions.
 * You cannot specify IAM groups or instance profiles as principals
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html
 */
export class ArnPrincipal extends PrincipalBase {
  /**
   *
   * @param arn Amazon Resource Name (ARN) of the principal entity (i.e. arn:aws:iam::123456789012:user/user-name)
   */
  constructor(public readonly arn: string) {
    super();
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment([
      {
        type: PrincipalType.AWS,
        identifiers: [this.arn],
      },
    ]);
  }

  public toString() {
    return `ArnPrincipal(${this.arn})`;
  }

  /**
   * A convenience method for adding a condition that the principal is part of the specified
   * AWS Organization.
   */
  public inOrganization(organizationId: string) {
    return this.withConditions({
      test: "StringEquals",
      variable: "aws:PrincipalOrgID",
      values: [organizationId],
    });
  }

  public dedupeString(): string | undefined {
    return `ArnPrincipal:${this.arn}`;
  }
}

/**
 * Specify AWS account ID as the principal entity in a policy to delegate authority to the account.
 */
export class AccountPrincipal extends ArnPrincipal {
  public readonly principalAccount: string | undefined;

  /**
   *
   * @param accountId AWS account ID (i.e. '123456789012')
   */
  constructor(public readonly accountId: any) {
    super(
      new AwsSpecDependentToken(
        (awsSpec) => `arn:${awsSpec.partition}:iam::${accountId}:root`,
      ).toString(),
    );
    if (!Token.isUnresolved(accountId) && typeof accountId !== "string") {
      throw new Error("accountId should be of type string");
    }
    this.principalAccount = accountId;
  }

  public toString() {
    return `AccountPrincipal(${this.accountId})`;
  }
}

/**
 * Options for a service principal.
 */
export interface ServicePrincipalOpts {
  /**
   * The region in which you want to reference the service
   *
   * This is only necessary for *cross-region* references.
   *
   * Note: We always return the full service principal name, including the region.
   * Normally, the region is only required for *opt-in* regions. In those
   * cases, the region name needs to be included to reference the correct service principal.
   * In all other cases, the global service principal name is sufficient.
   *
   * @default - the resolving Stack's region.
   */
  readonly region?: string;

  /**
   * Additional conditions to add to the Service Principal
   *
   * @default - No conditions
   */
  readonly conditions?: Conditions;
}

/**
 * An IAM principal that represents an AWS service (i.e. `sqs.amazonaws.com`).
 */
export class ServicePrincipal extends PrincipalBase {
  /**
   * Return the service principal name based on the region it's used in.
   *
   * Some service principal names used to be different for different partitions,
   * and some were not.
   *
   * These days all service principal names are standardized, and they are all
   * of the form `<servicename>.amazonaws.com`.
   *
   * To avoid breaking changes, handling is provided for services added with the formats below,
   * however, no additional handling will be added for new regions or partitions.
   *   - s3
   *   - s3.amazonaws.com
   *   - s3.amazonaws.com.cn
   *   - s3.c2s.ic.gov
   *   - s3.sc2s.sgov.gov
   *
   * @example
   * const principalName = iam.ServicePrincipal.servicePrincipalName('ec2');
   */
  public static servicePrincipalName(service: string): string {
    return new ServicePrincipalToken(service, {}).toString();
  }

  /**
   * Reference an AWS service, optionally in a given region
   *
   * @param service AWS service (i.e. sqs.amazonaws.com)
   */
  constructor(
    public readonly service: string,
    private readonly opts: ServicePrincipalOpts = {},
  ) {
    super();
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      [
        {
          type: PrincipalType.SERVICE,
          identifiers: [
            new ServicePrincipalToken(this.service, this.opts).toString(),
          ],
        },
      ],
      this.opts.conditions,
    );
  }

  public toString() {
    return `ServicePrincipal(${this.service})`;
  }

  public dedupeString(): string | undefined {
    return `ServicePrincipal:${this.service}:${JSON.stringify(this.opts)}`;
  }
}

/**
 * A principal that represents an AWS Organization
 */
export class OrganizationPrincipal extends PrincipalBase {
  /**
   *
   * @param organizationId The unique identifier (ID) of an organization (i.e. o-12345abcde)
   */
  constructor(public readonly organizationId: string) {
    super();
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      [{ type: PrincipalType.AWS, identifiers: ["*"] }],
      [
        {
          test: "StringEquals",
          variable: "aws:PrincipalOrgID",
          values: [this.organizationId],
        },
      ],
    );
  }

  public toString() {
    return `OrganizationPrincipal(${this.organizationId})`;
  }

  public dedupeString(): string | undefined {
    return `OrganizationPrincipal:${this.organizationId}`;
  }
}

/**
 * A policy principal for canonicalUserIds - useful for S3 bucket policies that use
 * Origin Access identities.
 *
 * See https://docs.aws.amazon.com/general/latest/gr/acct-identifiers.html
 *
 * and
 *
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
 *
 * for more details.
 *
 */
export class CanonicalUserPrincipal extends PrincipalBase {
  /**
   *
   * @param canonicalUserId unique identifier assigned by AWS for every account.
   *   root user and IAM users for an account all see the same ID.
   *   (i.e. 79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be)
   */
  constructor(public readonly canonicalUserId: string) {
    super();
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment([
      {
        type: PrincipalType.CANONICALUSER,
        identifiers: [this.canonicalUserId],
      },
    ]);
  }

  public toString() {
    return `CanonicalUserPrincipal(${this.canonicalUserId})`;
  }

  public dedupeString(): string | undefined {
    return `CanonicalUserPrincipal:${this.canonicalUserId}`;
  }
}

/**
 * Principal entity that represents a federated identity provider such as Amazon Cognito,
 * that can be used to provide temporary security credentials to users who have been authenticated.
 * Additional condition keys are available when the temporary security credentials are used to make a request.
 * You can use these keys to write policies that limit the access of federated users.
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html#condition-keys-wif
 */
export class FederatedPrincipal extends PrincipalBase {
  public readonly assumeRoleAction: string;

  /**
   * The conditions under which the policy is in effect.
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html
   */
  public readonly conditions: Conditions;

  /**
   *
   * @param federated federated identity provider (i.e. 'cognito-identity.amazonaws.com' for users authenticated through Cognito)
   * @param sessionTags Whether to enable session tagging (see https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html)
   */
  constructor(
    public readonly federated: string,
    conditions: Conditions = [],
    assumeRoleAction: string = "sts:AssumeRole",
  ) {
    super();

    this.conditions = conditions;
    this.assumeRoleAction = assumeRoleAction;
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      [{ type: PrincipalType.FEDERATED, identifiers: [this.federated] }],
      this.conditions,
    );
  }

  public toString() {
    return `FederatedPrincipal(${this.federated})`;
  }

  public dedupeString(): string | undefined {
    return `FederatedPrincipal:${this.federated}:${this.assumeRoleAction}:${JSON.stringify(this.conditions)}`;
  }
}

/**
 * A principal that represents a federated identity provider as Web Identity such as Cognito, Amazon,
 * Facebook, Google, etc.
 */
export class WebIdentityPrincipal extends FederatedPrincipal {
  /**
   *
   * @param identityProvider identity provider (i.e. 'cognito-identity.amazonaws.com' for users authenticated through Cognito)
   * @param conditions The conditions under which the policy is in effect.
   *   See [the IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
   * @param sessionTags Whether to enable session tagging (see https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html)
   */
  constructor(identityProvider: string, conditions: Conditions = []) {
    super(identityProvider, conditions ?? {}, "sts:AssumeRoleWithWebIdentity");
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      [{ type: PrincipalType.FEDERATED, identifiers: [this.federated] }],
      this.conditions,
    );
  }

  public toString() {
    return `WebIdentityPrincipal(${this.federated})`;
  }
}

/**
 * A principal that represents a federated identity provider as from a OpenID Connect provider.
 */
export class OpenIdConnectPrincipal extends WebIdentityPrincipal {
  /**
   *
   * @param openIdConnectProvider OpenID Connect provider
   * @param conditions The conditions under which the policy is in effect.
   *   See [the IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
   */
  constructor(
    openIdConnectProvider: IOpenIdConnectProvider,
    conditions: Conditions = [],
  ) {
    super(openIdConnectProvider.openIdConnectProviderArn, conditions);
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      [{ type: PrincipalType.FEDERATED, identifiers: [this.federated] }],
      this.conditions,
    );
  }

  public toString() {
    return `OpenIdConnectPrincipal(${this.federated})`;
  }
}

/**
 * Principal entity that represents a SAML federated identity provider
 */
export class SamlPrincipal extends FederatedPrincipal {
  constructor(samlProvider: ISamlProvider, conditions: Conditions) {
    super(samlProvider.samlProviderArn, conditions, "sts:AssumeRoleWithSAML");
  }

  public toString() {
    return `SamlPrincipal(${this.federated})`;
  }
}

/**
 * Principal entity that represents a SAML federated identity provider for
 * programmatic and AWS Management Console access.
 */
export class SamlConsolePrincipal extends SamlPrincipal {
  /**
   * enum Partition {
   *   Default = 'aws',
   *   Cn = 'aws-cn',
   *   UsGov = 'aws-us-gov',
   *   UsIso = 'aws-iso',
   *   UsIsoB = 'aws-iso-b',
   *   UsIsoF = 'aws-iso-f',
   *   EuIsoE = 'aws-iso-e',
   * }
   * SAML Sign On urls could be...
   * [Partition.Default]: 'https://signin.aws.amazon.com/saml',
   * [Partition.Cn]: 'https://signin.amazonaws.cn/saml',
   * [Partition.UsGov]: 'https://signin.amazonaws-us-gov.com/saml',
   * [Partition.UsIso]: 'https://signin.c2shome.ic.gov/saml',
   * [Partition.UsIsoB]: 'https://signin.sc2shome.sgov.gov/saml',
   */

  /**
   * @param samlProvider The SAML provider
   */
  constructor(samlProvider: ISamlProvider, conditions: Conditions = []) {
    super(samlProvider, [
      ...conditions,
      // TODO: handle collisions on "SAML:aud"?
      {
        test: "StringEquals",
        variable: "SAML:aud",
        values: ["https://signin.aws.amazon.com/saml"],
      },
    ]);
  }

  public toString() {
    return `SamlConsolePrincipal(${this.federated})`;
  }
}

/**
 * Use the AWS account into which a stack is deployed as the principal entity in a policy
 */
export class AccountRootPrincipal extends AccountPrincipal {
  constructor() {
    super(new AwsSpecDependentToken((awsSpec) => awsSpec.account).toString());
  }

  public toString() {
    return "AccountRootPrincipal()";
  }
}

/**
 * A principal representing all AWS identities in all accounts
 *
 * Some services behave differently when you specify `Principal: '*'`
 * or `Principal: { AWS: "*" }` in their resource policy.
 *
 * `AnyPrincipal` renders to `Principal: { AWS: "*" }`. This is correct
 * most of the time, but in cases where you need the other principal,
 * use `StarPrincipal` instead.
 */
export class AnyPrincipal extends ArnPrincipal {
  constructor() {
    super("*");
  }

  public toString() {
    return "AnyPrincipal()";
  }
}

/**
 * A principal representing all identities in all accounts
 * @deprecated use `AnyPrincipal`
 */
export class Anyone extends AnyPrincipal {}

/**
 * A principal that uses a literal '*' in the IAM JSON language
 *
 * Some services behave differently when you specify `Principal: "*"`
 * or `Principal: { AWS: "*" }` in their resource policy.
 *
 * `StarPrincipal` renders to `Principal: *`. Most of the time, you
 * should use `AnyPrincipal` instead.
 */
export class StarPrincipal extends PrincipalBase {
  public readonly policyFragment: PrincipalPolicyFragment =
    new PrincipalPolicyFragment([
      {
        type: PrincipalType.ANY,
        identifiers: ["*"],
      },
    ]);

  public toString() {
    return "StarPrincipal()";
  }

  public dedupeString(): string | undefined {
    return "StarPrincipal";
  }
}

/**
 * Represents a principal that has multiple types of principals. A composite principal cannot
 * have conditions. i.e. multiple ServicePrincipals that form a composite principal
 */
export class CompositePrincipal extends PrincipalBase {
  public readonly assumeRoleAction: string;
  private readonly _principals = new Array<IPrincipal>();

  constructor(...principals: IPrincipal[]) {
    super();
    if (principals.length === 0) {
      throw new Error(
        "CompositePrincipals must be constructed with at least 1 Principal but none were passed.",
      );
    }
    this.assumeRoleAction = principals[0].assumeRoleAction;
    this.addPrincipals(...principals);
  }

  /**
   * Adds IAM principals to the composite principal. Composite principals cannot have
   * conditions.
   *
   * @param principals IAM principals that will be added to the composite principal
   */
  public addPrincipals(...principals: IPrincipal[]): this {
    this._principals.push(...principals);
    return this;
  }

  public addToAssumeRolePolicy(doc: IPolicyDocument) {
    for (const p of this._principals) {
      defaultAddPrincipalToAssumeRole(p, doc);
    }
  }

  public get policyFragment(): PrincipalPolicyFragment {
    // We only have a problem with conditions if we are trying to render composite
    // principals into a single statement (which is when `policyFragment` would get called)
    for (const p of this._principals) {
      const fragment = p.policyFragment;
      if (fragment.conditions && fragment.conditions.length > 0) {
        throw new Error(
          "Components of a CompositePrincipal must not have conditions. " +
            `Tried to add the following fragment: ${JSON.stringify(fragment)}`,
        );
      }
    }

    const principals = new Array<PrincipalProps>();
    for (const p of this._principals) {
      mergePrincipal(principals, p.policyFragment.principals);
    }
    return new PrincipalPolicyFragment(principals);
  }

  public toString() {
    return `CompositePrincipal(${this._principals})`;
  }

  public dedupeString(): string | undefined {
    const inner = this._principals.map(ComparablePrincipal.dedupeStringFor);
    if (inner.some((x) => x === undefined)) {
      return undefined;
    }
    return `CompositePrincipal[${inner.join(",")}]`;
  }

  /**
   * Returns the principals that make up the CompositePrincipal
   */
  public get principals(): IPrincipal[] {
    return this._principals;
  }
}

/**
 * Base class for Principals that wrap other principals
 */
abstract class PrincipalAdapter extends PrincipalBase {
  public readonly assumeRoleAction = this.wrapped.assumeRoleAction;
  public readonly principalAccount = this.wrapped.principalAccount;

  constructor(protected readonly wrapped: IPrincipal) {
    super();
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return this.wrapped.policyFragment;
  }

  public addToPrincipalPolicy(
    statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    return this.wrapped.addToPrincipalPolicy(statement);
  }

  /**
   * Append the given string to the wrapped principal's dedupe string (if available)
   */
  protected appendDedupe(append: string): string | undefined {
    const inner = ComparablePrincipal.dedupeStringFor(this.wrapped);
    return inner !== undefined
      ? `${this.constructor.name}:${inner}:${append}`
      : undefined;
  }
}

/**
 * Interface for principals that can be compared.
 *
 * This only needs to be implemented for principals that could potentially be value-equal.
 * Identity-equal principals will be handled correctly by default.
 */
export interface IComparablePrincipal extends IPrincipal {
  /**
   * Return a string format of this principal which should be identical if the two
   * principals are the same.
   */
  dedupeString(): string | undefined;
}

/**
 * Helper class for working with `IComparablePrincipal`s
 */
export class ComparablePrincipal {
  /**
   * Whether or not the given principal is a comparable principal
   */
  public static isComparablePrincipal(
    x: IPrincipal,
  ): x is IComparablePrincipal {
    return "dedupeString" in x;
  }

  /**
   * Return the dedupeString of the given principal, if available
   */
  public static dedupeStringFor(x: IPrincipal): string | undefined {
    return ComparablePrincipal.isComparablePrincipal(x)
      ? x.dedupeString()
      : undefined;
  }
}

/**
 * An IAM principal with additional conditions specifying when the policy is in effect.
 *
 * For more information about conditions, see:
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html
 */
export class PrincipalWithConditions extends PrincipalAdapter {
  private additionalConditions: ConditionMap = {};

  constructor(principal: IPrincipal, conditions: Conditions) {
    super(principal);
    for (const c of conditions) {
      this.addCondition(c);
    }
  }

  // ref: https://github.com/aws/aws-cdk/pull/28510/files#diff-50248f671e9b13a9cb35a62441d72832dca89b6c7ad4a88aa4fb2ec8e676b7cd
  public addToAssumeRolePolicy(doc: IPolicyDocument) {
    if (doc.node.scope === undefined) {
      throw new Error(
        "Cannot add a condition to a principal outside of a stack scope",
      );
    }
    // Lazy import to avoid circular import dependencies during startup

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const adapter: typeof import("./private/adapter") = require("./private/adapter");
    defaultAddPrincipalToAssumeRole(
      this.wrapped,
      new adapter.MutatingPolicyDocumentAdapter(doc, (statement) => {
        statement.addActions(this.assumeRoleAction);
        statement.addConditions(...this.conditions);
        return statement;
      }),
    );
  }

  /**
   * Add a condition to the principal
   */
  public addCondition(condition: Condition) {
    if (!this.additionalConditions[condition.test]) {
      this.additionalConditions[condition.test] = {};
    }

    const existingCondition =
      this.additionalConditions[condition.test][condition.variable];
    if (existingCondition) {
      this.additionalConditions[condition.test][condition.variable] = {
        ...existingCondition,
        ...condition,
      };
    } else {
      this.additionalConditions[condition.test][condition.variable] = condition;
    }
  }

  /**
   * Add a conditionObject to the principal
   *
   * A conditionObject has the format of test: { variable: value | values[] }
   *
   * For example:
   *
   * ```ts
   * const condition1 = {'StringEquals', { 'aws:SomeField': '1' }};
   * // or
   * const condition2 = {'StringEquals', { 'aws:SomeField': ['1', '2'] }};
   * ```
   */
  public addConditionObject(key: string, value: unknown) {
    validateConditionObject(value);
    for (const [k, v] of Object.entries(value)) {
      if (!isStringOrArrayOfStrings(v)) {
        throw new Error(
          `Fields must be either a string or an array of strings. Got ${v} for key ${k}`,
        );
      }
      this.addCondition({
        test: key,
        variable: k,
        values: Array.isArray(v) ? v : [v],
      });
    }
  }

  /**
   * Adds multiple conditions to the principal
   *
   * Values from the conditions parameter will overwrite existing values with the same operator
   * and key.
   */
  public addConditions(conditions: Conditions) {
    conditions.map((c) => {
      this.addCondition(c);
    });
  }

  /**
   * Adds multiple conditionObjects to the principal
   *
   * Values from the conditions parameter will overwrite existing values with the same operator
   * and key.
   */
  public addConditionObjects(conditions: { [key: string]: unknown }) {
    for (const [key, value] of Object.entries(conditions)) {
      this.addConditionObject(key, value);
    }
  }

  /**
   * The conditions under which the policy is in effect.
   * See [the IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
   */
  public get conditions() {
    return this.mergeConditions(
      this.wrapped.policyFragment.conditions,
      this.additionalConditions,
    );
  }

  public get policyFragment(): PrincipalPolicyFragment {
    return new PrincipalPolicyFragment(
      this.wrapped.policyFragment.principals,
      this.conditions,
    );
  }

  public toString() {
    return this.wrapped.toString();
  }

  /**
   * JSON-ify the principal
   *
   * Used when JSON.stringify() is called
   */
  public toJSON() {
    // Have to implement toJSON() because the default will lead to infinite recursion.
    return this.policyFragment.principalJson;
  }

  public dedupeString(): string | undefined {
    return this.appendDedupe(JSON.stringify(this.conditions));
  }

  private mergeConditions(
    principalConditions: Conditions,
    additionalConditions: ConditionMap,
  ): Conditions {
    const mergedConditions: ConditionMap = {};
    principalConditions.forEach((c) => {
      if (!mergedConditions[c.test]) {
        mergedConditions[c.test] = {};
      }
      mergedConditions[c.test][c.variable] = c;
    });

    Object.entries(additionalConditions).forEach(([test, condition]) => {
      // merge the conditions if one of the additional conditions uses an
      // operator that's already used by the principal's conditions merge the
      // inner structure.
      const existing = mergedConditions[test];
      if (!existing) {
        mergedConditions[test] = condition;
        return; // continue
      }

      // TODO: Support IResolvable Condition?
      // // if either the existing condition or the new one contain unresolved
      // // tokens, fail the merge. this is as far as we go at this point.
      // if (Token.isUnresolved(condition) || Token.isUnresolved(existing)) {
      //   throw new Error(
      //     `multiple "${test}" conditions cannot be merged if one of them contains an unresolved token`,
      //   );
      // }

      // TODO: Validate condition?
      // validateConditionObject(existing);
      // validateConditionObject(condition);

      mergedConditions[test] = { ...existing, ...condition };
    });
    return toConditions(mergedConditions);
  }
}

/**
 * Enables session tags on role assumptions from a principal
 *
 * For more information on session tags, see:
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html
 */
export class SessionTagsPrincipal extends PrincipalAdapter {
  constructor(principal: IPrincipal) {
    super(principal);
  }

  // ref: https://github.com/aws/aws-cdk/pull/28510/files#diff-50248f671e9b13a9cb35a62441d72832dca89b6c7ad4a88aa4fb2ec8e676b7cd
  public addToAssumeRolePolicy(doc: IPolicyDocument) {
    // Lazy import to avoid circular import dependencies during startup

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const adapter: typeof import("./private/adapter") = require("./private/adapter");
    defaultAddPrincipalToAssumeRole(
      this.wrapped,
      new adapter.MutatingPolicyDocumentAdapter(doc, (statement) => {
        statement.addActions("sts:TagSession");
        return statement;
      }),
    );
  }

  public dedupeString(): string | undefined {
    return this.appendDedupe("");
  }
}

/**
 * Add a principal to an AssumeRolePolicyDocument in the right way
 *
 * Delegate to the principal if it can do the job itself, do a default job if it can't.
 */
export function defaultAddPrincipalToAssumeRole(
  principal: IPrincipal,
  doc: IPolicyDocument,
) {
  if (isAssumeRolePrincipal(principal)) {
    // Principal knows how to add itself
    principal.addToAssumeRolePolicy(doc);
  } else {
    // Principal can't add itself, we do it for them
    doc.addStatements(
      new PolicyStatement({
        actions: [principal.assumeRoleAction],
        principals: [principal],
      }),
    );
  }
}

function isAssumeRolePrincipal(
  principal: IPrincipal,
): principal is IAssumeRolePrincipal {
  return !!(principal as IAssumeRolePrincipal).addToAssumeRolePolicy;
}

/**
 * A lazy token that requires an instance of Stack to evaluate
 */
class AwsSpecDependentToken implements IResolvable {
  public readonly creationStack: string[];
  constructor(private readonly fn: (spec: AwsSpec) => any) {
    // TODO: Implement stack traces
    // ref: https://github.com/hashicorp/terraform-cdk/blob/v0.20.9/packages/cdktf/lib/tokens/private/stack-trace.ts#L9
    // ref: https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/core/lib/stack-trace.ts#L22
    this.creationStack = ["stack traces disabled"];
  }

  public resolve(context: IResolveContext) {
    return this.fn(AwsSpec.ofAwsBeacon(context.scope));
  }

  public toString() {
    return Token.asString(this);
  }

  /**
   * JSON-ify the token
   *
   * Used when JSON.stringify() is called
   */
  public toJSON() {
    return "<unresolved-token>";
  }
}

class ServicePrincipalToken implements IResolvable {
  public readonly creationStack: string[];
  constructor(
    private readonly service: string,
    private readonly opts: ServicePrincipalOpts,
  ) {
    // TODO: Implement stack traces
    // ref: https://github.com/hashicorp/terraform-cdk/blob/v0.20.9/packages/cdktf/lib/tokens/private/stack-trace.ts#L9
    // ref: https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/core/lib/stack-trace.ts#L22
    this.creationStack = ["stack traces disabled"];
  }

  public resolve(ctx: IResolveContext) {
    const awsSpec = AwsSpec.ofAwsBeacon(ctx.scope);
    // TODO: Does this work for Opt-In regions??
    // https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-iam/lib/principals.ts#L506-L510
    return awsSpec.servicePrincipalName(this.service, this.opts.region);
  }

  public toString() {
    return Token.asString(this, {
      displayHint: this.service,
    });
  }

  /**
   * JSON-ify the token
   *
   * Used when JSON.stringify() is called
   */
  public toJSON() {
    return `<${this.service}>`;
  }
}

/**
 * Merge two arrays that represent IAM principals
 *
 * Does an in-place merge into target.
 */
export function mergePrincipal(
  target: PrincipalProps[],
  source: PrincipalProps[],
) {
  // if one represents the starPrincipal the other one must be empty
  if (
    (hasStarPrincipal(target) && source.length > 0) ||
    (hasStarPrincipal(source) && target.length > 0)
  ) {
    throw new Error(
      `Cannot merge principals ${JSON.stringify(target)} and ${JSON.stringify(source)}; if one uses a the StarPrincipal string the other one must be empty`,
    );
  }

  const targetMap: Map<PrincipalType, PrincipalProps> = new Map();
  for (const principal of target) {
    targetMap.set(principal.type, principal);
  }

  for (const sourcePrincipal of source) {
    const { type, identifiers: sourceIdentifiers } = sourcePrincipal;
    if (targetMap.has(type)) {
      const targetIndentifierSet = new Set(targetMap.get(type)!.identifiers);
      for (const id of sourceIdentifiers) {
        targetIndentifierSet.add(id);
      }
      // Update the target identifiers in-place
      const index = target.findIndex((principal) => principal.type === type);
      if (index !== -1) {
        target[index] = {
          type,
          identifiers: Array.from(targetIndentifierSet),
        };
      }
    } else {
      target.push({
        type,
        identifiers: [...sourceIdentifiers],
      });
    }
  }
}

/**
 * Detect if the PrincipalProps array contains the StarPrincipal:
 * type = PrincipalType.ANY and identifiers = ["*"]
 */
function hasStarPrincipal(principals: PrincipalProps[]) {
  // TODO: Does having more than 1 principal make sense if one of them is the StarPrincipal?
  for (let index = 0; index < principals.length; index++) {
    const principal = principals[index];
    if (
      principal.type === PrincipalType.ANY &&
      principal.identifiers.length === 1 &&
      principal.identifiers[0] === "*"
    ) {
      return true;
    }
  }
  return false;
}
