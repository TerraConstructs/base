// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/instance-engine.test.ts

import { dbOptionGroup } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as iam from "../../../../src/aws/iam";
import * as rds from "../../../../src/aws/storage/rds";
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
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

describe("instance engine", () => {
  test("default parameterGroupFamily for versionless MariaDB instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.MARIADB;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless MySQL instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.MYSQL;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless PostgreSQL instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.POSTGRES;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless Oracle SE instance engine is 'oracle-se-11.2'", () => {
    const engine = rds.DatabaseInstanceEngine.ORACLE_SE;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual("oracle-se-11.2");
  });

  test("default parameterGroupFamily for versionless Oracle SE 1 instance engine is 'oracle-se1-11.2'", () => {
    const engine = rds.DatabaseInstanceEngine.ORACLE_SE1;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual("oracle-se1-11.2");
  });

  test("default parameterGroupFamily for versionless Oracle SE 2 instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.ORACLE_SE2;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless Oracle SE 2 (CDB) instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.ORACLE_SE2_CDB;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless Oracle EE instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.ORACLE_EE;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless Oracle EE (CDB) instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.ORACLE_EE_CDB;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless SQL Server SE instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.SQL_SERVER_SE;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless SQL Server EX instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.SQL_SERVER_EX;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless SQL Server Web instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.SQL_SERVER_WEB;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  test("default parameterGroupFamily for versionless SQL Server EE instance engine is not defined", () => {
    const engine = rds.DatabaseInstanceEngine.SQL_SERVER_EE;

    const family = engine.parameterGroupFamily;

    expect(family).toEqual(undefined);
  });

  describe("Oracle engine bindToInstance", () => {
    test("returns s3 integration feature", () => {
      const engine = rds.DatabaseInstanceEngine.oracleSe2({
        version: rds.OracleEngineVersion.VER_19_0_0_0_2025_07_R1,
      });

      const engineConfig = engine.bindToInstance(
        new AwsStack(Testing.app(), "ScratchStack", {
          environmentName,
          gridUUID,
          providerConfig,
          gridBackendConfig,
        }),
        {},
      );
      expect(engineConfig.features?.s3Import).toEqual("S3_INTEGRATION");
      expect(engineConfig.features?.s3Export).toEqual("S3_INTEGRATION");
    });

    test("s3 import/export - creates an option group if needed", () => {
      const engine = rds.DatabaseInstanceEngine.oracleSe2({
        version: rds.OracleEngineVersion.VER_19_0_0_0_2025_07_R1,
      });

      const engineConfig = engine.bindToInstance(stack, {
        optionGroup: undefined,
        s3ImportRole: new iam.Role(stack, "ImportRole", {
          assumedBy: new iam.AccountRootPrincipal(),
        }),
      });

      expect(engineConfig.optionGroup).toBeDefined();
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbOptionGroup.DbOptionGroup, {
        engine_name: "oracle-se2",
        option: [
          {
            option_name: "S3_INTEGRATION",
            version: "1.0",
          },
        ],
      });
    });

    test("s3 import/export - appends to an existing option group if it exists", () => {
      const engine = rds.DatabaseInstanceEngine.oracleSe2({
        version: rds.OracleEngineVersion.VER_19_0_0_0_2025_07_R1,
      });
      const optionGroup = new rds.OptionGroup(stack, "OptionGroup", {
        engine,
        configurations: [
          {
            name: "MY_OPTION_CONFIG",
          },
        ],
      });

      const engineConfig = engine.bindToInstance(stack, {
        optionGroup,
        s3ImportRole: new iam.Role(stack, "ImportRole", {
          assumedBy: new iam.AccountRootPrincipal(),
        }),
      });

      expect(engineConfig.optionGroup).toEqual(optionGroup);
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbOptionGroup.DbOptionGroup, {
        engine_name: "oracle-se2",
        option: [
          {
            option_name: "MY_OPTION_CONFIG",
          },
          {
            option_name: "S3_INTEGRATION",
            version: "1.0",
          },
        ],
      });
    });
  });

  describe("SQL Server engine bindToInstance", () => {
    test("returns s3 integration feature", () => {
      const engine = rds.DatabaseInstanceEngine.sqlServerSe({
        version: rds.SqlServerEngineVersion.VER_14_00_3192_2_V1,
      });

      const engineConfig = engine.bindToInstance(
        new AwsStack(Testing.app(), "ScratchStack", {
          environmentName,
          gridUUID,
          providerConfig,
          gridBackendConfig,
        }),
        {},
      );
      expect(engineConfig.features?.s3Import).toEqual("S3_INTEGRATION");
      expect(engineConfig.features?.s3Export).toEqual("S3_INTEGRATION");
    });

    test("s3 import/export - throws if roles are not equal", () => {
      const engine = rds.DatabaseInstanceEngine.sqlServerSe({
        version: rds.SqlServerEngineVersion.VER_14_00_3192_2_V1,
      });

      const s3ImportRole = new iam.Role(stack, "ImportRole", {
        assumedBy: new iam.AccountRootPrincipal(),
      });
      const s3ExportRole = new iam.Role(stack, "ExportRole", {
        assumedBy: new iam.AccountRootPrincipal(),
      });

      // each bindToInstance() call below may synthesize a new "InstanceOptionGroup" child
      // construct, so (as upstream does) each assertion gets its own fresh scope.
      let scratchStackCount = 0;
      const newScope = () =>
        new AwsStack(Testing.app(), `ScratchStack${++scratchStackCount}`, {
          environmentName,
          gridUUID,
          providerConfig,
          gridBackendConfig,
        });

      expect(() =>
        engine.bindToInstance(newScope(), { s3ImportRole, s3ExportRole }),
      ).toThrow(/S3 import and export roles must be the same/);
      expect(() =>
        engine.bindToInstance(newScope(), { s3ImportRole }),
      ).not.toThrow();
      expect(() =>
        engine.bindToInstance(newScope(), { s3ExportRole }),
      ).not.toThrow();
      expect(() =>
        engine.bindToInstance(newScope(), {
          s3ImportRole,
          s3ExportRole: s3ImportRole,
        }),
      ).not.toThrow();
    });

    test("s3 import/export - creates an option group if needed", () => {
      const engine = rds.DatabaseInstanceEngine.sqlServerSe({
        version: rds.SqlServerEngineVersion.VER_14_00_3192_2_V1,
      });
      const s3ImportRole = new iam.Role(stack, "ImportRole", {
        assumedBy: new iam.AccountRootPrincipal(),
      });

      const engineConfig = engine.bindToInstance(stack, {
        optionGroup: undefined,
        s3ImportRole,
      });

      expect(engineConfig.optionGroup).toBeDefined();
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbOptionGroup.DbOptionGroup, {
        engine_name: "sqlserver-se",
        option: [
          {
            option_name: "SQLSERVER_BACKUP_RESTORE",
            option_settings: [
              {
                name: "IAM_ROLE_ARN",
                value: stack.resolve(s3ImportRole.roleArn),
              },
            ],
          },
        ],
      });
    });

    test("s3 import/export - appends to an existing option group if it exists", () => {
      const engine = rds.DatabaseInstanceEngine.sqlServerSe({
        version: rds.SqlServerEngineVersion.VER_14_00_3192_2_V1,
      });
      const optionGroup = new rds.OptionGroup(stack, "OptionGroup", {
        engine,
        configurations: [
          {
            name: "MY_OPTION_CONFIG",
          },
        ],
      });

      const s3ImportRole = new iam.Role(stack, "ImportRole", {
        assumedBy: new iam.AccountRootPrincipal(),
      });
      const engineConfig = engine.bindToInstance(stack, {
        optionGroup,
        s3ImportRole,
      });

      expect(engineConfig.optionGroup).toEqual(optionGroup);
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbOptionGroup.DbOptionGroup, {
        engine_name: "sqlserver-se",
        option: [
          {
            option_name: "MY_OPTION_CONFIG",
          },
          {
            option_name: "SQLSERVER_BACKUP_RESTORE",
            option_settings: [
              {
                name: "IAM_ROLE_ARN",
                value: stack.resolve(s3ImportRole.roleArn),
              },
            ],
          },
        ],
      });
    });
  });

  describe("SQL Server engine family", () => {
    test.each([
      [
        "SQL Server Standard Edition",
        rds.DatabaseInstanceEngine.sqlServerSe({
          version: rds.SqlServerEngineVersion.VER_15_00_4153_1_V1,
        }),
      ],
      [
        "SQL Server Enterprise Edition",
        rds.DatabaseInstanceEngine.sqlServerEe({
          version: rds.SqlServerEngineVersion.VER_15_00_4153_1_V1,
        }),
      ],
      [
        "SQL Server Web Edition",
        rds.DatabaseInstanceEngine.sqlServerWeb({
          version: rds.SqlServerEngineVersion.VER_15_00_4153_1_V1,
        }),
      ],
      [
        "SQL Server Express Edition",
        rds.DatabaseInstanceEngine.sqlServerEx({
          version: rds.SqlServerEngineVersion.VER_15_00_4153_1_V1,
        }),
      ],
    ])("is passed correctly for %s", (_, engine) => {
      expect(engine.engineFamily).toEqual("SQLSERVER");
    });
  });

  describe("PostgreSQL engine bindToInstance", () => {
    test("returns s3 import/export feature if the version supports it", () => {
      const engineNewerVersion = rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      });

      const engineConfig = engineNewerVersion.bindToInstance(
        new AwsStack(Testing.app(), "ScratchStack", {
          environmentName,
          gridUUID,
          providerConfig,
          gridBackendConfig,
        }),
        {},
      );
      expect(engineConfig.features?.s3Import).toEqual("s3Import");
      expect(engineConfig.features?.s3Export).toEqual("s3Export");
    });
  });

  // TERRACONSTRUCTS DEVIATION: upstream's "MariaDB engine version" suite provisions a full
  // `rds.DatabaseInstance` (with a VPC) and asserts the version threads through the synthesized
  // `AWS::RDS::DBInstance.EngineVersion` property. `DatabaseInstance` is not ported yet (lands in
  // RDS PR 2c) — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/lib/instance.ts
  // so this suite instead asserts the version string threads through
  // `DatabaseInstanceEngine.mariaDb({ version }).engineVersion?.fullVersion`, which exercises the
  // same `MariaDbEngineVersion` -> `MariaDbInstanceEngine` -> `EngineVersion` wiring without the
  // not-yet-ported construct. Re-tighten to the upstream form once `DatabaseInstance` lands.
  describe("MariaDB engine version", () => {
    test.each([
      ["10.4", rds.MariaDbEngineVersion.VER_10_4],
      ["10.4.29", rds.MariaDbEngineVersion.VER_10_4_29],
      ["10.4.30", rds.MariaDbEngineVersion.VER_10_4_30],
      ["10.4.31", rds.MariaDbEngineVersion.VER_10_4_31],
      ["10.4.32", rds.MariaDbEngineVersion.VER_10_4_32],
      ["10.4.33", rds.MariaDbEngineVersion.VER_10_4_33],
      ["10.4.34", rds.MariaDbEngineVersion.VER_10_4_34],
      ["10.5", rds.MariaDbEngineVersion.VER_10_5],
      ["10.5.20", rds.MariaDbEngineVersion.VER_10_5_20],
      ["10.5.21", rds.MariaDbEngineVersion.VER_10_5_21],
      ["10.5.22", rds.MariaDbEngineVersion.VER_10_5_22],
      ["10.5.23", rds.MariaDbEngineVersion.VER_10_5_23],
      ["10.5.24", rds.MariaDbEngineVersion.VER_10_5_24],
      ["10.5.25", rds.MariaDbEngineVersion.VER_10_5_25],
      ["10.5.26", rds.MariaDbEngineVersion.VER_10_5_26],
      ["10.5.27", rds.MariaDbEngineVersion.VER_10_5_27],
      ["10.5.28", rds.MariaDbEngineVersion.VER_10_5_28],
      ["10.5.29", rds.MariaDbEngineVersion.VER_10_5_29],
      ["10.6", rds.MariaDbEngineVersion.VER_10_6],
      ["10.6.13", rds.MariaDbEngineVersion.VER_10_6_13],
      ["10.6.14", rds.MariaDbEngineVersion.VER_10_6_14],
      ["10.6.15", rds.MariaDbEngineVersion.VER_10_6_15],
      ["10.6.16", rds.MariaDbEngineVersion.VER_10_6_16],
      ["10.6.17", rds.MariaDbEngineVersion.VER_10_6_17],
      ["10.6.18", rds.MariaDbEngineVersion.VER_10_6_18],
      ["10.6.19", rds.MariaDbEngineVersion.VER_10_6_19],
      ["10.6.20", rds.MariaDbEngineVersion.VER_10_6_20],
      ["10.6.21", rds.MariaDbEngineVersion.VER_10_6_21],
      ["10.6.22", rds.MariaDbEngineVersion.VER_10_6_22],
      ["10.6.23", rds.MariaDbEngineVersion.VER_10_6_23],
      ["10.11", rds.MariaDbEngineVersion.VER_10_11],
      ["10.11.4", rds.MariaDbEngineVersion.VER_10_11_4],
      ["10.11.5", rds.MariaDbEngineVersion.VER_10_11_5],
      ["10.11.6", rds.MariaDbEngineVersion.VER_10_11_6],
      ["10.11.7", rds.MariaDbEngineVersion.VER_10_11_7],
      ["10.11.8", rds.MariaDbEngineVersion.VER_10_11_8],
      ["10.11.9", rds.MariaDbEngineVersion.VER_10_11_9],
      ["10.11.10", rds.MariaDbEngineVersion.VER_10_11_10],
      ["10.11.11", rds.MariaDbEngineVersion.VER_10_11_11],
      ["10.11.13", rds.MariaDbEngineVersion.VER_10_11_13],
      ["10.11.14", rds.MariaDbEngineVersion.VER_10_11_14],
      ["11.4.3", rds.MariaDbEngineVersion.VER_11_4_3],
      ["11.4.4", rds.MariaDbEngineVersion.VER_11_4_4],
      ["11.4.5", rds.MariaDbEngineVersion.VER_11_4_5],
      ["11.4.7", rds.MariaDbEngineVersion.VER_11_4_7],
      ["11.4.8", rds.MariaDbEngineVersion.VER_11_4_8],
      ["11.8.3", rds.MariaDbEngineVersion.VER_11_8_3],
      ["11.8.5", rds.MariaDbEngineVersion.VER_11_8_5],
    ])("is passed correctly for %s", (engineVersion, version) => {
      // WHEN
      const engine = rds.DatabaseInstanceEngine.mariaDb({ version });

      // THEN
      expect(engine.engineVersion?.fullVersion).toEqual(engineVersion);
      expect(engine.engineType).toEqual("mariadb");
    });
  });
});

