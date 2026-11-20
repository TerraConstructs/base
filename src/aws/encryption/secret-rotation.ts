// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts
//
// COMBINED: `SecretRotationApplication` (the ARN/version catalog below) retains its original
// v2.233.0 port as-is (no DB2 entries / `additionalSemanticVersions`) per the "reuse the already
// ported catalog" directive when unblocking this construct; `SecretRotationProps` and
// `SecretRotation` are ported fresh against v2.263.0.

import { serverlessapplicationrepositoryCloudformationStack } from "@cdktn/provider-aws";
import { Construct } from "constructs";
import { ISecret } from "./secret";
import { Duration } from "../../duration";
import { ValidationError, UnscopedValidationError } from "../../errors";
import { ArnFormat } from "../arn";
import { AwsStack } from "../aws-stack";
import * as ec2 from "../compute";
import * as iam from "../iam";
import { escapeTerraformTemplateLiteral } from "../util";

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

  // TODO: omitted — this v2.233.0-shaped catalog predates the `additionalSemanticVersions` option
  // (per-application aws-cn/aws-us-gov version overrides) — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L20-L27
  // /**
  //  * Semantic versions for partitions other than 'aws'.
  //  * If not specified, it is assumed that non aws partitions (eg aws-cn, aws-us-gov) are not supported.
  //  *
  //  * @default - no additional partition versions (only 'aws' partition is supported)
  //  */
  // readonly additionalSemanticVersions?: { [partition: string]: string };
}

/**
 * A secret rotation serverless application.
 */
export class SecretRotationApplication {
  // TODO: omitted — every application below is pinned to the v2.233.0 semantic versions (1.1.618); the
  // v2.263.0 catalog bumps these per-application to 1.1.670-1.1.672 and also adds per-application
  // `additionalSemanticVersions` (aws-cn/aws-us-gov) instead of the single global fallback used by
  // `semanticVersionForPartition` below — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L32-L192

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

