// ref: https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-iam/lib/policy-statement.ts
import { dataAwsIamPolicyDocument } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { IConstruct } from "constructs";
import { PolicyStatementProps } from "./policy-statement-props.generated";
import {
  AccountPrincipal,
  AccountRootPrincipal,
  AnyPrincipal,
  ArnPrincipal,
  CanonicalUserPrincipal,
  FederatedPrincipal,
  PrincipalPolicyFragment,
  ServicePrincipal,
  ServicePrincipalOpts,
  IPrincipal,
  PrincipalProps,
  mergePrincipal,
  toPrincipalJson,
  PrincipalBase,
} from "./principals";

/**
 * An estimate on how long ARNs typically are
 *
 * This is used to decide when to start splitting statements into new Managed Policies.
 * Because we often can't know the length of an ARN (it may be a token and only
 * available at deployment time) we'll have to estimate it.
 */
const DEFAULT_ARN_SIZE_ESTIMATE = 150;

export type ConditionMap = {
  [test: string]: { [variable: string]: Condition };
};

/**
 * Represents a statement in an IAM policy document.
 */
export class PolicyStatement {
  /**
   * Creates a new Terraform PolicyStatement based on the AWS IAM Policy Statement format.
   * This will accept an object created from the `.toStatementJson()` call
   *
   * @param obj the PolicyStatement in object form.
   */
  public static fromJson(obj: any) {
    // TODO: What if obj is/has a Token(s)?
    const ret = new PolicyStatement({
      sid: obj.Sid,
      actions: ensureArrayOrUndefined(obj.Action),
      resources: ensureArrayOrUndefined(obj.Resource),
      condition: fromConditionJson(obj.Condition),
      effect: obj.Effect,
      notActions: ensureArrayOrUndefined(obj.NotAction),
      notResources: ensureArrayOrUndefined(obj.NotResource),
      principals: obj.Principal
        ? [new JsonPrincipal(obj.Principal)]
        : undefined,
      notPrincipals: obj.NotPrincipal
        ? [new JsonPrincipal(obj.NotPrincipal)]
        : undefined,
    });

    // validate that the PolicyStatement has the correct shape
    const errors = ret.validateForAnyPolicy();
    if (errors.length > 0) {
      throw new Error("Incorrect Policy Statement: " + errors.join("\n"));
    }

    return ret;
  }

  private readonly _action = new OrderedSet<string>();
  private readonly _notAction = new OrderedSet<string>();
  private readonly _principal: PrincipalProps[] = [];
  private readonly _notPrincipal: PrincipalProps[] = [];
  private readonly _resource = new OrderedSet<string>();
  private readonly _notResource = new OrderedSet<string>();
  private readonly _conditionMap: ConditionMap = {};
  private _sid?: string;
  private _effect: Effect;
  private principalConditionsJson?: string;

  // Hold on to those principals
  private readonly _principals = new OrderedSet<IPrincipal>();
  private readonly _notPrincipals = new OrderedSet<IPrincipal>();
  private _frozen = false;

  constructor(props: PolicyStatementProps = {}) {
    this._sid = props.sid;
    this._effect = props.effect || Effect.ALLOW;

    this.addActions(...(props.actions || []));
    this.addNotActions(...(props.notActions || []));
    this.addPrincipals(...(props.principals || []));
    this.addNotPrincipals(...(props.notPrincipals || []));
    this.addResources(...(props.resources || []));
    this.addNotResources(...(props.notResources || []));
    // TODO: Handle IResolvable condition?
    if (props.condition !== undefined) {
      this.addConditions(...props.condition);
    }
  }

  /**
   * Statement ID for this statement
   */
  public get sid(): string | undefined {
    return this._sid;
  }

  /**
   * Set Statement ID for this statement
   */
  public set sid(sid: string | undefined) {
    this.assertNotFrozen("sid");
    this._sid = sid;
  }

  /**
   * Whether to allow or deny the actions in this statement
   */
  public get effect(): Effect {
    return this._effect;
  }