describe("rotation applications (TERRACONSTRUCTS DEVIATION: lazy/memoized getters)", () => {
  // The lazy thunk avoids the ../../encryption <-> ../../storage/rds module
  // cycle -- lock in resolved values + memoization against eager-resolution
  // regressions.
  test.each([
    [
      rds.DatabaseInstanceEngine.mariaDb({
        version: rds.MariaDbEngineVersion.VER_10_6,
      }),
      "SecretsManagerRDSMariaDBRotationSingleUser",
    ],
    [
      rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      "SecretsManagerRDSMySQLRotationSingleUser",
    ],
    [
      rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      "SecretsManagerRDSPostgreSQLRotationSingleUser",
    ],
    [
      rds.DatabaseInstanceEngine.oracleSe2({
        version: rds.OracleEngineVersion.VER_19,
      }),
      "SecretsManagerRDSOracleRotationSingleUser",
    ],
    [
      rds.DatabaseInstanceEngine.sqlServerSe({
        version: rds.SqlServerEngineVersion.VER_15,
      }),
      "SecretsManagerRDSSQLServerRotationSingleUser",
    ],
  ])(
    "engine resolves its single-user rotation application (%#)",
    (engine, expectedApp) => {
      expect(engine.singleUserRotationApplication.applicationId).toContain(
        expectedApp,
      );
    },
  );

  test("rotation application getters are memoized", () => {
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16,
    });
    expect(engine.singleUserRotationApplication).toBe(
      engine.singleUserRotationApplication,
    );
    expect(engine.multiUserRotationApplication).toBe(
      engine.multiUserRotationApplication,
    );
  });
});
