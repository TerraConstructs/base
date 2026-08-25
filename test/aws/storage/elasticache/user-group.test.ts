// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/user-group.test.ts

import { elasticacheUserGroup } from "@cdktn/provider-aws";
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
  // TODO: omitted — upstream's `beforeEach` also acknowledges the CDK `Validations` aspect
  // `CloudFormation-Validate::F3032` ("Required array is empty") via `Validations.of(stack)
  // .acknowledge(...)`. This is a CFN-template cfn-lint-integration validation aspect with no
  // TerraConstructs equivalent (Terraform has no analogous synth-time template linter), so it is
  // dropped rather than mapped —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/user-group.test.ts#L9-L12
});

describe("UserGroup", () => {
  describe("validation errors", () => {
    test.each([
      {
        testDescription:
          "when Redis user group contains non-Redis user throws validation error",
        engine: elasticache.UserEngine.REDIS,
        userEngine: elasticache.UserEngine.VALKEY,
        errorMessage: "Redis user group can only contain Redis users.",
      },
    ])("$testDescription", ({ engine, userEngine, errorMessage }) => {
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        engine: userEngine,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      expect(() => {
        new elasticache.UserGroup(stack, "TestUserGroup", {
          engine,
          users: [user],
        });
        Template.fromStack(stack);
      }).toThrow(errorMessage);
    });

    test("when Redis user group does not contain default user throws validation error", () => {
      const users = [
        new elasticache.IamUser(stack, "TestUser1", {
          userId: "user1",
          userName: "user1",
          engine: elasticache.UserEngine.REDIS,
          accessControl:
            elasticache.AccessControl.fromAccessString("on ~* +@all"),
        }),
      ];

      expect(() => {
        new elasticache.UserGroup(stack, "TestUserGroup", {
          engine: elasticache.UserEngine.REDIS,
          users: users,
        });
        Template.fromStack(stack);
      }).toThrow(
        'Redis user groups need to contain a user with the user name "default".',
      );
    });

    test("when Redis user group does not contain any users throws validation error", () => {
      expect(() => {
        new elasticache.UserGroup(stack, "TestUserGroup", {
          engine: elasticache.UserEngine.REDIS,
          users: [],
        });
        Template.fromStack(stack);
      }).toThrow(
        'Redis user groups need to contain a user with the user name "default".',
      );
    });

    test("when Redis user group have users prop as undefined throws validation error", () => {
      expect(() => {
        new elasticache.UserGroup(stack, "TestUserGroup", {
          engine: elasticache.UserEngine.REDIS,
        });
        Template.fromStack(stack);
      }).toThrow(
        'Redis user groups need to contain a user with the user name "default".',
      );
    });

    test("when user group has duplicate usernames throws validation error", () => {
      const users = [
        new elasticache.PasswordUser(stack, "TestUser1", {
          userId: "user1",
          userName: "duplicate-name",
          engine: elasticache.UserEngine.VALKEY,
          accessControl:
            elasticache.AccessControl.fromAccessString("on ~* +@all"),
          passwords: ["newpasswordforuser1"],
        }),
        new elasticache.PasswordUser(stack, "TestUser2", {
          userId: "user2",
          userName: "duplicate-name",
          engine: elasticache.UserEngine.VALKEY,
          accessControl:
            elasticache.AccessControl.fromAccessString("on ~* +@all"),
          passwords: ["newpasswordforuser2"],
        }),
      ];

      expect(() => {
        new elasticache.UserGroup(stack, "TestUserGroup", {
          engine: elasticache.UserEngine.VALKEY,
          users: users,
        });
        Template.fromStack(stack);
      }).toThrow("User group cannot have users with the same user name.");
    });

    test("when REDIS user group has duplicate usernames and do not contain default user throws validation error", () => {
      const users = [
        new elasticache.NoPasswordUser(stack, "TestUser1", {
          userId: "user1",
          userName: "duplicate-name",
          engine: elasticache.UserEngine.REDIS,
          accessControl:
            elasticache.AccessControl.fromAccessString("on ~* +@all"),
        }),
        new elasticache.NoPasswordUser(stack, "TestUser2", {
          userId: "user2",
          userName: "duplicate-name",
          engine: elasticache.UserEngine.REDIS,
          accessControl:
            elasticache.AccessControl.fromAccessString("on ~* +@all"),
        }),
      ];

      expect(() => {
        new elasticache.UserGroup(stack, "TestUserGroup", {
          engine: elasticache.UserEngine.REDIS,
          users: users,
        });
        Template.fromStack(stack);
      }).toThrow("User group cannot have users with the same user name.");
    });

    test.each([
      {
        testDescription:
          "when passing both userGroupName and userGroupArn throws validation error",
        userGroupArn:
          "arn:aws:elasticache:us-east-1:999999999999:usergroup:test-group",
        userGroupName: "test-group",
        errorMessage:
          "Only one of userGroupArn or userGroupName can be provided.",
      },
      {
        testDescription:
          "when passing neither userGroupName nor userGroupArn throws validation error",
        errorMessage: "One of userGroupName or userGroupArn is required.",
      },
      {
        testDescription:
          "when passing invalid userGroupArn (no group name) throws validation error",
        userGroupArn: "arn:aws:elasticache:us-east-1:999999999999:usergroup",
        errorMessage: "Unable to extract user group name from ARN.",
      },
    ])("$testDescription", ({ userGroupArn, userGroupName, errorMessage }) => {
      expect(() =>
        elasticache.UserGroup.fromUserGroupAttributes(
          stack,
          "ImportedUserGroup",
          { userGroupArn, userGroupName },
        ),
      ).toThrow(errorMessage);
    });

    test("when adding non-Redis user to Redis group throws validation error", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        engine: elasticache.UserEngine.REDIS,
      });
      const valkeyUser = new elasticache.IamUser(stack, "ValkeyUser", {
        userId: "valkey-user",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      expect(() => {
        userGroup.addUser(valkeyUser);
        Template.fromStack(stack);
      }).toThrow("Redis user group can only contain Redis users.");
    });
  });

  describe("constructor", () => {
    test("creates Valkey user group with minimal required properties", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup");

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          engine: "valkey",
          user_group_id: stack.resolve(userGroup.userGroupName),
        },
      );
    });

    test("creates Redis user group with empty UserIds array when the input users property is empty", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        users: [],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          engine: "valkey",
          user_group_id: stack.resolve(userGroup.userGroupName),
          user_ids: [],
        },
      );
    });

    test("creates Redis user group with minimal required properties", () => {
      const user = new elasticache.NoPasswordUser(stack, "TestUser", {
        userId: "default",
        engine: elasticache.UserEngine.REDIS,
        accessControl: elasticache.AccessControl.fromAccessString(
          "on ~app:* +@read +@write",
        ),
      });

      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        engine: elasticache.UserEngine.REDIS,
        users: [user],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          engine: "redis",
          user_group_id: stack.resolve(userGroup.userGroupName),
          user_ids: [stack.resolve(user.userId)],
        },
      );
    });

    test("creates user group with all possible properties", () => {
      const user = new elasticache.PasswordUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["secretvalue-123456"],
      });

      new elasticache.UserGroup(stack, "TestUserGroup", {
        userGroupName: "my-user-group",
        engine: elasticache.UserEngine.VALKEY,
        users: [user],
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          engine: "valkey",
          user_group_id: "my-user-group",
          user_ids: ["test-user"],
        },
      );
    });

    test("creates Valkey user group with both Redis and Valkey users", () => {
      const redisUser = new elasticache.NoPasswordUser(stack, "RedisUser", {
        userId: "redis-user",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const valkeyUser1 = new elasticache.PasswordUser(stack, "ValkeyUser1", {
        userId: "valkey-user1",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
        passwords: ["secretvalue-123456"],
      });

      const valkeyUser2 = new elasticache.IamUser(stack, "ValkeyUser2", {
        userId: "valkey-user2",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        users: [redisUser, valkeyUser1, valkeyUser2],
      });

      expect(userGroup.users).toHaveLength(3);
      expect(userGroup.users![0].userId).toBe("redis-user");
      expect(userGroup.users![1].userId).toBe("valkey-user1");
      expect(userGroup.users![2].userId).toBe("valkey-user2");

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          engine: "valkey",
          user_ids: [
            stack.resolve(redisUser.userId),
            stack.resolve(valkeyUser1.userId),
            stack.resolve(valkeyUser2.userId),
          ],
        },
      );
    });

    test("creates exactly one ElastiCache user group resource", () => {
      new elasticache.UserGroup(stack, "TestUserGroup");

      const t = new Template(stack);
      t.resourceCountIs(elasticacheUserGroup.ElasticacheUserGroup, 1);
    });
  });

  describe("properties", () => {
    test("exposes correct properties", () => {
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        userGroupName: "my-group",
        engine: elasticache.UserEngine.VALKEY,
        users: [user],
      });

      expect(userGroup.userGroupName).toBe("my-group");
      expect(userGroup.engine?.engineType).toBe("valkey");
      expect(userGroup.users).toHaveLength(1);
      expect(userGroup.users![0].userId).toBe("test-user");
      expect(userGroup.userGroupArn).toBeDefined();
      // TODO: omitted — upstream asserts `userGroup.userGroupStatus` is defined.
      // `userGroupStatus` has no Terraform-provider equivalent and is dropped from this port — see
      // the `TODO: omitted` note on `UserGroup` in `../../../../src/aws/storage/elasticache/
      // user-group.ts`.
    });

    test("defaults to Valkey engine when not specified", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup");

      expect(userGroup.engine).toBe(elasticache.UserEngine.VALKEY);
    });

    test("generates userGroupName when not provided", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup");

      expect(userGroup.userGroupName).toBeDefined();
      expect(typeof userGroup.userGroupName).toBe("string");
    });

    // TERRACONSTRUCTS DEVIATION: upstream's "show what the token actually contains" test resolves
    // a plain-CDK `Names.uniqueResourceName()`-derived Token to the exact string `'testusergroup'`.
    // This repo's `stack.uniqueResourceName()` uses a different (gridUUID/path-hash-based)
    // algorithm — see the `TERRACONSTRUCTS DEVIATION` note on `UserGroup.userGroupName` in
    // `../../../../src/aws/storage/elasticache/user-group.ts` — so the resolved value only needs
    // to be a lowercase, deterministic string derived from the construct path, not the literal
    // upstream value.
    test("generated userGroupName is a lowercase, deterministic value", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup");

      const resolved = stack.resolve(userGroup.userGroupName);
      expect(resolved).toEqual(resolved.toLowerCase());
      expect(resolved.length).toBeLessThanOrEqual(40);

      // deterministic: an identically-named construct in a fresh stack resolves the same way
      const otherApp = Testing.app();
      const otherStack = new AwsStack(otherApp, "MyStack", {
        environmentName,
        gridUUID,
        providerConfig,
        gridBackendConfig,
      });
      const otherUserGroup = new elasticache.UserGroup(
        otherStack,
        "TestUserGroup",
      );
      expect(otherStack.resolve(otherUserGroup.userGroupName)).toEqual(
        resolved,
      );
    });

    // TERRACONSTRUCTS DEVIATION: upstream only lowercases the GENERATED name (`Names
    // .uniqueResourceName(...).toLocaleLowerCase()`); an explicit `userGroupName` is passed through
    // verbatim. This port lowercases BOTH cases -- see the `TERRACONSTRUCTS DEVIATION` note on
    // `UserGroup.userGroupName` in `../../../../src/aws/storage/elasticache/user-group.ts` -- to
    // avoid a perpetual Terraform diff against the provider-side lowercased `UserGroupId`.
    test("lowercases an explicit mixed-case userGroupName to avoid a perpetual Terraform diff", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        userGroupName: "MyUserGroup",
      });

      expect(userGroup.userGroupName).toEqual("myusergroup");
      Template.synth(stack).toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          user_group_id: "myusergroup",
        },
      );
    });

    test("correctly creates a user group with a deploy-time value for its name", () => {
      const parameter = new TerraformVariable(stack, "Parameter", {
        type: "string",
      });
      new elasticache.UserGroup(stack, "TestUserGroup", {
        userGroupName: parameter.stringValue,
      });

      // A Token-valued name must be passed through untouched -- lowercasing it would corrupt the
      // cdktn `${TfToken[...]}` marker and break Terraform's reference resolution.
      Template.synth(stack).toHaveResourceWithProperties(
        elasticacheUserGroup.ElasticacheUserGroup,
        {
          user_group_id: stack.resolve(parameter.stringValue),
        },
      );
    });
  });

  describe("addUser", () => {
    test("adds user to group successfully", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        engine: elasticache.UserEngine.VALKEY,
      });
      const user = new elasticache.NoPasswordUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      userGroup.addUser(user);

      expect(userGroup.users).toHaveLength(1);
      expect(userGroup.users![0].userId).toBe(user.userId);
    });

    test("adds second user to group that already has one user", () => {
      const existingUser = new elasticache.NoPasswordUser(
        stack,
        "ExistingUser",
        {
          userId: "existing-user",
          engine: elasticache.UserEngine.REDIS,
          accessControl:
            elasticache.AccessControl.fromAccessString("on ~* +@all"),
        },
      );

      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup", {
        engine: elasticache.UserEngine.VALKEY,
        users: [existingUser],
      });

      const newUser = new elasticache.NoPasswordUser(stack, "NewUser", {
        userId: "new-user",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      userGroup.addUser(newUser);

      expect(userGroup.users).toHaveLength(2);
      expect(userGroup.users![0].userId).toBe("existing-user");
      expect(userGroup.users![1].userId).toBe("new-user");
    });
  });

  describe("isUserGroup", () => {
    test("returns true for UserGroup instances", () => {
      const userGroup = new elasticache.UserGroup(stack, "TestUserGroup");

      expect(elasticache.UserGroup.isUserGroup(userGroup)).toBe(true);
    });

    test("returns false for non-UserGroup objects", () => {
      expect(elasticache.UserGroup.isUserGroup({})).toBe(false);
      expect(elasticache.UserGroup.isUserGroup(null)).toBe(false);
      expect(elasticache.UserGroup.isUserGroup(undefined)).toBe(false);
      expect(elasticache.UserGroup.isUserGroup("string")).toBe(false);
      expect(elasticache.UserGroup.isUserGroup(123)).toBe(false);
    });

    test("returns false for imported user groups (not actual UserGroup instances)", () => {
      const importedUserGroup = elasticache.UserGroup.fromUserGroupName(
        stack,
        "ImportedUserGroup",
        "test-group",
      );

      expect(elasticache.UserGroup.isUserGroup(importedUserGroup)).toBe(false);
    });
  });

  describe("import methods", () => {
    test("fromUserGroupAttributes works with valid userGroupArn", () => {
      const userGroup = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "ImportedUserGroup",
        {
          userGroupArn:
            "arn:aws:elasticache:us-east-1:123456789012:usergroup:my-group",
        },
      );

      expect(userGroup.userGroupName).toBe("my-group");
      expect(userGroup.userGroupArn).toBe(
        "arn:aws:elasticache:us-east-1:123456789012:usergroup:my-group",
      );
      expect(userGroup.engine).toBe(undefined);
      expect(userGroup.users).toBe(undefined);
    });

    test("fromUserGroupAttributes works with userGroupName only", () => {
      const userGroup = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "ImportedUserGroup",
        {
          userGroupName: "imported-group",
        },
      );

      expect(userGroup.userGroupName).toBe("imported-group");
      expect(userGroup.userGroupArn).toContain("imported-group");
      expect(userGroup.engine).toBe(undefined);
      expect(userGroup.users).toBe(undefined);
    });

    test("fromUserGroupAttributes preserves engine when provided", () => {
      const userGroup = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "ImportedUserGroup",
        {
          userGroupName: "test-group",
          engine: elasticache.UserEngine.REDIS,
        },
      );

      expect(userGroup.engine).toBe(elasticache.UserEngine.REDIS);
    });

    test("fromUserGroupAttributes preserves users when provided", () => {
      const user = new elasticache.NoPasswordUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const userGroup = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "ImportedUserGroup",
        {
          userGroupName: "test-group",
          users: [user],
        },
      );

      expect(userGroup.users).toHaveLength(1);
      expect(userGroup.users![0].userId).toBe(user.userId);
    });

    test("fromUserGroupAttributes works with both engine and users", () => {
      const user = new elasticache.NoPasswordUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const userGroup = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "ImportedUserGroup",
        {
          userGroupName: "test-group",
          engine: elasticache.UserEngine.VALKEY,
          users: [user],
        },
      );

      expect(userGroup.userGroupName).toBe("test-group");
      expect(userGroup.userGroupArn).toContain("test-group");
      expect(userGroup.engine).toBe(elasticache.UserEngine.VALKEY);
      expect(userGroup.users).toHaveLength(1);
      expect(userGroup.users![0].userId).toBe(user.userId);
    });

    test("fromUserGroupAttributes with userGroupArn preserves additional attributes", () => {
      const arn =
        "arn:aws:elasticache:us-east-1:123456789012:usergroup:my-group";
      const user = new elasticache.NoPasswordUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const userGroup = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "ImportedUserGroup",
        {
          userGroupArn: arn,
          engine: elasticache.UserEngine.VALKEY,
          users: [user],
        },
      );

      expect(userGroup.userGroupArn).toBe(arn);
      expect(userGroup.userGroupName).toBe("my-group");
      expect(userGroup.engine?.engineType).toBe("valkey");
      expect(userGroup.users).toHaveLength(1);
      expect(userGroup.users![0].userId).toBe(user.userId);
    });

    test("fromUserGroupName creates user group with correct properties", () => {
      const userGroup = elasticache.UserGroup.fromUserGroupName(
        stack,
        "ImportedUserGroup",
        "my-group-name",
      );

      expect(userGroup.userGroupName).toBe("my-group-name");
      expect(userGroup.userGroupArn).toContain("my-group-name");
      expect(userGroup.engine).toBe(undefined);
      expect(userGroup.users).toBe(undefined);
    });

    test("fromUserGroupArn creates user group with correct properties", () => {
      const arn =
        "arn:aws:elasticache:us-west-2:123456789012:usergroup:test-group";
      const userGroup = elasticache.UserGroup.fromUserGroupArn(
        stack,
        "ImportedUserGroup",
        arn,
      );

      expect(userGroup.userGroupName).toBe("test-group");
      expect(userGroup.userGroupArn).toBe(arn);
      expect(userGroup.engine).toBe(undefined);
      expect(userGroup.users).toBe(undefined);
    });

    test("imported user groups cannot add users", () => {
      const importedUserGroup = elasticache.UserGroup.fromUserGroupName(
        stack,
        "ImportedUserGroup",
        "test-group",
      );
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      expect(() => importedUserGroup.addUser(user)).toThrow(
        "Cannot add users to an imported UserGroup. Only UserGroups created in this stack can be modified.",
      );
    });
  });

  describe("UserEngine class", () => {
    test("of() returns an instance with the expected engineType", () => {
      const engine = elasticache.UserEngine.of("redis");
      expect(engine.engineType).toBe("redis");
    });

    test("of() supports arbitrary engines", () => {
      const engine = elasticache.UserEngine.of("futureengine");
      expect(engine.engineType).toBe("futureengine");
    });

    test("named static members expose the correct engineType", () => {
      expect(elasticache.UserEngine.VALKEY.engineType).toBe("valkey");
      expect(elasticache.UserEngine.REDIS.engineType).toBe("redis");
    });

    test("toString() returns the engineType", () => {
      expect(elasticache.UserEngine.VALKEY.toString()).toBe("valkey");
      expect(elasticache.UserEngine.REDIS.toString()).toBe("redis");
    });

    test("of() does not return the same instance as a named static member", () => {
      expect(elasticache.UserEngine.of("redis")).not.toBe(
        elasticache.UserEngine.REDIS,
      );
      expect(elasticache.UserEngine.of("valkey")).not.toBe(
        elasticache.UserEngine.VALKEY,
      );
    });

    test("fromUserGroupAttributes preserves engine when constructed via UserEngine.of()", () => {
      const customEngine = elasticache.UserEngine.of("redis");
      const imported = elasticache.UserGroup.fromUserGroupAttributes(
        stack,
        "Imported",
        {
          userGroupName: "my-group",
          engine: customEngine,
        },
      );

      expect(imported.engine).toBe(customEngine);
      expect(imported.engine?.engineType).toBe("redis");
    });
  });
});