  /**
   * Set effect for this statement
   */
  public set effect(effect: Effect) {
    this.assertNotFrozen("effect");
    this._effect = effect;
  }

  //
  // Actions
  //

  /**
   * Specify allowed actions into the "Action" section of the policy statement.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_action.html
   *
   * @param actions actions that will be allowed.
   */
  public addActions(...actions: string[]) {
    this.assertNotFrozen("addActions");
    if (actions.length > 0 && this._notAction.length > 0) {
      throw new Error(
        "Cannot add 'Actions' to policy statement if 'NotActions' have been added",
      );
    }
    this.validatePolicyActions(actions);
    this._action.push(...actions);
  }

  /**
   * Explicitly allow all actions except the specified list of actions into the "NotAction" section
   * of the policy document.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html
   *
   * @param notActions actions that will be denied. All other actions will be permitted.
   */
  public addNotActions(...notActions: string[]) {
    this.assertNotFrozen("addNotActions");
    if (notActions.length > 0 && this._action.length > 0) {
      throw new Error(
        "Cannot add 'NotActions' to policy statement if 'Actions' have been added",
      );
    }
    this.validatePolicyActions(notActions);
    this._notAction.push(...notActions);
  }

  //
  // Principal
  //

  /**
   * Indicates if this permission has a "Principal" section.
   */
  public get hasPrincipal() {
    return this._principals.length + this._notPrincipals.length > 0;
  }

  /**
   * Adds principals to the "Principal" section of a policy statement.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html
   *
   * @param principals IAM principals that will be added
   */
  public addPrincipals(...principals: IPrincipal[]) {
    this.assertNotFrozen("addPrincipals");
    if (principals.length > 0 && this._notPrincipals.length > 0) {
      throw new Error(
        "Cannot add 'Principals' to policy statement if 'NotPrincipals' have been added",
      );
    }
    // TODO: AWSCDK only ensures Principal is not instanceof Group
    // for (const principal of principals) {
    //   this.validatePolicyPrincipal(principal);
    // }

    const added = this._principals.push(...principals);
    for (const principal of added) {
      const fragment = principal.policyFragment;
      mergePrincipal(this._principal, fragment.principals);
      this.addPrincipalConditions(...fragment.conditions);
    }
  }

  /**
   * Specify principals that is not allowed or denied access to the "NotPrincipal" section of
   * a policy statement.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notprincipal.html
   *
   * @param notPrincipals IAM principals that will be denied access
   */
  public addNotPrincipals(...notPrincipals: IPrincipal[]) {
    this.assertNotFrozen("addNotPrincipals");
    if (notPrincipals.length > 0 && this._principals.length > 0) {
      throw new Error(
        "Cannot add 'NotPrincipals' to policy statement if 'Principals' have been added",
      );
    }
    // for (const notPrincipal of notPrincipals) {
    //   this.validatePolicyPrincipal(notPrincipal);
    // }

    const added = this._notPrincipals.push(...notPrincipals);
    for (const notPrincipal of added) {
      const fragment = notPrincipal.policyFragment;
      mergePrincipal(this._notPrincipal, fragment.principals);
      this.addPrincipalConditions(...fragment.conditions);
    }
  }

  private validatePolicyActions(actions: string[]) {
    // In case of an unresolved list of actions return early
    if (Token.isUnresolved(actions)) return;
    for (const action of actions || []) {
      if (
        !Token.isUnresolved(action) &&
        !/^(\*|[a-zA-Z0-9-]+:[a-zA-Z0-9*]+)$/.test(action)
      ) {
        throw new Error(
          `Action '${action}' is invalid. An action string consists of a service namespace, a colon, and the name of an action. Action names can include wildcards.`,
        );
      }
    }
  }

  /**
   * Specify AWS account ID as the principal entity to the "Principal" section of a policy statement.
   */
  public addAwsAccountPrincipal(accountId: string) {
    this.addPrincipals(new AccountPrincipal(accountId));
  }

