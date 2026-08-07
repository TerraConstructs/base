// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/test/cluster.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import {
  docdbCluster,
  docdbClusterInstance,
  docdbClusterParameterGroup,
  docdbSubnetGroup,
  secretsmanagerSecret,
  secretsmanagerSecretRotation,
  secretsmanagerSecretVersion,
  dataAwsSecretsmanagerRandomPassword,
  vpcSecurityGroupEgressRule,
  serverlessapplicationrepositoryCloudformationStack,
} from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing, Tokenization } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as docdb from "../../../../src/aws/storage/docdb";
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

// TERRACONSTRUCTS DEVIATION: filter out the unrelated `skipFinalSnapshot`/`finalSnapshotIdentifier`
// synth-time warning (emitted whenever neither is set, which every test in this file triggers
// incidentally) rather than asserting zero warnings overall -- mirrors the identical adaptation in
// `../rds/cluster.test.ts`.
function nonSkipFinalSnapshotWarnings(stack: AwsStack) {
  return Annotations.fromStack(stack).warnings.filter(
    (w) => !w.message.toString().includes("skipFinalSnapshot"),
  );
}

describe("DatabaseCluster", () => {
  test("check that instantiation works", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        password: "tooshort",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      master_username: "admin",
      master_password: "tooshort",
      storage_encrypted: true,
    });
    t.resourceCountIs(docdbClusterInstance.DocdbClusterInstance, 1);
    t.expect.toHaveResourceWithProperties(docdbSubnetGroup.DocdbSubnetGroup, {
      subnet_ids: expect.arrayContaining([expect.anything()]),
    });
    const [subnetGroupResource] = t.resourceTypeArray(
      docdbSubnetGroup.DocdbSubnetGroup,
    ) as any[];
    expect(subnetGroupResource.subnet_ids).toHaveLength(3);
  });

  test("can create a cluster with a single instance", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      instances: 1,
      masterUser: {
        username: "admin",
        password: "tooshort",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      master_username: "admin",
      master_password: "tooshort",
    });
    t.resourceCountIs(docdbClusterInstance.DocdbClusterInstance, 1);
  });

  test("can specify instance CA certificate", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      instances: 1,
      masterUser: {
        username: "admin",
        password: "tooshort",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      caCertificate: docdb.CaCertificate.RDS_CA_RSA4096_G1,
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        cluster_identifier: stack.resolve(cluster.clusterIdentifier),
        ca_cert_identifier: "rds-ca-rsa4096-g1",
      },
    );
  });

  test("errors when less than one instance is specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    expect(() => {
      new docdb.DatabaseCluster(stack, "Database", {
        instances: 0,
        masterUser: {
          username: "admin",
        },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.LARGE,
        ),
      });
    }).toThrow("At least one instance is required");
  });

  test("errors when only one subnet is specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC", {
      maxAzs: 1,
    });

    // WHEN
    expect(() => {
      new docdb.DatabaseCluster(stack, "Database", {
        instances: 1,
        masterUser: {
          username: "admin",
        },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.LARGE,
        ),
        vpcSubnets: {
          subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS,
        },
      });
    }).toThrow("Cluster requires at least 2 subnets, got 1");
  });

  test("secret attachment target type is correct", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      instances: 1,
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: mirrors `DatabaseSecret.attach()`'s house pattern (see
    // `../rds/cluster.test.ts`'s equivalent test) -- there is no
    // `AWS::SecretsManager::SecretTargetAttachment` Terraform resource; `Secret.attach()` instead
    // stores the resolved `SecretAttachmentTargetProps` inline on the secret's own
    // `aws_secretsmanager_secret_version` (via `secretObjectValue`/`secretStringTemplate`), so the
    // assertion below checks `cluster.secret`'s attachment target directly rather than a separate
    // synthesized resource.
    expect(cluster.secret).toBeDefined();
    const target = cluster.asSecretAttachmentTarget();
    expect(stack.resolve(target.targetType)).toEqual("AWS::DocDB::DBCluster");
    // `engine`/`ssl` are required by the Secrets Manager MongoDB rotation templates and are not
    // resolvable server-side the way CFN's `SecretTargetAttachment` would (see the deviation note
    // on `DatabaseClusterBase.asSecretAttachmentTarget()`); `host`/`port` come from the cluster's
    // resolved endpoint.
    expect(stack.resolve(target.connectionFields)).toEqual({
      dbClusterIdentifier: stack.resolve(cluster.clusterIdentifier),
      engine: "mongo",
      ssl: "true",
      host: stack.resolve(cluster.clusterEndpoint.hostname),
      port: stack.resolve(
        Tokenization.stringifyNumber(cluster.clusterEndpoint.port),
      ),
    });
  });

  test("generated secret is attached with mongo engine, ssl and host/port connection fields", () => {
    // Regression test: `asSecretAttachmentTarget()` must inject `engine: "mongo"` and `ssl: "true"`
    // into the generated secret's JSON -- without them, the Secrets Manager MongoDB rotation
    // Lambda templates fail (see the docblock on `RotationMultiUserOptions.secret` in
    // `../../../../src/aws/storage/docdb/props.ts`). Mirrors the analogous
    // `../rds/cluster.test.ts` "generated secret is attached with host and port connection fields"
    // regression tests.
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: { username: "admin" },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
      {
        secret_string: expect.stringContaining('"engine" = "mongo"'),
      },
    );
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
      {
        secret_string: expect.stringContaining('"ssl" = "true"'),
      },
    );
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
      {
        secret_string: expect.stringContaining("host"),
      },
    );
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretVersion.SecretsmanagerSecretVersion,
      {
        secret_string: expect.stringContaining("port"),
      },
    );
  });

  test("can create a cluster with imported vpc and security group", () => {
    // GIVEN
    const stack = testStack();
    // TODO: omitted — upstream's `ec2.Vpc.fromLookup()` depends on the CDK CLI's synth-time
    // context-provider lookup/cache mechanism, which has no CDKTF equivalent (same omission as
    // `DatabaseClusterBase.fromLookup` in `./cluster.ts`). Use `compute.Vpc.fromVpcAttributes()`
    // with explicitly known attributes instead.
    const vpc = compute.Vpc.fromVpcAttributes(stack, "VPC", {
      vpcId: "VPC12345",
      availabilityZones: ["us-east-1a", "us-east-1b"],
      privateSubnetIds: ["priv-1", "priv-2"],
    });
    const sg = compute.SecurityGroup.fromSecurityGroupId(
      stack,
      "SG",
      "SecurityGroupId12345",
    );

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      instances: 1,
      masterUser: {
        username: "admin",
        password: "tooshort",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      securityGroup: sg,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      master_username: "admin",
      master_password: "tooshort",
      vpc_security_group_ids: ["SecurityGroupId12345"],
    });
  });

  test("can configure cluster deletion protection", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      deletionProtection: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      deletion_protection: true,
    });
  });

  test("cluster with parameter group", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const group = new docdb.ClusterParameterGroup(stack, "Params", {
      family: "hello",
      description: "bye",
      parameters: {
        param: "value",
      },
    });
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        password: "tooshort",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      parameterGroup: group,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      db_cluster_parameter_group_name: stack.resolve(group.parameterGroupName),
    });
    t.expect.toHaveResourceWithProperties(
      docdbClusterParameterGroup.DocdbClusterParameterGroup,
      {
        family: "hello",
        description: "bye",
        parameter: [{ name: "param", value: "value" }],
      },
    );
  });

  test("cluster with imported parameter group", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const group = docdb.ClusterParameterGroup.fromParameterGroupName(
      stack,
      "Params",
      "ParamGroupName",
    );

    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        password: "tooshort",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      parameterGroup: group,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      db_cluster_parameter_group_name: "ParamGroupName",
    });
  });

  test("creates a secret when master credentials are not specified", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: mirrors `DatabaseCluster`'s generated-password house pattern (see
    // `../rds/cluster.test.ts`'s equivalent test) rather than upstream's CFN dynamic-reference
    // (`{{resolve:secretsmanager:...}}`) syntax -- the generated password is an
    // `aws_secretsmanager_random_password` data-source token, stored verbatim (and `ignore_changes`'d)
    // on the `aws_docdb_cluster.master_password` argument.
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
      {
        exclude_characters: '"@/',
        password_length: 41,
      },
    );
    const [clusterResource] = t.resourceTypeArray(
      docdbCluster.DocdbCluster,
    ) as any[];
    expect(clusterResource.master_username).toEqual("admin");
    expect(clusterResource.master_password).toBeDefined();
    // TERRACONSTRUCTS DEVIATION: generated-password `ignore_changes` house pattern (see the
    // `ignore_changes`/password-drift note in `DatabaseCluster`'s constructor) -- without it, every
    // apply after the first would drift and REPLACE the live master password.
    expect(clusterResource.lifecycle).toEqual({
      ignore_changes: ["master_password"],
    });
  });

  test("creates a secret with excludeCharacters", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        excludeCharacters: '"@/()[]',
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
      {
        exclude_characters: '"@/()[]',
      },
    );
  });

  test("creates a secret with secretName set", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        secretName: "/myapp/mydocdb/masteruser",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecret.SecretsmanagerSecret,
      {
        name: "/myapp/mydocdb/masteruser",
      },
    );
  });

  test("create an encrypted cluster with custom KMS key", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const key = new encryption.Key(stack, "Key");
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      kmsKey: key,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      kms_key_id: stack.resolve(key.keyArn),
      storage_encrypted: true,
    });
  });

  test("creating a cluster defaults to using encryption", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      storage_encrypted: true,
    });
  });

  test("supplying a KMS key with storageEncryption false throws an error", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    function action() {
      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: {
          username: "admin",
        },
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.BURSTABLE2,
          compute.InstanceSize.SMALL,
        ),
        vpc,
        kmsKey: new encryption.Key(stack, "Key"),
        storageEncrypted: false,
      });
    }

    // THEN
    expect(action).toThrow();
  });

  test("cluster exposes different read and write endpoints", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });

    // THEN
    expect(stack.resolve(cluster.clusterEndpoint)).not.toEqual(
      stack.resolve(cluster.clusterReadEndpoint),
    );
  });

  test("instance identifier used when present", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const instanceIdentifierBase = "instanceidentifierbase-";
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
      instanceIdentifierBase,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        identifier: `${instanceIdentifierBase}1`,
      },
    );
  });

  test("cluster identifier used", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    const clusterIdentifier = "clusteridentifier-";
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
      dbClusterName: clusterIdentifier,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        identifier: `${clusterIdentifier}instance1`,
      },
    );
  });

  test("cluster identifier defaults to a lowercased gridUUID-scoped generated name", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: { username: "admin" },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      docdbCluster.DocdbCluster,
    ) as any[];
    expect(clusterResource.cluster_identifier).toEqual(
      (clusterResource.cluster_identifier as string).toLowerCase(),
    );
  });

  test("generated subnet group name is distinct from the cluster identifier", () => {
    // Regression test: the auto-created `aws_docdb_subnet_group.name` and `aws_docdb_cluster
    // .cluster_identifier` are both gridUUID-scoped `uniqueResourceName` defaults, but MUST be
    // derived from each resource's OWN construct path -- reusing the same path for both would
    // silently collapse them to the identical string (see the deviation note on the `subnetGroup`
    // creation in `../../../../src/aws/storage/docdb/cluster.ts`).
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: { username: "admin" },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      docdbCluster.DocdbCluster,
    ) as any[];
    const [subnetGroupResource] = t.resourceTypeArray(
      docdbSubnetGroup.DocdbSubnetGroup,
    ) as any[];
    expect(subnetGroupResource.name).not.toEqual(
      clusterResource.cluster_identifier,
    );
  });

  test("imported cluster has supplied attributes", () => {
    // GIVEN
    const stack = testStack();

    // WHEN
    const cluster = docdb.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Database",
      {
        clusterEndpointAddress: "addr",
        clusterIdentifier: "identifier",
        instanceEndpointAddresses: ["addr"],
        instanceIdentifiers: ["identifier"],
        port: 3306,
        readerEndpointAddress: "reader-address",
        securityGroup: compute.SecurityGroup.fromSecurityGroupId(
          stack,
          "SG",
          "sg-123456789",
          {
            allowAllOutbound: false,
          },
        ),
      },
    );

    // THEN
    expect(cluster.clusterEndpoint.hostname).toEqual("addr");
    expect(cluster.clusterEndpoint.port).toEqual(3306);
    expect(cluster.clusterIdentifier).toEqual("identifier");
    expect(cluster.instanceIdentifiers).toEqual(["identifier"]);
    expect(cluster.clusterReadEndpoint.hostname).toEqual("reader-address");
    expect(cluster.securityGroupId).toEqual("sg-123456789");
  });

  test("imported cluster with imported security group honors allowAllOutbound", () => {
    // GIVEN
    const stack = testStack();

    const cluster = docdb.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Database",
      {
        clusterEndpointAddress: "addr",
        clusterIdentifier: "identifier",
        instanceEndpointAddresses: ["addr"],
        instanceIdentifiers: ["identifier"],
        port: 3306,
        readerEndpointAddress: "reader-address",
        securityGroup: compute.SecurityGroup.fromSecurityGroupId(
          stack,
          "SG",
          "sg-123456789",
          {
            allowAllOutbound: false,
          },
        ),
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

  test("minimal imported cluster throws on accessing attributes for unprovided parameters", () => {
    const stack = testStack();

    const cluster = docdb.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Database",
      {
        clusterIdentifier: "identifier",
      },
    );

    expect(cluster.clusterIdentifier).toEqual("identifier");
    expect(() => cluster.clusterEndpoint).toThrow(
      /Cannot access `clusterEndpoint` of an imported cluster/,
    );
    expect(() => cluster.clusterReadEndpoint).toThrow(
      /Cannot access `clusterReadEndpoint` of an imported cluster/,
    );
    expect(() => cluster.instanceIdentifiers).toThrow(
      /Cannot access `instanceIdentifiers` of an imported cluster/,
    );
    expect(() => cluster.instanceEndpoints).toThrow(
      /Cannot access `instanceEndpoints` of an imported cluster/,
    );
    expect(() => cluster.securityGroupId).toThrow(
      /Cannot access `securityGroupId` of an imported cluster/,
    );
  });

  test("backup retention period respected", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
      backup: {
        retention: Duration.days(20),
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      backup_retention_period: 20,
    });
  });

  test("backup maintenance window respected", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
      backup: {
        retention: Duration.days(20),
        preferredWindow: "07:34-08:04",
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      backup_retention_period: 20,
      preferred_backup_window: "07:34-08:04",
    });
  });

  test("regular maintenance window respected", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
      preferredMaintenanceWindow: "tue:07:34-tue:08:04",
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      preferred_maintenance_window: "tue:07:34-tue:08:04",
    });
  });

  test("instanceMaintenanceWindow propagates to all auto-created instances", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      preferredMaintenanceWindow: "tue:04:17-tue:04:47",
      instances: 2,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
      instanceMaintenanceWindow: "sat:09:00-sat:09:30",
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      preferred_maintenance_window: "tue:04:17-tue:04:47",
    });
    t.resourceCountIs(docdbClusterInstance.DocdbClusterInstance, 2);
    const instances = t.resourceTypeArray(
      docdbClusterInstance.DocdbClusterInstance,
    ) as any[];
    for (const instance of instances) {
      expect(instance.preferred_maintenance_window).toEqual(
        "sat:09:00-sat:09:30",
      );
    }
  });

  test("maintenance window is omitted on instances when instanceMaintenanceWindow is not set", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // THEN
    const t = new Template(stack);
    const [instanceResource] = t.resourceTypeArray(
      docdbClusterInstance.DocdbClusterInstance,
    ) as any[];
    expect(instanceResource.preferred_maintenance_window).toBeUndefined();
  });

  test.each([
    "mon:00:00-mon:00:30",
    "sun:23:45-mon:00:15",
    "wed:12:00-thu:11:59",
    "SAT:09:00-SAT:09:30", // case-insensitive
  ])("accepts valid maintenance window %s", (window) => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN / THEN
    expect(
      () =>
        new docdb.DatabaseCluster(stack, "Database", {
          masterUser: { username: "admin" },
          vpc,
          instanceType: compute.InstanceType.of(
            compute.InstanceClass.R5,
            compute.InstanceSize.SMALL,
          ),
          preferredMaintenanceWindow: window,
          instanceMaintenanceWindow: window,
        }),
    ).not.toThrow();
  });

  test("skips maintenance window validation for tokenized values", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    // TERRACONSTRUCTS DEVIATION: upstream uses `cdk.CfnParameter`, which has no CDKTF equivalent;
    // `TerraformVariable` (used the same way -- an unresolved Token at synth time) is the
    // TerraConstructs-native stand-in (mirrors `../rds/cluster.test.ts`'s equivalent adaptation).
    const clusterWindow = new TerraformVariable(stack, "ClusterWindow", {
      type: "string",
    }).stringValue;
    const instanceWindow = new TerraformVariable(stack, "InstanceWindow", {
      type: "string",
    }).stringValue;

    // WHEN / THEN
    expect(
      () =>
        new docdb.DatabaseCluster(stack, "Database", {
          masterUser: { username: "admin" },
          vpc,
          instanceType: compute.InstanceType.of(
            compute.InstanceClass.R5,
            compute.InstanceSize.SMALL,
          ),
          preferredMaintenanceWindow: clusterWindow,
          instanceMaintenanceWindow: instanceWindow,
        }),
    ).not.toThrow();
  });

  test.each([
    ["07:34-08:04", "missing day prefix"],
    ["tue:04:17", "missing end range"],
    ["funday:04:17-tue:04:47", "invalid day"],
    ["tue:24:00-tue:24:30", "invalid hour"],
    ["tue:04:60-tue:05:30", "invalid minute"],
    ["tue:04:17-tue:04:47 ", "trailing whitespace"],
    ["", "empty string"],
  ])(
    "fails for invalid preferredMaintenanceWindow %s (%s)",
    (window, _reason) => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN / THEN
      expect(
        () =>
          new docdb.DatabaseCluster(stack, "Database", {
            masterUser: { username: "admin" },
            vpc,
            instanceType: compute.InstanceType.of(
              compute.InstanceClass.R5,
              compute.InstanceSize.SMALL,
            ),
            preferredMaintenanceWindow: window,
          }),
      ).toThrow(
        /preferredMaintenanceWindow must be in the format ddd:hh24:mi-ddd:hh24:mi/,
      );
    },
  );

  test.each([
    ["07:34-08:04", "missing day prefix"],
    ["funday:04:17-tue:04:47", "invalid day"],
    ["tue:24:00-tue:24:30", "invalid hour"],
    ["tue:04:60-tue:05:30", "invalid minute"],
    ["", "empty string"],
  ])(
    "fails for invalid instanceMaintenanceWindow %s (%s)",
    (window, _reason) => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN / THEN
      expect(
        () =>
          new docdb.DatabaseCluster(stack, "Database", {
            masterUser: { username: "admin" },
            vpc,
            instanceType: compute.InstanceType.of(
              compute.InstanceClass.R5,
              compute.InstanceSize.SMALL,
            ),
            instanceMaintenanceWindow: window,
          }),
      ).toThrow(
        /instanceMaintenanceWindow must be in the format ddd:hh24:mi-ddd:hh24:mi/,
      );
    },
  );

  test("can configure CloudWatchLogs for audit", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      exportAuditLogsToCloudWatch: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      enabled_cloudwatch_logs_exports: ["audit"],
    });
  });

  test("can configure CloudWatchLogs for profiler", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      exportProfilerLogsToCloudWatch: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      enabled_cloudwatch_logs_exports: ["profiler"],
    });
  });

  test("can configure CloudWatchLogs for all logs", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      exportAuditLogsToCloudWatch: true,
      exportProfilerLogsToCloudWatch: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      enabled_cloudwatch_logs_exports: ["audit", "profiler"],
    });
  });

  // TODO: omitted — upstream's `test('can set CloudWatch log retention', ...)` exercises
  // `cloudWatchLogsRetention`/`cloudWatchLogsRetentionRole` (Lambda-backed `Custom::LogRetention`
  // custom resource). There is no Terraform-native equivalent, and the props are dropped entirely
  // (see the TODO on `DatabaseClusterProps.cloudWatchLogsRetention` in `../../../../src/aws/storage/docdb/cluster.ts`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/test/cluster.test.ts#L822-L860

  test("can enable Performance Insights on instances", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // WHEN
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE2,
        compute.InstanceSize.SMALL,
      ),
      vpc,
      enablePerformanceInsights: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        enable_performance_insights: true,
      },
    );
  });

  test("single user rotation", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // WHEN
    cluster.addRotationSingleUser(Duration.days(5));

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        rotation_rules: { schedule_expression: "rate(5 days)" },
      },
    );
    t.expect.toHaveResourceWithProperties(
      serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
      {
        application_id: expect.stringContaining(
          "SecretsManagerMongoDBRotationSingleUser",
        ),
      },
    );
  });

  test("single user rotation requires secret", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        password: "secretpassword",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // WHEN
    function addSingleUserRotation() {
      cluster.addRotationSingleUser(Duration.days(10));
    }

    // THEN
    expect(addSingleUserRotation).toThrow();
  });

  test("no multiple single user rotations", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });

    // WHEN
    cluster.addRotationSingleUser(Duration.days(5));
    function addSecondRotation() {
      cluster.addRotationSingleUser(Duration.days(10));
    }

    // THEN
    expect(addSecondRotation).toThrow();
  });

  test("multi user rotation", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });
    const userSecret = new docdb.DatabaseSecret(stack, "UserSecret", {
      username: "seconduser",
      masterSecret: cluster.secret,
    });
    const attachedUserSecret = userSecret.attach(cluster);

    // WHEN
    cluster.addRotationMultiUser("Rotation", {
      secret: attachedUserSecret,
      automaticallyAfter: Duration.days(5),
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      serverlessapplicationrepositoryCloudformationStack.ServerlessapplicationrepositoryCloudformationStack,
      {
        application_id: expect.stringContaining(
          "SecretsManagerMongoDBRotationMultiUser",
        ),
        parameters: expect.objectContaining({
          masterSecretArn: stack.resolve(cluster.secret!.secretArn),
        }),
      },
    );
    t.expect.toHaveResourceWithProperties(
      secretsmanagerSecretRotation.SecretsmanagerSecretRotation,
      {
        rotation_rules: { schedule_expression: "rate(5 days)" },
      },
    );
  });

  test("multi user rotation requires secret", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      masterUser: {
        username: "admin",
        password: "secretpassword",
      },
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });
    const userSecret = new docdb.DatabaseSecret(stack, "UserSecret", {
      username: "seconduser",
      masterSecret: cluster.secret,
    });
    const attachedUserSecret = userSecret.attach(cluster);

    // WHEN
    function addMultiUserRotation() {
      cluster.addRotationMultiUser("Rotation", {
        secret: attachedUserSecret,
      });
    }

    // THEN
    expect(addMultiUserRotation).toThrow();
  });

  test("adds security groups", () => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");
    const cluster = new docdb.DatabaseCluster(stack, "Database", {
      vpc,
      masterUser: {
        username: "admin",
      },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.SMALL,
      ),
    });
    const securityGroup = new compute.SecurityGroup(stack, "SecurityGroup", {
      vpc,
    });

    // WHEN
    cluster.addSecurityGroups(securityGroup);

    // THEN
    // Asserts the exact (order-sensitive) two-element list, not just that the added security
    // group is present -- this is the behavior the bespoke `securityGroupIds` tracking deviation
    // in `../../../../src/aws/storage/docdb/cluster.ts` exists to guarantee (the originally
    // auto-created security group must be preserved, not clobbered, when appending).
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
      vpc_security_group_ids: [
        stack.resolve(cluster.securityGroupId),
        stack.resolve(securityGroup.securityGroupId),
      ],
    });
  });

  // TODO: omitted globally throughout this block — upstream repeatedly asserts CFN
  // `DeletionPolicy`/`UpdateReplacePolicy` via `removalPolicy`/`instanceRemovalPolicy`/
  // `securityGroupRemovalPolicy` (`RemovalPolicy.SNAPSHOT`/`RETAIN`). Terraform has no per-resource
  // DeletionPolicy concept -- the equivalent semantics (`skipFinalSnapshot`/`finalSnapshotIdentifier`/
  // `deletionProtection`, plus the synth-time warning when neither is set) are covered by the
  // dedicated tests below instead (mirroring `../rds/cluster.ts`'s house pattern). Neither
  // `aws_docdb_cluster_instance` nor the auto-created security group has a native replacement at all
  // (see the TODO on `DatabaseClusterProps.instanceRemovalPolicy`/`securityGroupRemovalPolicy` in
  // `../../../../src/aws/storage/docdb/cluster.ts`), so those upstream tests have no TerraConstructs
  // equivalent —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/test/cluster.test.ts#L1113-L1269
  describe("removal policy replacement props", () => {
    test("skipFinalSnapshot, finalSnapshotIdentifier and deletionProtection are rendered when set", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: { username: "admin" },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
        skipFinalSnapshot: false,
        finalSnapshotIdentifier: "my-final-snapshot",
        deletionProtection: true,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
        skip_final_snapshot: false,
        final_snapshot_identifier: "my-final-snapshot",
        deletion_protection: true,
      });
    });

    test("skipFinalSnapshot true omits finalSnapshotIdentifier", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: { username: "admin" },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
        skipFinalSnapshot: true,
      });

      const t = new Template(stack);
      const [clusterResource] = t.resourceTypeArray(
        docdbCluster.DocdbCluster,
      ) as any[];
      expect(clusterResource.skip_final_snapshot).toEqual(true);
      expect(clusterResource.final_snapshot_identifier).toBeUndefined();
    });

    test("skipFinalSnapshot, finalSnapshotIdentifier and deletionProtection are absent when unset", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: { username: "admin" },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
      });

      const t = new Template(stack);
      const [clusterResource] = t.resourceTypeArray(
        docdbCluster.DocdbCluster,
      ) as any[];
      expect(clusterResource.skip_final_snapshot).toBeUndefined();
      expect(clusterResource.final_snapshot_identifier).toBeUndefined();
      expect(clusterResource.deletion_protection).toBeUndefined();
    });

    test("warns when neither skipFinalSnapshot nor finalSnapshotIdentifier is set", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: { username: "admin" },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
      });

      const warnings = Annotations.fromStack(stack).warnings;
      expect(
        warnings.some((w) =>
          w.message.toString().includes("skipFinalSnapshot"),
        ),
      ).toEqual(true);
    });

    test("does not warn when skipFinalSnapshot is true", () => {
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: { username: "admin" },
        vpc,
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
        skipFinalSnapshot: true,
      });

      expect(nonSkipFinalSnapshotWarnings(stack)).toHaveLength(0);
    });
  });

  test.each([
    "1.0.0.1",
    "01.1.0",
    "1.0",
    "-1",
    "-0.1",
    "abc",
    "1.0.a",
    "a.b.c",
  ])("throw error for invalid engine version %s", (engineVersion: string) => {
    // GIVEN
    const stack = testStack();
    const vpc = new compute.Vpc(stack, "VPC");

    // THEN
    expect(() => {
      new docdb.DatabaseCluster(stack, "Database", {
        instances: 1,
        masterUser: {
          username: "admin",
          password: "tooshort",
        },
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
        vpc,
        engineVersion,
      });
    }).toThrow(
      `Invalid engine version: '${engineVersion}'. Engine version must be in the format x.y.z`,
    );
  });

  describe("storage type", () => {
    test("specify storage type", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN
      new docdb.DatabaseCluster(stack, "Database", {
        instances: 1,
        masterUser: {
          username: "admin",
          password: "tooshort",
        },
        instanceType: compute.InstanceType.of(
          compute.InstanceClass.R5,
          compute.InstanceSize.SMALL,
        ),
        vpc,
        storageType: docdb.StorageType.IOPT1,
        engineVersion: "5.0.0",
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
        storage_type: "iopt1",
      });
    });

    test("throw error for invalid engine version with I/O optimized storage type", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // THEN
      expect(() => {
        new docdb.DatabaseCluster(stack, "Database", {
          instances: 1,
          masterUser: {
            username: "admin",
            password: "tooshort",
          },
          instanceType: compute.InstanceType.of(
            compute.InstanceClass.R5,
            compute.InstanceSize.SMALL,
          ),
          vpc,
          storageType: docdb.StorageType.IOPT1,
          engineVersion: "3.6.0",
        });
      }).toThrow(
        "I/O-optimized storage is supported starting with engine version 5.0.0, got '3.6.0'",
      );
    });
  });

  describe("serverless clusters", () => {
    test("can create a serverless cluster", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN
      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: {
          username: "admin",
          password: "tooshort",
        },
        vpc,
        serverlessV2ScalingConfiguration: {
          minCapacity: 0.5,
          maxCapacity: 1,
        },
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
        serverless_v2_scaling_configuration: {
          min_capacity: 0.5,
          max_capacity: 1,
        },
      });
      // Should not create any instances
      t.resourceCountIs(docdbClusterInstance.DocdbClusterInstance, 0);
    });

    test("serverless cluster has empty instance arrays", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN
      const cluster = new docdb.DatabaseCluster(stack, "Database", {
        masterUser: {
          username: "admin",
        },
        vpc,
        serverlessV2ScalingConfiguration: {
          minCapacity: 0.5,
          maxCapacity: 2,
        },
      });

      // THEN
      expect(cluster.instanceIdentifiers).toEqual([]);
      expect(cluster.instanceEndpoints).toEqual([]);
    });

    test("cannot specify instanceType with serverless configuration", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN/THEN
      expect(() => {
        new docdb.DatabaseCluster(stack, "Database", {
          masterUser: {
            username: "admin",
          },
          vpc,
          instanceType: compute.InstanceType.of(
            compute.InstanceClass.R5,
            compute.InstanceSize.LARGE,
          ),
          serverlessV2ScalingConfiguration: {
            minCapacity: 0.5,
            maxCapacity: 1,
          },
        });
      }).toThrow(
        "Cannot specify both instanceType and serverlessV2ScalingConfiguration",
      );
    });

    test("provisioned cluster requires instanceType", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN/THEN
      expect(() => {
        new docdb.DatabaseCluster(stack, "Database", {
          masterUser: {
            username: "admin",
          },
          vpc,
        });
      }).toThrow(
        "Either instanceType (for provisioned clusters) or serverlessV2ScalingConfiguration (for serverless clusters) must be specified",
      );
    });

    test("serverless cluster with all configuration options", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN
      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: {
          username: "admin",
        },
        vpc,
        serverlessV2ScalingConfiguration: {
          minCapacity: 1,
          maxCapacity: 4,
        },
        engineVersion: "5.0.0",
        deletionProtection: true,
        exportAuditLogsToCloudWatch: true,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
        serverless_v2_scaling_configuration: {
          min_capacity: 1,
          max_capacity: 4,
        },
        engine_version: "5.0.0",
        deletion_protection: true,
        enabled_cloudwatch_logs_exports: ["audit"],
      });
    });

    test("serverless cluster requires engine version 5.0.0 or higher", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN/THEN
      expect(() => {
        new docdb.DatabaseCluster(stack, "Database", {
          masterUser: {
            username: "admin",
          },
          vpc,
          serverlessV2ScalingConfiguration: {
            minCapacity: 0.5,
            maxCapacity: 1,
          },
          engineVersion: "4.0.0",
        });
      }).toThrow(
        "DocumentDB serverless requires engine version 5.0.0 or higher, got '4.0.0'",
      );
    });

    test("serverless cluster allows engine version 5.0.0", () => {
      // GIVEN
      const stack = testStack();
      const vpc = new compute.Vpc(stack, "VPC");

      // WHEN
      new docdb.DatabaseCluster(stack, "Database", {
        masterUser: {
          username: "admin",
        },
        vpc,
        serverlessV2ScalingConfiguration: {
          minCapacity: 0.5,
          maxCapacity: 1,
        },
        engineVersion: "5.0.0",
      });

      // THEN - should not throw
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(docdbCluster.DocdbCluster, {
        engine_version: "5.0.0",
        serverless_v2_scaling_configuration: {
          min_capacity: 0.5,
          max_capacity: 1,
        },
      });
    });
  });
});

