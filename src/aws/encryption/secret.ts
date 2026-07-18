// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret.ts

import {
  secretsmanagerSecret,
  dataAwsSecretsmanagerSecretVersion,
  dataAwsSecretsmanagerRandomPassword,
  secretsmanagerSecretVersion,
} from "@cdktn/provider-aws";
import { Lazy, Token } from "cdktn";
import { IConstruct, Construct } from "constructs";
import { IKey } from "./key";
import { ResourcePolicy } from "./policy";
import { RotationSchedule, RotationScheduleOptions } from "./rotation-schedule";
import { ViaServicePrincipal } from "./via-service-principal";
import { Duration } from "../../duration";
import { ValidationError } from "../../errors";
import { Fn } from "../../terra-func";
import { TokenComparison, tokenCompareStrings } from "../../token";
import { ArnFormat } from "../arn";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as iam from "../iam";

const SECRET_SYMBOL = Symbol.for("terraconstructs/lib/aws/encryption.Secret");

/**
 * A secret in AWS Secrets Manager.
 */
export interface ISecret extends IAwsConstruct {
  /**
   * The customer-managed encryption key that is used to encrypt this secret, if any. When not specified, the default
   * KMS key for the account and region is being used.
   */
  readonly encryptionKey?: IKey;

  /**
   * The ARN of the secret in AWS Secrets Manager. Will return the full ARN if available, otherwise a partial arn.
   * For secrets imported by the deprecated `fromSecretName`, it will return the `secretName`.
   * @attribute
   */
  readonly secretArn: string;

  /**
   * The full ARN of the secret in AWS Secrets Manager, which is the ARN including the Secrets Manager-supplied 6-character suffix.
   * This is equal to `secretArn` in most cases, but is undefined when a full ARN is not available (e.g., secrets imported by name).
   */
  readonly secretFullArn?: string;

  /**
   * The name of the secret.
   *
   * For "owned" secrets, this will be the full resource name (secret name + suffix), unless the
   * '@aws-cdk/aws-secretsmanager:parseOwnedSecretName' feature flag is set.
   */
  readonly secretName: string;

  /**
   * Retrieve the value of the stored secret as a `SecretValue`.
   * @attribute
   */
  readonly secretValue: string; // SecretValue;

  /**
   * Interpret the secret as a JSON object and return a field's value from it as a `SecretValue`.
   */
  secretValueFromJson(key: string): string; //SecretValue;

  /**
   * Grants reading the secret value to some role.
   *
   * @param grantee       the principal being granted permission.
   * @param versionStages the version stages the grant is limited to. If not specified, no restriction on the version
   *                      stages is applied.
   */
  grantRead(grantee: iam.IGrantable, versionStages?: string[]): iam.Grant;

  /**
   * Grants writing and updating the secret value to some role.
   *
   * @param grantee       the principal being granted permission.
   */
  grantWrite(grantee: iam.IGrantable): iam.Grant;

  /**
   * Adds a rotation schedule to the secret.
   */
  addRotationSchedule(
    id: string,
    options: RotationScheduleOptions,
  ): RotationSchedule;

  /**
   * Adds a statement to the IAM resource policy associated with this secret.
   *
   * If this secret was created in this stack, a resource policy will be
   * automatically created upon the first call to `addToResourcePolicy`. If
   * the secret is imported, then this is a no-op.
   */
  addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * Denies the `DeleteSecret` action to all principals within the current
   * account.
   */
  denyAccountRootDelete(): void;

  /**
   * Attach a target to this secret.
   *
   * NOTE: TerraConstructs does not yet ship any concrete
   * `ISecretAttachmentTarget` implementations (the aws-rds/docdb/redshift
   * modules that provide them upstream have not been ported). Consumers
   * must supply their own implementation of `ISecretAttachmentTarget`
   * until those modules exist. See `ISecretAttachmentTarget` for details.
   *
   * @param target The target to attach.
   * @returns An attached secret
   */
  attach(target: ISecretAttachmentTarget): ISecret;
}

/**
 * The properties required to create a new secret in AWS Secrets Manager.
 */
export interface SecretProps extends AwsConstructProps {
  /**
   * An optional, human-friendly description of the secret.
   *
   * @default - No description.
   */
  readonly description?: string;

  /**
   * The customer-managed encryption key to use for encrypting the secret value.
   *
   * @default - A default KMS key for the account and region is used.
   */
  readonly encryptionKey?: IKey;

  /**
   * Configuration for how to generate a secret value.
   *
   * Only one of `secretString` and `generateSecretString` can be provided.
   *
   * @default - 32 characters with upper-case letters, lower-case letters, punctuation and numbers (at least one from each
   * category), per the default values of ``SecretStringGenerator``.
   */
  readonly generateSecretString?: SecretStringGenerator;

  /**
   * A name for the secret. Note that deleting secrets from SecretsManager does not happen immediately, but after a 7 to
   * 30 days blackout period. During that period, it is not possible to create another secret that shares the same name.
   *
   * @default - A name is generated by Terraform.
   */
  readonly secretName?: string;