  // TODO: omitted — RDS Db2 rotation applications (DB2_ROTATION_SINGLE_USER / DB2_ROTATION_MULTI_USER)
  // are absent from this v2.233.0-shaped catalog — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L177-L192
  // /**
  //  * Conducts an AWS SecretsManager secret rotation for RDS Db2 using the single user rotation scheme
  //  */
  // public static readonly DB2_ROTATION_SINGLE_USER =
  //   new SecretRotationApplication(
  //     "SecretsManagerRDSDb2RotationSingleUser",
  //     "1.1.271",
  //     {
  //       additionalSemanticVersions: {
  //         "aws-cn": "1.1.242",
  //         "aws-us-gov": "1.1.199",
  //       },
  //     },
  //   );
  //
  // /**
  //  * Conducts an AWS SecretsManager secret rotation for RDS Db2 using the multi user rotation scheme
  //  */
  // public static readonly DB2_ROTATION_MULTI_USER =
  //   new SecretRotationApplication(
  //     "SecretsManagerRDSDb2RotationMultiUser",
  //     "1.1.272",
  //     {
  //       additionalSemanticVersions: {
  //         "aws-cn": "1.1.240",
  //         "aws-us-gov": "1.1.197",
  //       },
  //     },
  //   );

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
    // TERRACONSTRUCTS DEVIATION: none -- matches v2.263.0 inference (options win, otherwise infer
    // from the `MultiUser` suffix), even though the v2.233.0-shaped catalog below always passes
    // `isMultiUser` explicitly — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L230
    this.isMultiUser =
      (options && options.isMultiUser) ?? applicationId.endsWith("MultiUser");
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
      // TODO: omitted — v2.233.0-shaped catalog: these aws-cn/aws-us-gov versions are a single global
      // fallback shared by every application, not the per-application `additionalSemanticVersions`
      // table v2.263.0 introduced — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L263-L268
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
   * This is typically the case for a secret referenced from an `AWS::SecretsManager::SecretTargetAttachment`
   * or an `ISecret` returned by the `attach()` method of `Secret`.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-secretsmanager-secrettargetattachment.html
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
 * TERRACONSTRUCTS DEVIATION: upstream deploys the rotation Lambda by instantiating an AWS-published
 * Serverless Application Repository (SAR) app via `aws-sam`'s `serverless.CfnApplication`
 * (`AWS::Serverless::Application`), backed by a `CfnMapping` that selects
 * `application.applicationArnForPartition(Aws.PARTITION)` / `semanticVersionForPartition(Aws.PARTITION)`
 * via `Fn::FindInMap` at deploy time. `terraform-provider-aws` DOES ship an equivalent resource --
 * `aws_serverlessapplicationrepository_cloudformation_stack` (24.8.0,
 * `serverlessapplicationrepository-cloudformation-stack`) -- so the SAR app is synthesized onto that
 * resource below (`location.applicationId`/`semanticVersion` -> `applicationId`/`semanticVersion`,
 * `parameters` -> `parameters`, plus the `capabilities` the AWS Serverless Transform always requests
 * for these rotation apps: `CAPABILITY_IAM` and `CAPABILITY_RESOURCE_POLICY`).
 *
 * What IS a deviation is partition selection: CloudFormation's `CfnMapping`/`Fn::FindInMap` resolves
 * `Aws.PARTITION` server-side during the SAME deployment, so upstream can defer the choice of
 * `applicationId`/`semanticVersion` until deploy time. Terraform has no equivalent -- `stack.partition`
 * here is a runtime-resolved `data.aws_partition` token (see `AwsStack.partition`), not a literal known
 * at synth time, so it cannot drive which literal string gets written into a resource argument. This
 * construct therefore always synthesizes for the known 'aws' (commercial) partition -- i.e. it calls
 * `application.applicationArnForPartition('aws')` / `semanticVersionForPartition('aws')` directly, the
 * same way `SecretRotationApplication`'s own per-partition ARN/version data above is just a hardcoded
 * table keyed by a literal partition string. Deploying to `aws-cn` / `aws-us-gov` requires overriding
 * `application` with a custom `SecretRotationApplication` whose `applicationArnForPartition('aws')` /
 * `semanticVersionForPartition('aws')` already return that partition's values.
 *
 * Upstream also calls `application.applyRemovalPolicy(RemovalPolicy.DESTROY)` on the CFN nested stack
 * (overriding CloudFormation's default `Retain` policy for nested stacks). Terraform has no
 * `DeletionPolicy` concept -- `terraform destroy` / removing the resource from config always deletes
 * it -- so there is nothing to port for that line.
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

    const stack = AwsStack.ofAwsConstruct(this);

    // Max length of 64 chars (the Lambda `FunctionName` limit).
    //
    // TERRACONSTRUCTS DEVIATION: upstream computes `Names.uniqueId(this)` and trims it to the last 64
    // characters (`uniqueId.substring(uniqueId.length - 64)`). `AwsStack.uniqueResourceName` trims from
    // the MIDDLE instead (see `UniqueResourceNameOptions` in `src/stack-base.ts`) -- functionally
    // equivalent (the result always fits within the 64-char limit), but the exact trimmed string
    // differs from upstream's.
    const rotationFunctionName = stack.uniqueResourceName(this.node, {
      maxLength: 64,
    });

    const securityGroup =
      props.securityGroup ??
      new ec2.SecurityGroup(this, "SecurityGroup", { vpc: props.vpc });
    props.target.connections.allowDefaultPortFrom(securityGroup);

    const parameters: { [key: string]: string } = {
      endpoint: `https://${props.endpoint ? `${props.endpoint.vpcEndpointId}.` : ""}secretsmanager.${stack.region}.${stack.urlSuffix}`,
      functionName: rotationFunctionName,
      vpcSubnetIds: props.vpc
        .selectSubnets(props.vpcSubnets)
        .subnetIds.join(","),
      vpcSecurityGroupIds: securityGroup.securityGroupId,
    };

    if (props.excludeCharacters !== undefined) {
      // TERRACONSTRUCTS DEVIATION: `excludeCharacters` is free text (e.g. the
      // "DMS and BASH problem chars" set, which legitimately contains `%{}`)
      // written into `parameters`, a Terraform (JSON) resource argument map.
      // Every such string value is evaluated as a Terraform string template,
      // so literal `${` / `%{` sequences must be escaped or synthesis
      // produces invalid Terraform -- see `escapeTerraformTemplateLiteral`.
      // CloudFormation additionally TRIMS leading/trailing whitespace from
      // parameter values on read-back, so an edge space (upstream's default
      // RDS exclude set starts with one) would perpetually drift. The value
      // is a character SET, so order is irrelevant: move edge whitespace
      // inward before escaping. Live-verified by integ/aws/encryption
      // TestSecretRotation's drift oracle.
      parameters.excludeCharacters = escapeTerraformTemplateLiteral(
        moveEdgeWhitespaceInward(props.excludeCharacters),
      );
    }

    if (props.secret.encryptionKey) {
      parameters.kmsKeyArn = props.secret.encryptionKey.keyArn;
    }

    if (props.masterSecret) {
      parameters.masterSecretArn = props.masterSecret.secretArn;

      if (props.masterSecret.encryptionKey) {
        parameters.masterSecretKmsKeyArn =
          props.masterSecret.encryptionKey.keyArn;
      }
    }

    // TODO: omitted — CloudFormation's `CfnMapping`/`Fn::FindInMap` server-side partition selection
    // has no Terraform equivalent (see the class doc comment above) — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L417-L432
    // const sarMapping = new CfnMapping(this, 'SARMapping', {
    //   mapping: {
    //     'aws': {
    //       applicationId: props.application.applicationArnForPartition('aws'),
    //       semanticVersion: props.application.semanticVersionForPartition('aws'),
    //     },
    //     'aws-cn': {
    //       applicationId: props.application.applicationArnForPartition('aws-cn'),
    //       semanticVersion: props.application.semanticVersionForPartition('aws-cn'),
    //     },
    //     'aws-us-gov': {
    //       applicationId: props.application.applicationArnForPartition('aws-us-gov'),
    //       semanticVersion: props.application.semanticVersionForPartition('aws-us-gov'),
    //     },
    //   },
    // });
    //
    // TERRACONSTRUCTS DEVIATION: see the class doc comment above -- always synthesized for the 'aws'
    // partition; there is no Terraform equivalent of CloudFormation's `CfnMapping`/`Fn::FindInMap`
    // server-side partition selection.
    const application =
      new serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack(
        this,
        "Resource",
        {
          // TERRACONSTRUCTS DEVIATION: the Terraform resource requires an explicit CloudFormation
          // stack name, whereas upstream's nested `AWS::Serverless::Application` is unnamed and
          // CloudFormation auto-generates the nested stack name. Reusing `rotationFunctionName`
          // keeps it deterministic and within the stack-name character/length limits.
          name: rotationFunctionName,
          applicationId: props.application.applicationArnForPartition("aws"),
          semanticVersion: props.application.semanticVersionForPartition("aws"),
          parameters,
          capabilities: ["CAPABILITY_IAM", "CAPABILITY_RESOURCE_POLICY"],
        },
      );
    // TODO: omitted — Terraform has no `DeletionPolicy`/nested-stack retain concept to override
    // (see the class doc comment above) — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-secretsmanager/lib/secret-rotation.ts#L440
    // application.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // This creates a dependency between the rotation schedule and the SAR-backed CloudFormation
    // stack. This is needed because it's the nested stack that creates the Lambda permission to
    // invoke the function.
    // See https://docs.aws.amazon.com/secretsmanager/latest/userguide/integrating_cloudformation.html
    const rotationLambda = new ImportedRotationLambda(
      this,
      "RotationLambda",
      application.outputs.lookup("RotationLambdaARN"),
    );

    props.secret.addRotationSchedule("RotationSchedule", {
      rotationLambda,
      automaticallyAfter: props.automaticallyAfter,
      rotateImmediatelyOnUpdate: props.rotateImmediatelyOnUpdate,
    });

    // Prevent master secret deletion when rotation is in place
    if (props.masterSecret) {
      props.masterSecret.denyAccountRootDelete();
    }
  }
}

