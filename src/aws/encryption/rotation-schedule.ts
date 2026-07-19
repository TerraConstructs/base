// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-secretsmanager/lib/rotation-schedule.ts

import { secretsmanagerSecretRotation } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { ISecret } from "./secret";
import { ViaServicePrincipal } from "./via-service-principal";
import { Duration } from "../../duration";
import { ValidationError, UnscopedValidationError } from "../../errors";
import { AwsConstructBase } from "../aws-construct";
import * as compute from "../compute";
import * as iam from "../iam";
import { Schedule } from "../notify";

/**
 * Options to add a rotation schedule to a secret.
 */
export interface RotationScheduleOptions {
  /**
   * A Lambda function that can rotate the secret.
   *
   * @default - either `rotationLambda` or `hostedRotation` must be specified
   */
  readonly rotationLambda?: compute.IFunction;

  /**
   * Hosted rotation
   *
   * @default - either `rotationLambda` or `hostedRotation` must be specified
   */
  readonly hostedRotation?: HostedRotation;

  /**
   * Specifies the number of days after the previous rotation before
   * Secrets Manager triggers the next automatic rotation.
   *
   * The minimum value is 4 hours.
   * The maximum value is 1000 days.
   *
   * TERRACONSTRUCTS DEVIATION: upstream allows a value of zero (`Duration.days(0)`) to mean "do not
   * create RotationRules" -- CloudFormation's `AWS::SecretsManager::RotationSchedule.RotationRules`
   * is entirely optional. Terraform's `aws_secretsmanager_secret_rotation` resource requires a
   * populated `rotation_rules` block (verified against `SecretsmanagerSecretRotationConfig`: the
   * block itself is a required field, even though its sub-fields are optional) -- an empty block
   * fails `tofu validate`. Passing `Duration.days(0)` therefore throws a `ValidationError` here
   * instead of silently synthesizing invalid Terraform.
   *
   * @default Duration.days(30)
   */
  readonly automaticallyAfter?: Duration;

  /**
   * Specifies whether to rotate the secret immediately or wait until the next
   * scheduled rotation window.
   *
   * @default true
   */
  readonly rotateImmediatelyOnUpdate?: boolean;
}

/**
 * Construction properties for a RotationSchedule.
 */
export interface RotationScheduleProps extends RotationScheduleOptions {
  /**
   * The secret to rotate.
   *
   * If hosted rotation is used, this must be a JSON string with the following format:
   *
   * ```
   * {
   *   "engine": <required: database engine>,
   *   "host": <required: instance host name>,
   *   "username": <required: username>,
   *   "password": <required: password>,
   *   "dbname": <optional: database name>,
   *   "port": <optional: if not specified, default port will be used>,
   *   "masterarn": <required for multi user rotation: the arn of the master secret which will be used to create users/change passwords>
   * }
   * ```
   *
   * This is typically the case for a secret referenced from an `ISecretTargetAttachment`, i.e. the
   * `ISecret` returned by the `attach()` method of `Secret`.
   */
  readonly secret: ISecret;
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface RotationScheduleOutputs {
  /**
   * The ARN or name of the secret this rotation schedule is attached to.
   *
   * @attribute
   */
  readonly secretId: string;
}

/**
 * A rotation schedule.
 *
 * @resource aws_secretsmanager_secret_rotation
 */
export class RotationSchedule extends AwsConstructBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.encryption.RotationSchedule";

  /**
   * The underlying `aws_secretsmanager_secret_rotation` resource.
   */
  public readonly resource: secretsmanagerSecretRotation.SecretsmanagerSecretRotation;

  public readonly rotationScheduleOutputs: RotationScheduleOutputs;
  public get outputs(): Record<string, any> {
    return this.rotationScheduleOutputs;
  }