  /**
   * Initial value for the secret
   *
   * **NOTE:** *It is **highly** encouraged to leave this field undefined and allow SecretsManager to create the secret value.
   * The secret string -- if provided -- will be included in the output of the cdk as part of synthesis,
   * and will appear in the Terraform configuration in the console. This can be secure(-ish) if that value is merely reference to
   * another resource (or one of its attributes), but if the value is a plaintext string, it will be visible to anyone with access
   * to the Terraform configuration (via the AWS Console, SDKs, or CLI).
   *
   * Specifies text data that you want to encrypt and store in this new version of the secret.
   * May be a simple string value. To provide a string representation of JSON structure, use `SecretProps.secretObjectValue` instead.
   *
   * Only one of `secretStringValue`, 'secretObjectValue', and `generateSecretString` can be provided.
   *
   * @default - SecretsManager generates a new secret value.
   */
  readonly secretStringValue?: string; //SecretValue;

  /**
   * Initial value for a JSON secret
   *
   * **NOTE:** *It is **highly** encouraged to leave this field undefined and allow SecretsManager to create the secret value.
   * The secret object -- if provided -- will be included in the output of the cdk as part of synthesis,
   * and will appear in the Terraform configuration in the console. This can be secure(-ish) if that value is merely reference to
   * another resource (or one of its attributes), but if the value is a plaintext string, it will be visible to anyone with access
   * to the Terraform configuration (via the AWS Console, SDKs, or CLI).
   *
   * Specifies a JSON object that you want to encrypt and store in this new version of the secret.
   * To specify a simple string value instead, use `SecretProps.secretStringValue`
   *
   * Only one of `secretStringValue`, 'secretObjectValue', and `generateSecretString` can be provided.
   *
   * @example
   * declare const user: iam.User;
   * declare const accessKey: iam.AccessKey;
   * declare const stack: Stack;
   * new encryption.Secret(stack, 'JSONSecret', {
   *   secretObjectValue: {
   *     username: SecretValue.unsafePlainText(user.userName), // intrinsic reference, not exposed as plaintext
   *     database: SecretValue.unsafePlainText('foo'), // rendered as plain text, but not a secret
   *     password: accessKey.secretAccessKey, // SecretValue
   *   },
   * });
   *
   * @default - SecretsManager generates a new secret value.
   */
  readonly secretObjectValue?: { [key: string]: string }; // SecretValue };

  // /**
  //  * Policy to apply when the secret is removed from this stack.
  //  *
  //  * @default - Not set.
  //  */
  // readonly removalPolicy?: RemovalPolicy;

  /**
   * (Optional) Number of days that AWS Secrets Manager waits before it can
   * delete the secret.
   *
   * This value can be 0 to force deletion without recovery or range
   * from 7 to 30 days. The default value is 30
   *
   * @default - 30 days.
   */
  readonly recoveryWindow?: Duration;

  /**
   * A list of regions where to replicate this secret.
   *
   * @default - Secret is not replicated
   */
  readonly replicaRegions?: ReplicaRegion[];
}

/**
 * Secret replica region
 */
export interface ReplicaRegion {
  /**
   * The name of the region
   */
  readonly region: string;

  /**
   * The customer-managed encryption key to use for encrypting the secret value.
   *
   * @default - A default KMS key for the account and region is used.
   */
  readonly encryptionKey?: IKey;
}

/**
 * Attributes required to import an existing secret into the Stack.
 * One ARN format (`secretCompleteArn`, `secretPartialArn`) must be provided.
 */
export interface SecretAttributes {
  /**
   * The encryption key that is used to encrypt the secret, unless the default SecretsManager key is used.
   */
  readonly encryptionKey?: IKey;

  /**
   * The complete ARN of the secret in SecretsManager. This is the ARN including the Secrets Manager 6-character suffix.
   * Cannot be used with `secretPartialArn`.
   */
  readonly secretCompleteArn?: string;

  /**
   * The partial ARN of the secret in SecretsManager. This is the ARN without the Secrets Manager 6-character suffix.
   * Cannot be used with `secretCompleteArn`.
   */
  readonly secretPartialArn?: string;
}

/**
 * The common behavior of Secrets. Users should not use this class directly, and instead use ``Secret``.
 */
abstract class SecretBase extends AwsConstructBase implements ISecret {
  public abstract readonly encryptionKey?: IKey;
  public abstract readonly secretArn: string;
  public abstract readonly secretName: string;

  protected abstract readonly autoCreatePolicy: boolean;

  private policy?: ResourcePolicy;
  private _arnForPolicies: string;

  constructor(scope: Construct, id: string, props: AwsConstructProps = {}) {
    super(scope, id, props);
    this._arnForPolicies = Lazy.stringValue({
      produce: () => {
        // TODO: Context provider not implemented
        // const consumingStack = AwsStack.of(context.scope);
        // if (this.stack.account !== consumingStack.account ||
        //   (this.stack.region !== consumingStack.region &&
        //     !consumingStack._crossRegionReferences) || !this.secretFullArn) {
        //   return `${this.secretArn}-??????`;
        // } else {
        //   return this.secretFullArn;
        // }
        if (this.secretFullArn) {
          return this.secretFullArn;
        }
        return `${this.secretArn}-??????`;
      },
    });

    this.node.addValidation({
      validate: () => this.policy?.document.validateForResourcePolicy() ?? [],
    });
  }

