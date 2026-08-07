// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/cluster-engine.test.ts

import * as rds from "../../../../src/aws/storage/rds";

describe("cluster engine", () => {
  // upstream: testDeprecated(...) -- `testDeprecated` is an `@aws-cdk/cdk-build-tools`
  // test-harness helper that only suppresses deprecation-usage warnings during the test; it
  // isn't ported in this repo and has no bearing on the assertion itself (see the identical
  // note in test/aws/encryption/secret.test.ts).
  test("default parameterGroupFamily for versionless Aurora cluster engine is 'aurora5.6'", () => {
    // GIVEN
    const engine = rds.DatabaseClusterEngine.AURORA;

    // WHEN
    const family = engine.parameterGroupFamily;

    // THEN
    expect(family).toEqual("aurora5.6");
  });

  test("default parameterGroupFamily for versionless Aurora MySQL cluster engine is 'aurora-mysql5.7'", () => {
    // GIVEN
    const engine = rds.DatabaseClusterEngine.AURORA_MYSQL;

    // WHEN
    const family = engine.parameterGroupFamily;

    // THEN
    expect(family).toEqual("aurora-mysql5.7");
  });

  test("default parameterGroupFamily for versionless Aurora PostgreSQL is not defined", () => {
    // GIVEN
    const engine = rds.DatabaseClusterEngine.AURORA_POSTGRESQL;

    // WHEN
    const family = engine.parameterGroupFamily;

    // THEN
    expect(family).toEqual(undefined);
  });

  test("parameter group family", () => {
    // the PostgreSQL engine knows about the following major versions: 9.6, 10 and 11

    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("8", "8"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql8");

    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("9", "9"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql9");

    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("9.7", "9.7"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql9.7");

    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("9.6", "9.6"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql9.6");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("9.6.1", "9.6"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql9.6");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("10.0", "10"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql10");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("13.21", "13"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql13");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("14.18", "14"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql14");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("15.13", "15"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql15");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("16.9", "16"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql16");
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of("17.5", "17"),
      }).parameterGroupFamily,
    ).toEqual("aurora-postgresql17");
  });

  test("supported log types", () => {
    const mysqlLogTypes = [
      "error",
      "general",
      "slowquery",
      "audit",
      "instance",
      "iam-db-auth-error",
    ];
    expect(
      rds.DatabaseClusterEngine.aurora({
        version: rds.AuroraEngineVersion.VER_1_22_2,
      }).supportedLogTypes,
    ).toEqual(mysqlLogTypes);
    expect(
      rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_2_12_3,
      }).supportedLogTypes,
    ).toEqual(mysqlLogTypes);
    expect(
      rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_3,
      }).supportedLogTypes,
    ).toEqual(["postgresql", "iam-db-auth-error", "instance"]);
  });

  test("AuroraMysqlEngineVersion.of() determines default combineImportAndExportRoles", () => {
    expect(
      rds.AuroraMysqlEngineVersion.of("5.7.mysql_aurora.2.12.3", "5.7")
        ._combineImportAndExportRoles,
    ).toEqual(false);
    expect(
      rds.AuroraMysqlEngineVersion.of("5.7.mysql_aurora.2.12.3")
        ._combineImportAndExportRoles,
    ).toEqual(false);
    expect(
      rds.AuroraMysqlEngineVersion.of("8.0.mysql_aurora.3.07.1", "8.0")
        ._combineImportAndExportRoles,
    ).toEqual(true);
  });

  test("AuroraMysqlEngineVersion.of() determines serverlessV2AutoPauseSupported", () => {
    expect(
      rds.AuroraMysqlEngineVersion.of("5.7.mysql_aurora.2.12.3", "5.7")
        ._serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraMysqlEngineVersion.of("8.0.mysql_aurora.3.07.1", "8.0")
        ._serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraMysqlEngineVersion.of("8.0.mysql_aurora.3.08.1", "8.0")
        ._serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraMysqlEngineVersion.of("8.0.mysql_aurora.3.10.0", "8.0")
        ._serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraMysqlEngineVersion.of("8.4.mysql_aurora.4.00.0", "8.4")
        ._serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraMysqlEngineVersion.of("10.0.mysql_aurora.x.xx.x", "10.0")
        ._serverlessV2AutoPauseSupported,
    ).toEqual(true);
  });

  test("AuroraPostgresEngineVersion.of() determines serverlessV2AutoPauseSupported", () => {
    expect(
      rds.AuroraPostgresEngineVersion.of("12.99", "12")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraPostgresEngineVersion.of("13.14", "13")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraPostgresEngineVersion.of("13.15", "13")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("14.11", "14")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraPostgresEngineVersion.of("14.12", "14")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("15.6", "15")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraPostgresEngineVersion.of("15.7", "15")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("15.10", "15")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("16.2", "16")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(false);
    expect(
      rds.AuroraPostgresEngineVersion.of("16.3", "16")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("16.10", "16")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("16.6-limitless", "16")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("17.4", "17")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
    expect(
      rds.AuroraPostgresEngineVersion.of("18.0", "18")._features
        .serverlessV2AutoPauseSupported,
    ).toEqual(true);
  });

  test("cluster parameter group correctly determined for AURORA_POSTGRESQL and given version", () => {
    // GIVEN
    const engine_VER_13_20 = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_13_20,
    });
    const engine_VER_14_3 = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_14_3,
    });
    const engine_VER_15_12 = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_15_12,
    });
    const engine_VER_16_3 = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_16_3,
    });
    const engine_VER_17_2 = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_17_2,
    });

    // THEN
    expect(engine_VER_13_20.parameterGroupFamily).toEqual(
      "aurora-postgresql13",
    );
    expect(engine_VER_14_3.parameterGroupFamily).toEqual("aurora-postgresql14");
    expect(engine_VER_15_12.parameterGroupFamily).toEqual(
      "aurora-postgresql15",
    );
    expect(engine_VER_16_3.parameterGroupFamily).toEqual("aurora-postgresql16");
    expect(engine_VER_17_2.parameterGroupFamily).toEqual("aurora-postgresql17");
  });

  // upstream: testDeprecated.each(...) -- see the `testDeprecated` note above; converted to a
  // plain `test.each`.
  test.each([
    rds.AuroraEngineVersion.VER_1_22_2,
    rds.AuroraEngineVersion.VER_1_22_3,
    rds.AuroraEngineVersion.VER_1_22_4,
    rds.AuroraEngineVersion.VER_1_22_5,
    rds.AuroraEngineVersion.VER_1_23_0,
    rds.AuroraEngineVersion.VER_1_23_1,
    rds.AuroraEngineVersion.VER_1_23_2,
    rds.AuroraEngineVersion.VER_1_23_3,
    rds.AuroraEngineVersion.VER_1_23_4,
  ])(
    "cluster parameter group correctly determined for AURORA_MYSQL 1.x and given version $auroraFullVersion",
    (version: rds.AuroraEngineVersion) => {
      // GIVEN
      const engine_ver = rds.DatabaseClusterEngine.aurora({ version });

      // THEN
      expect(engine_ver.parameterGroupFamily).toEqual("aurora5.6");
    },
  );

  test.each([
    rds.AuroraMysqlEngineVersion.VER_2_02_3,
    rds.AuroraMysqlEngineVersion.VER_2_03_2,
    rds.AuroraMysqlEngineVersion.VER_2_03_3,
    rds.AuroraMysqlEngineVersion.VER_2_03_4,
    rds.AuroraMysqlEngineVersion.VER_2_04_0,
    rds.AuroraMysqlEngineVersion.VER_2_04_1,
    rds.AuroraMysqlEngineVersion.VER_2_04_2,
    rds.AuroraMysqlEngineVersion.VER_2_04_3,
    rds.AuroraMysqlEngineVersion.VER_2_04_4,
    rds.AuroraMysqlEngineVersion.VER_2_04_5,
    rds.AuroraMysqlEngineVersion.VER_2_04_6,
    rds.AuroraMysqlEngineVersion.VER_2_04_7,
    rds.AuroraMysqlEngineVersion.VER_2_04_8,
    rds.AuroraMysqlEngineVersion.VER_2_04_9,
    rds.AuroraMysqlEngineVersion.VER_2_05_0,
    rds.AuroraMysqlEngineVersion.VER_2_05_1,
    rds.AuroraMysqlEngineVersion.VER_2_06_0,
    rds.AuroraMysqlEngineVersion.VER_2_07_0,
    rds.AuroraMysqlEngineVersion.VER_2_07_1,
    rds.AuroraMysqlEngineVersion.VER_2_07_2,
    rds.AuroraMysqlEngineVersion.VER_2_07_3,
    rds.AuroraMysqlEngineVersion.VER_2_07_4,
    rds.AuroraMysqlEngineVersion.VER_2_07_5,
    rds.AuroraMysqlEngineVersion.VER_2_07_6,
    rds.AuroraMysqlEngineVersion.VER_2_07_7,
    rds.AuroraMysqlEngineVersion.VER_2_07_8,
    rds.AuroraMysqlEngineVersion.VER_2_07_9,
    rds.AuroraMysqlEngineVersion.VER_2_07_10,
    rds.AuroraMysqlEngineVersion.VER_2_08_0,
    rds.AuroraMysqlEngineVersion.VER_2_08_1,
    rds.AuroraMysqlEngineVersion.VER_2_08_2,
    rds.AuroraMysqlEngineVersion.VER_2_08_3,
    rds.AuroraMysqlEngineVersion.VER_2_08_4,
    rds.AuroraMysqlEngineVersion.VER_2_09_0,
    rds.AuroraMysqlEngineVersion.VER_2_09_1,
    rds.AuroraMysqlEngineVersion.VER_2_09_2,
    rds.AuroraMysqlEngineVersion.VER_2_09_3,
    rds.AuroraMysqlEngineVersion.VER_2_10_0,
    rds.AuroraMysqlEngineVersion.VER_2_10_1,
    rds.AuroraMysqlEngineVersion.VER_2_10_2,
    rds.AuroraMysqlEngineVersion.VER_2_10_3,
    rds.AuroraMysqlEngineVersion.VER_2_11_0,
    rds.AuroraMysqlEngineVersion.VER_2_11_1,
    rds.AuroraMysqlEngineVersion.VER_2_11_2,
    rds.AuroraMysqlEngineVersion.VER_2_11_3,
    rds.AuroraMysqlEngineVersion.VER_2_11_4,
    rds.AuroraMysqlEngineVersion.VER_2_11_5,
    rds.AuroraMysqlEngineVersion.VER_2_11_6,
    rds.AuroraMysqlEngineVersion.VER_2_12_0,
    rds.AuroraMysqlEngineVersion.VER_2_12_1,
    rds.AuroraMysqlEngineVersion.VER_2_12_2,
    rds.AuroraMysqlEngineVersion.VER_2_12_3,
    rds.AuroraMysqlEngineVersion.VER_2_12_4,
    rds.AuroraMysqlEngineVersion.VER_2_12_5,
  ])(
    "cluster parameter group correctly determined for AURORA_MYSQL 2.x and given version $auroraMysqlFullVersion",
    (version: rds.AuroraMysqlEngineVersion) => {
      // GIVEN
      const engine_ver = rds.DatabaseClusterEngine.auroraMysql({ version });

      // THEN
      expect(engine_ver.parameterGroupFamily).toEqual("aurora-mysql5.7");
    },
  );

  test.each([
    rds.AuroraMysqlEngineVersion.VER_3_01_0,
    rds.AuroraMysqlEngineVersion.VER_3_01_1,
    rds.AuroraMysqlEngineVersion.VER_3_02_0,
    rds.AuroraMysqlEngineVersion.VER_3_02_1,
    rds.AuroraMysqlEngineVersion.VER_3_02_2,
    rds.AuroraMysqlEngineVersion.VER_3_02_3,
    rds.AuroraMysqlEngineVersion.VER_3_03_0,
    rds.AuroraMysqlEngineVersion.VER_3_03_1,
    rds.AuroraMysqlEngineVersion.VER_3_03_2,
    rds.AuroraMysqlEngineVersion.VER_3_03_3,
    rds.AuroraMysqlEngineVersion.VER_3_04_0,
    rds.AuroraMysqlEngineVersion.VER_3_04_1,
    rds.AuroraMysqlEngineVersion.VER_3_04_2,
    rds.AuroraMysqlEngineVersion.VER_3_04_3,
    rds.AuroraMysqlEngineVersion.VER_3_04_4,
    rds.AuroraMysqlEngineVersion.VER_3_04_6,
    rds.AuroraMysqlEngineVersion.VER_3_05_0,
    rds.AuroraMysqlEngineVersion.VER_3_05_1,
    rds.AuroraMysqlEngineVersion.VER_3_05_2,
    rds.AuroraMysqlEngineVersion.VER_3_06_0,
    rds.AuroraMysqlEngineVersion.VER_3_06_1,
    rds.AuroraMysqlEngineVersion.VER_3_07_0,
    rds.AuroraMysqlEngineVersion.VER_3_07_1,
    rds.AuroraMysqlEngineVersion.VER_3_08_0,
    rds.AuroraMysqlEngineVersion.VER_3_08_1,
    rds.AuroraMysqlEngineVersion.VER_3_08_2,
    rds.AuroraMysqlEngineVersion.VER_3_09_0,
    rds.AuroraMysqlEngineVersion.VER_3_10_0,
    rds.AuroraMysqlEngineVersion.VER_3_10_1,
    rds.AuroraMysqlEngineVersion.VER_3_10_2,
    rds.AuroraMysqlEngineVersion.VER_3_10_3,
    rds.AuroraMysqlEngineVersion.VER_3_11_0,
    rds.AuroraMysqlEngineVersion.VER_3_11_1,
    rds.AuroraMysqlEngineVersion.VER_3_12_0,
  ])(
    "cluster parameter group correctly determined for AURORA_MYSQL 3.x and given version $auroraMysqlFullVersion",
    (version: rds.AuroraMysqlEngineVersion) => {
      // GIVEN
      const engine_ver = rds.DatabaseClusterEngine.auroraMysql({ version });

      // THEN
      expect(engine_ver.parameterGroupFamily).toEqual("aurora-mysql8.0");
    },
  );
});

