// Smoke tests for src/aws/storage/rds/private/util.ts — upstream has no dedicated unit-test file
// for this module (its logic is exercised indirectly via instance.test.ts / cluster.test.ts, which
// are out of scope for this port). Upstream's aws-rds/test/util.ts is an unrelated CFN-validation
// test helper (`acknowledgeTestValidationRules`) and has nothing to do with `lib/private/util.ts`.

import { iamRole } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as iam from "../../../../src/aws/iam";
import { Bucket } from "../../../../src/aws/storage/bucket";
import {
  Credentials,
  SnapshotCredentials,
} from "../../../../src/aws/storage/rds";
import {
  DEFAULT_PASSWORD_EXCLUDE_CHARS,
  applyDefaultRotationOptions,
  defaultDeletionProtection,
  engineDescription,
  renderUnless,
  setupS3ImportExport,
  validateManagedPasswordCredentials,
  validateManagedPasswordSnapshotCredentials,
} from "../../../../src/aws/storage/rds/private/util";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
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

test("DEFAULT_PASSWORD_EXCLUDE_CHARS is byte-identical to upstream (leading space matters)", () => {
  expect(DEFAULT_PASSWORD_EXCLUDE_CHARS).toEqual(
    " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
  );
  expect(DEFAULT_PASSWORD_EXCLUDE_CHARS.startsWith(" ")).toEqual(true);
});

describe("renderUnless", () => {
  test("returns undefined when value equals the suppress value", () => {
    expect(renderUnless("DESTROY", "DESTROY")).toBeUndefined();
  });

  test("returns the value when it differs from the suppress value", () => {
    expect(renderUnless("RETAIN", "DESTROY")).toEqual("RETAIN");
  });
});

describe("defaultDeletionProtection", () => {
  test("passes through an explicit true", () => {
    expect(defaultDeletionProtection(true)).toEqual(true);
  });

  test("passes through an explicit false", () => {
    expect(defaultDeletionProtection(false)).toEqual(false);
  });

  test("is undefined when not specified", () => {
    expect(defaultDeletionProtection(undefined)).toBeUndefined();
  });
});

describe("engineDescription", () => {
  test("combines engineType and the full engine version when present", () => {
    expect(
      engineDescription({
        engineType: "mysql",
        engineVersion: { fullVersion: "8.0.35", majorVersion: "8.0" },
      }),
    ).toEqual("mysql-8.0.35");
  });

  test("is just the engineType when no version is specified", () => {
    expect(engineDescription({ engineType: "mysql" })).toEqual("mysql");
  });
});

describe("validateManagedPasswordCredentials", () => {
  test("does not throw for username-only credentials", () => {
    expect(() =>
      validateManagedPasswordCredentials(
        stack,
        Credentials.fromUsername("admin"),
      ),
    ).not.toThrow();
  });

  test("throws when an unsupported property (e.g. password) is set", () => {
    expect(() =>
      validateManagedPasswordCredentials(
        stack,
        Credentials.fromPassword("admin", "s3cr3t!"),
      ),
    ).toThrow(/only 'username' and 'encryptionKey' are allowed/);
  });
});

describe("validateManagedPasswordSnapshotCredentials", () => {
  test("does not throw when undefined", () => {
    expect(() =>
      validateManagedPasswordSnapshotCredentials(stack, undefined),
    ).not.toThrow();
  });

  test("throws when an unsupported property (e.g. generatePassword) is set", () => {
    expect(() =>
      validateManagedPasswordSnapshotCredentials(
        stack,
        SnapshotCredentials.fromGeneratedPassword("admin"),
      ),
    ).toThrow(/only 'username' and 'encryptionKey' are allowed/);
  });
});

describe("applyDefaultRotationOptions", () => {
  test("fills in the default exclude characters and vpcSubnets, options win on conflict", () => {
    const result = applyDefaultRotationOptions(
      { automaticallyAfter: undefined },
      { availabilityZones: ["us-east-1a"] },
    );
    expect(result.excludeCharacters).toEqual(DEFAULT_PASSWORD_EXCLUDE_CHARS);
    expect(result.vpcSubnets).toEqual({ availabilityZones: ["us-east-1a"] });
  });

  test("explicit options override the computed defaults", () => {
    const result = applyDefaultRotationOptions({ excludeCharacters: "@" });
    expect(result.excludeCharacters).toEqual("@");
  });
});

describe("setupS3ImportExport", () => {
  test("creates separate import/export roles by default and grants bucket access", () => {
    const importBucket = new Bucket(stack, "ImportBucket");
    const exportBucket = new Bucket(stack, "ExportBucket");

    const { s3ImportRole, s3ExportRole } = setupS3ImportExport(
      stack,
      { s3ImportBuckets: [importBucket], s3ExportBuckets: [exportBucket] },
      false,
    );

    expect(s3ImportRole).toBeDefined();
    expect(s3ExportRole).toBeDefined();
    expect(s3ImportRole).not.toBe(s3ExportRole);

    const t = new Template(stack, { snapshot: true });
    t.expectResources(iamRole.IamRole).toHaveLength(2);
  });

  test("combineRoles reuses a single role for both import and export", () => {
    const bucket = new Bucket(stack, "Bucket");

    const { s3ImportRole, s3ExportRole } = setupS3ImportExport(
      stack,
      { s3ImportBuckets: [bucket] },
      true,
    );
    const combined = setupS3ImportExport(
      stack,
      { s3ExportBuckets: [bucket], s3ImportRole },
      true,
    );

    expect(s3ExportRole).toBeUndefined();
    expect(combined.s3ExportRole).toBe(s3ImportRole);
  });

  test("throws when both s3ImportRole and s3ImportBuckets are specified", () => {
    const bucket = new Bucket(stack, "Bucket");
    const role = new iam.Role(stack, "ExistingRole", {
      assumedBy: new iam.ServicePrincipal("rds.amazonaws.com"),
    });

    expect(() =>
      setupS3ImportExport(
        stack,
        { s3ImportBuckets: [bucket], s3ImportRole: role },
        false,
      ),
    ).toThrow(/Only one of s3ImportRole or s3ImportBuckets must be specified/);
  });

  test("throws when both s3ExportRole and s3ExportBuckets are specified", () => {
    const bucket = new Bucket(stack, "Bucket");
    const role = new iam.Role(stack, "ExistingRole", {
      assumedBy: new iam.ServicePrincipal("rds.amazonaws.com"),
    });

    expect(() =>
      setupS3ImportExport(
        stack,
        { s3ExportBuckets: [bucket], s3ExportRole: role },
        false,
      ),
    ).toThrow(/Only one of s3ExportRole or s3ExportBuckets must be specified/);
  });
});