  public get outputs(): Record<string, any> {
    return {
      secretArn: this.secretArn,
      secretName: this.secretName,
      secretFullArn: this.secretFullArn,
    };
  }

  public get secretFullArn(): string | undefined {
    return this.secretArn;
  }

  public grantRead(
    grantee: iam.IGrantable,
    versionStages?: string[],
  ): iam.Grant {
    // @see https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_identity-based-policies.html

    const result = iam.Grant.addToPrincipalOrResource({
      grantee,
      actions: [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
      ],
      resourceArns: [this.arnForPolicies],
      resource: this,
    });

    const statement = result.principalStatement || result.resourceStatement;
    if (versionStages != null && statement) {
      statement.addCondition({
        test: "ForAnyValue:StringEquals",
        variable: "secretsmanager:VersionStage",
        values: versionStages,
      });
    }

    if (this.encryptionKey) {
      // @see https://docs.aws.amazon.com/kms/latest/developerguide/services-secrets-manager.html
      this.encryptionKey.grantDecrypt(
        new ViaServicePrincipal(
          `secretsmanager.${this.stack.region}.amazonaws.com`,
          grantee.grantPrincipal,
        ),
      );
    }

    const crossAccount = tokenCompareStrings(
      this.stack.account,
      grantee.grantPrincipal.principalAccount || "",
    );

    // Throw if secret is not imported and it's shared cross account and no KMS key is provided
    if (
      this instanceof Secret &&
      result.resourceStatement &&
      !this.encryptionKey &&
      crossAccount === TokenComparison.DIFFERENT
    ) {
      throw new ValidationError(
        "KMS Key must be provided for cross account access to Secret",
        this,
      );
    }

    return result;
  }

  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    // See https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_identity-based-policies.html
    const result = iam.Grant.addToPrincipalOrResource({
      grantee,
      actions: [
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecret",
        "secretsmanager:UpdateSecretVersionStage",
      ],
      resourceArns: [this.arnForPolicies],
      resource: this,
    });

    if (this.encryptionKey) {
      // See https://docs.aws.amazon.com/kms/latest/developerguide/services-secrets-manager.html
      this.encryptionKey.grantEncrypt(
        new ViaServicePrincipal(
          `secretsmanager.${this.stack.region}.amazonaws.com`,
          grantee.grantPrincipal,
        ),
      );
    }

    // Throw if secret is not imported and it's shared cross account and no KMS key is provided
    if (
      this instanceof Secret &&
      result.resourceStatement &&
      !this.encryptionKey
    ) {
      throw new ValidationError(
        "KMS Key must be provided for cross account access to Secret",
        this,
      );
    }

    return result;
  }

  public get secretValue(): string {
    return this.secretValueFromJson("");
  }

  public secretValueFromJson(jsonField: string): string {
    if (!this.secretArn && !this.secretName) {
      throw new ValidationError(
        "Cannot retrieve secret value from JSON for a secret without ARN or Friendly name.",
        this,
      );
    }
    const id = "SecretValue";
    let secretDataSource = this.node.tryFindChild(
      id,
    ) as dataAwsSecretsmanagerSecretVersion.DataAwsSecretsmanagerSecretVersion;
    if (!secretDataSource) {
      secretDataSource =
        new dataAwsSecretsmanagerSecretVersion.DataAwsSecretsmanagerSecretVersion(
          this,
          id,
          {
            secretId: this.secretArn || this.secretName,
            versionStage: "AWSCURRENT",
          },
        );
    }
    if (jsonField === "") {
      return secretDataSource.secretString;
    }
    // SecretValue.secretsManager(this.secretArn, { jsonField });
    return Fn.lookup(Fn.jsondecode(secretDataSource.secretString), jsonField);
  }

  public addRotationSchedule(
    id: string,
    options: RotationScheduleOptions,
  ): RotationSchedule {
    return new RotationSchedule(this, id, {
      secret: this,
      ...options,
    });
  }

  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (!this.policy && this.autoCreatePolicy) {
      this.policy = new ResourcePolicy(this, "Policy", { secret: this });
    }

    if (this.policy) {
      this.policy.document.addStatements(statement);
      return { statementAdded: true, policyDependable: this.policy };
    }
    return { statementAdded: false };
  }

  public denyAccountRootDelete() {
    this.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:DeleteSecret"],
        effect: iam.Effect.DENY,
        resources: ["*"],
        principals: [new iam.AccountRootPrincipal()],
      }),
    );
  }

  /**
   * Provides an identifier for this secret for use in IAM policies.
   * If there is a full ARN, this is just the ARN;
   * if we have a partial ARN -- due to either importing by secret name or partial ARN --
   * then we need to add a suffix to capture the full ARN's format.
   */
  protected get arnForPolicies() {
    return this._arnForPolicies;
  }

  /**
   * Attach a target to this secret
   *
   * @param target The target to attach
   * @returns An attached secret
   */
  public attach(target: ISecretAttachmentTarget): ISecret {
    const id = "Attachment";
    const existing = this.node.tryFindChild(id);

    if (existing) {
      throw new ValidationError(
        "Secret is already attached to a target.",
        this,
      );
    }

    return new SecretTargetAttachment(this, id, {
      secret: this,
      target,
    });
  }
}