describe("rotation applications (TERRACONSTRUCTS DEVIATION: lazy/memoized getters)", () => {
  // The lazy thunk avoids the ../../encryption <-> ../../storage/rds module
  // cycle -- these tests lock in the resolved values and memoization so a
  // future revert to eager resolution fails here, not in a later PR.
  test("aurora-mysql resolves the MySQL rotation applications", () => {
    const engine = rds.DatabaseClusterEngine.auroraMysql({
      version: rds.AuroraMysqlEngineVersion.VER_3_07_1,
    });
    expect(engine.singleUserRotationApplication.applicationId).toContain(
      "SecretsManagerRDSMySQLRotationSingleUser",
    );
    expect(engine.multiUserRotationApplication.applicationId).toContain(
      "SecretsManagerRDSMySQLRotationMultiUser",
    );
  });

  test("aurora-postgresql resolves the PostgreSQL rotation applications", () => {
    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_16_4,
    });
    expect(engine.singleUserRotationApplication.applicationId).toContain(
      "SecretsManagerRDSPostgreSQLRotationSingleUser",
    );
  });

  test("rotation application getters are memoized", () => {
    const engine = rds.DatabaseClusterEngine.auroraMysql({
      version: rds.AuroraMysqlEngineVersion.VER_3_07_1,
    });
    expect(engine.singleUserRotationApplication).toBe(
      engine.singleUserRotationApplication,
    );
    expect(engine.multiUserRotationApplication).toBe(
      engine.multiUserRotationApplication,
    );
  });
});
