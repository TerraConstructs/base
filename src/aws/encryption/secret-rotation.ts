// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts

import { Construct } from "constructs";
import { ISecret } from "./secret";
import { Duration } from "../../duration";
import { ValidationError, UnscopedValidationError } from "../../errors";
import * as ec2 from "../compute";

/**
 * Options for a SecretRotationApplication
 */
export interface SecretRotationApplicationOptions {
  /**
   * Whether the rotation application uses the mutli user scheme
   *
   * @default false
   */
  readonly isMultiUser?: boolean;
}

/**
 * A secret rotation serverless application.
 */
export class SecretRotationApplication {
  /**
   * Conducts an AWS SecretsManager secret rotation for RDS MariaDB using the single user rotation scheme
   */
  public static readonly MARIADB_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSMariaDBRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS MariaDB using the multi user rotation scheme
   */
  public static readonly MARIADB_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSMariaDBRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS MySQL using the single user rotation scheme
   */
  public static readonly MYSQL_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSMySQLRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS MySQL using the multi user rotation scheme
   */
  public static readonly MYSQL_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSMySQLRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS Oracle using the single user rotation scheme
   */
  public static readonly ORACLE_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSOracleRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS Oracle using the multi user rotation scheme
   */
  public static readonly ORACLE_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSOracleRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS PostgreSQL using the single user rotation scheme
   */
  public static readonly POSTGRES_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSPostgreSQLRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS PostgreSQL using the multi user rotation scheme
   */
  public static readonly POSTGRES_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSPostgreSQLRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS SQL Server using the single user rotation scheme
   */
  public static readonly SQLSERVER_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSSQLServerRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for RDS SQL Server using the multi user rotation scheme
   */
  public static readonly SQLSERVER_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerRDSSQLServerRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for Amazon Redshift using the single user rotation scheme
   */
  public static readonly REDSHIFT_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerRedshiftRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for Amazon Redshift using the multi user rotation scheme
   */
  public static readonly REDSHIFT_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerRedshiftRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for MongoDB using the single user rotation scheme
   */
  public static readonly MONGODB_ROTATION_SINGLE_USER =
    new SecretRotationApplication(
      "SecretsManagerMongoDBRotationSingleUser",
      "1.1.618",
    );

  /**
   * Conducts an AWS SecretsManager secret rotation for MongoDB using the multi user rotation scheme
   */
  public static readonly MONGODB_ROTATION_MULTI_USER =
    new SecretRotationApplication(
      "SecretsManagerMongoDBRotationMultiUser",
      "1.1.618",
      {
        isMultiUser: true,
      },
    );

  /**
   * The application identifier of the rotation application
   *
   * @deprecated only valid when deploying to the 'aws' partition. Use `applicationArnForPartition` instead.
   */
  public readonly applicationId: string;

  /**
   * The semantic version of the rotation application
   *
   * @deprecated only valid when deploying to the 'aws' partition. Use `semanticVersionForPartition` instead.
   */
  public readonly semanticVersion: string;

  /**
   * Whether the rotation application uses the mutli user scheme
   */
  public readonly isMultiUser?: boolean;

  /**
   * The application name of the rotation application
   */
  private readonly applicationName: string;

  constructor(
    applicationId: string,
    semanticVersion: string,
    options?: SecretRotationApplicationOptions,
  ) {
    // partitions are handled explicitly via applicationArnForPartition()
    this.applicationId = `arn:aws:serverlessrepo:us-east-1:297356227824:applications/${applicationId}`;
    this.semanticVersion = semanticVersion;
    this.applicationName = applicationId;
    this.isMultiUser = options && options.isMultiUser;
  }

  /**
   * Returns the application ARN for the current partition.
   * Can be used in combination with a `CfnMapping` to automatically select the correct ARN based on the current partition.
   */
  public applicationArnForPartition(partition: string) {
    if (partition === "aws") {
      return this.applicationId;
    } else if (partition === "aws-cn") {
      return `arn:aws-cn:serverlessrepo:cn-north-1:193023089310:applications/${this.applicationName}`;
    } else if (partition === "aws-us-gov") {
      return `arn:aws-us-gov:serverlessrepo:us-gov-west-1:023102451235:applications/${this.applicationName}`;
    } else {
      throw new UnscopedValidationError(`unsupported partition: ${partition}`);
    }
  }

  /**
   * The semantic version of the app for the current partition.
   * Can be used in combination with a `CfnMapping` to automatically select the correct version based on the current partition.
   */
  public semanticVersionForPartition(partition: string) {
    if (partition === "aws") {
      return this.semanticVersion;
    } else if (partition === "aws-cn") {
      return "1.1.237";
    } else if (partition === "aws-us-gov") {
      return "1.1.213";
    } else {
      throw new UnscopedValidationError(`unsupported partition: ${partition}`);
    }
  }
}

