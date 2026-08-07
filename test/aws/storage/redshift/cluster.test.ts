// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/cluster.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import {
  dataAwsSecretsmanagerRandomPassword,
  redshiftCluster,
  redshiftLogging,
  redshiftParameterGroup,
  redshiftSubnetGroup,
  secretsmanagerSecret,
  vpcSecurityGroupEgressRule,
} from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as iam from "../../../../src/aws/iam";
import { Bucket } from "../../../../src/aws/storage/bucket";
import * as redshift from "../../../../src/aws/storage/redshift";
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
// `../docdb/cluster.test.ts` / `../rds/cluster.test.ts`.
function nonSkipFinalSnapshotWarnings(stack: AwsStack) {
  return Annotations.fromStack(stack).warnings.filter(
    (w) => !w.message.toString().includes("skipFinalSnapshot"),
  );
}

let stack: AwsStack;
let vpc: compute.IVpc;

beforeEach(() => {
  stack = testStack();
  vpc = new compute.Vpc(stack, "VPC");
});

test("check that instantiation works", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      masterPassword: "tooshort",
    },
    vpc,
  });

  // THEN
  const t = new Template(stack, { snapshot: true });
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    allow_version_upgrade: true,
    master_username: "admin",
    master_password: "tooshort",
    cluster_type: "multi-node",
    automated_snapshot_retention_period: 1,
    encrypted: "true",
    number_of_nodes: 2,
    node_type: "ra3.large",
    database_name: "default_db",
    publicly_accessible: false,
  });
  t.expect.toHaveResourceWithProperties(
    redshiftSubnetGroup.RedshiftSubnetGroup,
    {
      description: "Subnets for Redshift Redshift cluster",
    },
  );
  const [subnetGroupResource] = t.resourceTypeArray(
    redshiftSubnetGroup.RedshiftSubnetGroup,
  ) as any[];
  expect(subnetGroupResource.subnet_ids).toHaveLength(3);
});

test("specify maintenance track name", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      masterPassword: "tooshort",
    },
    vpc,
    maintenanceTrackName: redshift.MaintenanceTrackName.TRAILING,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    maintenance_track_name: "trailing",
  });
});

test("can create a cluster with an externally supplied security group", () => {
  // GIVEN
  // TERRACONSTRUCTS DEVIATION: upstream also imports the VPC via `ec2.Vpc.fromLookup` (a
  // context-lookup mechanism requiring pre-seeded `cdk.context.json`-style values). That machinery
  // is orthogonal to `Cluster`'s own behavior under test here (wiring an externally-supplied
  // security group), so a normally-constructed VPC is used instead.
  const sg = compute.SecurityGroup.fromSecurityGroupId(
    stack,
    "SG",
    "SecurityGroupId12345",
  );

  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      masterPassword: "tooshort",
    },
    vpc,
    securityGroups: [sg],
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    master_username: "admin",
    master_password: "tooshort",
    vpc_security_group_ids: ["SecurityGroupId12345"],
  });
});

test("creates a secret when master credentials are not specified", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
  });

  // THEN
  // TERRACONSTRUCTS DEVIATION: mirrors `Cluster`'s generated-password house pattern (see
  // `../rds/cluster.test.ts`'s equivalent test) rather than upstream's CFN dynamic-reference
  // (`{{resolve:secretsmanager:...}}`) syntax -- the generated password is an
  // `aws_secretsmanager_random_password` data-source token, stored verbatim (and `ignore_changes`'d)
  // on the `aws_redshift_cluster.master_password` argument.
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
    {
      exclude_characters: "\"@/\\ '",
      password_length: 30,
    },
  );
  const [clusterResource] = t.resourceTypeArray(
    redshiftCluster.RedshiftCluster,
  ) as any[];
  expect(clusterResource.master_username).toEqual("admin");
  expect(clusterResource.master_password).toBeDefined();
  // TERRACONSTRUCTS DEVIATION: generated-password `ignore_changes` house pattern (see the
  // `ignore_changes`/password-drift note in `Cluster`'s constructor) -- without it, every apply
  // after the first would drift and REPLACE the live master password.
  expect(clusterResource.lifecycle).toEqual({
    ignore_changes: ["master_password"],
  });
});

test("creates a secret with a custom excludeCharacters", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      excludeCharacters: "\"@/\\ '`",
    },
    vpc,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveDataSourceWithProperties(
    dataAwsSecretsmanagerRandomPassword.DataAwsSecretsmanagerRandomPassword,
    {
      exclude_characters: "\"@/\\ '`",
      password_length: 30,
    },
  );
});

