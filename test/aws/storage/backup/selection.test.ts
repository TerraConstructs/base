// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/test/selection.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import { backupSelection, iamRolePolicyAttachment } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as backup from "../../../../src/aws/storage/backup";
import * as rds from "../../../../src/aws/storage/rds";
import { AttributeType } from "../../../../src/aws/storage/shared";
import { Table } from "../../../../src/aws/storage/table";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";

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

// See the identical adaptation note in `./plan.test.ts` -- cross-references render as CDKTF
// interpolation strings with a construct-path-hashed logical id, so a shape-only regex is used
// instead of hardcoding the hash.
const arnRefMatching = (fragment: string) => expect.stringContaining(fragment);

describe("BackupSelection", () => {
  let stack: AwsStack;
  let plan: backup.BackupPlan;
  beforeEach(() => {
    stack = testStack();
    plan = backup.BackupPlan.dailyWeeklyMonthly5YearRetention(stack, "Plan");
  });

  test("create a selection", () => {
    // WHEN
    new backup.BackupSelection(stack, "Selection", {
      backupPlan: plan,
      resources: [
        backup.BackupResource.fromArn("arn1"),
        backup.BackupResource.fromArn("arn2"),
        backup.BackupResource.fromTag("stage", "prod"),
        backup.BackupResource.fromTag("cost center", "cloud"),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      plan_id: arnRefMatching("aws_backup_plan"),
      name: "Selection",
      iam_role_arn: arnRefMatching("aws_iam_role"),
      selection_tag: [
        {
          key: "stage",
          type: "STRINGEQUALS",
          value: "prod",
        },
        {
          key: "cost center",
          type: "STRINGEQUALS",
          value: "cloud",
        },
      ],
      resources: ["arn1", "arn2"],
    });

    t.expect.toHaveResourceWithProperties(
      iamRolePolicyAttachment.IamRolePolicyAttachment,
      {
        policy_arn: arnRefMatching(
          ":iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
        ),
      },
    );
  });

  test("no policy is attached if disableDefaultBackupPolicy is true", () => {
    // WHEN
    new backup.BackupSelection(stack, "Selection", {
      backupPlan: plan,
      resources: [backup.BackupResource.fromArn("arn1")],
      disableDefaultBackupPolicy: true,
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(iamRolePolicyAttachment.IamRolePolicyAttachment, 0);
  });

  test("allow restores", () => {
    // WHEN
    new backup.BackupSelection(stack, "Selection", {
      backupPlan: plan,
      resources: [backup.BackupResource.fromArn("arn1")],
      allowRestores: true,
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(iamRolePolicyAttachment.IamRolePolicyAttachment, 2);
    t.expect.toHaveResourceWithProperties(
      iamRolePolicyAttachment.IamRolePolicyAttachment,
      {
        policy_arn: arnRefMatching(
          ":iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
        ),
      },
    );
    t.expect.toHaveResourceWithProperties(
      iamRolePolicyAttachment.IamRolePolicyAttachment,
      {
        policy_arn: arnRefMatching(
          ":iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
        ),
      },
    );
  });

  // TODO: omitted -- upstream's `fromConstruct` test also exercises `efs.CfnFileSystem` /
  // `BackupResource.fromEfsFileSystem`. EFS has not been ported to this repo -- see the identical
  // omission notes in `../../../../src/aws/storage/backup/resource.ts` and
  // `backupable-resources-collector.ts`.
  test("fromConstruct", () => {
    // GIVEN
    class MyConstruct extends Construct {
      constructor(scope: Construct, id: string) {
        super(scope, id);

        new Table(this, "Table", {
          partitionKey: {
            name: "id",
            type: AttributeType.STRING,
          },
        });

        const vpc = new compute.Vpc(this, "Vpc");

        new rds.DatabaseInstance(this, "DatabaseInstance", {
          engine: rds.DatabaseInstanceEngine.mysql({
            version: rds.MysqlEngineVersion.VER_8_0_39,
          }),
          instanceType: compute.InstanceType.of(
            compute.InstanceClass.BURSTABLE3,
            compute.InstanceSize.SMALL,
          ),
          vpc,
        });

        new rds.DatabaseCluster(this, "DatabaseCluster", {
          engine: rds.DatabaseClusterEngine.auroraMysql({
            version: rds.AuroraMysqlEngineVersion.VER_3_04_0,
          }),
          credentials: rds.Credentials.fromGeneratedSecret("clusteradmin"),
          instanceProps: {
            vpc,
          },
        });

        new rds.ServerlessCluster(this, "ServerlessCluster", {
          engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
          parameterGroup: rds.ParameterGroup.fromParameterGroupName(
            this,
            "ParameterGroup",
            "default.aurora-postgresql11",
          ),
          vpc,
        });

        // `ec2Instance.Instance` / `ebsVolume.EbsVolume` collector branches -- previously
        // exercised only via the dedicated `fromEc2Instance` test (a different code path that
        // never runs the `BackupableResourcesCollector` Aspect); included here too so the
        // Aspect-driven collection of both is asserted, mirroring upstream's `fromConstruct`
        // test omitting only `CfnFileSystem` (EFS, not ported -- see TODO above).
        new compute.Instance(this, "Instance", {
          vpc,
          instanceType: compute.InstanceType.of(
            compute.InstanceClass.T3,
            compute.InstanceSize.NANO,
          ),
          machineImage: new compute.AmazonLinuxImage({
            generation: compute.AmazonLinuxGeneration.AMAZON_LINUX_2,
          }),
        });

        new compute.Volume(this, "Volume", {
          availabilityZone: "us-east-1a",
          size: Size.gibibytes(8),
        });
      }
    }
    const myConstruct = new MyConstruct(stack, "MyConstruct");

    // WHEN
    plan.addSelection("Selection", {
      resources: [backup.BackupResource.fromConstruct(myConstruct)],
    });

    // THEN
    const t = new Template(stack);
    // `rds.ServerlessCluster` (Aurora Serverless v1) is provisioned via the same `aws_rds_cluster`
    // Terraform resource as `rds.DatabaseCluster` -- see the identical note on the
    // `fromRdsServerlessCluster` test below -- so the collector emits a second `aws_rds_cluster`
    // match here.
    //
    // Full-shape regexes (rather than the looser `arnRefMatching` substring helper) pin down the
    // exact Terraform attribute each ARN is built from -- catching, e.g., the difference between
    // `aws_db_instance`'s `.id` (RDS DBI resource ID, wrong) and `.identifier` (correct) that a
    // substring-only match on the resource type would miss. Mirrors the style already used in the
    // `fromRdsDatabaseInstance`/`fromRdsDatabaseCluster` tests below.
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      name: "Selection",
      resources: [
        expect.stringMatching(/:table\/\$\{aws_dynamodb_table\.\w+\.id\}$/),
        expect.stringMatching(/:db:\$\{aws_db_instance\.\w+\.identifier\}$/),
        expect.stringMatching(/:cluster:\$\{aws_rds_cluster\.\w+\.id\}$/),
        expect.stringMatching(/:cluster:\$\{aws_rds_cluster\.\w+\.id\}$/),
        expect.stringMatching(/:instance\/\$\{aws_instance\.\w+\.id\}$/),
        expect.stringMatching(/:volume\/\$\{aws_ebs_volume\.\w+\.id\}$/),
      ],
    });
  });

  test("fromEc2Instance", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const instance = new compute.Instance(stack, "Instance", {
      vpc,
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.T3,
        compute.InstanceSize.NANO,
      ),
      machineImage: new compute.AmazonLinuxImage({
        generation: compute.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
    });

    // WHEN
    plan.addSelection("Selection", {
      resources: [backup.BackupResource.fromEc2Instance(instance)],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      name: "Selection",
      resources: [arnRefMatching("aws_instance")],
    });
  });

  test("fromDynamoDbTable", () => {
    // GIVEN
    const newTable = new Table(stack, "New", {
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
    });
    const existingTable = Table.fromTableArn(
      stack,
      "Existing",
      "arn:aws:dynamodb:eu-west-1:123456789012:table/existing",
    );

    // WHEN
    plan.addSelection("Selection", {
      resources: [
        backup.BackupResource.fromDynamoDbTable(newTable),
        backup.BackupResource.fromDynamoDbTable(existingTable),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      name: "Selection",
      resources: [
        arnRefMatching("aws_dynamodb_table"),
        "arn:aws:dynamodb:eu-west-1:123456789012:table/existing",
      ],
    });
  });

  test("fromRdsDatabaseInstance", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const newInstance = new rds.DatabaseInstance(stack, "New", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_39,
      }),
      instanceType: compute.InstanceType.of(
        compute.InstanceClass.BURSTABLE3,
        compute.InstanceSize.SMALL,
      ),
      vpc,
    });
    const existingInstance =
      rds.DatabaseInstance.fromDatabaseInstanceAttributes(stack, "Existing", {
        instanceEndpointAddress: "address",
        instanceIdentifier: "existing-instance",
        port: 3306,
        securityGroups: [],
      });

    // WHEN
    plan.addSelection("Selection", {
      resources: [
        backup.BackupResource.fromRdsDatabaseInstance(newInstance),
        backup.BackupResource.fromRdsDatabaseInstance(existingInstance),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      name: "Selection",
      resources: [
        expect.stringMatching(/:db:\$\{aws_db_instance\.\w+\.identifier\}$/),
        expect.stringMatching(/:db:existing-instance$/),
      ],
    });
  });

  test("fromRdsDatabaseCluster", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const newCluster = new rds.DatabaseCluster(stack, "New", {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_04_0,
      }),
      credentials: rds.Credentials.fromGeneratedSecret("clusteradmin"),
      instanceProps: {
        vpc,
      },
    });
    const existingCluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Existing",
      {
        clusterIdentifier: "existing-cluster",
      },
    );

    // WHEN
    plan.addSelection("Selection", {
      resources: [
        backup.BackupResource.fromRdsDatabaseCluster(newCluster),
        backup.BackupResource.fromRdsDatabaseCluster(existingCluster),
      ],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      name: "Selection",
      resources: [
        expect.stringMatching(
          /:cluster:\$\{aws_rds_cluster\.\w+\.cluster_identifier\}$/,
        ),
        expect.stringMatching(/:cluster:existing-cluster$/),
      ],
    });
  });

  test("fromRdsServerlessCluster", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "Vpc");
    const newCluster = new rds.ServerlessCluster(stack, "New", {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        stack,
        "ParameterGroup",
        "default.aurora-postgresql11",
      ),
      vpc,
    });
    const existingCluster =
      rds.ServerlessCluster.fromServerlessClusterAttributes(stack, "Existing", {
        clusterIdentifier: "existing-cluster",
      });

    // WHEN
    plan.addSelection("Selection", {
      resources: [
        backup.BackupResource.fromRdsServerlessCluster(newCluster),
        backup.BackupResource.fromRdsServerlessCluster(existingCluster),
      ],
    });

    // THEN
    const t = new Template(stack);
    // TERRACONSTRUCTS DEVIATION: `rds.ServerlessCluster` (Aurora Serverless v1, deprecation-kept
    // per `../rds/serverless-cluster.ts`) is provisioned via the same `aws_rds_cluster` Terraform
    // resource as `rds.DatabaseCluster` -- so `fromRdsServerlessCluster`'s rendered ARN has the
    // same `:cluster:` shape as `fromRdsDatabaseCluster` above, not a distinct one.
    t.expect.toHaveResourceWithProperties(backupSelection.BackupSelection, {
      name: "Selection",
      resources: [
        expect.stringMatching(
          /:cluster:\$\{aws_rds_cluster\.\w+\.cluster_identifier\}$/,
        ),
        expect.stringMatching(/:cluster:existing-cluster$/),
      ],
    });
  });
});
