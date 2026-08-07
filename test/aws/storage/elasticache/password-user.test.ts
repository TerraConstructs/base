// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/password-user.test.ts

import { elasticacheUser } from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as elasticache from "../../../../src/aws/storage/elasticache";
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

describe("PasswordUser", () => {
  describe("validation errors", () => {
    test.each([
      {
        testDescription: "when no passwords provided throws validation error",
        passwords: [],
        errorMessage: "Password authentication requires 1-2 passwords.",
      },
      {
        testDescription:
          "when more than 2 passwords provided throws validation error",
        passwords: [
          "secretvalue-1234",
          "secretvalue-12345",
          "secretvalue-123456",
        ],
        errorMessage: "Password authentication requires 1-2 passwords.",
      },
    ])("$testDescription", ({ passwords, errorMessage }) => {
      expect(
        () =>
          new elasticache.PasswordUser(stack, "TestUser", {
            userId: "test-user",
            accessControl:
              elasticache.AccessControl.fromAccessString("on ~* +@all"),
            passwords,
          }),
      ).toThrow(errorMessage);
    });
  });

  describe("constructor", () => {
    test("creates user with minimal required properties (single password)", () => {
      new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["secretvalue-1234"],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(elasticacheUser.ElasticacheUser, {
        engine: "valkey",
        user_id: "test-user",
        user_name: "test-user",
        access_string: "on ~* +@all",
        authentication_mode: {
          type: "password",
          passwords: ["secretvalue-1234"],
        },
        no_password_required: false,
      });
    });

    test("creates user with two passwords", () => {
      new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["secretvalue-1234", "secretvalue-12345"],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(elasticacheUser.ElasticacheUser, {
        authentication_mode: {
          type: "password",
          passwords: ["secretvalue-1234", "secretvalue-12345"],
        },
      });
    });

    test("creates user with all possible properties", () => {
      new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        accessControl: elasticache.AccessControl.fromAccessString(
          "on ~app:* +@read +@write",
        ),
        engine: elasticache.UserEngine.REDIS,
        userName: "test-user-name",
        passwords: ["my-secret"],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(elasticacheUser.ElasticacheUser, {
        engine: "redis",
        user_id: "test-user",
        user_name: "test-user-name",
        access_string: "on ~app:* +@read +@write",
        authentication_mode: {
          type: "password",
          passwords: ["my-secret"],
        },
        no_password_required: false,
      });
    });

    test("creates exactly one ElastiCache user resource", () => {
      new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["my-secret"],
      });

      const t = new Template(stack);
      t.resourceCountIs(elasticacheUser.ElasticacheUser, 1);
    });

    // TERRACONSTRUCTS DEVIATION: not present upstream — `userId` is lowercased at synth (see the
    // `TERRACONSTRUCTS DEVIATION` note on `PasswordUser.userId` in `../../../../src/aws/storage/
    // elasticache/password-user.ts`). `userName` still defaults from `props.userId` in its
    // original casing (byte-close to upstream), so it is unaffected by the `userId` lowercasing.
    test("lowercases a mixed-case userId to avoid a perpetual Terraform diff", () => {
      const user = new elasticache.PasswordUser(stack, "TestUser", {
        userId: "Test-User",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["my-secret"],
      });

      expect(user.userId).toBe("test-user");
      expect(user.userName).toBe("Test-User");
    });

    // A Token-valued userId must be passed through untouched -- lowercasing it would corrupt the
    // cdktn `${TfToken[...]}` marker and break Terraform's reference resolution.
    test("passes through a deploy-time (Token) userId without lowercasing it", () => {
      const parameter = new TerraformVariable(stack, "Parameter", {
        type: "string",
      });
      const tokenValue = parameter.stringValue;
      const user = new elasticache.PasswordUser(stack, "TestUser", {
        userId: tokenValue,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["my-secret"],
      });

      expect(user.userId).toEqual(tokenValue);
      Template.synth(stack).toHaveResourceWithProperties(
        elasticacheUser.ElasticacheUser,
        {
          user_id: stack.resolve(tokenValue),
        },
      );
    });
  });

  describe("properties", () => {
    test("exposes correct properties", () => {
      const user = new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user-id",
        userName: "test-user-name",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~app:* +@read"),
        passwords: ["secretvalue-1234"],
      });

      expect(user.userId).toBe("test-user-id");
      expect(user.userName).toBe("test-user-name");
      expect(user.engine?.engineType).toBe("valkey");
      expect(user.accessString).toBe("on ~app:* +@read");
      expect(user.userArn).toBeDefined();
      // TODO: omitted — upstream asserts `user.userStatus` is defined. `userStatus` has no
      // Terraform-provider equivalent and is dropped from this port — see the `TODO: omitted` note
      // on `PasswordUser` in `../../../../src/aws/storage/elasticache/password-user.ts`.
    });

    test("userName defaults to userId when not provided", () => {
      const user = new elasticache.PasswordUser(stack, "TestUser", {
        userId: "my-user-id",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["my-secret"],
      });

      expect(user.userName).toBe("my-user-id");
      expect(user.engine?.engineType).toBe("redis");
    });

    test("handles multiple passwords", () => {
      new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["elasticache/user/password", "plaintext-password"],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(elasticacheUser.ElasticacheUser, {
        authentication_mode: {
          type: "password",
          passwords: ["elasticache/user/password", "plaintext-password"],
        },
      });
    });
  });

  describe("isPasswordUser", () => {
    test("returns true for PasswordUser instances", () => {
      const user = new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["my-secret"],
      });

      expect(elasticache.PasswordUser.isPasswordUser(user)).toBe(true);
    });

    test("returns false for non-PasswordUser objects", () => {
      expect(elasticache.PasswordUser.isPasswordUser({})).toBe(false);
      expect(elasticache.PasswordUser.isPasswordUser(null)).toBe(false);
      expect(elasticache.PasswordUser.isPasswordUser(undefined)).toBe(false);
      expect(elasticache.PasswordUser.isPasswordUser("string")).toBe(false);
      expect(elasticache.PasswordUser.isPasswordUser(123)).toBe(false);
    });

    test("returns false for imported users (not actual PasswordUser instances)", () => {
      const importedUser = elasticache.PasswordUser.fromUserId(
        stack,
        "ImportedUser",
        "test-user",
      );

      expect(elasticache.PasswordUser.isPasswordUser(importedUser)).toBe(false);
    });
  });

  describe("import methods", () => {
    test("fromUserAttributes works with valid userArn", () => {
      const user = elasticache.PasswordUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userArn: "arn:aws:elasticache:us-east-1:123456789012:user:my-user",
        },
      );

      expect(user.userId).toBe("my-user");
      expect(user.userArn).toBe(
        "arn:aws:elasticache:us-east-1:123456789012:user:my-user",
      );
      expect(user.userName).toBe(undefined);
      expect(user.engine).toBe(undefined);
    });

    test("fromUserAttributes works with userId only", () => {
      const user = elasticache.PasswordUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "imported-user",
        },
      );

      expect(user.userId).toBe("imported-user");
      expect(user.userArn).toContain("imported-user");
      expect(user.userName).toBe(undefined);
      expect(user.engine).toBe(undefined);
    });

    test("fromUserAttributes preserves engine when provided", () => {
      const user = elasticache.PasswordUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "test-user",
          engine: elasticache.UserEngine.REDIS,
        },
      );

      expect(user.engine).toBe(elasticache.UserEngine.REDIS);
    });

    test("fromUserAttributes preserves userName when provided", () => {
      const user = elasticache.PasswordUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "test-user",
          userName: "custom-name",
        },
      );

      expect(user.userName).toBe("custom-name");
    });

    test("fromUserAttributes works with both engine and userName", () => {
      const user = elasticache.PasswordUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "test-user",
          engine: elasticache.UserEngine.REDIS,
          userName: "custom-name",
        },
      );

      expect(user.userId).toBe("test-user");
      expect(user.engine).toBe(elasticache.UserEngine.REDIS);
      expect(user.userName).toBe("custom-name");
    });

    test("fromUserAttributes with userArn preserves additional attributes", () => {
      const arn = "arn:aws:elasticache:us-east-1:123456789012:user:my-user";
      const user = elasticache.PasswordUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userArn: arn,
          engine: elasticache.UserEngine.VALKEY,
          userName: "display-name",
        },
      );

      expect(user.userArn).toBe(arn);
      expect(user.userId).toBe("my-user");
      expect(user.engine?.engineType).toBe("valkey");
      expect(user.userName).toBe("display-name");
    });

    test("fromUserId creates user with correct properties", () => {
      const user = elasticache.PasswordUser.fromUserId(
        stack,
        "ImportedUser",
        "my-user-id",
      );

      expect(user.userId).toBe("my-user-id");
      expect(user.userArn).toContain("my-user-id");
      expect(user.userName).toBe(undefined);
      expect(user.engine).toBe(undefined);
    });

    test("fromUserArn creates user with correct properties", () => {
      const arn = "arn:aws:elasticache:us-west-2:123456789012:user:test-user";
      const user = elasticache.PasswordUser.fromUserArn(
        stack,
        "ImportedUser",
        arn,
      );

      expect(user.userId).toBe("test-user");
      expect(user.userArn).toBe(arn);
      expect(user.userName).toBe(undefined);
      expect(user.engine).toBe(undefined);
    });

    test.each([
      {
        testDescription:
          "when passing both userId and userArn throws validation error",
        userArn: "arn:aws:elasticache:us-east-1:999999999999:user:test-user",
        userId: "test-user",
        errorMessage: "Only one of userArn or userId can be provided.",
      },
      {
        testDescription:
          "when passing neither userId nor userArn throws validation error",
        errorMessage: "One of userId or userArn is required.",
      },
      {
        testDescription:
          "when passing invalid userArn (no user id) throws validation error",
        userArn: "arn:aws:elasticache:us-east-1:999999999999:user",
        errorMessage: "Unable to extract user id from ARN.",
      },
    ])("$testDescription", ({ userArn, userId, errorMessage }) => {
      expect(() =>
        elasticache.PasswordUser.fromUserAttributes(stack, "ImportedUser", {
          userArn,
          userId,
        }),
      ).toThrow(errorMessage);
    });
  });
});