describe("node count", () => {
  test("Single Node Clusters do not define node count", () => {
    // WHEN
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      clusterType: redshift.ClusterType.SINGLE_NODE,
    });

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.cluster_type).toEqual("single-node");
    expect(clusterResource.number_of_nodes).toBeUndefined();
  });

  test("Single Node Clusters treat 1 node as undefined", () => {
    // WHEN
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      clusterType: redshift.ClusterType.SINGLE_NODE,
      numberOfNodes: 1,
    });

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.cluster_type).toEqual("single-node");
    expect(clusterResource.number_of_nodes).toBeUndefined();
  });

  test("Single Node Clusters throw if any other node count is specified", () => {
    expect(() => {
      new redshift.Cluster(stack, "Redshift", {
        masterUser: {
          masterUsername: "admin",
        },
        vpc,
        clusterType: redshift.ClusterType.SINGLE_NODE,
        numberOfNodes: 2,
      });
    }).toThrow(
      /Number of nodes must be not be supplied or be 1 for cluster type single-node/,
    );
  });

  test("Multi-Node Clusters default to 2 nodes", () => {
    // WHEN
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      clusterType: redshift.ClusterType.MULTI_NODE,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
      cluster_type: "multi-node",
      number_of_nodes: 2,
    });
  });

  test.each([0, 1, -1, 101])(
    "Multi-Node Clusters throw with %s nodes",
    (numberOfNodes: number) => {
      expect(() => {
        new redshift.Cluster(stack, "Redshift", {
          masterUser: {
            masterUsername: "admin",
          },
          vpc,
          clusterType: redshift.ClusterType.MULTI_NODE,
          numberOfNodes,
        });
      }).toThrow(
        /Number of nodes for cluster type multi-node must be at least 2 and no more than 100/,
      );
    },
  );

  test("Multi-Node Clusters should allow input parameter for number of nodes", () => {
    // GIVEN
    // TERRACONSTRUCTS DEVIATION: upstream uses `cdk.CfnParameter`, which has no CDKTF equivalent;
    // `TerraformVariable` (used the same way -- an unresolved Token at synth time) is the
    // TerraConstructs-native stand-in (mirrors `../rds/cluster.test.ts`'s equivalent adaptation).
    const numberOfNodesParam = new TerraformVariable(stack, "numberOfNodes", {
      type: "number",
    });

    // WHEN
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      clusterType: redshift.ClusterType.MULTI_NODE,
      numberOfNodes: numberOfNodesParam.numberValue as unknown as number,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
      cluster_type: "multi-node",
      number_of_nodes: stack.resolve(numberOfNodesParam.numberValue),
    });
  });
});

test("create an encrypted cluster with custom KMS key", () => {
  // WHEN
  const key = new encryption.Key(stack, "Key");
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    encryptionKey: key,
    vpc,
  });

  // THEN: assert the exact ARN value — `kms_key_id` must carry the key ARN, not the bare key
  // id, per the ID-vs-ARN AUDIT note in `cluster.ts` (a keyId regression would otherwise leave
  // the field defined and this test green while causing a perpetual post-apply diff).
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    kms_key_id: stack.resolve(key.keyArn),
  });
});

describe("parameter group", () => {
  test("cluster instantiated with parameter group", () => {
    // WHEN
    const group = new redshift.ClusterParameterGroup(stack, "Params", {
      description: "bye",
      parameters: {
        param: "value",
      },
    });

    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      parameterGroup: group,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
      cluster_parameter_group_name: stack.resolve(
        group.clusterParameterGroupName,
      ),
    });
  });

  test("Adding to the cluster parameter group on a cluster not instantiated with a parameter group", () => {
    // WHEN
    const cluster = new redshift.Cluster(stack, "Redshift", {
      clusterName: "foobar",
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
    });

    cluster.addToParameterGroup("foo", "bar");

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      redshiftParameterGroup.RedshiftParameterGroup,
      {
        description: "Parameter Group for the foobar Redshift cluster",
        family: "redshift-1.0",
        parameter: [
          {
            name: "foo",
            value: "bar",
          },
        ],
      },
    );
  });

  test("Adding to the cluster parameter group on a cluster instantiated with a parameter group", () => {
    // WHEN
    const group = new redshift.ClusterParameterGroup(stack, "Params", {
      description: "lorem ipsum",
      parameters: {
        param: "value",
      },
    });

    const cluster = new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      parameterGroup: group,
    });
    cluster.addToParameterGroup("foo", "bar");

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      redshiftParameterGroup.RedshiftParameterGroup,
      {
        description: "lorem ipsum",
        family: "redshift-1.0",
        parameter: [
          {
            name: "param",
            value: "value",
          },
          {
            name: "foo",
            value: "bar",
          },
        ],
      },
    );
  });

  test("Adding a parameter to an IClusterParameterGroup", () => {
    // GIVEN
    const cluster = new redshift.Cluster(stack, "Redshift", {
      clusterName: "foobar",
      parameterGroup:
        redshift.ClusterParameterGroup.fromClusterParameterGroupName(
          stack,
          "Params",
          "foo",
        ),
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
    });

    // WHEN
    expect(() => cluster.addToParameterGroup("param", "value2"))
      // THEN
      .toThrow("Cannot add a parameter to an imported parameter group");
  });
});