describe("instance identifiers (TERRACONSTRUCTS DEVIATION: gridUUID naming invariant)", () => {
  test("unnamed cluster derives lowercase gridUUID-scoped instance identifiers from the derived cluster identifier", () => {
    // GIVEN -- local stack (the shared beforeEach fixtures are scoped to the
    // describe blocks above)
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });

    // WHEN -- no dbClusterName, no instanceIdentifierBase
    new docdb.DatabaseCluster(stack, "Database", {
      masterUser: { username: "admin" },
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.R5,
        compute.InstanceSize.LARGE,
      ),
      instances: 2,
      vpc,
    });

    // THEN -- instances reuse the derived (grid-scoped, lowercased) cluster
    // identifier as their base instead of falling back to provider auto-naming
    const t = new Template(stack);
    const instances: any[] = t.resourceTypeArray(
      docdbClusterInstance.DocdbClusterInstance,
    );
    expect(instances).toHaveLength(2);
    const clusterResource: any[] = t.resourceTypeArray(
      docdbCluster.DocdbCluster,
    );
    const clusterId = clusterResource[0].cluster_identifier;
    expect(instances[0].identifier).toEqual(`${clusterId}instance1`);
    expect(instances[1].identifier).toEqual(`${clusterId}instance2`);
    expect(instances[0].identifier).toMatch(/^[a-z0-9-]+$/);
  });
});