  constructor(scope: Construct, id: string, props: RotationScheduleProps) {
    super(scope, id);

    if (
      (!props.rotationLambda && !props.hostedRotation) ||
      (props.rotationLambda && props.hostedRotation)
    ) {
      throw new ValidationError(
        "One of `rotationLambda` or `hostedRotation` must be specified.",
        this,
      );
    }

    if (props.rotationLambda?.permissionsNode.defaultChild) {
      if (props.secret.encryptionKey) {
        props.secret.encryptionKey.grantEncryptDecrypt(
          new ViaServicePrincipal(
            `secretsmanager.${this.stack.region}.amazonaws.com`,
            props.rotationLambda.grantPrincipal,
          ),
        );
      }

      const grant = props.rotationLambda.grantInvoke(
        new iam.ServicePrincipal("secretsmanager.amazonaws.com"),
      );
      grant.applyBefore(this);

      props.rotationLambda.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            "secretsmanager:DescribeSecret",
            "secretsmanager:GetSecretValue",
            "secretsmanager:PutSecretValue",
            "secretsmanager:UpdateSecretVersionStage",
          ],
          resources: [
            props.secret.secretFullArn
              ? props.secret.secretFullArn
              : `${props.secret.secretArn}-??????`,
          ],
        }),
      );
      props.rotationLambda.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetRandomPassword"],
          resources: ["*"],
        }),
      );
    }

    let scheduleExpression: string;
    if (props.automaticallyAfter) {
      const automaticallyAfterMillis =
        props.automaticallyAfter.toMilliseconds();
      if (automaticallyAfterMillis === 0) {
        // See the "Never synthesize provider-invalid config for CFN sentinel semantics" rule
        // (conventions.md): CFN's `Duration.days(0)` sentinel ("do not create RotationRules") has no
        // Terraform representation -- `rotation_rules` is a required block on
        // `aws_secretsmanager_secret_rotation`, and an empty block fails `tofu validate`.
        throw new ValidationError(
          "`automaticallyAfter` cannot be `Duration.days(0)`: CloudFormation treats a zero duration as " +
            '"do not create RotationRules", but Terraform\'s `aws_secretsmanager_secret_rotation` ' +
            "resource requires a populated `rotation_rules` block (an empty block fails `tofu validate`). " +
            "Omit `automaticallyAfter` to use the default 30-day schedule.",
          this,
        );
      }
      if (automaticallyAfterMillis < Duration.hours(4).toMilliseconds()) {
        throw new ValidationError(
          `automaticallyAfter must not be smaller than 4 hours, got ${props.automaticallyAfter.toHours()} hours`,
          this,
        );
      }
      if (automaticallyAfterMillis > Duration.days(1000).toMilliseconds()) {
        throw new ValidationError(
          `automaticallyAfter must not be greater than 1000 days, got ${props.automaticallyAfter.toDays()} days`,
          this,
        );
      }
      scheduleExpression = Schedule.rate(
        props.automaticallyAfter,
      ).expressionString;
    } else {
      scheduleExpression = Schedule.rate(Duration.days(30)).expressionString;
    }

    // TERRACONSTRUCTS DEVIATION: upstream passes `props.hostedRotation?.bind(props.secret, this)` into
    // `hostedRotationLambda` on the underlying Cfn resource. `aws_secretsmanager_secret_rotation` has no
    // equivalent field (verified: absent from `SecretsmanagerSecretRotationConfig`) -- CFN's
    // `HostedRotationLambda` relies on the `AWS::SecretsManager-2024-09-16` transform to auto-provision a
    // fully managed rotation Lambda from an AWS-published SAR template, which Terraform cannot do. Calling
    // `bind()` always throws (see `HostedRotation.bind` below); it is invoked here -- before the L1 resource
    // is created -- purely to preserve upstream's construction-time failure for this unsupported feature.
    props.hostedRotation?.bind(props.secret, this);

    this.resource =
      new secretsmanagerSecretRotation.SecretsmanagerSecretRotation(
        this,
        "Resource",
        {
          secretId: props.secret.secretArn,
          rotationLambdaArn: props.rotationLambda?.functionArn,
          rotationRules: {
            scheduleExpression,
          },
          rotateImmediately: props.rotateImmediatelyOnUpdate,
        },
      );

    this.rotationScheduleOutputs = {
      secretId: this.resource.secretId,
    };

    // Prevent secrets deletions when rotation is in place
    props.secret.denyAccountRootDelete();
  }
}

/**
 * Single user hosted rotation options
 */
export interface SingleUserHostedRotationOptions {
  /**
   * A name for the Lambda created to rotate the secret
   *
   * @default - a Terraform generated name
   */
  readonly functionName?: string;

  /**
   * A list of security groups for the Lambda created to rotate the secret
   *
   * @default - a new security group is created
   */
  readonly securityGroups?: compute.ISecurityGroup[];

  /**
   * The VPC where the Lambda rotation function will run.
   *
   * @default - the Lambda is not deployed in a VPC
   */
  readonly vpc?: compute.IVpc;

  /**
   * The type of subnets in the VPC where the Lambda rotation function will run.
   *
   * @default - the Vpc default strategy if not specified.
   */
  readonly vpcSubnets?: compute.SubnetSelection;