/**
 * TERRACONSTRUCTS DEVIATION: an `IFunction` reference to the rotation Lambda provisioned by the
 * `aws_serverlessapplicationrepository_cloudformation_stack` resource above, deliberately NOT built via
 * `ec2.LambdaFunction.fromFunctionAttributes()`. That factory always backs an ARN-only import with a
 * real `data.aws_lambda_function` lookup construct, which would become this reference's
 * `permissionsNode.defaultChild` -- making `RotationSchedule` (./rotation-schedule.ts) try to grant
 * Secrets Manager invoke permissions on it. Those grants would be redundant (the nested SAR stack
 * already creates that Lambda permission itself, exactly like upstream's `AWS::Serverless::Application`
 * -- see the comment above `rotationLambda` in `SecretRotation`'s constructor) and, because the
 * function ARN is only known after the SAR stack deploys (an unresolved Token), attempting them here
 * currently trips an unrelated `IDependable` gap in the shared grant machinery (`src/aws/iam/grant.ts`)
 * when the underlying permission ends up a no-op. Upstream's actual ARN-only CFN import has NO backing
 * resource at all, so it never triggers that grant path either; this class mirrors that -- it creates
 * no child resource, so `permissionsNode.defaultChild` is always `undefined`, matching upstream.
 */
class ImportedRotationLambda extends ec2.LambdaFunctionBase {
  public readonly functionName: string;
  public readonly functionArn: string;
  public readonly grantPrincipal: iam.IPrincipal;
  public readonly role = undefined;
  public readonly permissionsNode = this.node;
  public readonly architecture = ec2.Architecture.X86_64;
  public readonly version = "$LATEST";
  protected readonly canCreatePermissions = false;
  public readonly resourceArnsForGrantInvoke: string[];

