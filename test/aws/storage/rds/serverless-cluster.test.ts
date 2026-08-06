// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/serverless-cluster.test.ts
//
// Aurora Serverless v1 was RETIRED by AWS -- see the module-level TERRACONSTRUCTS note in
// `../../../../src/aws/storage/rds/serverless-cluster.ts`. This is a FULL port for API/migration
// parity; individual behavioral gaps are documented inline with TERRACONSTRUCTS DEVIATION/TODO notes
// at each call site, mirroring the identical omissions already established for
// `DatabaseCluster`/`DatabaseInstance` in `./cluster.test.ts`/`./instance.test.ts`.

import {
  rdsCluster,
  dbSubnetGroup,
  secretsmanagerSecret,
  secretsmanagerSecretRotation,
  dataAwsIamPolicyDocument,
  dataAwsSecretsmanagerRandomPassword,
  vpcSecurityGroupEgressRule,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { ArnFormat, AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import * as rds from "../../../../src/aws/storage/rds";
import { Duration } from "../../../../src/duration";
import { Annotations, Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

function testStack(app?: App, stackId?: string): AwsStack {
  return new AwsStack(app ?? Testing.app(), stackId ?? "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

describe("serverless cluster", () => {
  test("can create a Serverless Cluster with Aurora Postgres database engine", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "ServerlessDatabase", {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      vpc,
      credentials: {
        username: "admin",
        password: "tooshort",
      } as rds.Credentials,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        stack,
        "ParameterGroup",
        "default.aurora-postgresql11",
      ),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      engine: "aurora-postgresql",
      copy_tags_to_snapshot: true,
      db_cluster_parameter_group_name: "default.aurora-postgresql11",
      engine_mode: "serverless",
      master_username: "admin",
      master_password: "tooshort",
      storage_encrypted: true,
    });
    t.expect.toHaveResourceWithProperties(dbSubnetGroup.DbSubnetGroup, {
      description: "Subnets for ServerlessDatabase database",
    });
  });

  test("can create a Serverless Cluster with Aurora Mysql database engine", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "ServerlessDatabase", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: mirrors `DatabaseCluster`'s `renderClusterCredentials`/
    // `Secret._generatedPassword` house pattern (see `./cluster.ts`) rather than upstream's CFN
    // dynamic-reference (`{{resolve:secretsmanager:...}}`) syntax.
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      engine: "aurora-mysql",
      copy_tags_to_snapshot: true,
      db_cluster_parameter_group_name: "default.aurora-mysql5.7",
      engine_mode: "serverless",
      storage_encrypted: true,
    });
    const [clusterResource] = t.resourceTypeArray(
      rdsCluster.RdsCluster,
    ) as any[];
    expect(clusterResource.master_username).toBeDefined();
    expect(clusterResource.master_password).toBeDefined();
    expect(clusterResource.lifecycle).toEqual({
      ignore_changes: ["master_password"],
    });
  });

  test("can create a Serverless cluster with imported vpc and security group", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const sg = compute.SecurityGroup.fromSecurityGroupId(
      stack,
      "SG",
      "SecurityGroupId12345",
    );

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      vpc,
      securityGroups: [sg],
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        stack,
        "ParameterGroup",
        "default.aurora-postgresql11",
      ),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      engine: "aurora-postgresql",
      db_cluster_parameter_group_name: "default.aurora-postgresql11",
      engine_mode: "serverless",
      vpc_security_group_ids: ["SecurityGroupId12345"],
    });
  });

  // TODO: omitted -- "sets the retention policy of the SubnetGroup to 'Retain' if the Serverless
  // Cluster is created with 'Retain'" exercises `cdk.RemovalPolicy.RETAIN` propagating from the
  // cluster onto the auto-created `AWS::RDS::DBSubnetGroup`'s CFN `DeletionPolicy`. `core.
  // RemovalPolicy` is not ported in this repo (see the `skipFinalSnapshot`/`finalSnapshotIdentifier`
  // TODO on `ServerlessClusterNewProps.removalPolicy` in
  // `../../../../src/aws/storage/rds/serverless-cluster.ts`, and the identical omission on
  // `SubnetGroupProps.removalPolicy` in `../../../../src/aws/storage/rds/subnet-group.ts`) --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/serverless-cluster.test.ts#L143-L157

  test("creates a secret when master credentials are not specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      credentials: {
        username: "myuser",
        excludeCharacters: '"@/\\',
      } as rds.Credentials,
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecret.SecretsmanagerSecret,
      {},
    );
    t.expect.toHaveDataSourceWithProperties(
      dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
      {
        exclude_characters: '"@/\\',
        password_length: 30,
      },
    );
    const [clusterResource] = t.resourceTypeArray(
      rdsCluster.RdsCluster,
    ) as any[];
    expect(clusterResource.master_username).toEqual("myuser");
    expect(clusterResource.master_password).toBeDefined();
  });

  test("create an Serverless cluster with custom KMS key for storage", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const key = new encryption.Key(stack, "Key");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      storageEncryptionKey: key,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      kms_key_id: stack.resolve(key.keyArn),
    });
  });

  test("create a cluster using a specific version of Postgresql", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_10_7,
      }),
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      engine: "aurora-postgresql",
      engine_mode: "serverless",
      engine_version: "10.7",
    });
  });

  test("cluster exposes different read and write endpoints", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      credentials: { username: "admin" } as rds.Credentials,
      vpc,
    });

    // THEN
    expect(stack.resolve(cluster.clusterEndpoint)).not.toEqual(
      stack.resolve(cluster.clusterReadEndpoint),
    );
  });

  test("imported cluster with imported security group honors allowAllOutbound", () => {
    // GIVEN
    const stack = testStack();

    const cluster = rds.ServerlessCluster.fromServerlessClusterAttributes(
      stack,
      "Database",
      {
        clusterEndpointAddress: "addr",
        clusterIdentifier: "identifier",
        port: 3306,
        readerEndpointAddress: "reader-address",
        securityGroups: [
          compute.SecurityGroup.fromSecurityGroupId(
            stack,
            "SG",
            "sg-123456789",
            {
              allowAllOutbound: false,
            },
          ),
        ],
      },
    );

    // WHEN
    cluster.connections.allowToAnyIpv4(compute.Port.tcp(443));

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        security_group_id: "sg-123456789",
      },
    );
  });

  test("can import a serverless cluster with minimal attributes", () => {
    const stack = testStack();

    const cluster = rds.ServerlessCluster.fromServerlessClusterAttributes(
      stack,
      "Database",
      {
        clusterIdentifier: "identifier",
      },
    );

    expect(cluster.clusterIdentifier).toEqual("identifier");
  });

  test("minimal imported cluster throws on accessing attributes for missing parameters", () => {
    const stack = testStack();

    const cluster = rds.ServerlessCluster.fromServerlessClusterAttributes(
      stack,
      "Database",
      {
        clusterIdentifier: "identifier",
      },
    );

    expect(() => cluster.clusterEndpoint).toThrow(
      /Cannot access `clusterEndpoint` of an imported cluster/,
    );
    expect(() => cluster.clusterReadEndpoint).toThrow(
      /Cannot access `clusterReadEndpoint` of an imported cluster/,
    );
  });

  test("imported cluster can access properties if attributes are provided", () => {
    const stack = testStack();

    const cluster = rds.ServerlessCluster.fromServerlessClusterAttributes(
      stack,
      "Database",
      {
        clusterEndpointAddress: "addr",
        clusterIdentifier: "identifier",
        port: 3306,
        readerEndpointAddress: "reader-address",
        securityGroups: [
          compute.SecurityGroup.fromSecurityGroupId(
            stack,
            "SG",
            "sg-123456789",
            {
              allowAllOutbound: false,
            },
          ),
        ],
      },
    );

    expect(cluster.clusterEndpoint.socketAddress).toEqual("addr:3306");
    expect(cluster.clusterReadEndpoint.socketAddress).toEqual(
      "reader-address:3306",
    );
  });

  test("throws when trying to add single-user rotation to a serverless cluster without secret", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      credentials: {
        username: "admin",
        password: "tooshort",
      } as rds.Credentials,
      vpc,
    });

    // THEN
    expect(() => cluster.addRotationSingleUser()).toThrow(/without secret/);
  });

  test("throws when trying to add single user rotation multiple times", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      credentials: { username: "admin" } as rds.Credentials,
      vpc,
    });

    // WHEN
    cluster.addRotationSingleUser();

    // THEN
    expect(() => cluster.addRotationSingleUser()).toThrow(
      /A single user rotation was already added to this cluster/,
    );

    const t = new Template(stack);
    t.resourceCountIs(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      1,
    );
  });

  test("throws when trying to add single-user rotation to a serverless cluster without VPC", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
    });

    // THEN
    expect(() => {
      cluster.addRotationSingleUser();
    }).toThrow(/Cannot add single user rotation for a cluster without VPC/);
  });

  test("throws when trying to add multi-user rotation to a serverless cluster without VPC", () => {
    // GIVEN
    const stack = testStack();
    const secret = new rds.DatabaseSecret(stack, "Secret", {
      username: "admin",
    });

    // WHEN
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
    });

    // THEN
    expect(() => {
      cluster.addRotationMultiUser("someId", { secret });
    }).toThrow(/Cannot add multi user rotation for a cluster without VPC/);
  });

  test("can set deletion protection", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      deletionProtection: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      deletion_protection: true,
    });
  });

  test("can set backup retention", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      backupRetention: Duration.days(2),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      backup_retention_period: 2,
    });
  });

  // TODO: omitted -- "does not throw (but adds a node error) if a (dummy) VPC does not have
  // sufficient subnets" depends on `ec2.Vpc.fromLookup({ isDefault: true })`, the CDK CLI's
  // synth-time context-provider lookup mechanism with no CDKTF equivalent (same omission as
  // `DatabaseClusterBase`/`DatabaseInstanceBase.fromLookup` elsewhere in this port). The underlying
  // "Cluster requires at least 2 subnets" `Annotations.addError` behavior it exercises is otherwise
  // portable and is not separately re-tested here --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/serverless-cluster.test.ts#L431-L450

  test("can set scaling configuration", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      scaling: {
        minCapacity: rds.AuroraCapacityUnit.ACU_1,
        maxCapacity: rds.AuroraCapacityUnit.ACU_128,
        autoPause: Duration.minutes(10),
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      scaling_configuration: {
        auto_pause: true,
        max_capacity: 128,
        min_capacity: 1,
        seconds_until_auto_pause: 600,
      },
    });
  });

  test("can enable Data API", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      enableDataApi: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      enable_http_endpoint: true,
    });
  });

  test("default scaling options", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      scaling: {},
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      scaling_configuration: {
        auto_pause: true,
      },
    });
  });

  test("auto pause is disabled if a time of zero is specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      scaling: {
        autoPause: Duration.seconds(0),
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      scaling_configuration: {
        auto_pause: false,
      },
    });
  });

  test("throws when invalid auto pause time is specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // THEN
    expect(
      () =>
        new rds.ServerlessCluster(stack, "Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          vpc,
          scaling: {
            autoPause: Duration.seconds(30),
          },
        }),
    ).toThrow(/auto pause time must be between 5 minutes and 1 day./);

    expect(
      () =>
        new rds.ServerlessCluster(stack, "Another Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          vpc,
          scaling: {
            autoPause: Duration.days(2),
          },
        }),
    ).toThrow(/auto pause time must be between 5 minutes and 1 day./);
  });

  test("throws when invalid backup retention period is specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    expect(
      () =>
        new rds.ServerlessCluster(stack, "Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          vpc,
          backupRetention: Duration.days(0),
        }),
    ).toThrow(
      /backup retention period must be between 1 and 35 days. received: 0/,
    );

    expect(
      () =>
        new rds.ServerlessCluster(stack, "Another Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          vpc,
          backupRetention: Duration.days(36),
        }),
    ).toThrow(
      /backup retention period must be between 1 and 35 days. received: 36/,
    );
  });

  test("throws error when min capacity is greater than max capacity", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    expect(
      () =>
        new rds.ServerlessCluster(stack, "Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          vpc,
          scaling: {
            minCapacity: rds.AuroraCapacityUnit.ACU_2,
            maxCapacity: rds.AuroraCapacityUnit.ACU_1,
          },
        }),
    ).toThrow(
      /maximum capacity must be greater than or equal to minimum capacity./,
    );
  });

  test("check that clusterArn property works", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
    });

    // THEN
    expect(stack.resolve(cluster.clusterArn)).toEqual(
      stack.resolve(
        stack.formatArn({
          service: "rds",
          resource: "cluster",
          resourceName: cluster.clusterIdentifier,
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ),
    );
  });

  test("can grant Data API access", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      enableDataApi: true,
    });
    const user = new iam.User(stack, "User");

    // WHEN
    cluster.grantDataApiAccess(user);

    // THEN
    // TERRACONSTRUCTS DEVIATION: mirrors upstream's `resourceArns: ['*']` on
    // `ServerlessClusterBase.grantDataApiAccess()` (`../../../../src/aws/storage/rds/serverless-cluster.ts`)
    // -- unlike `DatabaseCluster.grantDataApiAccess()`, which scopes to `[this.clusterArn]`.
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: [
              "rds-data:BatchExecuteStatement",
              "rds-data:BeginTransaction",
              "rds-data:CommitTransaction",
              "rds-data:ExecuteStatement",
              "rds-data:RollbackTransaction",
            ],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            effect: "Allow",
            resources: [stack.resolve(cluster.secret!.secretArn)],
          }),
        ]),
      },
    );
  });

  test("can grant Data API access on imported cluster with given secret", () => {
    // GIVEN
    const stack = testStack();
    const secret = new rds.DatabaseSecret(stack, "Secret", {
      username: "admin",
    });
    const cluster = rds.ServerlessCluster.fromServerlessClusterAttributes(
      stack,
      "Cluster",
      {
        clusterIdentifier: "ImportedDatabase",
        secret,
      },
    );
    const user = new iam.User(stack, "User");

    // WHEN
    cluster.grantDataApiAccess(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: [
              "rds-data:BatchExecuteStatement",
              "rds-data:BeginTransaction",
              "rds-data:CommitTransaction",
              "rds-data:ExecuteStatement",
              "rds-data:RollbackTransaction",
            ],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            effect: "Allow",
            resources: [stack.resolve(secret.secretArn)],
          }),
        ]),
      },
    );
  });

  test("grant Data API access enables the Data API", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
    });
    const user = new iam.User(stack, "User");

    // WHEN
    cluster.grantDataApiAccess(user);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      enable_http_endpoint: true,
    });
  });

  test("grant Data API access throws if the Data API is disabled", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      enableDataApi: false,
    });
    const user = new iam.User(stack, "User");

    // WHEN
    expect(() => cluster.grantDataApiAccess(user)).toThrow(
      /Cannot grant Data API access when the Data API is disabled/,
    );
  });

  test("changes the case of the cluster identifier", () => {
    // GIVEN
    const stack = testStack();
    const clusterIdentifier = "TestClusterIdentifier";
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      clusterIdentifier,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      cluster_identifier: clusterIdentifier.toLowerCase(),
    });
  });

  // TODO: omitted -- "does not change the case of the cluster identifier if the
  // lowercaseDbIdentifier feature flag is disabled" exercises the
  // `@aws-cdk/aws-rds:lowercaseDbIdentifier` `cx-api` CDK context feature flag. CDK's synth-time
  // feature-flag registry is not ported in this repo (same omission as `RDS_LOWERCASE_DB_IDENTIFIER`
  // on `DatabaseInstance`/`DatabaseClusterNew`'s identifier handling); unconditional lowercasing (the
  // corrected behavior, exercised above) is the only behavior here --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/serverless-cluster.test.ts#L788-L806

  test("can create a Serverless cluster without VPC", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
    });

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      rdsCluster.RdsCluster,
    ) as any[];
    expect(clusterResource.engine).toEqual("aurora-mysql");
    expect(clusterResource.engine_mode).toEqual("serverless");
    expect(clusterResource.db_subnet_group_name).toBeUndefined();
    expect(clusterResource.vpc_security_group_ids).toEqual([]);
  });

  test("cannot create a Serverless cluster without VPC but specifying a security group", () => {
    // GIVEN
    const stack = testStack();
    const sg = compute.SecurityGroup.fromSecurityGroupId(
      stack,
      "SG",
      "SecurityGroupId12345",
    );

    // THEN
    expect(
      () =>
        new rds.ServerlessCluster(stack, "Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          securityGroups: [sg],
        }),
    ).toThrow(
      /A VPC is required to use securityGroups in ServerlessCluster. Please add a VPC or remove securityGroups/,
    );
  });

  test("cannot create a Serverless cluster without VPC but specifying a subnet group", () => {
    // GIVEN
    const stack = testStack();
    const subnetGroupName = "SubnetGroupId12345";
    const subnetGroup = rds.SubnetGroup.fromSubnetGroupName(
      stack,
      "SubnetGroup12345",
      subnetGroupName,
    );

    // THEN
    expect(
      () =>
        new rds.ServerlessCluster(stack, "Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          subnetGroup,
        }),
    ).toThrow(
      /A VPC is required to use subnetGroup in ServerlessCluster. Please add a VPC or remove subnetGroup/,
    );
  });

  test("cannot create a Serverless cluster without VPC but specifying VPC subnets", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    const vpcSubnets = {
      subnetGroupName: "AVpcSubnet",
    };

    // THEN
    expect(
      () =>
        new rds.ServerlessCluster(stack, "Database", {
          engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          vpcSubnets,
        }),
    ).toThrow(
      /A VPC is required to use vpcSubnets in ServerlessCluster. Please add a VPC or remove vpcSubnets/,
    );
  });

  // TODO: omitted -- "can call exportValue on endpoint.port" exercises `cdk.Stack.exportValue()`, a
  // CFN cross-stack `Fn::ImportValue`/`Export` mechanism. `AwsStack` has no `exportValue` equivalent
  // in this repo (Terraform cross-stack references work differently, via remote state / outputs) --
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/serverless-cluster.test.ts#L867-L886

  test("cluster with copyTagsToSnapshot default", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        stack,
        "ParameterGroup",
        "default.aurora-postgresql11",
      ),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      copy_tags_to_snapshot: true,
    });
  });

  test("cluster with copyTagsToSnapshot disabled", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      copyTagsToSnapshot: false,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        stack,
        "ParameterGroup",
        "default.aurora-postgresql11",
      ),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      copy_tags_to_snapshot: false,
    });
  });

  test("cluster with copyTagsToSnapshot enabled", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      copyTagsToSnapshot: true,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        stack,
        "ParameterGroup",
        "default.aurora-postgresql11",
      ),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      copy_tags_to_snapshot: true,
    });
  });

  test("check properties propagation of ServerlessScalingOptions", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    new rds.ServerlessCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc: new compute.Vpc(stack, "Vpc"),
      scaling: {
        autoPause: Duration.minutes(10),
        minCapacity: rds.AuroraCapacityUnit.ACU_8,
        maxCapacity: rds.AuroraCapacityUnit.ACU_32,
        timeout: Duration.minutes(10),
        timeoutAction: rds.TimeoutAction.FORCE_APPLY_CAPACITY_CHANGE,
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
      scaling_configuration: {
        auto_pause: true,
        max_capacity: 32,
        min_capacity: 8,
        seconds_until_auto_pause: 600,
        seconds_before_timeout: 600,
        timeout_action: "ForceApplyCapacityChange",
      },
    });
  });

  test.each([Duration.seconds(59), Duration.seconds(601)])(
    "invalid ServerlessScalingOptions throws",
    (duration) => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "Vpc");

      // THEN
      expect(
        () =>
          new rds.ServerlessCluster(stack, "Database1", {
            engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
            vpc,
            scaling: {
              autoPause: Duration.minutes(10),
              minCapacity: rds.AuroraCapacityUnit.ACU_8,
              maxCapacity: rds.AuroraCapacityUnit.ACU_32,
              timeout: duration,
            },
          }),
      ).toThrow(/timeout must be between 60 and 600 seconds/);
    },
  );

  // TERRACONSTRUCTS DEVIATION: not present upstream. Mirrors the "removal policy replacement props"
  // describe block in `./instance.test.ts` -- see the note there for why `skipFinalSnapshot`/
  // `finalSnapshotIdentifier`/`deletionProtection` (native `aws_rds_cluster` fields) replace
  // upstream's `removalPolicy` here.
  describe("removal policy replacement props", () => {
    test("skipFinalSnapshot, finalSnapshotIdentifier and deletionProtection are rendered when set", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new rds.ServerlessCluster(stack, "Database", {
        engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
        vpc,
        skipFinalSnapshot: false,
        finalSnapshotIdentifier: "my-final-snapshot",
        deletionProtection: true,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
        skip_final_snapshot: false,
        final_snapshot_identifier: "my-final-snapshot",
        deletion_protection: true,
      });
    });

    test("skipFinalSnapshot true omits finalSnapshotIdentifier", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new rds.ServerlessCluster(stack, "Database", {
        engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
        vpc,
        skipFinalSnapshot: true,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(rdsCluster.RdsCluster, {
        skip_final_snapshot: true,
      });
      const [clusterResource] = t.resourceTypeArray(
        rdsCluster.RdsCluster,
      ) as any[];
      expect(clusterResource.final_snapshot_identifier).toBeUndefined();
    });

    test("warns when neither skipFinalSnapshot nor finalSnapshotIdentifier is set", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new rds.ServerlessCluster(stack, "Database", {
        engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
        vpc,
      });

      Annotations.fromStack(stack).hasWarnings({
        constructPath: "MyStack/Database",
        message: expect.stringContaining(
          "Neither `skipFinalSnapshot` nor `finalSnapshotIdentifier` is set",
        ),
      });
    });
  });
});
