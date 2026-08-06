// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/proxy.test.ts
//
// TERRACONSTRUCTS DEVIATION: upstream's default (unset) `dbProxyName` renders as the CFN logical
// id derived from the construct id ("Proxy") -- see `proxy.ts`'s deviation note on `physicalName`.
// This repo instead always defaults to a gridUUID-scoped `uniqueResourceName` (there is no
// CloudFormation Ref-based logical-id concept here), so upstream's `DBProxyName: 'Proxy'`
// assertions are simply omitted below rather than replaced with an unstable synthesized value --
// same idiom as `identifier` on `DatabaseInstance`/`DatabaseCluster` tests.
//
// TERRACONSTRUCTS DEVIATION: upstream's `describe('feature flag @aws-cdk/aws-rds:databaseProxyUniqueResourceName', ...)`
// block is omitted entirely -- both its tests exercise a CDK context feature flag toggling between
// the construct id and a unique name; this repo has no such flag (unique names are always used, see
// above), so the "with a unique resource name" case is moot; the "with a proxy name in the
// constructor" case is covered by the explicit-`dbProxyName` test in the `proxy` describe block.

import {
  dbProxy,
  dbProxyDefaultTargetGroup,
  dbProxyEndpoint,
  dbProxyTarget,
  dataAwsIamPolicyDocument,
  securityGroup,
  vpcSecurityGroupIngressRule,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { ArnFormat, AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import { AccountPrincipal, Role } from "../../../../src/aws/iam";
import * as rds from "../../../../src/aws/storage/rds";
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
  vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
});