  /**
   * Specify a principal using the ARN  identifier of the principal.
   * You cannot specify IAM groups and instance profiles as principals.
   *
   * @param arn ARN identifier of AWS account, IAM user, or IAM role (i.e. arn:aws:iam::123456789012:user/user-name)
   */
  public addArnPrincipal(arn: string) {
    this.addPrincipals(new ArnPrincipal(arn));
  }

  /**
   * Adds a service principal to this policy statement.
   *
   * @param service the service name for which a service principal is requested (e.g: `s3.amazonaws.com`).
   * @param opts    options for adding the service principal (such as specifying a principal in a different region)
   */
  public addServicePrincipal(service: string, opts?: ServicePrincipalOpts) {
    this.addPrincipals(new ServicePrincipal(service, opts));
  }

  /**
   * Adds a federated identity provider such as Amazon Cognito to this policy statement.
   *
   * @param federated federated identity provider (i.e. 'cognito-identity.amazonaws.com')
   * @param conditions The conditions under which the policy is in effect.
   *   See [the IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
   */
  public addFederatedPrincipal(federated: any, conditions: Conditions) {
    this.addPrincipals(new FederatedPrincipal(federated, conditions));
  }

  /**
   * Adds an AWS account root user principal to this policy statement
   */
  public addAccountRootPrincipal() {
    this.addPrincipals(new AccountRootPrincipal());
  }

  /**
   * Adds a canonical user ID principal to this policy document
   *
   * @param canonicalUserId unique identifier assigned by AWS for every account
   */
  public addCanonicalUserPrincipal(canonicalUserId: string) {
    this.addPrincipals(new CanonicalUserPrincipal(canonicalUserId));
  }

  /**
   * Adds all identities in all accounts ("*") to this policy statement
   */
  public addAnyPrincipal() {
    this.addPrincipals(new AnyPrincipal());
  }

  //
  // Resources
  //

  /**
   * Specify resources that this policy statement applies into the "Resource" section of
   * this policy statement.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html
   *
   * @param arns Amazon Resource Names (ARNs) of the resources that this policy statement applies to
   */
  public addResources(...arns: string[]) {
    this.assertNotFrozen("addResources");
    if (arns.length > 0 && this._notResource.length > 0) {
      throw new Error(
        "Cannot add 'Resources' to policy statement if 'NotResources' have been added",
      );
    }
    this._resource.push(...arns);
  }

  /**
   * Specify resources that this policy statement will not apply to in the "NotResource" section
   * of this policy statement. All resources except the specified list will be matched.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notresource.html
   *
   * @param arns Amazon Resource Names (ARNs) of the resources that this policy statement does not apply to
   */
  public addNotResources(...arns: string[]) {
    this.assertNotFrozen("addNotResources");
    if (arns.length > 0 && this._resource.length > 0) {
      throw new Error(
        "Cannot add 'NotResources' to policy statement if 'Resources' have been added",
      );
    }
    this._notResource.push(...arns);
  }

  /**
   * Adds a ``"*"`` resource to this statement.
   */
  public addAllResources() {
    this.addResources("*");
  }

  /**
   * Indicates if this permission has at least one resource associated with it.
   */
  public get hasResource() {
    return this._resource && this._resource.length > 0;
  }

  //
  // Condition
  //

  /**
   * Add a condition to the Policy
   *
   * If multiple calls are made to add a condition with the same test and variable, only
   * the last one wins. For example:
   *
   * ```ts
   * declare const stmt: iam.PolicyStatement;
   *
   * stmt.addCondition({ test: 'StringEquals', variable: 'aws:SomeField', values: ['1'] });
   * stmt.addCondition({ test: 'StringEquals', variable: 'aws:SomeField', values: ['2'] });
   * ```
   *
   * Will end up with the single condition
   *
   * ```ts
   * {
   *   test: 'StringEquals',
   *   variable: 'aws:SomeField',
   *   values: ['2'],
   * }
   * ```.
   *
   * If you meant to add a condition to say that the field can be *either* `1` or `2`, write
   * this:
   *
   * ```ts
   * declare const stmt: iam.PolicyStatement;
   *
   * stmt.addCondition({ test: 'StringEquals', variable: 'aws:SomeField', values: ['1', '2'] });
   * ```
   */
  public addCondition(condition: Condition) {
    this.assertNotFrozen("addCondition");

    if (!this._conditionMap[condition.test]) {
      this._conditionMap[condition.test] = {};
    }

    const existingCondition =
      this._conditionMap[condition.test][condition.variable];
    if (existingCondition) {
      this._conditionMap[condition.test][condition.variable] = {
        ...existingCondition,
        ...condition,
      };
    } else {
      this._conditionMap[condition.test][condition.variable] = condition;
    }
  }

