import {
  iamUser,
  iamUserLoginProfile,
  iamUserPolicy,
  iamUserGroupMembership,
  dataAwsIamPolicyDocument,
  iamUserPolicyAttachment,
} from "@cdktf/provider-aws";
import { App, Token, Testing } from "cdktf";
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
    const user = new User(stack, "MyUser", {
      createLoginProfile: true,
      // terraform-provider-aws does not support providing password in plain text
      // password: "1234", // SecretValue.unsafePlainText("1234"),
    });
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      iamUserLoginProfile.IamUserLoginProfile,
      {
        user: stack.resolve(user.userName),
      },
    );
  });

  // // NOTE: This test is not applicable to Terraform
  // test("fails if reset password is required but no password is set", () => {
  //   expect(
  //     () => new User(stack, "MyUser", { passwordResetRequired: true }),
  //   ).toThrow();
  // });

  test("create with managed policy", () => {
    new User(stack, "MyUser", {
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(stack, "UserPolicy", "asdf"),
      ],
    });
    const t = new Template(stack);
    t.resourceCountIs(iamUser.IamUser, 1);
    t.expect.toHaveResourceWithProperties(
      iamUserPolicyAttachment.IamUserPolicyAttachment,
      {
        user: "${aws_iam_user.MyUser_DC45028B.name}",
        policy_arn:
          // "arn:{ Ref: "AWS::Partition" }:iam::aws:policy/asdf",
          "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/asdf",
      },
    );
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
      permissions_boundary:
        // "arn:{ Ref: "AWS::Partition" }:iam::aws:policy/managed-policy",
        "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/managed-policy",
    });
  });

  test("user imported by user name has an ARN", () => {
    const user = User.fromUserName(stack, "import", "MyUserName");
    expect(stack.resolve(user.userArn)).toStrictEqual(
      // "arn:{ Ref: "AWS::Partition" }:iam::{ Ref: "AWS::AccountId" }:user/MyUserName",
      "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:user/MyUserName",
    );
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
    expect(stack.resolve(user.userName)).toStrictEqual(
      '${element(split(":user/", {"Ref" = "ARN"}), 1)}',
    );
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
    expect(stack.resolve(user.principalAccount)).toStrictEqual(
      '${element(split(":", {"Ref" = "ARN"}), 4)}',
    );
  });

  test("user imported by a new User construct has a principalAccount", () => {
    const localUser = new User(stack, "LocalUser");
    const user = User.fromUserArn(stack, "import", localUser.userArn);
    expect(stack.resolve(user.principalAccount)).toStrictEqual(
      '${element(split(":", aws_iam_user.LocalUser_87F70DDF.arn), 4)}',
    );
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
    expect(stack.resolve(user.userName)).toStrictEqual(
      '${element(split(":user/", {"Ref" = "ARN"}), 1)}',
    );
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
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["aws:Use"],
            resources: ["*"],
            effect: "Allow",
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: "john",
      policy:
        "${data.aws_iam_policy_document.ImportedUser_Policy_12354FE1.json}",
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
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["aws:Use"],
            resources: ["*"],
            effect: "Allow",
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: "john",
      policy: "${data.aws_iam_policy_document.Policy_E08602BD.json}",
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
    // AWS CDK generates: "arn:{ Ref: "AWS::Partition" }":iam::123456789012:user/sample/path/sample-name",
    UserArn:
      "${data.terraform_remote_state.cross-stack-reference-input-user-stack.outputs.cross-stack-output-aws_iam_userUser_00B015A1arn}",
  });
});