  /**
   * A string of the characters that you don't want in the password
   *
   * @default the same exclude characters as the ones used for the
   * secret or " %+~`#$&*()|[]{}:;<>?!'/@\"\\"
   */
  readonly excludeCharacters?: string;
}

/**
 * Multi user hosted rotation options
 */
export interface MultiUserHostedRotationOptions
  extends SingleUserHostedRotationOptions {
  /**
   * The master secret for a multi user rotation scheme
   */
  readonly masterSecret: ISecret;
}

/**
 * A hosted rotation
 *
 * TERRACONSTRUCTS DEVIATION: upstream's `bind()` renders a `CfnRotationSchedule.HostedRotationLambdaProperty`
 * consumed by CloudFormation's `AWS::SecretsManager-2024-09-16` transform, which auto-provisions a fully
 * managed rotation Lambda from an AWS-published SAR template. Terraform's `aws_secretsmanager_secret_rotation`
 * resource has no equivalent (verified against `SecretsmanagerSecretRotationConfig` -- no `hostedRotationLambda`
 * / SAR-backed field exists anywhere in the AWS Terraform provider). `HostedRotation` and `HostedRotationType`
 * are preserved here for API compatibility (so callers can still construct e.g.
 * `HostedRotation.mysqlSingleUser()`), but `bind()` always throws -- "Not supported by Terraform Provider".
 * To rotate a secret with Terraform, deploy a real rotation Lambda (`aws_lambda_function`, e.g. from one of
 * the AWS Secrets Manager rotation templates) and pass it as `RotationScheduleOptions.rotationLambda` instead.
 */
export class HostedRotation implements compute.IConnectable {
  /** MySQL Single User */
  public static mysqlSingleUser(options: SingleUserHostedRotationOptions = {}) {
    return new HostedRotation(HostedRotationType.MYSQL_SINGLE_USER, options);
  }

  /** MySQL Multi User */
  public static mysqlMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.MYSQL_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  /** PostgreSQL Single User */
  public static postgreSqlSingleUser(
    options: SingleUserHostedRotationOptions = {},
  ) {
    return new HostedRotation(
      HostedRotationType.POSTGRESQL_SINGLE_USER,
      options,
    );
  }

  /** PostgreSQL Multi User */
  public static postgreSqlMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.POSTGRESQL_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  /** Oracle Single User */
  public static oracleSingleUser(
    options: SingleUserHostedRotationOptions = {},
  ) {
    return new HostedRotation(HostedRotationType.ORACLE_SINGLE_USER, options);
  }

  /** Oracle Multi User */
  public static oracleMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.ORACLE_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  /** MariaDB Single User */
  public static mariaDbSingleUser(
    options: SingleUserHostedRotationOptions = {},
  ) {
    return new HostedRotation(HostedRotationType.MARIADB_SINGLE_USER, options);
  }

  /** MariaDB Multi User */
  public static mariaDbMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.MARIADB_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  /** SQL Server Single User */
  public static sqlServerSingleUser(
    options: SingleUserHostedRotationOptions = {},
  ) {
    return new HostedRotation(
      HostedRotationType.SQLSERVER_SINGLE_USER,
      options,
    );
  }

  /** SQL Server Multi User */
  public static sqlServerMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.SQLSERVER_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  /** Redshift Single User */
  public static redshiftSingleUser(
    options: SingleUserHostedRotationOptions = {},
  ) {
    return new HostedRotation(HostedRotationType.REDSHIFT_SINGLE_USER, options);
  }

  /** Redshift Multi User */
  public static redshiftMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.REDSHIFT_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  /** MongoDB Single User */
  public static mongoDbSingleUser(
    options: SingleUserHostedRotationOptions = {},
  ) {
    return new HostedRotation(HostedRotationType.MONGODB_SINGLE_USER, options);
  }

  /** MongoDB Multi User */
  public static mongoDbMultiUser(options: MultiUserHostedRotationOptions) {
    return new HostedRotation(
      HostedRotationType.MONGODB_MULTI_USER,
      options,
      options.masterSecret,
    );
  }

  private _connections?: compute.Connections;

  private constructor(
    private readonly type: HostedRotationType,
    private readonly props:
      | SingleUserHostedRotationOptions
      | MultiUserHostedRotationOptions,
    // NOTE: not stored as a property -- `bind()` below always throws (Terraform has no
    // equivalent of CloudFormation's HostedRotationLambda transform), so upstream's
    // masterSecret-driven ARN/KMS wiring in `bind()` has no Terraform counterpart to port.
    // Retained as a constructor-only parameter purely to preserve the multi-user validation
    // check below and the public static factory signatures.
    masterSecret?: ISecret,
  ) {
    if (type.isMultiUser && !masterSecret) {
      throw new UnscopedValidationError(
        "The `masterSecret` must be specified when using the multi user scheme.",
      );
    }
  }