describe("proxy", () => {
  test("create a DB proxy from an instance", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      vpc,
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      auth: [
        {
          auth_scheme: "SECRETS",
          iam_auth: "DISABLED",
          secret_arn: stack.resolve(instance.secret!.secretArn),
        },
      ],
      engine_family: "MYSQL",
      require_tls: true,
    });
    // `connectionPoolConfig` is omitted entirely from the synthesized resource when every
    // sub-field is `undefined` (no pool-tuning props were passed) -- presence of the target group
    // resource itself is asserted above/below via `db_proxy_name`/`target_group_name`.
    t.resourceCountIs(dbProxyDefaultTargetGroup.DbProxyDefaultTargetGroup, 1);
    t.expect.toHaveResourceWithProperties(dbProxyTarget.DbProxyTarget, {
      target_group_name: "default",
      db_instance_identifier: stack.resolve(instance.instanceIdentifier),
    });
  });

  test("explicit dbProxyName maps to aws_db_proxy name", () => {
    // GIVEN -- https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/proxy.test.ts#L1088
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      vpc,
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      dbProxyName: "my-proxy-name",
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      name: "my-proxy-name",
    });
  });

  test("generated default proxy name is lowercase (provider validates lowercase-only)", () => {
    // GIVEN -- live-caught by TestRdsProxy: the provider rejects uppercase in
    // aws_db_proxy.name at plan time.
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      vpc,
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // THEN
    const t = new Template(stack);
    const [proxyResource]: any[] = t.resourceTypeArray(dbProxy.DbProxy);
    expect(proxyResource.name).toMatch(/^[a-z0-9-]+$/);
  });

  test("pool-tuning and proxy-tuning props map end-to-end across the resource split", () => {
    // GIVEN -- the CfnDBProxyTargetGroup -> default-target-group/target split is the largest
    // deviation in this file; every connection_pool_config sub-field plus the aws_db_proxy
    // tuning args must be asserted through it.
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      vpc,
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
      borrowTimeout: Duration.seconds(30),
      initQuery: "SET x=1",
      maxConnectionsPercent: 50,
      maxIdleConnectionsPercent: 20,
      sessionPinningFilters: [rds.SessionPinningFilter.EXCLUDE_VARIABLE_SETS],
      debugLogging: true,
      idleClientTimeout: Duration.minutes(3),
      requireTLS: false,
      iamAuth: true,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      debug_logging: true,
      idle_client_timeout: 180,
      require_tls: false,
      auth: [
        {
          auth_scheme: "SECRETS",
          iam_auth: "REQUIRED",
          secret_arn: stack.resolve(instance.secret!.secretArn),
        },
      ],
    });
    t.expect.toHaveResourceWithProperties(
      dbProxyDefaultTargetGroup.DbProxyDefaultTargetGroup,
      {
        connection_pool_config: {
          connection_borrow_timeout: 30,
          init_query: "SET x=1",
          max_connections_percent: 50,
          max_idle_connections_percent: 20,
          session_pinning_filters: ["EXCLUDE_VARIABLE_SETS"],
        },
      },
    );
  });

  test("create a DB proxy for a MariaDB instance", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mariaDb({
        version: rds.MariaDbEngineVersion.VER_10_6_16,
      }),
      vpc,
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // THEN
    // MariaDB shares RDS Proxy's MYSQL engine family.
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      engine_family: "MYSQL",
    });
  });

  test("create a DB proxy from a cluster", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_10_7,
      }),
      instanceProps: { vpc },
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [cluster.secret!],
      vpc,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      auth: [
        {
          auth_scheme: "SECRETS",
          iam_auth: "DISABLED",
          secret_arn: stack.resolve(cluster.secret!.secretArn),
        },
      ],
      engine_family: "POSTGRESQL",
      require_tls: true,
    });
    t.expect.toHaveResourceWithProperties(dbProxyTarget.DbProxyTarget, {
      db_cluster_identifier: stack.resolve(cluster.clusterIdentifier),
    });
    // no db_instance_identifier set for a cluster target
    const [target] = t.resourceTypeArray(dbProxyTarget.DbProxyTarget) as any[];
    expect(target.db_instance_identifier).toBeUndefined();

    t.expect.toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        ip_protocol: "tcp",
        description: "Allow connections to the database Cluster from the Proxy",
      },
    );
  });

  test("throws when defaultAuthScheme is NONE and no secrets are provided", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_10_7,
      }),
      instanceProps: { vpc },
    });

    // WHEN
    expect(() => {
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromCluster(cluster),
        secrets: [], // No secret
        vpc,
        defaultAuthScheme: rds.DefaultAuthScheme.NONE,
      });
    }).toThrow(
      "One or more secrets are required when defaultAuthScheme is not specified or is NONE.",
    );
  });

  test("throws when defaultAuthScheme is undefined and no secrets are provided", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_10_7,
      }),
      instanceProps: { vpc },
    });

    // WHEN
    expect(() => {
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromCluster(cluster),
        secrets: [], // No secret
        vpc,
        // defaultAuthScheme is not specified (undefined)
      });
    }).toThrow(
      "One or more secrets are required when defaultAuthScheme is not specified or is NONE.",
    );
  });

  test("fails when trying to create a proxy for a target without an engine", () => {
    const importedCluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Cluster",
      {
        clusterIdentifier: "my-cluster",
      },
    );

    expect(() => {
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromCluster(importedCluster),
        vpc,
        secrets: [new encryption.Secret(stack, "Secret")],
      });
    }).toThrow(
      /Could not determine engine for proxy target '.*Cluster'\. Please provide it explicitly when importing the resource/,
    );
  });

  test("fails when trying to create a proxy for a target with an engine that doesn't have engineFamily", () => {
    const importedInstance =
      rds.DatabaseInstance.fromDatabaseInstanceAttributes(stack, "Cluster", {
        instanceIdentifier: "my-instance",
        instanceEndpointAddress: "instance-address",
        port: 5432,
        securityGroups: [],
        engine: rds.DatabaseInstanceEngine.oracleEe({
          version: rds.OracleEngineVersion.VER_21,
        }),
      });

    expect(() => {
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromInstance(importedInstance),
        vpc,
        secrets: [new encryption.Secret(stack, "Secret")],
      });
    }).toThrow(
      /RDS proxies require an engine family to be specified on the database cluster or instance\. No family specified for engine 'oracle-ee-21'/,
    );
  });

  test("correctly creates a proxy for an imported Cluster if its engine is known", () => {
    const importedCluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(
      stack,
      "Cluster",
      {
        clusterIdentifier: "my-cluster",
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_9_6_11,
        }),
        port: 5432,
      },
    );

    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(importedCluster),
      vpc,
      secrets: [new encryption.Secret(stack, "Secret")],
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      engine_family: "POSTGRESQL",
    });
    t.expect.toHaveResourceWithProperties(dbProxyTarget.DbProxyTarget, {
      db_cluster_identifier: "my-cluster",
    });
    t.expect.toHaveResourceWithProperties(securityGroup.SecurityGroup, {
      description: "SecurityGroup for Database Proxy",
    });
  });

  describe("imported Proxies", () => {
    let importedDbProxy: rds.IDatabaseProxy;
    beforeEach(() => {
      importedDbProxy = rds.DatabaseProxy.fromDatabaseProxyAttributes(
        stack,
        "Proxy",
        {
          dbProxyName: "my-proxy",
          dbProxyArn:
            "arn:aws:rds:us-east-1:123456789012:db-proxy:prx-1234abcd",
          endpoint: "my-endpoint",
          securityGroups: [],
        },
      );
    });

    test("grant rds-db:connect in grantConnect() with a dbUser explicitly passed", () => {
      // WHEN
      const role = new Role(stack, "DBProxyRole", {
        assumedBy: new AccountPrincipal(stack.account),
      });
      const databaseUser = "test";
      importedDbProxy.grantConnect(role, databaseUser);

      // THEN
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["rds-db:connect"],
              effect: "Allow",
              resources: [
                stack.resolve(
                  stack.formatArn({
                    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
                    service: "rds-db",
                    resource: "dbuser",
                    resourceName: "prx-1234abcd/test",
                  }),
                ),
              ],
            },
          ],
        },
      );
    });

    test("throws when grantConnect() is used without a dbUser", () => {
      // WHEN
      const role = new Role(stack, "DBProxyRole", {
        assumedBy: new AccountPrincipal(stack.account),
      });

      // THEN
      expect(() => {
        importedDbProxy.grantConnect(role);
      }).toThrow(
        /For imported Database Proxies, the dbUser is required in grantConnect/,
      );
    });
  });

  // TERRACONSTRUCTS DEVIATION: upstream's 'new Proxy with a single Secret can use grantConnect()
  // without a dbUser passed' test defaults `dbUser` by reading it back out of the secret's JSON
  // value via `secret.secretValueFromJson('username').unsafeUnwrap()` -- a CloudFormation dynamic
  // reference, not portable here (see the deviation note on `DatabaseProxy.grantConnect()`). This
  // repo throws instead, directing callers to pass `dbUser` explicitly.
  test("new Proxy with a single Secret cannot use grantConnect() without a dbUser passed", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      instanceProps: { vpc },
    });

    const proxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [cluster.secret!],
      vpc,
    });

    // WHEN
    const role = new Role(stack, "DBProxyRole", {
      assumedBy: new AccountPrincipal(stack.account),
    });

    // THEN
    expect(() => {
      proxy.grantConnect(role);
    }).toThrow(
      /grantConnect\(\) without a dbUser is not supported in TerraConstructs when the Proxy has a single secret/,
    );
  });

  test("new Proxy with multiple Secrets cannot use grantConnect() without a dbUser passed", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      instanceProps: { vpc },
    });

    const proxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [cluster.secret!, new encryption.Secret(stack, "ProxySecret")],
      vpc,
    });

    // WHEN
    const role = new Role(stack, "DBProxyRole", {
      assumedBy: new AccountPrincipal(stack.account),
    });

    // THEN
    expect(() => {
      proxy.grantConnect(role);
    }).toThrow(
      /When the Proxy contains multiple Secrets, you must pass a dbUser explicitly to grantConnect/,
    );
  });

  test("throws when grantConnect() is used without dbUser on Proxy with no secrets", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      vpc,
      iamAuthentication: true,
    });

    const proxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      vpc,
      defaultAuthScheme: rds.DefaultAuthScheme.IAM_AUTH,
    });

    // WHEN
    const role = new Role(stack, "DBProxyRole", {
      assumedBy: new AccountPrincipal(stack.account),
    });

    // THEN
    expect(() => {
      proxy.grantConnect(role);
    }).toThrow(
      /When using IAM authentication without secrets, you must specify a dbUser parameter in grantConnect/,
    );
  });

  test("new Proxy with no secrets can use grantConnect() with a dbUser specified", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      vpc,
      iamAuthentication: true,
    });

    const proxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      vpc,
      defaultAuthScheme: rds.DefaultAuthScheme.IAM_AUTH,
      // No secrets provided
    });

    // WHEN
    const role = new Role(stack, "DBProxyRole", {
      assumedBy: new AccountPrincipal(stack.account),
    });
    const databaseUser = "testuser";
    proxy.grantConnect(role, databaseUser);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["rds-db:connect"],
            effect: "Allow",
            resources: [expect.stringContaining("/testuser")],
          },
        ],
      },
    );
  });

  test("new Proxy with kms encrypted Secrets has permissions to kms:Decrypt that secret using its key", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "Database", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      instanceProps: { vpc },
    });

    const kmsKey = new encryption.Key(stack, "Key");

    const kmsEncryptedSecret = new encryption.Secret(stack, "Secret", {
      encryptionKey: kmsKey,
    });

    // WHEN
    new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      vpc,
      secrets: [kmsEncryptedSecret],
    });

    // THEN
    // NOTE: `secret.grantRead(role)` and `secret.encryptionKey.grantDecrypt(role)` both grant to
    // the SAME auto-created proxy role, so both statements are merged onto that role's single IAM
    // policy document (one `data.aws_iam_policy_document` with two statements), rather than two
    // separate documents.
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            effect: "Allow",
            resources: [stack.resolve(kmsEncryptedSecret.secretArn)],
          }),
          expect.objectContaining({
            actions: ["kms:Decrypt"],
            effect: "Allow",
            resources: [stack.resolve(kmsKey.keyArn)],
          }),
        ]),
      },
    );
  });

  test("DbProxyTarget should have dependency on the proxy targets", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "cluster", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      instanceProps: {
        vpc,
      },
    });

    // WHEN
    new rds.DatabaseProxy(stack, "proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [cluster.secret!],
      vpc,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: upstream asserts an explicit CFN `DependsOn` (the cluster
    // instances'/cluster's logical ids) on the single `AWS::RDS::DBProxyTargetGroup`. There is no
    // logical-id/`Ref` concept here; the equivalent Terraform ordering constraint is a `depends_on`
    // entry (added via `node.addDependency()`) on the `aws_db_proxy_target` resource (see the
    // deviation note on `DatabaseProxy`'s constructor in `proxy.ts`), asserted loosely below (by
    // substring) since the exact synthesized address depends on `cluster.ts`'s internal
    // construct-id choices.
    const t = new Template(stack);
    const [target] = t.resourceTypeArray(dbProxyTarget.DbProxyTarget) as any[];
    expect(target.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Instance1"),
        expect.stringContaining("Instance2"),
        expect.stringContaining("cluster"),
      ]),
    );
  });

  test("Correct dependencies are created when multiple DatabaseProxy are created with addProxy", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "cluster", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      instanceProps: {
        vpc,
      },
    });

    // WHEN
    cluster.addProxy("Proxy", {
      vpc,
      secrets: [cluster.secret!],
    });
    cluster.addProxy("Proxy2", {
      vpc,
      secrets: [cluster.secret!],
    });

    // THEN
    const t = new Template(stack);
    const targets = t.resourceTypeArray(dbProxyTarget.DbProxyTarget) as any[];
    expect(targets).toHaveLength(2);
    targets.forEach((target) => {
      expect(target.depends_on).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Instance1"),
          expect.stringContaining("Instance2"),
          expect.stringContaining("cluster"),
        ]),
      );
    });
  });

  test("DbProxyTarget should have dependency on the proxy targets when using cluster with writer and readers properties", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "cluster", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      writer: rds.ClusterInstance.provisioned("writer"),
      readers: [rds.ClusterInstance.provisioned("reader")],
    });

    // WHEN
    new rds.DatabaseProxy(stack, "proxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [cluster.secret!],
      vpc,
    });

    // THEN
    const t = new Template(stack);
    const [target] = t.resourceTypeArray(dbProxyTarget.DbProxyTarget) as any[];
    expect(target.depends_on).toEqual(
      expect.arrayContaining([
        expect.stringContaining("writer"),
        expect.stringContaining("reader"),
        expect.stringContaining("cluster"),
      ]),
    );
  });

  test("Correct dependencies are created when multiple DatabaseProxy are created with addProxy for cluster with writer and readers properties", () => {
    // GIVEN
    const cluster = new rds.DatabaseCluster(stack, "cluster", {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      writer: rds.ClusterInstance.provisioned("writer"),
      readers: [rds.ClusterInstance.provisioned("reader")],
    });

    // WHEN
    cluster.addProxy("Proxy", {
      vpc,
      secrets: [cluster.secret!],
    });
    cluster.addProxy("Proxy2", {
      vpc,
      secrets: [cluster.secret!],
    });

    // THEN
    const t = new Template(stack);
    const targets = t.resourceTypeArray(dbProxyTarget.DbProxyTarget) as any[];
    expect(targets).toHaveLength(2);
    targets.forEach((target) => {
      expect(target.depends_on).toEqual(
        expect.arrayContaining([
          expect.stringContaining("writer"),
          expect.stringContaining("reader"),
          expect.stringContaining("cluster"),
        ]),
      );
    });
  });

  describe("clientPasswordAuthType", () => {
    test("create a DB proxy with specified client password authentication type", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_5_7,
        }),
        vpc,
      });

      // WHEN
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromInstance(instance),
        secrets: [instance.secret!],
        vpc,
        clientPasswordAuthType:
          rds.ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
        auth: [
          expect.objectContaining({
            auth_scheme: "SECRETS",
            iam_auth: "DISABLED",
            client_password_auth_type: "MYSQL_NATIVE_PASSWORD",
          }),
        ],
        engine_family: "MYSQL",
      });
    });

    test("MYSQL_NATIVE_PASSWORD clientPasswordAuthType requires MYSQL engine family", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_11,
        }),
        vpc,
      });

      // WHEN
      // THEN
      expect(() => {
        new rds.DatabaseProxy(stack, "Proxy", {
          proxyTarget: rds.ProxyTarget.fromInstance(instance),
          secrets: [instance.secret!],
          vpc,
          clientPasswordAuthType:
            rds.ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD,
        });
      }).toThrow(
        /MYSQL_NATIVE_PASSWORD client password authentication type requires MYSQL engineFamily, got POSTGRESQL/,
      );
    });

    test("POSTGRES_SCRAM_SHA_256 clientPasswordAuthType requires POSTGRESQL engine family", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_5_7,
        }),
        vpc,
      });

      // WHEN
      // THEN
      expect(() => {
        new rds.DatabaseProxy(stack, "Proxy", {
          proxyTarget: rds.ProxyTarget.fromInstance(instance),
          secrets: [instance.secret!],
          vpc,
          clientPasswordAuthType:
            rds.ClientPasswordAuthType.POSTGRES_SCRAM_SHA_256,
        });
      }).toThrow(
        /POSTGRES_SCRAM_SHA_256 client password authentication type requires POSTGRESQL engineFamily, got MYSQL/,
      );
    });

    test("POSTGRES_MD5 clientPasswordAuthType requires POSTGRESQL engine family", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_5_7,
        }),
        vpc,
      });

      // WHEN
      // THEN
      expect(() => {
        new rds.DatabaseProxy(stack, "Proxy", {
          proxyTarget: rds.ProxyTarget.fromInstance(instance),
          secrets: [instance.secret!],
          vpc,
          clientPasswordAuthType: rds.ClientPasswordAuthType.POSTGRES_MD5,
        });
      }).toThrow(
        /POSTGRES_MD5 client password authentication type requires POSTGRESQL engineFamily, got MYSQL/,
      );
    });

    test("SQL_SERVER_AUTHENTICATION clientPasswordAuthType requires SQLSERVER engine family", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_5_7,
        }),
        vpc,
      });

      // WHEN
      // THEN
      expect(() => {
        new rds.DatabaseProxy(stack, "Proxy", {
          proxyTarget: rds.ProxyTarget.fromInstance(instance),
          secrets: [instance.secret!],
          vpc,
          clientPasswordAuthType:
            rds.ClientPasswordAuthType.SQL_SERVER_AUTHENTICATION,
        });
      }).toThrow(
        /SQL_SERVER_AUTHENTICATION client password authentication type requires SQLSERVER engineFamily, got MYSQL/,
      );
    });
  });

  describe("defaultAuthScheme", () => {
    test("create a DB proxy with IAM_AUTH default authentication scheme", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16_3,
        }),
        vpc,
        iamAuthentication: true,
      });

      // WHEN
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromInstance(instance),
        vpc,
        defaultAuthScheme: rds.DefaultAuthScheme.IAM_AUTH,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
        engine_family: "POSTGRESQL",
        require_tls: true,
        default_auth_scheme: "IAM_AUTH",
      });
    });

    test("create a DB proxy with NONE default authentication scheme and secrets", () => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16_3,
        }),
        vpc,
      });

      // WHEN
      new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromInstance(instance),
        secrets: [instance.secret!],
        vpc,
        defaultAuthScheme: rds.DefaultAuthScheme.NONE,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
        auth: [
          {
            auth_scheme: "SECRETS",
            iam_auth: "DISABLED",
            secret_arn: stack.resolve(instance.secret!.secretArn),
          },
        ],
        engine_family: "POSTGRESQL",
        require_tls: true,
        default_auth_scheme: "NONE",
      });
    });
  });

  test("add additional proxy endpoint", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      vpc,
    });

    const dbProxyL2 = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // WHEN
    dbProxyL2.addEndpoint("ProxyEndpoint", {
      vpc,
      targetRole: rds.ProxyEndpointTargetRole.READ_ONLY,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxyEndpoint.DbProxyEndpoint, {
      db_proxy_name: stack.resolve(dbProxyL2.dbProxyName),
      target_role: "READ_ONLY",
    });
  });
});

describe("instance.addProxy", () => {
  test("creates a proxy targeting the instance", () => {
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      vpc,
    });

    instance.addProxy("Proxy", {
      vpc,
      secrets: [instance.secret!],
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxy.DbProxy, {
      engine_family: "MYSQL",
    });
    t.expect.toHaveResourceWithProperties(dbProxyTarget.DbProxyTarget, {
      db_instance_identifier: stack.resolve(instance.instanceIdentifier),
    });
  });
});
