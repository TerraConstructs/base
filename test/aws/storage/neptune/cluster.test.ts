// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/cluster.test.ts

import {
  cloudwatchMetricAlarm,
  neptuneCluster,
  neptuneClusterInstance,
  neptuneSubnetGroup,
  dataAwsIamPolicyDocument,
  vpcSecurityGroupEgressRule,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import * as neptune from "../../../../src/aws/storage/neptune";
import { Duration } from "../../../../src/duration";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let app: App;
let stack: AwsStack;
let vpc: compute.IVpc;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new compute.Vpc(stack, "VPC");
});

describe("DatabaseCluster", () => {
  test("check that instantiation works", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: upstream asserts CFN DeletionPolicy/UpdateReplacePolicy Retain
    // (core.RemovalPolicy is not ported; destroy-time semantics map onto
    // skipFinalSnapshot/finalSnapshotIdentifier — see the props' deviation notes).
    const t = new Template(stack, { snapshot: true });
    const [cluster]: any[] = t.resourceTypeArray(neptuneCluster.NeptuneCluster);
    expect(cluster.storage_encrypted).toEqual(true);
    expect(cluster.neptune_subnet_group_name).toBeDefined();
    expect(cluster.vpc_security_group_ids).toHaveLength(1);

    t.resourceCountIs(neptuneClusterInstance.NeptuneClusterInstance, 1);

    const [subnets]: any[] = t.resourceTypeArray(
      neptuneSubnetGroup.NeptuneSubnetGroup,
    );
    // default Vpc has private-with-egress subnets across the available AZs
    expect(subnets.subnet_ids.length).toBeGreaterThanOrEqual(2);
  });

  test("can create a cluster with a single instance", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      instances: 1,
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(neptuneClusterInstance.NeptuneClusterInstance, 1);
    const [cluster]: any[] = t.resourceTypeArray(neptuneCluster.NeptuneCluster);
    expect(cluster.neptune_subnet_group_name).toBeDefined();
    expect(cluster.vpc_security_group_ids).toHaveLength(1);
  });

  test("errors when less than one instance is specified", () => {
    // WHEN
    expect(() => {
      new neptune.DatabaseCluster(stack, "Database", {
        instances: 0,
        vpc,
        instanceType: neptune.InstanceType.R5_LARGE,
      });
    }).toThrow("At least one instance is required");
  });

  test("errors when only one subnet is specified", () => {
    // GIVEN
    const smallVpc = new compute.Vpc(stack, "SmallVPC", {
      maxAzs: 1,
    });

    // WHEN
    expect(() => {
      new neptune.DatabaseCluster(stack, "Database", {
        instances: 1,
        vpc: smallVpc,
        vpcSubnets: {
          subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS,
        },
        instanceType: neptune.InstanceType.R5_LARGE,
      });
    }).toThrow("Cluster requires at least 2 subnets, got 1");
  });

  test("can create a cluster with custom engine version", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      engineVersion: neptune.EngineVersion.V1_0_4_1,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        engine_version: "1.0.4.1",
      },
    );
  });

  test.each([
    ["1.1.1.0", neptune.EngineVersion.V1_1_1_0],
    ["1.2.0.0", neptune.EngineVersion.V1_2_0_0],
    ["1.3.0.0", neptune.EngineVersion.V1_3_0_0],
    ["1.4.0.0", neptune.EngineVersion.V1_4_0_0],
  ])("can create a cluster for engine version %s", (expected, version) => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      engineVersion: version,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        engine_version: expected,
      },
    );
  });

  test("can create a cluster with imported security group", () => {
    // GIVEN
    // TERRACONSTRUCTS DEVIATION: upstream uses `ec2.Vpc.fromLookup` (ContextProvider, not ported —
    // see the fromLookup TODO in ../../../../src/aws/compute); a constructed Vpc with an imported
    // security group exercises the same code path (caller-supplied securityGroups).
    const sg = compute.SecurityGroup.fromSecurityGroupId(
      stack,
      "SG",
      "SecurityGroupId12345",
    );

    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      instances: 1,
      vpc,
      securityGroups: [sg],
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        vpc_security_group_ids: ["SecurityGroupId12345"],
      },
    );
  });

  test("cluster with parameter group", () => {
    // WHEN
    const group = new neptune.ClusterParameterGroup(stack, "Params", {
      description: "bye",
      parameters: {
        param: "value",
      },
    });
    const cluster = new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      clusterParameterGroup: group,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        neptune_cluster_parameter_group_name: stack.resolve(
          group.clusterParameterGroupName,
        ),
      },
    );
    expect(cluster).toBeDefined();
  });

  test("cluster with associated role", () => {
    // WHEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("rds.amazonaws.com"),
    });
    role.addManagedPolicy(
      // TERRACONSTRUCTS DEVIATION: base's fromAwsManagedPolicyName takes (scope, id, name)
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        stack,
        "S3ReadOnly",
        "AmazonS3ReadOnlyAccess",
      ),
    );

    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      associatedRoles: [role],
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        iam_roles: [stack.resolve(role.roleArn)],
      },
    );
  });

  test("cluster with port", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      port: 1234,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        port: 1234,
      },
    );
  });

  test("cluster with imported parameter group", () => {
    // WHEN
    const group = neptune.ClusterParameterGroup.fromClusterParameterGroupName(
      stack,
      "Params",
      "ParamGroupName",
    );

    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      clusterParameterGroup: group,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        neptune_cluster_parameter_group_name: "ParamGroupName",
      },
    );
  });

  test("create an encrypted cluster with custom KMS key", () => {
    // GIVEN
    const key = new encryption.Key(stack, "Key");

    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      kmsKey: key,
    });

    // THEN -- the key ARN, not the bare id (id-vs-ARN read-back parity; the
    // PR #151 kms lesson)
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        kms_key_arn: stack.resolve(key.keyArn),
        storage_encrypted: true,
      },
    );
  });

  test("creating a cluster defaults to using encryption", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        storage_encrypted: true,
      },
    );
  });

  test("supplying a KMS key with storageEncryption false throws an error", () => {
    // GIVEN
    const key = new encryption.Key(stack, "Key");

    // WHEN
    function action() {
      new neptune.DatabaseCluster(stack, "Database", {
        vpc,
        instanceType: neptune.InstanceType.R5_LARGE,
        kmsKey: key,
        storageEncrypted: false,
      });
    }

    // THEN
    expect(action).toThrow();
  });

  test("cluster exposes different read and write endpoints", () => {
    // WHEN
    const cluster = new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    expect(stack.resolve(cluster.clusterEndpoint)).not.toBe(
      stack.resolve(cluster.clusterReadEndpoint),
    );
  });

  test("instance identifier used when present", () => {
    // WHEN
    const instanceIdentifierBase = "instanceidentifierbase-";
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      instanceIdentifierBase,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        identifier: `${instanceIdentifierBase}1`,
      },
    );
  });

  test("cluster identifier used", () => {
    // WHEN
    const clusterIdentifier = "clusteridentifier-";
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      dbClusterName: clusterIdentifier,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        identifier: `${clusterIdentifier}instance1`,
      },
    );
  });

  test("unnamed cluster derives lowercase gridUUID-scoped instance identifiers", () => {
    // TERRACONSTRUCTS DEVIATION: repo naming invariant (docdb precedent) --
    // instances reuse the DERIVED grid-scoped cluster identifier as their base
    // instead of provider auto-naming.
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      instances: 2,
    });

    const t = new Template(stack);
    const instances: any[] = t.resourceTypeArray(
      neptuneClusterInstance.NeptuneClusterInstance,
    );
    expect(instances).toHaveLength(2);
    const [cluster]: any[] = t.resourceTypeArray(neptuneCluster.NeptuneCluster);
    expect(instances[0].identifier).toEqual(
      `${cluster.cluster_identifier}instance1`,
    );
    expect(instances[1].identifier).toEqual(
      `${cluster.cluster_identifier}instance2`,
    );
    expect(instances[0].identifier).toMatch(/^[a-z0-9-]+$/);
  });

  test("imported cluster has supplied attributes", () => {
    // WHEN
    const cluster = neptune.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Database",
      {
        clusterEndpointAddress: "addr",
        clusterIdentifier: "identifier",
        clusterResourceIdentifier: "resourceIdentifier",
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
    expect(cluster.clusterReadEndpoint.hostname).toEqual("reader-address");
  });

  test("imported cluster with imported security group honors allowAllOutbound", () => {
    // GIVEN
    const cluster = neptune.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Database",
      {
        clusterEndpointAddress: "addr",
        clusterIdentifier: "identifier",
        clusterResourceIdentifier: "resourceIdentifier",
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
    Template.synth(stack).toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        security_group_id: "sg-123456789",
      },
    );
  });

  test("backup retention period respected", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      backupRetention: Duration.days(20),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        backup_retention_period: 20,
      },
    );
  });

  test("backup maintenance window respected", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      backupRetention: Duration.days(20),
      preferredBackupWindow: "07:34-08:04",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        backup_retention_period: 20,
        preferred_backup_window: "07:34-08:04",
      },
    );
  });

  test("regular maintenance window respected", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      preferredMaintenanceWindow: "07:34-08:04",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        preferred_maintenance_window: "07:34-08:04",
      },
    );
  });

  test("iam authentication - off by default", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    const t = new Template(stack);
    const [cluster]: any[] = t.resourceTypeArray(neptuneCluster.NeptuneCluster);
    expect(cluster.iam_database_authentication_enabled).toBeUndefined();
  });

  test("grantConnect - enables IAM auth and grants neptune-db:* to the grantee", () => {
    // WHEN
    const cluster = new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });
    const role = new iam.Role(stack, "DBRole", {
      assumedBy: new iam.AccountPrincipal(stack.account),
    });
    cluster.grantConnect(role);

    // THEN
    const t = new Template(stack);
    const [clusterRes]: any[] = t.resourceTypeArray(
      neptuneCluster.NeptuneCluster,
    );
    expect(clusterRes.iam_database_authentication_enabled).toEqual(true);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["neptune-db:*"],
            effect: "Allow",
            resources: [
              stack.resolve(
                `arn:${stack.partition}:neptune-db:${stack.region}:${stack.account}:${cluster.clusterResourceIdentifier}/*`,
              ),
            ],
          },
        ],
      },
    );
  });

  test("grantConnect - throws if IAM auth disabled", () => {
    // WHEN
    const cluster = new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      iamAuthentication: false,
    });
    const role = new iam.Role(stack, "DBRole", {
      assumedBy: new iam.AccountPrincipal(stack.account),
    });

    // THEN
    expect(() => {
      cluster.grantConnect(role);
    }).toThrow(/Cannot grant permissions when IAM authentication is disabled/);
  });

  test("grant - enables IAM auth and grants specified actions to the grantee", () => {
    // WHEN
    const cluster = new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });
    const role = new iam.Role(stack, "DBRole", {
      assumedBy: new iam.AccountPrincipal(stack.account),
    });
    cluster.grant(
      role,
      "neptune-db:ReadDataViaQuery",
      "neptune-db:WriteDataViaQuery",
    );

    // THEN
    const t = new Template(stack);
    const [clusterRes]: any[] = t.resourceTypeArray(
      neptuneCluster.NeptuneCluster,
    );
    expect(clusterRes.iam_database_authentication_enabled).toEqual(true);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "neptune-db:ReadDataViaQuery",
              "neptune-db:WriteDataViaQuery",
            ],
            effect: "Allow",
            resources: [
              stack.resolve(
                `arn:${stack.partition}:neptune-db:${stack.region}:${stack.account}:${cluster.clusterResourceIdentifier}/*`,
              ),
            ],
          },
        ],
      },
    );
  });

  test("grant - throws if IAM auth disabled", () => {
    // WHEN
    const cluster = new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      iamAuthentication: false,
    });
    const role = new iam.Role(stack, "DBRole", {
      assumedBy: new iam.AccountPrincipal(stack.account),
    });

    // THEN
    expect(() => {
      cluster.grant(
        role,
        "neptune-db:ReadDataViaQuery",
        "neptune-db:WriteDataViaQuery",
      );
    }).toThrow(/Cannot grant permissions when IAM authentication is disabled/);
  });

  test("autoMinorVersionUpgrade is enabled when configured", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      autoMinorVersionUpgrade: true,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        auto_minor_version_upgrade: true,
      },
    );
  });

  test("autoMinorVersionUpgrade is not enabled when not configured", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        auto_minor_version_upgrade: false,
      },
    );
  });

  test("cloudwatchLogsExports is enabled when configured", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      cloudwatchLogsExports: [neptune.LogType.AUDIT],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        enable_cloudwatch_logs_exports: ["audit"],
      },
    );
  });

  // TODO: omitted — upstream's `cloudwatchLogsRetention` tests exercise the Lambda-backed
  // `Custom::LogRetention` custom resource, which has no Terraform equivalent (the prop is
  // TODO-omitted in cluster.ts) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/cluster.test.ts#L697-L729
  // test('cloudwatchLogsExports log retention is enabled when configured', () => { ... });
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/cluster.test.ts#L848-L895
  // test('cloudwatchLogsExports log retention is enabled when configured for multiple logs exports', () => { ... });

  test("metric - constructs metric with correct namespace and dimension and inputs", () => {
    // GIVEN
    const cluster = new neptune.DatabaseCluster(stack, "Cluster", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // WHEN
    const metric = cluster.metric("SparqlRequestsPerSec");
    new cloudwatch.Alarm(stack, "Alarm", {
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      metric: metric,
    });

    // THEN
    expect(metric).toEqual(
      new cloudwatch.Metric({
        namespace: "AWS/Neptune",
        dimensionsMap: {
          DBClusterIdentifier: cluster.clusterIdentifier,
        },
        metricName: "SparqlRequestsPerSec",
      }),
    );
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchMetricAlarm.CloudwatchMetricAlarm,
      {
        namespace: "AWS/Neptune",
        metric_name: "SparqlRequestsPerSec",
        dimensions: {
          DBClusterIdentifier: stack.resolve(cluster.clusterIdentifier),
        },
        comparison_operator: "LessThanThreshold",
        evaluation_periods: 1,
        threshold: 1,
      },
    );
  });

  test("should instantiate a serverless cluster", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.SERVERLESS,
      serverlessScalingConfiguration: {
        minCapacity: 1,
        maxCapacity: 10,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        serverless_v2_scaling_configuration: {
          min_capacity: 1,
          max_capacity: 10,
        },
      },
    );
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        instance_class: "db.serverless",
      },
    );
  });

  test("should validate serverlessScalingConfiguration", () => {
    expect(() => {
      new neptune.DatabaseCluster(stack, "Database0", {
        vpc,
        instanceType: neptune.InstanceType.SERVERLESS,
      });
    }).toThrow(
      /You need to specify a serverless scaling configuration with a db.serverless instance type./,
    );

    expect(() => {
      new neptune.DatabaseCluster(stack, "Database1", {
        vpc,
        instanceType: neptune.InstanceType.SERVERLESS,
        serverlessScalingConfiguration: {
          minCapacity: 0,
          maxCapacity: 10,
        },
      });
    }).toThrow(
      /ServerlessScalingConfiguration minCapacity must be greater or equal than 1, received 0/,
    );

    expect(() => {
      new neptune.DatabaseCluster(stack, "Database2", {
        vpc,
        instanceType: neptune.InstanceType.SERVERLESS,
        serverlessScalingConfiguration: {
          minCapacity: 1,
          maxCapacity: 200,
        },
      });
    }).toThrow(
      /ServerlessScalingConfiguration maxCapacity must be between 2.5 and 128, received 200/,
    );

    expect(() => {
      new neptune.DatabaseCluster(stack, "Database3", {
        vpc,
        instanceType: neptune.InstanceType.SERVERLESS,
        serverlessScalingConfiguration: {
          minCapacity: 10,
          maxCapacity: 5,
        },
      });
    }).toThrow(
      /ServerlessScalingConfiguration minCapacity 10 must be less than serverlessScalingConfiguration maxCapacity 5/,
    );
  });

  test("copyTagsToSnapshot is not set by default", () => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    const t = new Template(stack);
    const [cluster]: any[] = t.resourceTypeArray(neptuneCluster.NeptuneCluster);
    expect(cluster.copy_tags_to_snapshot).toBeUndefined();
  });

  test.each([false, true])("cluster with copyTagsToSnapshot set", (value) => {
    // WHEN
    new neptune.DatabaseCluster(stack, "Database", {
      vpc,
      instanceType: neptune.InstanceType.R5_LARGE,
      copyTagsToSnapshot: value,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      neptuneCluster.NeptuneCluster,
      {
        copy_tags_to_snapshot: value,
      },
    );
  });
});