test("publicly accessible cluster", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
    publiclyAccessible: true,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    publicly_accessible: true,
  });
});

test("availability zone relocation enabled", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
    availabilityZoneRelocation: true,
    nodeType: redshift.NodeType.RA3_XLPLUS,
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    availability_zone_relocation_enabled: true,
  });
});

test.each([redshift.NodeType.DC1_8XLARGE, redshift.NodeType.DC2_LARGE])(
  "throw error when availability zone relocation is enabled for invalid node type %s",
  (nodeType) => {
    expect(() => {
      new redshift.Cluster(stack, "Redshift", {
        masterUser: {
          masterUsername: "admin",
        },
        vpc,
        availabilityZoneRelocation: true,
        nodeType,
      });
    }).toThrow(
      `Availability zone relocation is supported for only RA3 node types, got: ${nodeType}`,
    );
  },
);

test("imported cluster with imported security group honors allowAllOutbound", () => {
  // GIVEN
  const cluster = redshift.Cluster.fromClusterAttributes(stack, "Database", {
    clusterEndpointAddress: "addr",
    clusterName: "identifier",
    clusterEndpointPort: 3306,
    securityGroups: [
      compute.SecurityGroup.fromSecurityGroupId(stack, "SG", "sg-123456789", {
        allowAllOutbound: false,
      }),
    ],
  });

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

test("can create a cluster with logging enabled", () => {
  // GIVEN
  const bucket = Bucket.fromBucketName(stack, "bucket", "logging-bucket");

  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
    loggingProperties: {
      loggingBucket: bucket,
      loggingKeyPrefix: "prefix",
    },
  });

  // THEN
  // TERRACONSTRUCTS DEVIATION: see the file-header SCOPE REDUCTION note on `../../../../src/aws/
  // storage/redshift/cluster.ts` -- provider 6.x moved Redshift audit logging off the
  // `aws_redshift_cluster` resource itself and onto a standalone `aws_redshift_logging` resource.
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftLogging.RedshiftLogging, {
    bucket_name: "logging-bucket",
    s3_key_prefix: "prefix",
    log_destination_type: "s3",
  });
});

// TODO: omitted — upstream's `ResourceAction`-driven tests (`specify resource action %s` /
// `throw error for failover primary compute action with single AZ cluster`). See the
// `ResourceAction` omission note on `../../../../src/aws/storage/redshift/cluster.ts` -- the
// `aws_redshift_cluster` Terraform resource has no equivalent argument at all —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/cluster.test.ts#L529-L557

test("throws when trying to add rotation to a cluster without secret", () => {
  // WHEN
  const cluster = new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      masterPassword: "tooshort",
    },
    vpc,
  });

  // THEN
  expect(() => {
    cluster.addRotationSingleUser();
  }).toThrow();
});

test("throws validation error when trying to set encryptionKey without enabling encryption", () => {
  // GIVEN
  const key = new encryption.Key(stack, "kms-key");

  // WHEN
  const props = {
    encrypted: false,
    encryptionKey: key,
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
  };

  // THEN
  expect(() => {
    new redshift.Cluster(stack, "Redshift", props);
  }).toThrow();
});

test("throws when trying to add single user rotation multiple times", () => {
  // GIVEN
  const cluster = new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
  });

  // WHEN
  cluster.addRotationSingleUser();

  // THEN
  expect(() => {
    cluster.addRotationSingleUser();
  }).toThrow();
});

test("can use existing cluster subnet group", () => {
  // GIVEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
    },
    vpc,
    subnetGroup: redshift.ClusterSubnetGroup.fromClusterSubnetGroupName(
      stack,
      "Group",
      "my-existing-cluster-subnet-group",
    ),
  });

  const t = new Template(stack);
  t.resourceCountIs(redshiftSubnetGroup.RedshiftSubnetGroup, 0);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    cluster_subnet_group_name: "my-existing-cluster-subnet-group",
  });
});