/**
 * Creates a new secret in AWS SecretsManager.
 */
export class Secret extends SecretBase {
  /**
   * Return whether the given object is a Secret.
   */
  public static isSecret(x: any): x is Secret {
    return x !== null && typeof x === "object" && SECRET_SYMBOL in x;
  }

  /** Imports a secret by complete ARN. The complete ARN is the ARN with the Secrets Manager-supplied suffix. */
  public static fromSecretCompleteArn(
    scope: Construct,
    id: string,
    secretCompleteArn: string,
  ): ISecret {
    return Secret.fromSecretAttributes(scope, id, { secretCompleteArn });
  }

  /** Imports a secret by partial ARN. The partial ARN is the ARN without the Secrets Manager-supplied suffix. */
  public static fromSecretPartialArn(
    scope: Construct,
    id: string,
    secretPartialArn: string,
  ): ISecret {
    return Secret.fromSecretAttributes(scope, id, { secretPartialArn });
  }

  /**
   * Imports a secret by secret name.
   * A secret with this name must exist in the same account & region.
   * Please note this method returns ISecret that only contains partial ARN and could lead to AccessDeniedException
   * when you pass the partial ARN to CLI or SDK to get the secret value. If your secret name ends with a hyphen and
   * 6 characters, you should always use fromSecretCompleteArn() to avoid potential AccessDeniedException.
   * @see https://docs.aws.amazon.com/secretsmanager/latest/userguide/troubleshoot.html#ARN_secretnamehyphen
   */
  public static fromSecretNameV2(
    scope: Construct,
    id: string,
    secretName: string,
  ): ISecret {
    return new (class extends SecretBase {
      public readonly encryptionKey = undefined;
      public readonly secretName = secretName;
      public readonly secretArn = this.partialArn;
      protected readonly autoCreatePolicy = false;
      public get secretFullArn() {
        return undefined;
      }
      // Creates a "partial" ARN from the secret name. The "full" ARN would include the SecretsManager-provided suffix.
      private get partialArn(): string {
        return this.stack.formatArn({
          service: "secretsmanager",
          resource: "secret",
          resourceName: secretName,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        });
      }
    })(scope, id);
  }

  /**
   * Import an existing secret into the Stack.
   *
   * @param scope the scope of the import.
   * @param id    the ID of the imported Secret in the construct tree.
   * @param attrs the attributes of the imported secret.
   */
  public static fromSecretAttributes(
    scope: Construct,
    id: string,
    attrs: SecretAttributes,
  ): ISecret {
    let secretArn: string;
    let secretArnIsPartial: boolean;

    if (
      (attrs.secretCompleteArn && attrs.secretPartialArn) ||
      (!attrs.secretCompleteArn && !attrs.secretPartialArn)
    ) {
      throw new ValidationError(
        "must use only one of `secretCompleteArn` or `secretPartialArn`",
        scope,
      );
    }
    if (attrs.secretCompleteArn && !arnIsComplete(attrs.secretCompleteArn)) {
      throw new ValidationError(
        "`secretCompleteArn` does not appear to be complete; missing 6-character suffix",
        scope,
      );
    }
    [secretArn, secretArnIsPartial] = attrs.secretCompleteArn
      ? [attrs.secretCompleteArn, false]
      : [attrs.secretPartialArn!, true];

    return new (class extends SecretBase {
      public readonly encryptionKey = attrs.encryptionKey;
      public readonly secretArn = secretArn;
      public readonly secretName = parseSecretName(scope, secretArn);
      protected readonly autoCreatePolicy = false;
      public get secretFullArn() {
        return secretArnIsPartial ? undefined : secretArn;
      }
      protected get arnForPolicies() {
        return secretArnIsPartial ? `${secretArn}-??????` : secretArn;
      }
    })(scope, id, { environmentFromArn: secretArn });
  }

  public readonly encryptionKey?: IKey;
  public readonly secretArn: string;
  public readonly secretName: string;
  public readonly secretVersionArn: string;

  /**
   * The string of the characters that are excluded in this secret
   * when it is generated.
   */
  public readonly excludeCharacters?: string;

  private replicaRegions: secretsmanagerSecret.SecretsmanagerSecretReplica[] =
    [];
  private readonly resource: secretsmanagerSecret.SecretsmanagerSecret;
  /**
   * The base secret value configured at construction (from
   * `generateSecretString`/`secretStringValue`/`secretObjectValue`), before
   * any attachment connection details are merged in. Rendered into the sole
   * `secretsmanagerSecretVersion` during `toTerraform()`.
   */
  private readonly baseSecretString?: string;
  /**
   * Connection details contributed by `attach()` to be merged into the secret
   * value. Registered (after construction) via `_attachConnectionFields()`.
   */
  private attachmentConnectionFields?: { [key: string]: string };
  /**
   * The sole secret version resource. Created lazily during `toTerraform()`
   * (the first `prepareStack()` pass) so connection details registered by a
   * later `attach()` are merged into the same version rather than creating a
   * conflicting second `AWSCURRENT` version for the same secret.
   */
  private secretVersion?: secretsmanagerSecretVersion.SecretsmanagerSecretVersion;