  /**
   * Add a condition to the Policy
   *
   * If multiple calls are made to add a condition with the same operator and field, only
   * the last one wins. For example:
   *
   * ```ts
   * declare const stmt: iam.PolicyStatement;
   *
   * stmt.addCondition('StringEquals', { 'aws:SomeField': '1' });
   * stmt.addCondition('StringEquals', { 'aws:SomeField': '2' });
   * ```
   *
   * Will end up with the single condition `StringEquals: { 'aws:SomeField': '2' }`.
   *
   * If you meant to add a condition to say that the field can be *either* `1` or `2`, write
   * this:
   *
   * ```ts
   * declare const stmt: iam.PolicyStatement;
   *
   * stmt.addCondition('StringEquals', { 'aws:SomeField': ['1', '2'] });
   * ```
   */
  public addConditionObject(key: string, value: unknown) {
    this.assertNotFrozen("addCondition");
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
   * Add multiple conditions to the Policy
   *
   * See the `addCondition` function for a caveat on calling this method multiple times.
   */
  public addConditions(...conditions: Condition[]) {
    conditions.map((c) => {
      this.addCondition(c);
    });
  }

  /**
   * Add multiple conditionObjects to the Policy
   *
   * See the `addConditionObject` function for a caveat on calling this method multiple times.
   */
  public addConditionObjects(conditions: Record<string, unknown>) {
    for (const [key, value] of Object.entries(conditions)) {
      this.addConditionObject(key, value);
    }
  }

  /**
   * Add a `StringEquals` condition that limits to a given account from `sts:ExternalId`.
   *
   * This method can only be called once: subsequent calls will overwrite earlier calls.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html
   */
  public addAccountCondition(...accountIds: string[]) {
    this.addCondition({
      test: "StringEquals",
      variable: "sts:ExternalId",
      values: accountIds,
    });
  }

  /**
   * Add an `StringEquals` condition that limits to a given account from `aws:SourceAccount`.
   *
   * This method can only be called once: subsequent calls will overwrite earlier calls.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-sourceaccount
   */
  public addSourceAccountCondition(...accountIds: string[]) {
    this.addCondition({
      test: "StringEquals",
      variable: "aws:SourceAccount",
      values: accountIds,
    });
  }

  /**
   * Add an `ArnEquals` condition that limits to a given resource arn from `aws:SourceArn`.
   *
   * This method can only be called once: subsequent calls will overwrite earlier calls.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-sourcearn
   */
  public addSourceArnCondition(...arns: string[]) {
    this.addCondition({
      test: "ArnEquals",
      variable: "aws:SourceArn",
      values: arns,
    });
  }

  /**
   * Create a new `PolicyStatement` with the same exact properties
   * as this one, except for the overrides
   */
  public copy(overrides: PolicyStatementProps = {}) {
    return new PolicyStatement({
      sid: overrides.sid ?? this.sid,
      effect: overrides.effect ?? this.effect,
      actions: overrides.actions ?? this.actions,
      notActions: overrides.notActions ?? this.notActions,

      principals: overrides.principals ?? this.principals,
      notPrincipals: overrides.notPrincipals ?? this.notPrincipals,

      resources: overrides.resources ?? this.resources,
      notResources: overrides.notResources ?? this.notResources,

      condition: overrides.condition ?? this.conditions,
    });
  }

  /**
   * Get AWS IAM Policy statement JSON
   */
  public toStatementJson(): any {
    return normalizeStatement({
      Action: this._action.direct(),
      NotAction: this._notAction.direct(),
      Condition: toConditionJson(...toConditions(this._conditionMap)),
      Effect: this.effect,
      Principal: toPrincipalJson(...this._principal),
      NotPrincipal: toPrincipalJson(...this._notPrincipal),
      Resource: this._resource.direct(),
      NotResource: this._notResource.direct(),
      Sid: this.sid,
    });
  }

  /**
   * String representation of this policy statement
   */
  public toString() {
    return Token.asString(this, {
      displayHint: "PolicyStatement",
    });
  }

  /**
   * JSON-ify the statement
   *
   * Used when JSON.stringify() is called
   */
  public toJSON(): dataAwsIamPolicyDocument.DataAwsIamPolicyDocumentStatement {
    const principals = this.principals.flatMap(
      (p) => p.policyFragment.principals,
    );
    const notPrincipals = this.notPrincipals.flatMap(
      (p) => p.policyFragment.principals,
    );

    return {
      sid: this.sid,
      actions: this.actions.length > 0 ? this.actions : undefined,
      notActions: this.notActions.length > 0 ? this.notActions : undefined,
      principals: principals.length > 0 ? principals : undefined,
      notPrincipals: notPrincipals.length > 0 ? notPrincipals : undefined,
      resources: this.resources.length > 0 ? this.resources : undefined,
      notResources:
        this.notResources.length > 0 ? this.notResources : undefined,
      condition: this.conditions.length > 0 ? this.conditions : undefined,
      effect: this.effect,
    };
  }

  /**
   * Add a principal's conditions
   *
   * For convenience, principals have been modeled as both a principal
   * and a set of conditions. This makes it possible to have a single
   * object represent e.g. an "SNS Topic" (SNS service principal + aws:SourcArn
   * condition) or an Organization member (* + aws:OrgId condition).
   *
   * However, when using multiple principals in the same policy statement,
   * they must all have the same conditions or the OR samentics
   * implied by a list of principals cannot be guaranteed (user needs to
   * add multiple statements in that case).
   */
  private addPrincipalConditions(
    ...conditions: dataAwsIamPolicyDocument.DataAwsIamPolicyDocumentStatementCondition[]
  ) {
    // Stringifying the conditions is an easy way to do deep equality
    const theseConditions = JSON.stringify(conditions);
    if (this.principalConditionsJson === undefined) {
      // First principal, anything goes
      this.principalConditionsJson = theseConditions;
    } else {
      if (this.principalConditionsJson !== theseConditions) {
        throw new Error(
          `All principals in a PolicyStatement must have the same Conditions (got '${this.principalConditionsJson}' and '${theseConditions}'). Use multiple statements instead.`,
        );
      }
    }
    this.addConditions(...conditions);
  }

  /**
   * Validate that the policy statement satisfies base requirements for a policy.
   *
   * @returns An array of validation error messages, or an empty array if the statement is valid.
   */
  public validateForAnyPolicy(): string[] {
    const errors = new Array<string>();
    if (this._action.length === 0 && this._notAction.length === 0) {
      errors.push(
        "A PolicyStatement must specify at least one 'action' or 'notAction'.",
      );
    }
    return errors;
  }

  /**
   * Validate that the policy statement satisfies all requirements for a resource-based policy.
   *
   * @returns An array of validation error messages, or an empty array if the statement is valid.
   */
  public validateForResourcePolicy(): string[] {
    const errors = this.validateForAnyPolicy();
    if (this._principals.length === 0 && this._notPrincipals.length === 0) {
      errors.push(
        "A PolicyStatement used in a resource-based policy must specify at least one IAM principal.",
      );
    }
    return errors;
  }

  /**
   * Validate that the policy statement satisfies all requirements for an identity-based policy.
   *
   * @returns An array of validation error messages, or an empty array if the statement is valid.
   */
  public validateForIdentityPolicy(): string[] {
    const errors = this.validateForAnyPolicy();
    if (this._principals.length > 0 || this._notPrincipals.length > 0) {
      errors.push(
        "A PolicyStatement used in an identity-based policy cannot specify any IAM principals.",
      );
    }
    if (this._resource.length === 0 && this._notResource.length === 0) {
      errors.push(
        "A PolicyStatement used in an identity-based policy must specify at least one resource.",
      );
    }
    return errors;
  }

  /**
   * The Actions added to this statement
   */
  public get actions() {
    return this._action.copy();
  }

  /**
   * The NotActions added to this statement
   */
  public get notActions() {
    return this._notAction.copy();
  }

  /**
   * The Principals added to this statement
   */
  public get principals(): IPrincipal[] {
    return this._principals.copy();
  }

  /**
   * The NotPrincipals added to this statement
   */
  public get notPrincipals(): IPrincipal[] {
    return this._notPrincipals.copy();
  }

  /**
   * The Resources added to this statement
   */
  public get resources() {
    return this._resource.copy();
  }

  /**
   * The NotResources added to this statement
   */
  public get notResources() {
    return this._notResource.copy();
  }

  /**
   * The conditions added to this statement
   */
  public get conditions(): Conditions {
    return toConditions(this._conditionMap);
  }

  /**
   * Make the PolicyStatement immutable
   *
   * After calling this, any of the `addXxx()` methods will throw an exception.
   *
   * Libraries that lazily generate statement bodies can override this method to
   * fill the actual PolicyStatement fields. Be aware that this method may be called
   * multiple times.
   */
  public freeze(): PolicyStatement {
    this._frozen = true;
    return this;
  }

  /**
   * Whether the PolicyStatement has been frozen
   *
   * The statement object is frozen when `freeze()` is called.
   */
  public get frozen(): boolean {
    return this._frozen;
  }

  /**
   * Estimate the size of this policy statement
   *
   * By necessity, this will not be accurate. We'll do our best to overestimate
   * so we won't have nasty surprises.
   *
   * @internal
   */
  public _estimateSize(options: EstimateSizeOptions): number {
    let ret = 0;

    const { actionEstimate, arnEstimate } = options;

    ret += `"Effect": "${this.effect}",`.length;

    count("Action", this.actions, actionEstimate);
    count("NotAction", this.notActions, actionEstimate);
    count("Resource", this.resources, arnEstimate);
    count("NotResource", this.notResources, arnEstimate);

    ret += this.principals.length * arnEstimate;
    ret += this.notPrincipals.length * arnEstimate;

    ret += JSON.stringify(toConditionJson(...this.conditions)).length;
    return ret;

    function count(key: string, values: string[], tokenSize: number) {
      if (values.length > 0) {
        ret +=
          key.length +
          5 /* quotes, colon, brackets */ +
          sum(
            values.map(
              (v) =>
                (Token.isUnresolved(v) ? tokenSize : v.length) +
                3 /* quotes, separator */,
            ),
          );
      }
    }
  }

  /**
   * Throw an exception when the object is frozen
   */
  private assertNotFrozen(method: string) {
    if (this._frozen) {
      throw new Error(
        `${method}: freeze() has been called on this PolicyStatement previously, so it can no longer be modified`,
      );
    }
  }
}

/**
 * The Effect element of an IAM policy
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_effect.html
 */
export enum Effect {
  /**
   * Allows access to a resource in an IAM policy statement. By default, access to resources are denied.
   */
  ALLOW = "Allow",

