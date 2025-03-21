import { App, CfnResource, SecretValue, Token, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Template } from "../../assertions";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  User,
  ManagedPolicy,
  Policy,
  PolicyStatement,
  Group,
} from "../../../src/aws/iam";

describe("IAM user", () => {
  test("default user", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack");
    new User(stack, "MyUser");
    Template.synth(stack).expect.toHaveResource("aws_iam_user");
  });

  test("default user with password", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack");
    new User(stack, "MyUser", {
      password: SecretValue.unsafePlainText("1234"),
    });
    Template.synth(stack).expect.toHaveResourceWithProperties("aws_iam_user", {
      login_profile: { password: "1234" },
    });
  });

  test("fails if reset password is required but no password is set", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack");
    expect(
      () => new User(stack, "MyUser", { passwordResetRequired: true }),
    ).toThrow();
  });

  test("create with managed policy", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack");
    new User(stack, "MyUser", {
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("asdf")],
    });
    Template.synth(stack).expect.toHaveResourceWithProperties("aws_iam_user", {
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
    const app = Testing.app();
    const stack = new AwsStack(app, "MyStack");
    const permissionsBoundary =
      ManagedPolicy.fromAwsManagedPolicyName("managed-policy");
    new User(stack, "MyUser", { permissionsBoundary });
    Template.synth(stack).expect.toHaveResourceWithProperties("aws_iam_user", {
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
    const stack = new AwsStack(Testing.app(), "MyStack");
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
    const stack = new AwsStack(Testing.app(), "MyStack");
    const userName = "MyUserName";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::account-id:user/${userName}`,
    );
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by tokenized user ARN has a name", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
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
    const stack = new AwsStack(Testing.app(), "MyStack");
    const accountId = "account-id";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::${accountId}:user/mockuser`,
    );
    expect(stack.resolve(user.principalAccount)).toStrictEqual(accountId);
  });

  test("user imported by tokenized user ARN has a principalAccount", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
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
    const stack = new AwsStack(Testing.app(), "MyStack");
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
    const stack = new AwsStack(Testing.app(), "MyStack");
    const userName = "MyUserName";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::account-id:user/path/${userName}`,
    );
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by user ARN with path (multiple elements)", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const userName = "MyUserName";
    const user = User.fromUserArn(
      stack,
      "import",
      `arn:aws:iam::account-id:user/p/a/t/h/${userName}`,
    );
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by tokenized user attributes has a name", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const user = User.fromUserAttributes(stack, "import", {
      userArn: Token.asString({ Ref: "ARN" }),
    });
    expect(stack.resolve(user.userName)).toStrictEqual({
      "Fn::Select": [1, { "Fn::Split": [":user/", { Ref: "ARN" }] }],
    });
  });

  test("user imported by user attributes has a name", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const userName = "MyUserName";
    const user = User.fromUserAttributes(stack, "import", {
      userArn: `arn:aws:iam::account-id:user/${userName}`,
    });
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by user attributes with path has a name", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const userName = "MyUserName";
    const user = User.fromUserAttributes(stack, "import", {
      userArn: `arn:aws:iam::account-id:user/path/${userName}`,
    });
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("user imported by user attributes with path (multiple elements) has a name", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const userName = "MyUserName";
    const user = User.fromUserAttributes(stack, "import", {
      userArn: `arn:aws:iam::account-id:user/p/a/t/h/${userName}`,
    });
    expect(stack.resolve(user.userName)).toStrictEqual(userName);
  });

  test("add to policy of imported user", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const user = User.fromUserName(stack, "ImportedUser", "john");
    user.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["aws:Use"],
        resources: ["*"],
      }),
    );
    Template.synth(stack).expect.toHaveResourceWithProperties(
      "aws_iam_user_policy",
      {
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
      },
    );
  });

  test("attach policy to imported user", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
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
    Template.synth(stack).expect.toHaveResourceWithProperties(
      "aws_iam_user_policy",
      {
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
      },
    );
  });

  test("addToGroup for imported user", () => {
    const stack = new AwsStack(Testing.app(), "MyStack");
    const user = User.fromUserName(stack, "ImportedUser", "john");
    const group = new Group(stack, "Group");
    const otherGroup = new Group(stack, "OtherGroup");

    user.addToGroup(group);
    otherGroup.addUser(user);

    // In TerraConstructs, group membership is expressed as separate resources.
    // Here we simply assert that two aws_iam_user_group_membership resources have been created.
    Template.synth(stack).expect.resourceCountIs(
      "aws_iam_user_group_membership",
      2,
    );
  });
});

test("cross-env user ARNs include path", () => {
  const app = Testing.app();
  const userStack = new AwsStack(app, "user-stack", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  const referencerStack = new AwsStack(app, "referencer-stack", {
    env: { region: "us-east-2" },
  });
  const user = new User(userStack, "User", {
    path: "/sample/path/",
    userName: "sample-name",
  });
  new CfnResource(referencerStack, "Referencer", {
    type: "Custom::UserReferencer",
    properties: { UserArn: user.userArn },
  });

  Template.synth(referencerStack).expect.toHaveResourceWithProperties(
    "Custom::UserReferencer",
    {
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
    },
  );
});