  constructor(scope: Construct, id: string, functionArn: string) {
    super(scope, id, { environmentFromArn: functionArn });
    this.functionArn = functionArn;
    const { resourceName } = AwsStack.ofAwsConstruct(this).splitArn(
      functionArn,
      ArnFormat.COLON_RESOURCE_NAME,
    );
    if (resourceName === undefined) {
      // Arn.split's parseTokenArn branch always sets resourceName for COLON_RESOURCE_NAME
      // (see src/aws/arn.ts) -- this should be unreachable.
      throw new ValidationError(
        `Unable to parse function name from rotation Lambda ARN: ${functionArn}`,
        this,
      );
    }
    this.functionName = resourceName;
    this.grantPrincipal = new iam.UnknownPrincipal({ resource: this });
    this.resourceArnsForGrantInvoke = [functionArn, `${functionArn}:*`];
  }

  public get functionQualifiedInvokeArn(): string {
    const { region, partition } = AwsStack.ofAwsConstruct(this).splitArn(
      this.functionArn,
      ArnFormat.COLON_RESOURCE_NAME,
    );
    return `arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${this.functionArn}/invocations`;
  }

  public get functionInvokeArn(): string {
    return this.functionQualifiedInvokeArn;
  }

  public get outputs(): Record<string, any> {
    return {
      functionArn: this.functionArn,
      functionName: this.functionName,
    };
  }
}

/**
 * Moves leading/trailing whitespace characters into the interior of the
 * string (right after the first non-whitespace character). CloudFormation
 * trims edge whitespace from stack parameter values on read-back, which would
 * both drop those characters remotely and cause perpetual Terraform drift on
 * the SAR stack's `parameters`. `excludeCharacters` is a character SET, so
 * reordering preserves its meaning. All-whitespace values are returned
 * unchanged (nothing to anchor the whitespace behind).
 */
function moveEdgeWhitespaceInward(value: string): string {
  const trimmed = value.trim();
  if (trimmed === value || trimmed.length === 0) {
    return value;
  }
  const leading = value.slice(0, value.length - value.trimStart().length);
  const trailing = value.slice(value.trimEnd().length);
  return trimmed[0] + leading + trailing + trimmed.slice(1);
}