/**
 * Construction properties for a SecretRotation.
 */
export interface SecretRotationProps {
  /**
   * The secret to rotate. It must be a JSON string with the following format:
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
   *
   * @see https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_secret_json_structure.html
   */
  readonly secret: ISecret;

  /**
   * The master secret for a multi user rotation scheme
   *
   * @default - single user rotation scheme
   */
  readonly masterSecret?: ISecret;

  /**
   * Specifies the number of days after the previous rotation before
   * Secrets Manager triggers the next automatic rotation.
   *
   * @default Duration.days(30)
   */
  readonly automaticallyAfter?: Duration;

  /**
   * The serverless application for the rotation.
   */
  readonly application: SecretRotationApplication;

  /**
   * The VPC where the Lambda rotation function will run.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The type of subnets in the VPC where the Lambda rotation function will run.
   *
   * @default - the Vpc default strategy if not specified.
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * The target service or database
   */
  readonly target: ec2.IConnectable;

  /**
   * The security group for the Lambda rotation function
   *
   * @default - a new security group is created
   */
  readonly securityGroup?: ec2.ISecurityGroup;

  /**
   * Characters which should not appear in the generated password
   *
   * @default - no additional characters are explicitly excluded
   */
  readonly excludeCharacters?: string;

  /**
   * The VPC interface endpoint to use for the Secrets Manager API
   *
   * If you enable private DNS hostnames for your VPC private endpoint (the default), you don't
   * need to specify an endpoint. The standard Secrets Manager DNS hostname the Secrets Manager
   * CLI and SDKs use by default (https://secretsmanager.<region>.amazonaws.com) automatically
   * resolves to your VPC endpoint.
   *
   * @default https://secretsmanager.<region>.amazonaws.com
   */
  readonly endpoint?: ec2.IInterfaceVpcEndpoint;

  /**
   * Specifies whether to rotate the secret immediately or wait until the next
   * scheduled rotation window.
   *
   * @default true
   */
  readonly rotateImmediatelyOnUpdate?: boolean;
}

/**
 * Secret rotation for a service or database
 *
 * TERRACONSTRUCTS DEVIATION (HARD BLOCKER, see conventions.md "Cfn resources with NO terraform-provider-aws
 * equivalent"): upstream deploys the rotation Lambda by instantiating an AWS-published Serverless
 * Application Repository (SAR) app via `aws-sam`'s `serverless.CfnApplication`
 * (`AWS::Serverless::Application`, backed by a `CfnMapping` selecting `application.applicationArnForPartition`
 * per-partition). There is no `terraform-provider-aws` resource for `serverlessrepo` -- the provider
 * maintainers decline to add one when there is no matching service API -- so this construct cannot be
 * represented in Terraform. `SecretRotationApplication` (the pure ARN/version catalog, portable as-is)
 * is preserved above so callers can still reference e.g. `SecretRotationApplication.MYSQL_ROTATION_SINGLE_USER`,
 * but this construct always throws a `ValidationError` at construction time -- never synthesize a
 * half/invalid resource. To rotate a secret with Terraform, deploy a real rotation Lambda by hand (e.g.
 * from one of the AWS Secrets Manager rotation templates published for the SAR apps above) and attach it
 * with `secret.addRotationSchedule(id, { rotationLambda, automaticallyAfter, rotateImmediatelyOnUpdate })`
 * from `./rotation-schedule` instead.
 */
export class SecretRotation extends Construct {
  constructor(scope: Construct, id: string, props: SecretRotationProps) {
    super(scope, id);

    if (!props.target.connections.defaultPort) {
      throw new ValidationError(
        "The `target` connections must have a default port range.",
        this,
      );
    }

    if (props.application.isMultiUser && !props.masterSecret) {
      throw new ValidationError(
        "The `masterSecret` must be specified for application using the multi user scheme.",
        this,
      );
    }

    // TODO: AWS::Serverless::Application (SAR) has no Terraform equivalent -- see the class doc
    // comment above. There is no `terraform-provider-aws` resource for `serverlessrepo`, so the
    // rotation Lambda this construct deploys via a SAR app cannot be synthesized. Deploy a real
    // rotation Lambda by hand and use `ISecret.addRotationSchedule` / `RotationSchedule` from
    // `./rotation-schedule` instead.
    throw new ValidationError(
      "SecretRotation is not supported: it deploys its rotation Lambda via an AWS Serverless Application " +
        "Repository (SAR) app (`AWS::Serverless::Application`), and Terraform has no `serverlessrepo` " +
        "resource. Deploy a rotation Lambda yourself and call `secret.addRotationSchedule(id, { rotationLambda, ... })` instead.",
      this,
    );
  }
}
