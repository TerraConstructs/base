// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/test/instance.test.ts

import { docdbCluster, docdbClusterInstance } from "@cdktn/provider-aws";
import { App, Testing, Tokenization } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { ArnFormat, AwsConstructBase, AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as docdb from "../../../../src/aws/storage/docdb";
import { CaCertificate } from "../../../../src/aws/storage/rds";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const SINGLE_INSTANCE_TYPE = compute.InstanceType.of(
  compute.InstanceClass.R5,
  compute.InstanceSize.XLARGE,
);
const EXPECTED_SYNTH_INSTANCE_TYPE = `db.${SINGLE_INSTANCE_TYPE}`;

/**
 * TEST-ONLY adapter implementing `docdb.IDatabaseCluster` directly on top of the
 * `aws_docdb_cluster` L1. This fixture stands in for the real `DatabaseCluster` construct
 * (`cluster.ts`) so `DatabaseInstance` (which requires a `docdb.IDatabaseCluster`) can be exercised
 * in isolation from `DatabaseCluster`'s own subnet-group/security-group/secret machinery. Mirrors
 * the `RdsDbInstanceAttachmentTarget` TEST-ONLY adapter pattern in
 * `integ/aws/encryption/apps/secret-attach.ts`.
 */
class TestDatabaseCluster
  extends AwsConstructBase
  implements docdb.IDatabaseCluster
{
  public readonly clusterIdentifier: string;
  public readonly instanceIdentifiers: string[] = [];
  public readonly clusterEndpoint: docdb.Endpoint;
  public readonly clusterReadEndpoint: docdb.Endpoint;
  public readonly instanceEndpoints: docdb.Endpoint[] = [];
  public readonly securityGroupId: string;
  public readonly connections: compute.Connections;

  constructor(scope: Construct, id: string, vpc: compute.IVpc) {
    super(scope, id, {});

    const securityGroup = new compute.SecurityGroup(this, "SecurityGroup", {
      vpc,
    });
    const resource = new docdbCluster.DocdbCluster(this, "Resource", {
      clusterIdentifier: "test-cluster",
      masterUsername: "admin",
      masterPassword: "toolongtoolongtoolong",
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
      skipFinalSnapshot: true,
    });

    this.clusterIdentifier = resource.clusterIdentifier;
    this.securityGroupId = securityGroup.securityGroupId;
    this.connections = new compute.Connections({
      securityGroups: [securityGroup],
    });
    this.clusterEndpoint = new docdb.Endpoint(resource.endpoint, 27017);
    this.clusterReadEndpoint = new docdb.Endpoint(
      resource.readerEndpoint,
      27017,
    );
  }

  public asSecretAttachmentTarget(): encryption.SecretAttachmentTargetProps {
    return {
      targetId: this.clusterIdentifier,
      targetType: encryption.AttachmentTargetType.DOCDB_DB_CLUSTER,
    };
  }

  public get outputs(): Record<string, any> {
    return { identifier: this.clusterIdentifier };
  }
}

let app: App;
let stack: AwsStack;
let vpc: compute.IVpc;
let cluster: docdb.IDatabaseCluster;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
  cluster = new TestDatabaseCluster(stack, "Database", vpc);
});

describe("DatabaseInstance", () => {
  test("check that instantiation works", () => {
    // WHEN
    new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        cluster_identifier: stack.resolve(cluster.clusterIdentifier),
        instance_class: EXPECTED_SYNTH_INSTANCE_TYPE,
        auto_minor_version_upgrade: true,
      },
    );
  });

  test.each([
    [undefined, true],
    [true, true],
    [false, false],
  ])(
    "check that autoMinorVersionUpdate works: %p",
    (given: boolean | undefined, expected: boolean) => {
      // WHEN
      new docdb.DatabaseInstance(stack, "Instance", {
        cluster,
        instanceType: SINGLE_INSTANCE_TYPE,
        autoMinorVersionUpgrade: given,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        docdbClusterInstance.DocdbClusterInstance,
        {
          instance_class: EXPECTED_SYNTH_INSTANCE_TYPE,
          auto_minor_version_upgrade: expected,
        },
      );
    },
  );

  test("check that CA certificate identifier works", () => {
    // WHEN
    new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
      caCertificate: CaCertificate.RDS_CA_RSA4096_G1,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        instance_class: EXPECTED_SYNTH_INSTANCE_TYPE,
        ca_cert_identifier: "rds-ca-rsa4096-g1",
      },
    );
  });

  test("check that the endpoint works", () => {
    // WHEN
    const instance = new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
    });

    // THEN
    expect(stack.resolve(instance.instanceEndpoint.port)).toEqual(
      stack.resolve(instance.resource.port),
    );
    // Built from the L1 attribute references directly (NOT from
    // instanceEndpoint's own fields) so this fails if socketAddress ever
    // stops interpolating hostname:port.
    expect(stack.resolve(instance.instanceEndpoint.socketAddress)).toEqual(
      stack.resolve(
        `${instance.resource.endpoint}:${Tokenization.stringifyNumber(instance.resource.port)}`,
      ),
    );
  });

  test("check that instanceArn property works", () => {
    // WHEN
    const instance = new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
    });

    // THEN
    expect(stack.resolve(instance.instanceArn)).toEqual(
      stack.resolve(
        stack.formatArn({
          service: "rds",
          resource: "db",
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          resourceName: instance.instanceIdentifier,
        }),
      ),
    );
  });

  test("check importing works as expected", () => {
    // GIVEN
    const instanceEndpointAddress = "127.0.0.1";
    const instanceIdentifier = "InstanceID";
    const port = 8888;

    // WHEN
    const instance = docdb.DatabaseInstance.fromDatabaseInstanceAttributes(
      stack,
      "ImportedInstance",
      {
        instanceEndpointAddress,
        instanceIdentifier,
        port,
      },
    );

    // THEN
    expect(instance.instanceIdentifier).toEqual(instanceIdentifier);
    expect(instance.instanceEndpoint.socketAddress).toEqual(
      `${instanceEndpointAddress}:${port}`,
    );
  });

  test("can enable performance insights on instances", () => {
    // WHEN
    new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
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

  test("instance identifier defaults to a gridUUID-scoped, lowercased generated name", () => {
    // WHEN
    new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      docdbClusterInstance.DocdbClusterInstance,
    ) as any[];
    expect(resource.identifier).toEqual(expect.any(String));
    expect(resource.identifier).toEqual(resource.identifier.toLowerCase());
  });

  test("an explicit dbInstanceName is lowercased", () => {
    // WHEN
    new docdb.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: SINGLE_INSTANCE_TYPE,
      dbInstanceName: "MyInstanceName",
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterInstance.DocdbClusterInstance,
      {
        identifier: "myinstancename",
      },
    );
  });
});