  /**
   * Explicitly deny access to a resource. By default, all requests are denied implicitly.
   *
   * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
   */
  DENY = "Deny",
}

/**
 * Condition for when an IAM policy is in effect. Maps from the keys in a request's context to
 * a string value or array of string values. See the Conditions interface for more details.
 */
export type Condition =
  dataAwsIamPolicyDocument.DataAwsIamPolicyDocumentStatementCondition;

/**
 * Conditions for when an IAM Policy is in effect, specified in the following structure:
 *
 * `{ "Operator": { "keyInRequestContext": "value" } }`
 *
 * The value can be either a single string value or an array of string values.
 *
 * For more information, including which operators are supported, see [the IAM
 * documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
 */
export type Conditions = Array<Condition>;
// TODO: Support IResolvable Condition?

class JsonPrincipal extends PrincipalBase {
  public readonly policyFragment: PrincipalPolicyFragment;
  public readonly principals: PrincipalProps[] = [];

  constructor(json: any = {}) {
    super();
    this.policyFragment = PrincipalPolicyFragment.fromJson(json);
  }

  public dedupeString(): string | undefined {
    return JSON.stringify(this.policyFragment);
  }
}

/**
 * Options for _estimateSize
 *
 * These can optionally come from context, but it's too expensive to look
 * them up every time so we bundle them into a struct first.
 *
 * @internal
 */
export interface EstimateSizeOptions {
  /**
   * Estimated size of an unresolved ARN
   */
  readonly arnEstimate: number;