  protected readonly autoCreatePolicy = true;
  // TODO: Use Ephemeral Resources as soon as Hashicorp decides to update CDKTF T_T
  private readonly randomPassword?: dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword;

  constructor(scope: Construct, id: string, props: SecretProps = {}) {
    super(scope, id, props);

    const secretName = props.secretName ?? this.stack.uniqueResourceName(this);

    if (
      props.generateSecretString &&
      (props.generateSecretString.secretStringTemplate ||
        props.generateSecretString.generateStringKey) &&
      !(
        props.generateSecretString.secretStringTemplate &&
        props.generateSecretString.generateStringKey
      )
    ) {
      throw new ValidationError(
        "`secretStringTemplate` and `generateStringKey` must be specified together.",
        this,
      );
    }

    if (
      (props.generateSecretString ? 1 : 0) +
        (props.secretStringValue ? 1 : 0) +
        (props.secretObjectValue ? 1 : 0) >
      1
    ) {
      throw new ValidationError(
        "Cannot specify more than one of `generateSecretString`, `secretStringValue`, and `secretObjectValue`.",
        this,
      );
    }

    let secretString = props.secretObjectValue
      ? this.resolveSecretObjectValue(props.secretObjectValue)
      : props.secretStringValue?.toString();

    // Mirrors upstream aws-cdk: when neither a secret string nor
    // generateSecretString options are provided, default to generating a
    // random password (equivalent to CFN's `GenerateSecretString: {}`).
    const generateSecretString: SecretStringGenerator | undefined =
      props.generateSecretString ?? (secretString ? undefined : {});

    if (generateSecretString) {
      this.randomPassword =
        new dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword(
          this,
          "RandomPassword",
          {
            // note Defaults
            // https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/secretsmanager/random_password_data_source.go#L22-L59
            passwordLength: generateSecretString.passwordLength ?? 32,
            excludeUppercase: generateSecretString.excludeUppercase ?? false,
            excludeLowercase: generateSecretString.excludeLowercase ?? false,
            excludeNumbers: generateSecretString.excludeNumbers ?? false,
            excludePunctuation:
              generateSecretString.excludePunctuation ?? false,
            includeSpace: generateSecretString.includeSpace ?? false,
            requireEachIncludedType:
              generateSecretString.requireEachIncludedType ?? true,
            excludeCharacters: generateSecretString.excludeCharacters,
          },
        );

      if (generateSecretString.secretStringTemplate) {
        // If a secretStringTemplate is provided, we need to merge the generated password into it.
        const secretStringTemplate = JSON.parse(
          generateSecretString.secretStringTemplate,
        );
        secretStringTemplate[generateSecretString.generateStringKey!] =
          this.randomPassword.randomPassword;
        secretString = Fn.jsonencode(secretStringTemplate);
      } else {
        secretString = this.randomPassword.randomPassword;
      }
    }

    // // TODO: If we implement removalPolicy logic, set recoveryWindowInDays
    // // based on that.
    // const recoveryWindowInDays =
    //   props.removalPolicy === RemovalPolicy.DESTROY ? 0 : undefined;
    const recoveryWindowInDays = props.recoveryWindow?.toDays();
    // validate recovery window between 7 and 30 days
    if (
      recoveryWindowInDays !== undefined &&
      recoveryWindowInDays !== 0 &&
      (recoveryWindowInDays < 7 || recoveryWindowInDays > 30)
    ) {
      throw new ValidationError(
        "recoveryWindow must be between 7 and 30 days, or 0 to force deletion without recovery.",
        this,
      );
    }

    this.resource = new secretsmanagerSecret.SecretsmanagerSecret(
      this,
      "Resource",
      {
        name: secretName,
        description: props.description,
        kmsKeyId: props.encryptionKey?.keyArn,
        recoveryWindowInDays,
        replica: Lazy.anyValue(
          { produce: () => this.replicaRegions },
          { omitEmptyArray: true },
        ),
      },
    );

    // Store the base value; the SOLE `secretsmanagerSecretVersion` resource is
    // created lazily in `toTerraform()` (the first prepareStack pass) so that
    // connection details registered by a later `attach()` can be merged into
    // the same version, instead of creating a conflicting second AWSCURRENT
    // version for the same secret.
    // TODO: Use Ephemeral Resources as soon as Hashicorp decides to update CDKTF T_T
    this.baseSecretString = secretString;

    // TODO: Should there be a secretVersionArn property?
    this.secretArn = this.resource.arn;
    this.secretVersionArn = Lazy.stringValue({
      produce: () => this.getOrCreateSecretVersion().arn,
    });
    this.secretName = this.resource.name;
    this.encryptionKey = props.encryptionKey;

    // @see https://docs.aws.amazon.com/kms/latest/developerguide/services-secrets-manager.html#asm-authz
    const principal = new ViaServicePrincipal(
      `secretsmanager.${this.stack.region}.amazonaws.com`,
      new iam.AccountPrincipal(this.stack.account),
    );
    this.encryptionKey?.grantEncryptDecrypt(principal);
    this.encryptionKey?.grant(principal, "kms:CreateGrant", "kms:DescribeKey");

    for (const replica of props.replicaRegions ?? []) {
      this.addReplicaRegion(replica.region, replica.encryptionKey);
    }

    this.excludeCharacters = props.generateSecretString?.excludeCharacters;
  }

