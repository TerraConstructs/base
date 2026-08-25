// Smoke tests for src/aws/storage/rds/{endpoint,perms,props}.ts — upstream has no dedicated
// endpoint.test.ts / perms.test.ts / props.test.ts (this logic is exercised indirectly via
// instance.test.ts / cluster.test.ts, which are out of scope for this port).

import { Token } from "cdktn";
import {
  CredentialsFromUsernameOptions,
  Credentials,
  Endpoint,
  EngineLifecycleSupport,
  PerformanceInsightRetention,
  SnapshotCredentials,
} from "../../../../src/aws/storage/rds";
// `perms.ts` is an internal module (not part of the public `rds` barrel, matching upstream), so it
// is imported directly here.
import { DATA_API_ACTIONS } from "../../../../src/aws/storage/rds/perms";

describe("Endpoint", () => {
  test("exposes hostname and port", () => {
    const endpoint = new Endpoint("db.example.com", 5432);
    expect(endpoint.hostname).toEqual("db.example.com");
    expect(endpoint.port).toEqual(5432);
  });

  test("socketAddress combines hostname and a resolved port", () => {
    const endpoint = new Endpoint("db.example.com", 5432);
    expect(endpoint.socketAddress).toEqual("db.example.com:5432");
  });

  test("socketAddress resolves an unresolved (Token) port", () => {
    const port = Token.asNumber({ Ref: "Port" });
    const endpoint = new Endpoint("db.example.com", port);
    expect(Token.isUnresolved(endpoint.port)).toEqual(true);
    // Each `Token.asString()` call mints a distinct token id, so compare structurally rather
    // than against a second independently-minted token string.
    expect(endpoint.socketAddress).toMatch(
      /^db\.example\.com:\$\{TfToken\[TOKEN\.\d+\]\}$/,
    );
  });
});

test("DATA_API_ACTIONS is the documented minimal rds-data permission set", () => {
  expect(DATA_API_ACTIONS).toEqual([
    "rds-data:BatchExecuteStatement",
    "rds-data:BeginTransaction",
    "rds-data:CommitTransaction",
    "rds-data:ExecuteStatement",
    "rds-data:RollbackTransaction",
  ]);
});

describe("Credentials", () => {
  test("fromGeneratedSecret sets usernameAsString and carries through options", () => {
    const creds = Credentials.fromGeneratedSecret("admin", {
      secretName: "my-secret",
      excludeCharacters: '"',
    });
    expect(creds.username).toEqual("admin");
    expect(creds.usernameAsString).toEqual(true);
    expect(creds.secretName).toEqual("my-secret");
    expect(creds.excludeCharacters).toEqual('"');
    expect(creds.password).toBeUndefined();
  });

  test("fromPassword sets username, password and usernameAsString", () => {
    const creds = Credentials.fromPassword("admin", "s3cr3t!");
    expect(creds.username).toEqual("admin");
    expect(creds.password).toEqual("s3cr3t!");
    expect(creds.usernameAsString).toEqual(true);
  });

  test("fromUsername does not force usernameAsString", () => {
    const options: CredentialsFromUsernameOptions = { password: "s3cr3t!" };
    const creds = Credentials.fromUsername("admin", options);
    expect(creds.username).toEqual("admin");
    expect(creds.password).toEqual("s3cr3t!");
    expect(creds.usernameAsString).toBeUndefined();
  });
});

describe("SnapshotCredentials", () => {
  test("fromGeneratedSecret requests generation and replacement on criteria changes", () => {
    const creds = SnapshotCredentials.fromGeneratedSecret("admin");
    expect(creds.username).toEqual("admin");
    expect(creds.generatePassword).toEqual(true);
    expect(creds.replaceOnPasswordCriteriaChanges).toEqual(true);
  });

  test("fromGeneratedPassword requests generation without forcing replacement", () => {
    const creds = SnapshotCredentials.fromGeneratedPassword("admin");
    expect(creds.username).toEqual("admin");
    expect(creds.generatePassword).toEqual(true);
    expect(creds.replaceOnPasswordCriteriaChanges).toBeUndefined();
  });

  test("fromPassword carries the given password without generation", () => {
    const creds = SnapshotCredentials.fromPassword("s3cr3t!");
    expect(creds.generatePassword).toEqual(false);
    expect(creds.password).toEqual("s3cr3t!");
  });
});

test("PerformanceInsightRetention enum values match the CloudFormation-accepted day counts", () => {
  expect(PerformanceInsightRetention.DEFAULT).toEqual(7);
  expect(PerformanceInsightRetention.MONTHS_1).toEqual(31);
  expect(PerformanceInsightRetention.MONTHS_23).toEqual(31 * 23);
  expect(PerformanceInsightRetention.LONG_TERM).toEqual(731);
});

test("EngineLifecycleSupport enum values match the RDS API string values", () => {
  expect(EngineLifecycleSupport.OPEN_SOURCE_RDS_EXTENDED_SUPPORT).toEqual(
    "open-source-rds-extended-support",
  );
  expect(
    EngineLifecycleSupport.OPEN_SOURCE_RDS_EXTENDED_SUPPORT_DISABLED,
  ).toEqual("open-source-rds-extended-support-disabled");
});
