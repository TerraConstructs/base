// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-secretsmanager/lib/rotation-schedule.ts

import { secretsmanagerSecretRotation } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import {
  ISecret,
  // Secret,
} from "./secret";
import { ViaServicePrincipal } from "./via-service-principal";
import { Duration } from "../../duration";
import { ValidationError, UnscopedValidationError } from "../../errors";
import { AwsConstructBase } from "../aws-construct";
import * as compute from "../compute";
import * as iam from "../iam";

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
   * @deprecated - see https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/design-decisions/secretsmanager-secret-target-attachment.md
   */
  readonly hostedRotation?: HostedRotation;

  /**
   * Specifies the number of days after the previous rotation before
   * Secrets Manager triggers the next automatic rotation.
   *
   * The minimum value is 4 hours.
   * The maximum value is 1000 days.
   *
   * A value of zero (`Duration.days(0)`) will not create RotationRules.
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
   * This is typically the case for a secret referenced from an `AWS::SecretsManager::SecretTargetAttachment`
   * or an `ISecret` returned by the `attach()` method of `Secret`.
   */
  readonly secret: ISecret;
}

/**
 * A rotation schedule.
 */
export class RotationSchedule extends AwsConstructBase {
  public get outputs(): Record<string, any> {
    return {};
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

    if (props.hostedRotation) {
      // https://github.com/hashicorp/terraform-provider-aws/issues/34108
      // https://github.com/hashicorp/terraform-provider-aws/issues/9183#issuecomment-1789690055
      // https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/design-decisions/secretsmanager-secret-target-attachment.md
      throw new ValidationError(
        "HostedRotation in Terraform provider AWS is handled in resources that use them. See https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/design-decisions/secretsmanager-secret-target-attachment.md",
        this,
      );
    }

    if (props.rotationLambda) {
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

    let automaticallyAfterDays: number | undefined;
    let scheduleExpression: string | undefined;
    if (props.automaticallyAfter) {
      const automaticallyAfterMillis =
        props.automaticallyAfter.toMilliseconds();
      if (automaticallyAfterMillis > 0) {
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
        // Terraform's `automatically_after_days` only accepts whole days. For
        // durations that are not an exact number of days (e.g. hours), fall
        // back to `schedule_expression`, mirroring the `rate(...)` expression
        // upstream aws-cdk always uses via `Schedule.rate()`.
        if (
          automaticallyAfterMillis % Duration.days(1).toMilliseconds() ===
          0
        ) {
          automaticallyAfterDays = props.automaticallyAfter.toDays();
        } else {
          scheduleExpression = compute.Schedule.rate(
            props.automaticallyAfter,
          ).expressionString;
        }
      }
    } else {
      automaticallyAfterDays = 30;
    }

    // `rotation_rules` is a required block for the underlying Terraform
    // resource (unlike CloudFormation's optional `RotationRules`), so a
    // value of zero (no automatic rotation configured) still needs an
    // (empty) `rotationRules` object to satisfy the provider schema.
    let rotationRules: secretsmanagerSecretRotation.SecretsmanagerSecretRotationRotationRules =
      {};
    if (automaticallyAfterDays) {
      rotationRules = {
        automaticallyAfterDays,
      };
    } else if (scheduleExpression) {
      rotationRules = {
        scheduleExpression,
      };
    }

    new secretsmanagerSecretRotation.SecretsmanagerSecretRotation(
      this,
      "Resource",
      {
        secretId: props.secret.secretArn,
        rotationLambdaArn: props.rotationLambda?.functionArn,
        rotationRules,
        rotateImmediately: props.rotateImmediatelyOnUpdate,
      },
    );

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
   * @default - a CloudFormation generated name
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
   * secret or " %+~`#$&*()|[]{}:;<>?!'/@\"\\
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
 * A hosted rotation.
 * @note This is a CloudFormation-specific feature that is not supported in TerraConstructs.
 * Using this class will result in an error at synthesis time.
 * In Terraform, you must create the rotation Lambda function explicitly and provide its ARN
 * to the `rotationLambda` property of the `RotationSchedule`.
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
    type: HostedRotationType,
    private readonly props:
      | SingleUserHostedRotationOptions
      | MultiUserHostedRotationOptions,
    masterSecret?: ISecret,
  ) {
    if (type.isMultiUser && !masterSecret) {
      throw new UnscopedValidationError(
        "The `masterSecret` must be specified when using the multi user scheme.",
      );
    }
  }

  /**
   * Binds this hosted rotation to a secret
   * @internal
   */
  public _bind(
    _secret: ISecret,
    _scope: Construct,
  ): secretsmanagerSecretRotation.SecretsmanagerSecretRotation {
    throw new UnscopedValidationError(
      "HostedRotation is not supported in TerraConstructs. See https://github.com/hashicorp/terraform-provider-aws/blob/main/docs/design-decisions/secretsmanager-secret-target-attachment.md.",
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