  private resolveSecretObjectValue(secretObject: {
    [key: string]: string; // SecretValue;
  }): string {
    // We are not using SecretValue, so can just stringify the object.
    return Fn.jsonencode(secretObject);
    // const resolvedObject: { [key: string]: string } = {};
    // for (const [key, value] of Object.entries(secretObject)) {
    //   resolvedObject[key] = value.toString();
    // }
    // return JSON.stringify(resolvedObject);
  }

  /**
   * Adds a replica region for the secret
   *
   * @param region The name of the region
   * @param encryptionKey The customer-managed encryption key to use for encrypting the secret value.
   */
  public addReplicaRegion(region: string, encryptionKey?: IKey): void {
    if (
      !Token.isUnresolved(this.stack.region) &&
      !Token.isUnresolved(region) &&
      region === this.stack.region
    ) {
      throw new ValidationError(
        "Cannot add the region where this stack is deployed as a replica region.",
        this,
      );
    }

    this.replicaRegions.push({
      region,
      kmsKeyId: encryptionKey?.keyArn,
    });
  }

  public secretValueFromJson(jsonField: string): string {
    // The version resource is created lazily in `toTerraform()`, so defer
    // reading its `secretString` attribute until synthesis (post-prepare).
    return Lazy.stringValue({
      produce: () => {
        const secretString = this.getOrCreateSecretVersion().secretString;
        if (jsonField === "") {
          return secretString;
        }
        // SecretValue.secretsManager(this.secretArn, { jsonField });
        return Fn.lookup(Fn.jsondecode(secretString), jsonField);
      },
    });
  }

  /**
   * Renders the secret string for the sole version resource, merging any
   * connection details contributed by `attach()` over the base value. Terraform
   * has no server-side merge (unlike CloudFormation's SecretTargetAttachment),
   * so the merge is expressed as `jsonencode(merge(jsondecode(base), fields))`.
   */
  private renderSecretString(): string | undefined {
    if (!this.attachmentConnectionFields) {
      return this.baseSecretString;
    }
    return Fn.jsonencode(
      Fn.merge([
        Fn.jsondecode(this.baseSecretString ?? "{}"),
        this.attachmentConnectionFields,
      ]),
    );
  }

  private getOrCreateSecretVersion(): secretsmanagerSecretVersion.SecretsmanagerSecretVersion {
    const id = "SecretVersion";
    const existing = this.node.tryFindChild(id) as
      | secretsmanagerSecretVersion.SecretsmanagerSecretVersion
      | undefined;
    if (existing) {
      return existing;
    }
    // TODO: Use Ephemeral Resources as soon as Hashicorp decides to update CDKTF T_T
    this.secretVersion =
      new secretsmanagerSecretVersion.SecretsmanagerSecretVersion(this, id, {
        secretId: this.resource.arn,
        secretString: this.renderSecretString(),
      });
    return this.secretVersion;
  }

  /**
   * Creates the sole secret version during the first `prepareStack()` pass,
   * after any `attach()` calls have registered their connection details.
   * Mirrors the idempotent `toTerraform()` pattern used by `iam/policy.ts`.
   */
  public toTerraform(): any {
    this.getOrCreateSecretVersion();
    return {};
  }

  /**
   * Registers connection details contributed by an attached target so they are
   * merged into this secret's sole version. Called by `SecretTargetAttachment`.
   * @internal
   */
  public _attachConnectionFields(fields?: { [key: string]: string }): void {
    if (!fields) {
      return;
    }
    this.attachmentConnectionFields = {
      ...(this.attachmentConnectionFields ?? {}),
      ...fields,
    };
  }
}

/**
 * A secret attachment target.
 *
 * NOTE: TerraConstructs does not yet ship any concrete implementations of
 * this interface. In upstream aws-cdk, `ISecretAttachmentTarget` is
 * implemented by `DatabaseInstance`, `DatabaseCluster`, and `DatabaseProxy`
 * (aws-rds), and by the DocDB/Redshift equivalents -- none of which have
 * been ported to TerraConstructs yet. Until they are, consumers who want to
 * attach a secret to a database (or other supported target) must implement
 * this interface themselves. See `integ/aws/encryption/apps/*.ts` for a
 * worked (test-only) example.
 */
export interface ISecretAttachmentTarget {
  /**
   * Renders the target specifications.
   */
  asSecretAttachmentTarget(): SecretAttachmentTargetProps;
}

/**
 * The type of service or database that's being associated with the secret.
 */
export enum AttachmentTargetType {
  /**
   * AWS::RDS::DBInstance
   */
  RDS_DB_INSTANCE = "AWS::RDS::DBInstance",

