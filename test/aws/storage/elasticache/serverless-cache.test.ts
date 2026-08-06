// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/serverless-cache.test.ts
//
// Narrow behavioral gaps between this port and upstream (permanent capability differences, not
// pending work) are documented inline at each call site below with a TERRACONSTRUCTS
// DEVIATION/TODO note.

import {
  elasticacheServerlessCache,
  vpcSecurityGroupIngressRule,
} from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing } from "cdktn";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as encryption from "../../../../src/aws/encryption";
import * as events from "../../../../src/aws/notify";
import * as elasticache from "../../../../src/aws/storage/elasticache";
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

// TERRACONSTRUCTS DEVIATION: upstream's `beforeEach` also calls
// `Validations.of(stack).acknowledge({ id: 'CloudFormation-Validate::F3032', ... })` (a CFN-template
// linting-rule acknowledgement, `aws-cdk-lib/core` `Validations`). This is a CFN/CDK-CLI-synth-time
// mechanism with no TerraConstructs equivalent (there is no template-linting `Validations` registry
// in this repo) -- identical omission pattern to `testStack()` in `../rds/cluster.test.ts` and
// `../docdb/cluster.test.ts`.
function testStack(app?: App, stackId?: string): AwsStack {
  return new AwsStack(app ?? Testing.app(), stackId ?? "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

describe("ServerlessCache", () => {
  describe("isServerlessCache", () => {
    let stack: AwsStack;
    let vpc: compute.Vpc;
    beforeEach(() => {
      stack = testStack();
      vpc = new compute.Vpc(stack, "VPC");
    });

    test("returns true for ServerlessCache instances", () => {
      const cache = new elasticache.ServerlessCache(stack, "Cache", { vpc });

      expect(elasticache.ServerlessCache.isServerlessCache(cache)).toBe(true);
    });

    test("returns false for non-ServerlessCache objects", () => {
      expect(elasticache.ServerlessCache.isServerlessCache({})).toBe(false);
      expect(elasticache.ServerlessCache.isServerlessCache(null)).toBe(false);
      expect(elasticache.ServerlessCache.isServerlessCache(undefined)).toBe(
        false,
      );
      expect(elasticache.ServerlessCache.isServerlessCache("string")).toBe(
        false,
      );
      expect(elasticache.ServerlessCache.isServerlessCache(123)).toBe(false);
    });

    test("returns false for imported serverless caches (not actual ServerlessCache instances)", () => {
      const importedCache = elasticache.ServerlessCache.fromServerlessCacheName(
        stack,
        "ImportedCache",
        "my-serverless-cache",
      );

      expect(elasticache.ServerlessCache.isServerlessCache(importedCache)).toBe(
        false,
      );
    });
  });

  describe("create valid templates", () => {
    let stack: AwsStack;
    let vpc: compute.Vpc;
    beforeEach(() => {
      stack = testStack();
      vpc = new compute.Vpc(stack, "VPC");
    });

    test("import serverless cache", () => {
      const cache = elasticache.ServerlessCache.fromServerlessCacheAttributes(
        stack,
        "ImportedCache",
        {
          serverlessCacheName: "my-serverless-cache",
        },
      );

      expect(cache.serverlessCacheArn).toEqual(
        `arn:${stack.partition}:elasticache:${stack.region}:${stack.account}:serverlesscache/my-serverless-cache`,
      );
    });

    test.each([
      [elasticache.CacheEngine.VALKEY_LATEST],
      [elasticache.CacheEngine.VALKEY_8],
      [elasticache.CacheEngine.VALKEY_7],
      [elasticache.CacheEngine.REDIS_LATEST],
      [elasticache.CacheEngine.REDIS_7],
      [elasticache.CacheEngine.MEMCACHED_LATEST],
      [elasticache.CacheEngine.MEMCACHED_1_6],
    ])("import serverless cache for %s", (cacheEngine) => {
      const cache = elasticache.ServerlessCache.fromServerlessCacheAttributes(
        stack,
        "ImportedCache",
        {
          serverlessCacheName: "my-serverless-cache",
          engine: cacheEngine,
        },
      );

      expect(cache.serverlessCacheArn).toEqual(
        `arn:${stack.partition}:elasticache:${stack.region}:${stack.account}:serverlesscache/my-serverless-cache`,
      );
    });

    test("create serverless cache with full props", () => {
      const key = new encryption.Key(stack, "Key");
      const securityGroup = new compute.SecurityGroup(stack, "SecurityGroup", {
        vpc,
      });
      const userGroup = new elasticache.UserGroup(stack, "UserGroup", {});

      const cache = new elasticache.ServerlessCache(stack, "Cache", {
        description: "Serverless cache",
        vpc,
        engine: elasticache.CacheEngine.VALKEY_8,
        serverlessCacheName: "serverelessCache",
        kmsKey: key,
        vpcSubnets: { subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [securityGroup],
        userGroup,
        backup: {
          backupRetentionLimit: 2,
        },
        cacheUsageLimits: {
          dataStorageMinimumSize: Size.gibibytes(1),
          dataStorageMaximumSize: Size.gibibytes(1),
          requestRateLimitMinimum: 1_000,
          requestRateLimitMaximum: 1_000,
        },
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheServerlessCache.ElasticacheServerlessCache,
        {
          description: "Serverless cache",
          engine: "valkey",
          major_engine_version: "8",
          // key ARN, not bare id -- provider read-back parity (see the DEVIATION in
          // serverless-cache.ts; live-caught inconsistent-result error otherwise)
          kms_key_id: stack.resolve(key.keyArn),
          name: "serverelesscache",
          snapshot_retention_limit: 2,
          user_group_id: userGroup.userGroupName,
          cache_usage_limits: [
            {
              data_storage: [
                {
                  minimum: 1,
                  maximum: 1,
                  unit: "GB",
                },
              ],
              ecpu_per_second: [
                {
                  minimum: 1_000,
                  maximum: 1_000,
                },
              ],
            },
          ],
        },
      );
      // TERRACONSTRUCTS DEVIATION: upstream also asserts `FinalSnapshotName: 'last-snapshot-name'`
      // (`backup.backupNameBeforeDeletion`) -- omitted here, see the TODO on `BackupSettings` in
      // `../../../../src/aws/storage/elasticache/serverless-cache.ts` (no Terraform-provider
      // equivalent for `aws_elasticache_serverless_cache`).
      expect(cache.serverlessCacheName).toEqual("serverelesscache");
      // `backup.backupArnsToRestore` was not supplied above, so `backupArnsToRestore` must reflect
      // that -- it must NOT read the provider's `snapshot_arns_to_restore` computed attribute
      // getter, which always returns a non-empty token list regardless of input.
      expect(cache.backupArnsToRestore).toBeUndefined();
    });

    test("backupArnsToRestore reflects the supplied backup.backupArnsToRestore", () => {
      const arns = ["arn:aws:s3:::my-bucket/snapshot1"];
      const cache = new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
        backup: {
          backupArnsToRestore: arns,
        },
      });

      expect(cache.backupArnsToRestore).toEqual(arns);
    });

    test("serverlessCacheStatus resolves to the resource's computed status attribute", () => {
      const cache = new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
      });

      expect(stack.resolve(cache.serverlessCacheStatus)).toEqual(
        stack.resolve(cache.resource.status),
      );
    });

    test("correctly creates a serverless cache with a deploy-time value for its name", () => {
      const parameter = new TerraformVariable(stack, "Parameter", {
        type: "string",
      });
      new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
        serverlessCacheName: parameter.stringValue,
      });

      // A Token-valued name must be passed through untouched -- lowercasing it would corrupt the
      // cdktn `${TfToken[...]}` marker and break Terraform's reference resolution.
      Template.synth(stack).toHaveResourceWithProperties(
        elasticacheServerlessCache.ElasticacheServerlessCache,
        {
          name: stack.resolve(parameter.stringValue),
        },
      );
    });

    test.each([
      [elasticache.CacheEngine.VALKEY_LATEST, "valkey", undefined],
      [elasticache.CacheEngine.VALKEY_8, "valkey", "8"],
      [elasticache.CacheEngine.VALKEY_7, "valkey", "7"],
      [elasticache.CacheEngine.REDIS_LATEST, "redis", undefined],
      [elasticache.CacheEngine.REDIS_7, "redis", "7"],
      [elasticache.CacheEngine.MEMCACHED_LATEST, "memcached", undefined],
      [elasticache.CacheEngine.MEMCACHED_1_6, "memcached", "1.6"],
    ])(
      "test serverless cache version for %s",
      (cacheEngine, engine, version) => {
        new elasticache.ServerlessCache(stack, "Cache", {
          description: "Serverless cache",
          vpc,
          engine: cacheEngine,
        });

        const t = new Template(stack);
        const [resource] = t.resourceTypeArray(
          elasticacheServerlessCache.ElasticacheServerlessCache,
        ) as any[];
        expect(resource.description).toEqual("Serverless cache");
        expect(resource.engine).toEqual(engine);
        expect(resource.major_engine_version).toEqual(version);
      },
    );

    test("backup.backupTime formats an hour/minute cron schedule to daily_snapshot_time", () => {
      new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
        backup: {
          backupTime: events.Schedule.cron({ hour: "12", minute: "5" }),
        },
      });

      Template.synth(stack).toHaveResourceWithProperties(
        elasticacheServerlessCache.ElasticacheServerlessCache,
        {
          daily_snapshot_time: "12:05",
        },
      );
    });

    test("backup.backupTime throws when the schedule specifies more than hour/minute", () => {
      expect(
        () =>
          new elasticache.ServerlessCache(stack, "Cache", {
            vpc,
            backup: {
              backupTime: events.Schedule.cron({
                hour: "12",
                minute: "0",
                weekDay: "MON",
              }),
            },
          }),
      ).toThrow(
        "For now, only daily backup time is available (supports just hour and minute). Day, month, year, and weekDay are not allowed",
      );
    });

    test("allow security group ingress with endpoint port", () => {
      const cache = new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
      });
      new compute.SecurityGroup(stack, "SecurityGroup", {
        vpc,
      }).connections.allowToDefaultPort(cache);

      const t = new Template(stack);
      // TERRACONSTRUCTS DEVIATION: upstream asserts `AWS::EC2::SecurityGroupIngress` with
      // `FromPort`/`ToPort` set to `{ 'Fn::GetAtt': ['Cache18F6EE16', 'Endpoint.Port'] }` -- the
      // Terraform AWS provider represents security group ingress rules as a standalone
      // `aws_vpc_security_group_ingress_rule` resource with `from_port`/`to_port` fields.
      t.expect.toHaveResourceWithProperties(
        vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
        {
          from_port: stack.resolve(cache.serverlessCacheEndpointPort),
          to_port: stack.resolve(cache.serverlessCacheEndpointPort),
        },
      );
    });
  });

  describe("validation errors", () => {
    let stack: AwsStack;
    let vpc: compute.Vpc;
    beforeEach(() => {
      stack = testStack();
      vpc = new compute.Vpc(stack, "VPC");
    });

    const descriptionLength = 256;
    test.each([
      {
        testDescription:
          "when the description is longer than the max(255) characters throws validation error",
        description: "A".repeat(descriptionLength),
        errorMessage: `Description must not exceed 255 characters, currently has ${descriptionLength}`,
      },
      {
        testDescription:
          "when the description has < characters throws validation error",
        description: "<",
        errorMessage: "Description must not contain < or > characters",
      },
      {
        testDescription:
          "when the description has > characters throws validation error",
        description: ">",
        errorMessage: "Description must not contain < or > characters",
      },
    ])("$testDescription", ({ description, errorMessage }) => {
      expect(
        () =>
          new elasticache.ServerlessCache(stack, "cache", {
            description,
            vpc,
          }),
      ).toThrow(errorMessage);
    });

    const invalidMinStorageSize = Size.bytes(0);
    const invalidMaxStorageSize = Size.gibibytes(5_001);
    const dataStorageTest = [
      {
        testDescription:
          "when the minimum data storage is smaller than the minimum(1 GB) throws validation error",
        cacheUsageLimits: { dataStorageMinimumSize: invalidMinStorageSize },
        errorMessage: "Data storage minimum must be between 1 and 5000 GB.",
      },
      {
        testDescription:
          "when the minimum data storage is larger than the maximum(5000 GB) throws validation error",
        cacheUsageLimits: { dataStorageMinimumSize: invalidMaxStorageSize },
        errorMessage: "Data storage minimum must be between 1 and 5000 GB.",
      },
      {
        testDescription:
          "when the maximum data storage is larger than the maximum(5000 GB) throws validation error",
        cacheUsageLimits: { dataStorageMaximumSize: invalidMaxStorageSize },
        errorMessage: "Data storage maximum must be between 1 and 5000 GB.",
      },
      {
        testDescription:
          "when the maximum data storage is smaller than the minimum(1 GB) throws validation error",
        cacheUsageLimits: { dataStorageMaximumSize: invalidMinStorageSize },
        errorMessage: "Data storage maximum must be between 1 and 5000 GB.",
      },
      {
        testDescription:
          "when the minimum data storage is larger than maximum data storage throws validation error",
        cacheUsageLimits: {
          dataStorageMinimumSize: Size.gibibytes(100),
          dataStorageMaximumSize: Size.gibibytes(99),
        },
        errorMessage: "Data storage minimum cannot be greater than maximum",
      },
    ];

    const invalidMinRequestRate = 999;
    const invalidMaxRequestRate = 15_000_001;
    const requestRateLimitTests = [
      {
        testDescription:
          "when the minimum request rate is smaller than minimum(1,000) throws validation error",
        cacheUsageLimits: {
          requestRateLimitMinimum: invalidMinRequestRate,
        },
        errorMessage:
          "Request rate minimum must be between 1,000 and 15,000,000 ECPUs per second",
      },
      {
        testDescription:
          "when the minimum request rate is larger than maximum(15,000,000) throws validation error",
        cacheUsageLimits: {
          requestRateLimitMinimum: invalidMaxRequestRate,
        },
        errorMessage:
          "Request rate minimum must be between 1,000 and 15,000,000 ECPUs per second",
      },
      {
        testDescription:
          "when the maximum request rate is smaller than minimum(1,000) throws validation error",
        cacheUsageLimits: {
          requestRateLimitMaximum: invalidMinRequestRate,
        },
        errorMessage:
          "Request rate maximum must be between 1,000 and 15,000,000 ECPUs per second",
      },
      {
        testDescription: `when the maximum request rate is ${invalidMaxRequestRate} throws validation error`,
        cacheUsageLimits: {
          requestRateLimitMaximum: invalidMaxRequestRate,
        },
        errorMessage:
          "Request rate maximum must be between 1,000 and 15,000,000 ECPUs per second",
      },
      {
        testDescription:
          "when the minimum request rate is larger than maximum request rate throws validation error",
        cacheUsageLimits: {
          requestRateLimitMinimum: 2_000,
          requestRateLimitMaximum: 1_000,
        },
        errorMessage: "Request rate minimum cannot be greater than maximum",
      },
    ];

    test.each([...dataStorageTest, ...requestRateLimitTests])(
      "$testDescription",
      ({ cacheUsageLimits, errorMessage }) => {
        expect(
          () =>
            new elasticache.ServerlessCache(stack, "cache", {
              vpc,
              cacheUsageLimits,
            }),
        ).toThrow(errorMessage);
      },
    );

    test.each([
      {
        testDescription:
          "when the backup retention limit is smaller than minimum(1) throws validation error",
        backup: {
          backupRetentionLimit: 0,
        },
        errorMessage: "Backup retention limit must be between 1 and 35 days",
      },
      {
        testDescription:
          "when the backup retention limit is larger than maximum(35) throws validation error",
        backup: {
          backupRetentionLimit: 36,
        },
        errorMessage: "Backup retention limit must be between 1 and 35 days",
      },
      // TERRACONSTRUCTS DEVIATION: upstream also has four `backupNameBeforeDeletion`-format test
      // cases here (name starting with a number / ending with a hyphen / consecutive hyphens /
      // containing a dollar sign) -- omitted, see the TODO on `BackupSettings` in
      // `../../../../src/aws/storage/elasticache/serverless-cache.ts` (`backupNameBeforeDeletion`
      // has no Terraform-provider equivalent for `aws_elasticache_serverless_cache`, so its
      // format-validation logic was not ported either).
    ])("$testDescription", ({ backup, errorMessage }) => {
      expect(
        () =>
          new elasticache.ServerlessCache(stack, "cache", {
            vpc,
            backup,
          }),
      ).toThrow(errorMessage);
    });

    test.each([
      {
        testDescription:
          "when a user group passed to Mem cache throws validation error",
        engine: elasticache.CacheEngine.MEMCACHED_LATEST,
        userGroupProps: {},
        errorMessage:
          "User groups cannot be used with Memcached engines. Only Redis and Valkey engines support user groups.",
      },
      {
        testDescription:
          "when a valkey user group passed to Redis cache throws validation error",
        engine: elasticache.CacheEngine.REDIS_LATEST,
        userGroupProps: {
          engine: elasticache.UserEngine.VALKEY,
        },
        errorMessage: "Redis cache can only use Redis user groups.",
      },
    ])("$testDescription", ({ engine, userGroupProps, errorMessage }) => {
      const userGroup = new elasticache.UserGroup(
        stack,
        "UserGroup",
        userGroupProps,
      );
      expect(
        () =>
          new elasticache.ServerlessCache(stack, "cache", {
            vpc,
            engine,
            userGroup,
          }),
      ).toThrow(errorMessage);
    });

    test.each([
      {
        testDescription:
          "when passing cache name & cache arn throws validation error",
        serverlessCacheArn:
          "arn:aws:elasticache:us-east-1:999999999999:serverlesscache:cachename",
        serverlessCacheName: "cachename",
        errorMessage:
          "Only one of serverlessCacheArn or serverlessCacheName can be provided.",
      },
      {
        testDescription:
          "when passing none of cache name or cache arn throws validation error",
        errorMessage:
          "One of serverlessCacheName or serverlessCacheArn is required.",
      },
      {
        testDescription:
          "when passing cache arn invalid(has no cache name) throws validation error",
        serverlessCacheArn:
          "arn:aws:elasticache:us-east-1:999999999999:serverlesscache",
        errorMessage: "Unable to extract serverless cache name from ARN.",
      },
    ])(
      "$testDescription",
      ({ serverlessCacheName, serverlessCacheArn, errorMessage }) => {
        expect(() =>
          elasticache.ServerlessCache.fromServerlessCacheAttributes(
            stack,
            "ImportedCache",
            { serverlessCacheArn, serverlessCacheName },
          ),
        ).toThrow(errorMessage);
      },
    );
  });

  describe("CacheEngine class", () => {
    let stack: AwsStack;
    let vpc: compute.Vpc;
    beforeEach(() => {
      stack = testStack();
      vpc = new compute.Vpc(stack, "VPC");
    });

    test("of() returns an instance with the expected engineType and majorEngineVersion", () => {
      const engine = elasticache.CacheEngine.of("valkey", "8");
      expect(engine.engineType).toBe("valkey");
      expect(engine.majorEngineVersion).toBe("8");
    });

    test("of() accepts an explicit engineType and majorEngineVersion", () => {
      const engine = elasticache.CacheEngine.of("valkey", "9");
      expect(engine.engineType).toBe("valkey");
      expect(engine.majorEngineVersion).toBe("9");
    });

    test("of() accepts an undefined majorEngineVersion", () => {
      const engine = elasticache.CacheEngine.of("valkey");
      expect(engine.engineType).toBe("valkey");
      expect(engine.majorEngineVersion).toBeUndefined();
    });

    test("named static members expose the correct engineType and majorEngineVersion", () => {
      expect(elasticache.CacheEngine.VALKEY_8.engineType).toBe("valkey");
      expect(elasticache.CacheEngine.VALKEY_8.majorEngineVersion).toBe("8");
      expect(
        elasticache.CacheEngine.VALKEY_LATEST.majorEngineVersion,
      ).toBeUndefined();
      expect(elasticache.CacheEngine.MEMCACHED_1_6.engineType).toBe(
        "memcached",
      );
      expect(elasticache.CacheEngine.MEMCACHED_1_6.majorEngineVersion).toBe(
        "1.6",
      );
    });

    test("VALKEY_9 maps to engineType=valkey and majorEngineVersion=9", () => {
      expect(elasticache.CacheEngine.VALKEY_9.engineType).toBe("valkey");
      expect(elasticache.CacheEngine.VALKEY_9.majorEngineVersion).toBe("9");
    });

    test("toString() renders engineType_majorEngineVersion for versioned engines", () => {
      expect(elasticache.CacheEngine.VALKEY_8.toString()).toBe("valkey_8");
      expect(elasticache.CacheEngine.MEMCACHED_1_6.toString()).toBe(
        "memcached_1.6",
      );
    });

    test("toString() renders only engineType when majorEngineVersion is undefined", () => {
      expect(elasticache.CacheEngine.VALKEY_LATEST.toString()).toBe("valkey");
      expect(elasticache.CacheEngine.REDIS_LATEST.toString()).toBe("redis");
    });

    test("named static members synthesize with the expected Terraform properties", () => {
      new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
        engine: elasticache.CacheEngine.VALKEY_9,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheServerlessCache.ElasticacheServerlessCache,
        {
          engine: "valkey",
          major_engine_version: "9",
        },
      );
    });

    test("of() for an unknown major version synthesizes correctly", () => {
      new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
        engine: elasticache.CacheEngine.of("valkey", "9"),
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheServerlessCache.ElasticacheServerlessCache,
        {
          engine: "valkey",
          major_engine_version: "9",
        },
      );
    });

    test("MEMCACHED_1_6 with a user group throws MemcachedUserGroupNotSupported", () => {
      const userGroup = new elasticache.UserGroup(stack, "UserGroup", {});

      expect(
        () =>
          new elasticache.ServerlessCache(stack, "Cache", {
            vpc,
            engine: elasticache.CacheEngine.MEMCACHED_1_6,
            userGroup,
          }),
      ).toThrow("User groups cannot be used with Memcached engines.");
    });

    test("REDIS_7 with a Valkey user group throws RedisUserGroupMismatch", () => {
      const userGroup = new elasticache.UserGroup(stack, "UserGroup", {
        engine: elasticache.UserEngine.VALKEY,
      });

      expect(
        () =>
          new elasticache.ServerlessCache(stack, "Cache", {
            vpc,
            engine: elasticache.CacheEngine.REDIS_7,
            userGroup,
          }),
      ).toThrow("Redis cache can only use Redis user groups.");
    });

    test("imported cache with VALKEY_9 resolves the correct default port", () => {
      const cache = elasticache.ServerlessCache.fromServerlessCacheAttributes(
        stack,
        "ImportedCache",
        {
          serverlessCacheName: "my-cache",
          engine: elasticache.CacheEngine.VALKEY_9,
          securityGroups: [new compute.SecurityGroup(stack, "SG", { vpc })],
        },
      );

      expect(cache.connections.defaultPort?.toString()).toContain("6379");
    });

    test("of() does not return the same instance as a named static member", () => {
      expect(elasticache.CacheEngine.of("valkey", "8")).not.toBe(
        elasticache.CacheEngine.VALKEY_8,
      );
      expect(elasticache.CacheEngine.of("valkey")).not.toBe(
        elasticache.CacheEngine.VALKEY_LATEST,
      );
    });

    test("VALKEY_9 with a Redis user group synthesizes without error", () => {
      const userGroup = new elasticache.UserGroup(stack, "UserGroup", {
        engine: elasticache.UserEngine.REDIS,
        users: [
          new elasticache.NoPasswordUser(stack, "DefaultUser", {
            userId: "default",
            userName: "default",
            engine: elasticache.UserEngine.REDIS,
            accessControl:
              elasticache.AccessControl.fromAccessString("on ~* +@all"),
          }),
        ],
      });

      expect(
        () =>
          new elasticache.ServerlessCache(stack, "Cache", {
            vpc,
            engine: elasticache.CacheEngine.VALKEY_9,
            userGroup,
          }),
      ).not.toThrow();
    });
  });
});