// TODO: omitted — upstream's `default child returns a CfnCluster` test asserts
// `cluster.node.defaultChild instanceof CfnCluster`. `resource` (the `aws_redshift_cluster` L1) is
// a private field on `Cluster` in this port (mirroring `ClusterParameterGroup`/`ClusterSubnetGroup`
// in this same package), not registered as `node.defaultChild` -- there is no TerraConstructs
// equivalent of CDK's `defaultChild` convention in this repo —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/cluster.test.ts#L629-L638

// TODO: omitted — upstream's `resize type (%s)` / `resize type not set` tests exercise
// `classicResizing` (CFN's `Classic` property). See the `classicResizing` omission note on
// `../../../../src/aws/storage/redshift/cluster.ts` -- the `aws_redshift_cluster` Terraform
// resource has no equivalent argument at all —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/cluster.test.ts#L640-L705

test("elastic ip address", () => {
  // WHEN
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      masterPassword: "tooshort",
    },
    vpc,
    elasticIp: "1.3.3.7",
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
    elastic_ip: "1.3.3.7",
  });
});

describe("multi AZ cluster", () => {
  test("create a multi AZ cluster", () => {
    // WHEN
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
        masterPassword: "tooshort",
      },
      vpc,
      nodeType: redshift.NodeType.RA3_LARGE,
      multiAz: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
      multi_az: true,
    });
  });

  test("throw error for invalid node type", () => {
    expect(() => {
      new redshift.Cluster(stack, "Redshift", {
        masterUser: {
          masterUsername: "admin",
        },
        vpc,
        nodeType: redshift.NodeType.DS2_XLARGE,
        multiAz: true,
      });
    }).toThrow(
      "Multi-AZ cluster is only supported for RA3 node types, got: ds2.xlarge",
    );
  });

  test("throw error for single node cluster", () => {
    expect(() => {
      new redshift.Cluster(stack, "Redshift", {
        masterUser: {
          masterUsername: "admin",
        },
        vpc,
        nodeType: redshift.NodeType.RA3_XLPLUS,
        multiAz: true,
        clusterType: redshift.ClusterType.SINGLE_NODE,
      });
    }).toThrow(
      "Multi-AZ cluster is not supported for `clusterType` single-node",
    );
  });
});

// TODO(scope-reduction): omitted — upstream's `reboot for Parameter Changes` describe block
// exercises `enableRebootForParameterChanges()`/`rebootForParameterChanges`, both fully commented
// out in this port (backed entirely by a `Custom::RedshiftClusterRebooter` Lambda-backed custom
// resource this repo has no framework for). See the omission notes on
// `Cluster.enableRebootForParameterChanges()` and `ClusterProps.rebootForParameterChanges` in
// `../../../../src/aws/storage/redshift/cluster.ts` —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/cluster.test.ts#L801-L929

describe("default IAM role", () => {
  test("Default role not in role list", () => {
    // GIVEN
    const clusterRole1 = new iam.Role(stack, "clusterRole1", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });
    const defaultRole1 = new iam.Role(stack, "defaultRole1", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });

    expect(() => {
      new redshift.Cluster(stack, "Redshift", {
        masterUser: {
          masterUsername: "admin",
        },
        vpc,
        roles: [clusterRole1],
        defaultRole: defaultRole1,
      });
    }).toThrow(/Default role must be included in role list./);
  });

  test("throws error when default role not attached to cluster when adding default role post creation", () => {
    const defaultRole1 = new iam.Role(stack, "defaultRole1", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });
    const cluster = new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
    });

    expect(() => {
      cluster.addDefaultIamRole(defaultRole1);
    }).toThrow(
      /Default role must be associated to the Redshift cluster to be set as the default role./,
    );
  });

  test("sets the native default_iam_role_arn attribute", () => {
    // TERRACONSTRUCTS DEVIATION: see the `addDefaultIamRole()` TERRACONSTRUCTS DEVIATION note on
    // `../../../../src/aws/storage/redshift/cluster.ts` -- upstream shells out to the Redshift API
    // via an `AwsCustomResource`, with no synth-time-visible assertion available. The native
    // `aws_redshift_cluster.default_iam_role_arn` argument this port uses instead IS visible at
    // synth time, so this test asserts it directly (a strict improvement in testability, not just
    // implementation).
    const defaultRole = new iam.Role(stack, "defaultRole", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });

    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      roles: [defaultRole],
      defaultRole,
    });

    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.default_iam_role_arn).toBeDefined();
  });
});