  /**
   * AWS::RDS::DBCluster
   */
  RDS_DB_CLUSTER = "AWS::RDS::DBCluster",

  /**
   * AWS::RDS::DBProxy
   */
  RDS_DB_PROXY = "AWS::RDS::DBProxy",

  /**
   * AWS::Redshift::Cluster
   */
  REDSHIFT_CLUSTER = "AWS::Redshift::Cluster",

  /**
   * AWS::DocDB::DBInstance
   */
  DOCDB_DB_INSTANCE = "AWS::DocDB::DBInstance",

  /**
   * AWS::DocDB::DBCluster
   */
  DOCDB_DB_CLUSTER = "AWS::DocDB::DBCluster",
}

/**
 * Attachment target specifications.
 */
export interface SecretAttachmentTargetProps {
  /**
   * The id of the target to attach the secret to.
   */
  readonly targetId: string;

  /**
   * The type of the target to attach the secret to.
   */
  readonly targetType: AttachmentTargetType;

  /**
   * Connection details to merge into the attached secret's JSON value.
   *
   * CloudFormation's `AWS::SecretsManager::SecretTargetAttachment` resolves
   * these from `targetId`/`targetType` **server-side**; the Terraform AWS
   * provider has no such server-side merge, so a target must supply the
   * connection attributes it wants folded into the secret (typically
   * `engine`, `host`, `port`, `dbname`). They are merged over the secret's
   * existing JSON value at synthesis via
   * `jsonencode(merge(jsondecode(existing), connectionFields))`.
   *
   * This field is a TerraConstructs-specific superset of the upstream aws-cdk
   * `SecretAttachmentTargetProps` (which carries only `targetId`/`targetType`).
   *
   * @default - no additional fields are merged (API-parity-only attachment)
   */
  readonly connectionFields?: { [key: string]: string };
}

/**
 * Options to add a secret attachment to a secret.
 */
export interface AttachedSecretOptions {
  /**
   * The target to attach the secret to.
   */
  readonly target: ISecretAttachmentTarget;
}

/**
 * Construction properties for an AttachedSecret.
 */
export interface SecretTargetAttachmentProps extends AttachedSecretOptions {
  /**
   * The secret to attach to the target.
   */
  readonly secret: ISecret;
}

export interface ISecretTargetAttachment extends ISecret {
  /**
   * Same as `secretArn`
   *
   * @attribute
   */
  readonly secretTargetAttachmentSecretArn: string;
}

/**
 * An attached secret.
 *
 * CloudFormation's `AWS::SecretsManager::SecretTargetAttachment` is an opaque
 * AWS orchestration call that merges a target's connection details (host,
 * port, engine, dbname, ...) into the secret's JSON value **server-side**. The
 * Terraform AWS provider has no equivalent -- there is no SecretsManager API
 * behind it -- so the maintainers recommend building that merged value
 * yourself with a single `aws_secretsmanager_secret_version`. See HashiCorp's
 * design decision (also referenced from `HostedRotation` in
 * rotation-schedule.ts):
 * https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/design-decisions/secretsmanager-secret-target-attachment.md
 *
 * TerraConstructs mirrors that recommended shape: `attach()` does NOT create a
 * second version resource (two versions managing the same secret's
 * `AWSCURRENT` would conflict). Instead it registers the target's
 * `connectionFields` (from `asSecretAttachmentTarget()`) onto the owned
 * `Secret`, which merges them into its SOLE version -- created lazily in
 * `Secret.toTerraform()` -- via `jsonencode(merge(jsondecode(base), fields))`.
 * The result is exactly one `aws_secretsmanager_secret_version` containing the
 * base credentials plus the target's connection details.
 *
 * Concrete `ISecretAttachmentTarget` implementers (`DatabaseInstance`,
 * `DatabaseCluster`, ... in aws-rds/docdb/redshift) are not yet ported to
 * TerraConstructs; until they are, consumers implement the interface
 * themselves. See `integ/aws/encryption/apps/*.ts` for a worked (test-only)
 * example of a target that supplies real connection details.
 *
 * `addToResourcePolicy` calls are forwarded to the original secret so that
 * only a single resource policy is ever created for the secret (AWS allows
 * only one `aws_secretsmanager_secret_policy` per secret ARN).
 *
 * `secretArn`/`secretName` mirror the attached secret since there is no
 * separate attachment ARN in Terraform.
 */
