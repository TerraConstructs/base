import {
  iamUser,
  iamUserPolicy,
  iamUserGroupMembership,
} from "@cdktf/provider-aws";
import { App, SecretValue, Token, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  User,
  ManagedPolicy,
  Policy,
  PolicyStatement,
  Group,
} from "../../../src/aws/iam";
import { Template } from "../../assertions";
import { TestResource } from "../../test-resource";

describe("IAM user", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName: "Test",
      gridUUID: "test-uuid",
      providerConfig: { region: "us-east-1" },
      gridBackendConfig: { address: "http://localhost" },
    });
  });
  test("default user", () => {
    new User(stack, "MyUser");
    const t = new Template(stack);
    t.expect.toHaveResource(iamUser.IamUser);
  });

  test("default user with password", () => {
    new User(stack, "MyUser", {
      password: SecretValue.unsafePlainText("1234"),
    });
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(iamUser.IamUser, {
      login_profile: { password: "1234" },
    });
  });

  test("fails if reset password is required but no password is set", () => {
    expect(
      () => new User(stack, "MyUser", { passwordResetRequired: true }),
    ).toThrow();
  });

  test("create with managed policy", () => {
    new User(stack, "MyUser", {
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(stack, "UserPolicy", "asdf"),
      ],
    });
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(iamUser.IamUser, {
      managed_policy_arns: [
        {
          "Fn::Join": [
            "",
            ["arn:", { Ref: "AWS::Partition" }, ":iam::aws:policy/asdf"],
          ],
        },
      ],
    });
  });

  test("can supply permissions boundary managed policy", () => {
    const permissionsBoundary = ManagedPolicy.fromAwsManagedPolicyName(
      stack,
      "UserPolicy",
      "managed-policy",
    );
    new User(stack, "MyUser", { permissionsBoundary });
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(iamUser.IamUser, {
      permissions_boundary: {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            ":iam::aws:policy/managed-policy",
          ],
        ],
      },
    });
  });

  test("user imported by user name has an ARN", () => {
    const user = User.fromUserName(stack, "import", "MyUserName");
    expect(stack.resolve(user.userArn)).toStrictEqual({
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          ":iam::",
          { Ref: "AWS::AccountId" },
          ":user/MyUserName",
        ],
      ],
    });
  });

  test("user imported by user ARN has a name", () => {
    const userName = "MyUserName";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::account-id:user/${userName}`,
    );
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by tokenized user ARN has a name", () => {
    const user = User.fromUserArn(
      stack,
      "import",
      Token.asString({ Ref: "ARN" }),
    );
    expect(stack.resolve(user.userName)).toStrictEqual({
      "Fn::Select": [1, { "Fn::Split": [":user/", { Ref: "ARN" }] }],
    });
  });

  test("user imported by user ARN has a principalAccount", () => {
    const accountId = "account-id";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::${accountId}:user/mockuser`,
    );
    expect(stack.resolve(user.principalAccount)).toStrictEqual(accountId);
  });

  test("user imported by tokenized user ARN has a principalAccount", () => {
    const user = User.fromUserArn(
      stack,
      "import",
      Token.asString({ Ref: "ARN" }),
    );
    expect(stack.resolve(user.principalAccount)).toStrictEqual({
      "Fn::Select": [4, { "Fn::Split": [":", { Ref: "ARN" }] }],
    });
  });

  test("user imported by a new User construct has a principalAccount", () => {
    const localUser = new User(stack, "LocalUser");
    const user = User.fromUserArn(stack, "import", localUser.userArn);
    expect(stack.resolve(user.principalAccount)).toStrictEqual({
      "Fn::Select": [
        4,
        { "Fn::Split": [":", { "Fn::GetAtt": ["LocalUser87F70DDF", "Arn"] }] },
      ],
    });
  });

  test("user imported by user ARN with path", () => {
    const userName = "MyUserName";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::account-id:user/path/${userName}`,
    );
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by user ARN with path (multiple elements)", () => {
    const userName = "MyUserName";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::account-id:user/p/a/t/h/${userName}`,
    );
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by tokenized user attributes has a name", () => {
    const user = User.fromUserAttributes(stack, "import", {
      userArn: Token.asString({ Ref: "ARN" }),
    });
    expect(stack.resolve(user.userName)).toStrictEqual({
      "Fn::Select": [1, { "Fn::Split": [":user/", { Ref: "ARN" }] }],
    });
  });

  test("user imported by user attributes has a name", () => {
    const userName = "MyUserName";
    const user = User.fromUserAttributes(stack, "import", {
      userArn: `arn:aws:iam::account-id:user/${userName}`,
    });
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by user attributes with path has a name", () => {
    const userName = "MyUserName";
    const user = User.fromUserAttributes(stack, "import", {
      userArn: `arn:aws:iam::account-id:user/path/${userName}`,
    });
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by user attributes with path (multiple elements) has a name", () => {
    const userName = "MyUserName";
    const user = User.fromUserAttributes(stack, "import", {
      userArn: `arn:aws:iam::account-id:user/p/a/t/h/${userName}`,
    });
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("add to policy of imported user", () => {
    const user = User.fromUserName(stack, "ImportedUser", "john");
    user.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["aws:Use"],
        resources: ["*"],
      }),
    );
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: "john",
      policy: {
        Statement: [
          {
            Action: "aws:Use",
            Effect: "Allow",
            Resource: "*",
          },
        ],
        Version: "2012-10-17",
      },
    });
  });

  test("attach policy to imported user", () => {
    const user = User.fromUserName(stack, "ImportedUser", "john");
    user.attachInlinePolicy(
      new Policy(stack, "Policy", {
        statements: [
          new PolicyStatement({
            actions: ["aws:Use"],
            resources: ["*"],
          }),
        ],
      }),
    );
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: "john",
      policy: {
        Statement: [
          {
            Action: "aws:Use",
            Effect: "Allow",
            Resource: "*",
          },
        ],
        Version: "2012-10-17",
      },
    });
  });

  test("addToGroup for imported user", () => {
    const user = User.fromUserName(stack, "ImportedUser", "john");
    const group = new Group(stack, "Group");
    const otherGroup = new Group(stack, "OtherGroup");

    user.addToGroup(group);
    otherGroup.addUser(user);

    // In TerraConstructs, group membership is expressed as separate resources.
    // Here we simply assert that two aws_iam_user_group_membership resources have been created.
    const t = new Template(stack);
    t.resourceCountIs(iamUserGroupMembership.IamUserGroupMembership, 2);
  });
});

test("cross-env user ARNs include path", () => {
  const app = Testing.app();
  const stackProps = {
    environmentName: "Test",
    gridUUID: "test-uuid",
    providerConfig: { region: "us-east-1" },
    gridBackendConfig: { address: "http://localhost" },
  };
  // env: { account: "123456789012", region: "us-east-1" },
  const userStack = new AwsStack(app, "user-stack", {
    ...stackProps,
    providerConfig: { region: "us-east-1" },
  });
  // env: { region: "us-east-2" },
  const referencerStack = new AwsStack(app, "referencer-stack", {
    ...stackProps,
    providerConfig: { region: "us-east-2" },
  });
  const user = new User(userStack, "User", {
    path: "/sample/path/",
    userName: "sample-name",
  });
  new TestResource(referencerStack, "Referencer", {
    properties: { UserArn: user.userArn },
  });

  Template.synth(referencerStack).toHaveResourceWithProperties(TestResource, {
    UserArn: {
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          ":iam::123456789012:user/sample/path/sample-name",
        ],
      ],
    },
  });
});