  /**
   * Binds this hosted rotation to a secret.
   *
   * Always throws: Terraform's `aws_secretsmanager_secret_rotation` resource has no equivalent of
   * CloudFormation's `HostedRotationLambda`. See the `HostedRotation` class doc comment above.
   *
   * NOTE: return type is `void`, not `never` -- jsii rejects `never` as unrepresentable in target
   * languages (JSII1007). Callers only invoke this for its side effect (it always throws before
   * returning), so the narrower TS type isn't otherwise load-bearing here.
   */
  public bind(_secret: ISecret, scope: Construct): void {
    throw new ValidationError(
      "HostedRotation is not supported by the Terraform AWS provider: `aws_secretsmanager_secret_rotation` " +
        "has no equivalent of CloudFormation's `HostedRotationLambda` (which relies on the " +
        `"${this.type.name}" AWS::SecretsManager-2024-09-16 transform to auto-provision a fully managed ` +
        "rotation Lambda from an AWS-published SAR template -- Terraform cannot do this). Deploy a real " +
        "rotation Lambda and provide it as `RotationScheduleOptions.rotationLambda` instead.",
      scope,
    );
  }

  /**
   * Security group connections for this hosted rotation
   */
  public get connections() {
    if (!this.props.vpc) {
      throw new UnscopedValidationError(
        "Cannot use connections for a hosted rotation that is not deployed in a VPC",
      );
    }

    // If we are in a vpc and bind() has been called _connections should be defined
    if (!this._connections) {
      throw new UnscopedValidationError(
        "Cannot use connections for a hosted rotation that has not been bound to a secret",
      );
    }

    return this._connections;
  }
}

/**
 * Hosted rotation type
 */
export class HostedRotationType {
  /** MySQL Single User */
  public static readonly MYSQL_SINGLE_USER = new HostedRotationType(
    "MySQLSingleUser",
  );

  /** MySQL Multi User */
  public static readonly MYSQL_MULTI_USER = new HostedRotationType(
    "MySQLMultiUser",
    true,
  );

  /** PostgreSQL Single User */
  public static readonly POSTGRESQL_SINGLE_USER = new HostedRotationType(
    "PostgreSQLSingleUser",
  );

  /** PostgreSQL Multi User */
  public static readonly POSTGRESQL_MULTI_USER = new HostedRotationType(
    "PostgreSQLMultiUser",
    true,
  );

  /** Oracle Single User */
  public static readonly ORACLE_SINGLE_USER = new HostedRotationType(
    "OracleSingleUser",
  );

  /** Oracle Multi User */
  public static readonly ORACLE_MULTI_USER = new HostedRotationType(
    "OracleMultiUser",
    true,
  );

  /** MariaDB Single User */
  public static readonly MARIADB_SINGLE_USER = new HostedRotationType(
    "MariaDBSingleUser",
  );

  /** MariaDB Multi User */
  public static readonly MARIADB_MULTI_USER = new HostedRotationType(
    "MariaDBMultiUser",
    true,
  );

  /** SQL Server Single User */
  public static readonly SQLSERVER_SINGLE_USER = new HostedRotationType(
    "SQLServerSingleUser",
  );

  /** SQL Server Multi User */
  public static readonly SQLSERVER_MULTI_USER = new HostedRotationType(
    "SQLServerMultiUser",
    true,
  );

  /** Redshift Single User */
  public static readonly REDSHIFT_SINGLE_USER = new HostedRotationType(
    "RedshiftSingleUser",
  );

  /** Redshift Multi User */
  public static readonly REDSHIFT_MULTI_USER = new HostedRotationType(
    "RedshiftMultiUser",
    true,
  );

  /** MongoDB Single User */
  public static readonly MONGODB_SINGLE_USER = new HostedRotationType(
    "MongoDBSingleUser",
  );

  /** MongoDB Multi User */
  public static readonly MONGODB_MULTI_USER = new HostedRotationType(
    "MongoDBMultiUser",
    true,
  );

  /**
   * @param name The type of rotation
   * @param isMultiUser Whether the rotation uses the mutli user scheme
   */
  private constructor(
    public readonly name: string,
    public readonly isMultiUser?: boolean,
  ) {}
}