  /**
   * Estimated size of an unresolved action
   */
  readonly actionEstimate: number;
}

/**
 * Derive the size estimation options from context
 *
 * @internal
 */
export function deriveEstimateSizeOptions(
  _scope: IConstruct,
): EstimateSizeOptions {
  const actionEstimate = 20;
  const arnEstimate = DEFAULT_ARN_SIZE_ESTIMATE;
  return { actionEstimate, arnEstimate };
}

/**
 * A class that behaves both as a set and an array
 *
 * Used for the elements of a PolicyStatement. In practice they behave as sets,
 * but we have thousands of snapshot tests in existence that will rely on a
 * particular order so we can't just change the type to `Set<>` wholesale without
 * causing a lot of churn.
 */
class OrderedSet<A> {
  private readonly set = new Set<A>();
  private readonly array = new Array<A>();

  /**
   * Add new elements to the set
   *
   * @param xs the elements to be added
   *
   * @returns the elements actually added
   */
  public push(...xs: readonly A[]): A[] {
    const ret = new Array<A>();
    for (const x of xs) {
      if (this.set.has(x)) {
        continue;
      }
      this.set.add(x);
      this.array.push(x);
      ret.push(x);
    }
    return ret;
  }

  public get length() {
    return this.array.length;
  }

  public copy(): A[] {
    return [...this.array];
  }

