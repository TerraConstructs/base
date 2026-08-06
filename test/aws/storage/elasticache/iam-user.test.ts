// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/iam-user.test.ts

import { elasticacheUser, dataAwsIamPolicyDocument } from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as iam from "../../../../src/aws/iam";
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

describe("IamUser", () => {
  describe("validation errors", () => {
    test.each([
      {
        testDescription:
          "when userName differs from userId throws validation error",
        userId: "test-user",
        userName: "different-name",
        errorMessage:
          "For IAM authentication, userName must be equal to userId.",
      },
    ])("$testDescription", ({ userId, userName, errorMessage }) => {
      expect(
        () =>
          new elasticache.IamUser(stack, "TestUser", {
            userId,
            userName,
            accessControl:
              elasticache.AccessControl.fromAccessString("on ~* +@all"),
          }),
      ).toThrow(errorMessage);
    });
  });

  describe("constructor", () => {
    test("creates user with minimal required properties", () => {
      new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(elasticacheUser.ElasticacheUser, {
        engine: "valkey",
        user_id: "test-user",
        user_name: "test-user",
        access_string: "on ~* +@all",
        authentication_mode: {
          type: "iam",
        },
        no_password_required: false,
      });
    });

    test("creates user with all possible properties", () => {
      new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        accessControl: elasticache.AccessControl.fromAccessString(
          "on ~app:* +@read +@write",
        ),
        engine: elasticache.UserEngine.REDIS,
        userName: "test-user",
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(elasticacheUser.ElasticacheUser, {
        engine: "redis",
        user_id: "test-user",
        user_name: "test-user",
        access_string: "on ~app:* +@read +@write",
        authentication_mode: {
          type: "iam",
        },
        no_password_required: false,
      });
    });

    test("creates exactly one ElastiCache user resource", () => {
      new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      const t = new Template(stack);
      t.resourceCountIs(elasticacheUser.ElasticacheUser, 1);
    });

    // TERRACONSTRUCTS DEVIATION: not present upstream — `userId` is lowercased at synth (see the
    // `TERRACONSTRUCTS DEVIATION` note on `IamUser.userId` in `../../../../src/aws/storage/
    // elasticache/iam-user.ts`). `userName` still defaults from `props.userId` in its original
    // casing (byte-close to upstream), so a mixed-case `userId` supplied without an explicit,
    // already-lowercased `userName` fails the `userName === userId` equality check below.
    test("lowercases a mixed-case userId to avoid a perpetual Terraform diff", () => {
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "Test-User",
        userName: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      expect(user.userId).toBe("test-user");
      expect(user.userName).toBe("test-user");
    });

    test("a mixed-case userId without a matching lowercase userName throws validation error", () => {
      expect(
        () =>
          new elasticache.IamUser(stack, "TestUser", {
            userId: "Test-User",
            accessControl:
              elasticache.AccessControl.fromAccessString("on ~* +@all"),
          }),
      ).toThrow(
        "For IAM authentication, userName must be equal to userId. `userId` is lowercased to 'test-user' (ElastiCache stores UserId as a lowercase string), so supply an already-lowercase `userId`, or pass a matching lowercase `userName`.",
      );
    });

    // A Token-valued userId must be passed through untouched -- lowercasing it would corrupt the
    // cdktn `${TfToken[...]}` marker and break Terraform's reference resolution. Since `userName`
    // defaults from the same unresolved token, the `userName === userId` equality check still
    // passes.
    test("passes through a deploy-time (Token) userId without lowercasing it", () => {
      const parameter = new TerraformVariable(stack, "Parameter", {
        type: "string",
      });
      const tokenValue = parameter.stringValue;
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: tokenValue,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
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
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user-id",
        userName: "test-user-id",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~app:* +@read"),
      });

      expect(user.userId).toBe("test-user-id");
      expect(user.userName).toBe("test-user-id");
      expect(user.engine?.engineType).toBe("valkey");
      expect(user.accessString).toBe("on ~app:* +@read");
      expect(user.userArn).toBeDefined();
      // TODO: omitted — upstream asserts `user.userStatus` is defined. `userStatus` has no
      // Terraform-provider equivalent and is dropped from this port — see the `TODO: omitted` note
      // on `IamUser` in `../../../../src/aws/storage/elasticache/iam-user.ts`.
    });

    test("userName defaults to userId when not provided", () => {
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "my-user-id",
        engine: elasticache.UserEngine.REDIS,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      expect(user.userName).toBe("my-user-id");
      expect(user.engine?.engineType).toBe("redis");
    });
  });

  describe("isIamUser", () => {
    test("returns true for IamUser instances", () => {
      const user = new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        engine: elasticache.UserEngine.VALKEY,
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });

      expect(elasticache.IamUser.isIamUser(user)).toBe(true);
    });

    test("returns false for non-IamUser objects", () => {
      expect(elasticache.IamUser.isIamUser({})).toBe(false);
      expect(elasticache.IamUser.isIamUser(null)).toBe(false);
      expect(elasticache.IamUser.isIamUser(undefined)).toBe(false);
      expect(elasticache.IamUser.isIamUser("string")).toBe(false);
      expect(elasticache.IamUser.isIamUser(123)).toBe(false);
    });

    test("returns false for imported users (not actual IamUser instances)", () => {
      const importedUser = elasticache.IamUser.fromUserId(
        stack,
        "ImportedUser",
        "test-user",
      );

      expect(elasticache.IamUser.isIamUser(importedUser)).toBe(false);
    });
  });

  describe("IAM permissions", () => {
    let user: elasticache.IamUser;
    let role: iam.Role;

    beforeEach(() => {
      user = new elasticache.IamUser(stack, "TestUser", {
        userId: "test-user",
        accessControl:
          elasticache.AccessControl.fromAccessString("on ~* +@all"),
      });
      role = new iam.Role(stack, "TestRole", {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      });
    });

    test("grantConnect adds correct IAM permissions", () => {
      user.grantConnect(role);

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["elasticache:Connect"],
              effect: "Allow",
              resources: [stack.resolve(user.userArn)],
            },
          ],
        },
      );
    });

    test("grant adds custom IAM permissions", () => {
      user.grant(role, "elasticache:Connect", "elasticache:DescribeUsers");

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["elasticache:Connect", "elasticache:DescribeUsers"],
              effect: "Allow",
              resources: [stack.resolve(user.userArn)],
            },
          ],
        },
      );
    });

    test("grant works with single action", () => {
      user.grant(role, "elasticache:Connect");

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["elasticache:Connect"],
              effect: "Allow",
              resources: [stack.resolve(user.userArn)],
            },
          ],
        },
      );
    });
  });

  describe("import methods", () => {
    test("fromUserAttributes works with valid userArn", () => {
      const user = elasticache.IamUser.fromUserAttributes(
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
      const user = elasticache.IamUser.fromUserAttributes(
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
      const user = elasticache.IamUser.fromUserAttributes(
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
      const user = elasticache.IamUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "test-user",
          userName: "test-user",
        },
      );

      expect(user.userName).toBe("test-user");
    });

    test("fromUserAttributes works with both engine and userName", () => {
      const user = elasticache.IamUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "test-user",
          engine: elasticache.UserEngine.REDIS,
          userName: "test-user",
        },
      );

      expect(user.userId).toBe("test-user");
      expect(user.engine).toBe(elasticache.UserEngine.REDIS);
      expect(user.userName).toBe("test-user");
    });

    test("fromUserAttributes with userArn preserves additional attributes", () => {
      const arn = "arn:aws:elasticache:us-east-1:123456789012:user:my-user";
      const user = elasticache.IamUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userArn: arn,
          engine: elasticache.UserEngine.VALKEY,
          userName: "my-user",
        },
      );

      expect(user.userArn).toBe(arn);
      expect(user.userId).toBe("my-user");
      expect(user.engine?.engineType).toBe("valkey");
      expect(user.userName).toBe("my-user");
    });

    test("fromUserId creates user with correct properties", () => {
      const user = elasticache.IamUser.fromUserId(
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
      const user = elasticache.IamUser.fromUserArn(stack, "ImportedUser", arn);

      expect(user.userId).toBe("test-user");
      expect(user.userArn).toBe(arn);
      expect(user.userName).toBe(undefined);
      expect(user.engine).toBe(undefined);
    });

    test("import methods do not validate userName equals userId constraint", () => {
      // Import methods assume external user is valid
      const user = elasticache.IamUser.fromUserAttributes(
        stack,
        "ImportedUser",
        {
          userId: "test-user",
          userName: "different-name", // This is allowed for imports
        },
      );

      expect(user.userName).toBe("different-name");
      expect(user.userId).toBe("test-user");
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
        elasticache.IamUser.fromUserAttributes(stack, "ImportedUser", {
          userArn,
          userId,
        }),
      ).toThrow(errorMessage);
    });
  });
});