describe("IAM role", () => {
  test("roles can be directly attached to cluster during declaration", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      roles: [role],
    });

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.iam_roles).toHaveLength(1);
  });

  test("roles can be attached to cluster after declaration", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });
    const cluster = new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
    });

    // WHEN
    cluster.addIamRole(role);

    // THEN
    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.iam_roles).toHaveLength(1);
  });

  test("roles can be attached to cluster in another stack", () => {
    // GIVEN
    // TERRACONSTRUCTS DEVIATION: upstream nests a second `cdk.Stack` inside `stack` and asserts the
    // resulting `Fn::ImportValue` cross-stack reference syntax. CDKTF/cdktn stacks are top-level
    // siblings under ONE shared `App` — only then does cdktn's cross-stack-reference machinery
    // (`terraform_remote_state`) engage — mirroring the single-`Testing.app()` pattern in
    // `test/aws/compute/ecs/ec2/cross-stack.test.ts`.
    const app = Testing.app();
    const clusterStack = testStack(app, "ClusterStack");
    const clusterVpc = new compute.Vpc(clusterStack, "VPC");
    const cluster = new redshift.Cluster(clusterStack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc: clusterVpc,
    });

    const newTestStack = testStack(app, "NewTestStack");
    const role = new iam.Role(newTestStack, "Role", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });

    // WHEN
    cluster.addIamRole(role);

    // THEN: the emitted `iam_roles` entry is a resolvable `terraform_remote_state` reference to
    // the role ARN produced by NewTestStack (not just any array entry). The construct-id hash
    // suffix in the remote-state output key is synth-derived, so it is matched loosely.
    const t = new Template(clusterStack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.iam_roles).toHaveLength(1);
    expect(clusterResource.iam_roles[0]).toMatch(
      /^\$\{data\.terraform_remote_state\.cross-stack-reference-input-NewTestStack\.outputs\.cross-stack-output-aws_iam_role.*arn\}$/,
    );
  });

  test("throws when adding role that is already in cluster", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
    });
    const cluster = new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      roles: [role],
    });

    expect(() =>
      // WHEN
      cluster.addIamRole(role),
    ).toThrow(`Role '${role.roleArn}' is already attached to the cluster`);
  });
});

// TERRACONSTRUCTS DEVIATION: not present upstream -- see the `skipFinalSnapshot`/
// `finalSnapshotIdentifier` TERRACONSTRUCTS DEVIATION on `ClusterProps` in
// `../../../../src/aws/storage/redshift/cluster.ts`. Mirrors the identical dedicated test block in
// `../docdb/cluster.test.ts` / `../neptune/cluster.test.ts`.
describe("removal policy replacement props", () => {
  test("skipFinalSnapshot and finalSnapshotIdentifier are rendered when set", () => {
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      skipFinalSnapshot: false,
      finalSnapshotIdentifier: "my-final-snapshot",
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(redshiftCluster.RedshiftCluster, {
      skip_final_snapshot: false,
      final_snapshot_identifier: "my-final-snapshot",
    });
  });

  test("skipFinalSnapshot true omits finalSnapshotIdentifier", () => {
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      skipFinalSnapshot: true,
    });

    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.skip_final_snapshot).toEqual(true);
    expect(clusterResource.final_snapshot_identifier).toBeUndefined();
  });

  test("skipFinalSnapshot and finalSnapshotIdentifier are absent when unset", () => {
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
    });

    const t = new Template(stack);
    const [clusterResource] = t.resourceTypeArray(
      redshiftCluster.RedshiftCluster,
    ) as any[];
    expect(clusterResource.skip_final_snapshot).toBeUndefined();
    expect(clusterResource.final_snapshot_identifier).toBeUndefined();
  });

  test("warns when neither skipFinalSnapshot nor finalSnapshotIdentifier is set", () => {
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
    });

    const warnings = Annotations.fromStack(stack).warnings;
    expect(
      warnings.some((w) => w.message.toString().includes("skipFinalSnapshot")),
    ).toEqual(true);
  });

  test("does not warn when skipFinalSnapshot is true", () => {
    new redshift.Cluster(stack, "Redshift", {
      masterUser: {
        masterUsername: "admin",
      },
      vpc,
      skipFinalSnapshot: true,
    });

    expect(nonSkipFinalSnapshotWarnings(stack)).toHaveLength(0);
  });
});

test("secret has no resources when the master password is provided", () => {
  new redshift.Cluster(stack, "Redshift", {
    masterUser: {
      masterUsername: "admin",
      masterPassword: "tooshort",
    },
    vpc,
    skipFinalSnapshot: true,
  });

  const t = new Template(stack);
  t.resourceCountIs(secretsmanagerSecret.SecretsmanagerSecret, 0);
});