  /**
   * Direct (read-only) access to the underlying array
   *
   * (Saves a copy)
   */
  public direct(): readonly A[] {
    return this.array;
  }
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

// ref: https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-iam/lib/private

// An IAM value is a string or an intrinsic value
export type IamValue =
  | string
  | Record<string, any>
  | Array<string | Record<string, any>>;

interface StatementSchema {
  readonly Sid?: string;
  readonly Effect?: string;
  readonly Principal?: string | string[] | Record<string, IamValue>;
  readonly NotPrincipal?: string | string[] | Record<string, IamValue>;
  readonly Resource?: IamValue;
  readonly NotResource?: IamValue;
  readonly Action?: IamValue;
  readonly NotAction?: IamValue;
  readonly Condition?: unknown;
}

function normalizeStatement(s: StatementSchema) {
  return noUndef({
    Action: _norm(s.Action, { unique: true }),
    NotAction: _norm(s.NotAction, { unique: true }),
    Condition: _norm(s.Condition),
    Effect: _norm(s.Effect),
    Principal: _normPrincipal(s.Principal),
    NotPrincipal: _normPrincipal(s.NotPrincipal),
    Resource: _norm(s.Resource, { unique: true }),
    NotResource: _norm(s.NotResource, { unique: true }),
    Sid: _norm(s.Sid),
  });

  function _norm(
    values: any,
    { unique = false }: { unique: boolean } = { unique: false },
  ) {
    if (values == null) {
      return undefined;
    }

    if (Token.isUnresolved(values)) {
      return values;
    }

    if (Array.isArray(values)) {
      if (!values || values.length === 0) {
        return undefined;
      }

      if (values.length === 1) {
        return values[0];
      }

      return unique ? Array.from(new Set(values)) : values;
    }

    if (values && typeof values === "object") {
      if (Object.keys(values).length === 0) {
        return undefined;
      }
    }

    return values;
  }

  function _normPrincipal(
    principal?: string | string[] | { [key: string]: any },
  ) {
    if (!principal) {
      return undefined;
    }
    if (typeof principal === "string") {
      return principal;
    }
    if (Array.isArray(principal) || typeof principal !== "object") {
      return undefined;
    }
    const keys = Object.keys(principal);
    if (keys.length === 0) {
      return undefined;
    }

    const result: any = {};
    for (const key of keys) {
      const normVal = _norm(principal[key]);
      if (normVal) {
        result[key] = normVal;
      }
    }
    return result;
  }
}

function noUndef(x: any): any {
  const ret: any = {};
  for (const [key, value] of Object.entries(x)) {
    if (value !== undefined) {
      ret[key] = value;
    }
  }
  return ret;
}

function ensureArrayOrUndefined(field: any) {
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string" && !Array.isArray(field)) {
    throw new Error("Fields must be either a string or an array of strings");
  }
  if (Array.isArray(field) && !!field.find((f: any) => typeof f !== "string")) {
    throw new Error("Fields must be either a string or an array of strings");
  }
  return Array.isArray(field) ? field : [field];
}

export function isStringOrArrayOfStrings(
  value: unknown,
): value is string | string[] {
  if (typeof value === "string") {
    return true;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return true;
  }
  return false;
}

/**
 * Convert a condition JSON object to a list of Terraform AWS Policy Statement Conditions
 *
 * JSON object is specified in the following structure:
 *
 * `{ "Operator": { "keyInRequestContext": "value" } }`
 *
 * The value can be either a single string value or an array of string values.
 *
 * For more information, including which operators are supported, see [the IAM
 * documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html).
 * @param conditionJson The condition JSON object
 * @returns The list of Terraform condition objects
 */
export function fromConditionJson(
  conditionJson: Record<string, unknown> | undefined,
): Conditions | undefined {
  if (!conditionJson) {
    return undefined;
  }
  const result = new Array<Condition>();

  for (const [test, variables] of Object.entries(conditionJson)) {
    if (Array.isArray(variables)) {
      throw new Error(
        `Invalid event pattern field { ${test}: ${JSON.stringify(
          variables,
        )} }. All fields must be objects`,
      );
    }
    for (const [variable, value] of Object.entries(variables as any)) {
      result.push({
        test,
        variable,
        values: Array.isArray(value) ? value : [value],
      });
    }
  }

  return result;
}

/**
 * flatten Conditions mapped by test and variable to an array of Terraform AWS Policy Statement Conditions
 * @param conditionMap The condition map
 * @returns The list of Terraform condition objects
 */
export function toConditions(conditionMap: ConditionMap): Conditions {
  return Object.values(conditionMap).flatMap((variables) =>
    Object.values(variables),
  );
  // const conditions: Conditions = [];
  // for (const variablesMap of Object.values(conditionMap)) {
  //   for (const condition of Object.values(variablesMap)) {
  //     conditions.push(condition);
  //   }
  // }
  // return conditions;
}

/**
 * Convert a list of Terraform AWS Policy Statement condition objects back to a condition JSON object
 * @param conditions The list of Terraform condition objects
 * @returns The condition JSON object
 */
export function toConditionJson(
  ...conditions: Conditions
): Record<string, any> {
  const conditionJson: Record<string, any> = {};

  for (const condition of conditions) {
    const { test, variable, values } = condition;

    if (!conditionJson[test]) {
      conditionJson[test] = {};
    }

    if (values.length === 1) {
      conditionJson[test][variable] = values[0];
    } else {
      conditionJson[test][variable] = values;
    }
  }

  return conditionJson;
}

/**
 * Validate that the given value is a valid Json Condition object
 *
 * AWS CDK IAM library relies on being able to pass in a `Json` instance for
 * a `Condition`.
 */
export function validateConditionObject(
  x: unknown,
): asserts x is Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) {
    throw new Error(
      "A Condition should be represented as a map of operator to value",
    );
  }
}