export class SecretTargetAttachment
  extends SecretBase
  implements ISecretTargetAttachment
{
  public static fromSecretTargetAttachmentSecretArn(
    scope: Construct,
    id: string,
    secretTargetAttachmentSecretArn: string,
  ): ISecretTargetAttachment {
    class Import extends SecretBase implements ISecretTargetAttachment {
      public readonly encryptionKey: IKey | undefined = undefined;
      public readonly secretArn: string = secretTargetAttachmentSecretArn;
      public readonly secretTargetAttachmentSecretArn: string =
        secretTargetAttachmentSecretArn;
      public readonly secretName: string = parseSecretName(
        scope,
        secretTargetAttachmentSecretArn,
      );
      protected readonly autoCreatePolicy = false;
    }

    return new Import(scope, id);
  }

  public readonly encryptionKey?: IKey;
  public readonly secretArn: string;
  public readonly secretName: string;

  /**
   * @attribute
   */
  public readonly secretTargetAttachmentSecretArn: string;

  protected readonly autoCreatePolicy = true;

  private readonly attachedSecret: ISecret;

  constructor(
    scope: Construct,
    id: string,
    props: SecretTargetAttachmentProps,
  ) {
    super(scope, id);
    this.attachedSecret = props.secret;

    // Terraform has no server-side merge, so fold the target's connection
    // details into the attached secret's SOLE version (created lazily in
    // `Secret.toTerraform()`). No separate/duplicate version is created here.
    const targetProps = props.target.asSecretAttachmentTarget();
    if (Secret.isSecret(this.attachedSecret)) {
      (this.attachedSecret as Secret)._attachConnectionFields(
        targetProps.connectionFields,
      );
    }

    this.encryptionKey = this.attachedSecret.encryptionKey;
    this.secretName = this.attachedSecret.secretName;

    // No separate attachment ARN exists in Terraform, so the attached
    // secret's own ARN is the correct reference.
    this.secretArn = this.attachedSecret.secretArn;
    this.secretTargetAttachmentSecretArn = this.attachedSecret.secretArn;
  }

  /**
   * Forward any additions to the resource policy to the original secret.
   * This is required because a secret can only have a single resource policy.
   * If we do not forward policy additions, a new policy resource would be
   * created using the secret attachment ARN, which AWS APIs would reject.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    return this.attachedSecret.addToResourcePolicy(statement);
  }
}

/**
 * Configuration to generate secrets such as passwords automatically.
 */
export interface SecretStringGenerator {
  /**
   * Specifies that the generated password shouldn't include uppercase letters.
   *
   * @default false
   */
  readonly excludeUppercase?: boolean;

  /**
   * Specifies whether the generated password must include at least one of every allowed character type.
   *
   * @default true
   */
  readonly requireEachIncludedType?: boolean;

  /**
   * Specifies that the generated password can include the space character.
   *
   * @default false
   */
  readonly includeSpace?: boolean;

  /**
   * A string that includes characters that shouldn't be included in the generated password. The string can be a minimum
   * of ``0`` and a maximum of ``4096`` characters long.
   *
   * @default no exclusions
   */
  readonly excludeCharacters?: string;

  /**
   * The desired length of the generated password.
   *
   * @default 32
   */
  readonly passwordLength?: number;

  /**
   * Specifies that the generated password shouldn't include punctuation characters.
   *
   * @default false
   */
  readonly excludePunctuation?: boolean;

  /**
   * Specifies that the generated password shouldn't include lowercase letters.
   *
   * @default false
   */
  readonly excludeLowercase?: boolean;

  /**
   * Specifies that the generated password shouldn't include digits.
   *
   * @default false
   */
  readonly excludeNumbers?: boolean;

  /**
   * A properly structured JSON string that the generated password can be added to. The ``generateStringKey`` is
   * combined with the generated random string and inserted into the JSON structure that's specified by this parameter.
   * The merged JSON string is returned as the completed SecretString of the secret. If you specify ``secretStringTemplate``
   * then ``generateStringKey`` must be also be specified.
   */
  readonly secretStringTemplate?: string;

  /**
   * The JSON key name that's used to add the generated password to the JSON structure specified by the
   * ``secretStringTemplate`` parameter. If you specify ``generateStringKey`` then ``secretStringTemplate``
   * must be also be specified.
   */
  readonly generateStringKey?: string;
}

/** Parses the secret name from the ARN. */
function parseSecretName(construct: IConstruct, secretArn: string) {
  const resourceName = AwsStack.ofAwsConstruct(construct).splitArn(
    secretArn,
    ArnFormat.COLON_RESOURCE_NAME,
  ).resourceName;
  if (resourceName) {
    // Can't operate on the token to remove the SecretsManager suffix, so just return the full secret name
    if (Token.isUnresolved(resourceName)) {
      return resourceName;
    }

    // Secret resource names are in the format `${secretName}-${6-character SecretsManager suffix}`
    // If there is no hyphen (or 6-character suffix) assume no suffix was provided, and return the whole name.
    const lastHyphenIndex = resourceName.lastIndexOf("-");
    const hasSecretsSuffix =
      lastHyphenIndex !== -1 &&
      resourceName.slice(lastHyphenIndex + 1).length === 6;
    return hasSecretsSuffix
      ? resourceName.slice(0, lastHyphenIndex)
      : resourceName;
  }
  throw new ValidationError(
    "invalid ARN format; no secret name provided",
    construct,
  );
}

/** Performs a best guess if an ARN is complete, based on if it ends with a 6-character suffix. */
function arnIsComplete(secretArn: string): boolean {
  return Token.isUnresolved(secretArn) || /-[a-z0-9]{6}$/i.test(secretArn);
}

/**
 * Mark all instances of 'Secret'.
 */
Object.defineProperty(Secret.prototype, SECRET_SYMBOL, {
  value: true,
  enumerable: false,
  writable: false,
});
