import { iamRolePolicy, dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Policy } from "../../../src/aws/iam/policy";
import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { PolicyStatement } from "../../../src/aws/iam/policy-statement";
import { ServicePrincipal } from "../../../src/aws/iam/principals";
import { Role } from "../../../src/aws/iam/role";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("IAM policy", () => {
  let stack: AwsStack;

  beforeEach(() => {
    // app = new App();
    stack = getAwsStack();
  });

  // TODO: throw Error if force is true and policy is empty
  // test('fails when "forced" policy is empty', () => {
  //   new Policy(stack, "MyPolicy", { force: true });

  //   expect(() => Testing.synth(stack)).toThrow(/is empty/);
  // });

  test("policy with statements", () => {
    const policy = new Policy(stack, "MyPolicy", {
      policyName: "MyPolicyName",
    });
    policy.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["sqs:SendMessage"] }),
    );
    policy.addStatements(
      new PolicyStatement({ resources: ["arn"], actions: ["sns:Subscribe"] }),
    );

    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("sns"),
    });
    role.attachInlinePolicy(policy);
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // NOTE: without prepareStack, the IamRolePolicy is missing!
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: ["sqs:SendMessage"],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: ["sns:Subscribe"],
            effect: "Allow",
            resources: ["arn"],
          }),
        ]),
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        name: "MyPolicyName",
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.Role"),
      },
    );
  });

  test("policy from policy document alone", () => {
    const policy = new Policy(stack, "MyPolicy", {
      policyName: "MyPolicyName",
      document: PolicyDocument.fromJson(stack, "doc", {
        Statement: [
          {
            Action: "sqs:SendMessage",
            Effect: "Allow",
            Resource: "*",
          },
        ],
      }),
    });

    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("sns"),
    });
    role.attachInlinePolicy(policy);
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();

    // NOTE: without prepareStack, the IamRolePolicy is missing!
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: ["sqs:SendMessage"],
            effect: "Allow",
            resources: ["*"],
          }),
        ]),
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        name: "MyPolicyName",
        policy: expect.stringContaining("data.aws_iam_policy_document.doc"),
        role: expect.stringContaining("aws_iam_role.Role"),
      },
    );
  });

  test("policy name can be omitted, in which case the logical id will be used", () => {
    const policy = new Policy(stack, "MyPolicy");
    policy.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["sqs:SendMessage"] }),
    );
    policy.addStatements(
      new PolicyStatement({ resources: ["arn"], actions: ["sns:Subscribe"] }),
    );

    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("sns"),
    });
    role.attachInlinePolicy(policy);

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // NOTE: without prepareStack, the IamRolePolicy is missing!
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            actions: ["sqs:SendMessage"],
            effect: "Allow",
            resources: ["*"],
          }),
          expect.objectContaining({
            actions: ["sns:Subscribe"],
            effect: "Allow",
            resources: ["arn"],
          }),
        ]),
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        name: expect.stringContaining("TestStackMyPolicy"),
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.Role"),
      },
    );
  });

  test("policy can be attached users, groups and roles and added permissions via props", () => {
    // const user1 = new User(stack, "User1");
    // const group1 = new Group(stack, "Group1");
    const role1 = new Role(stack, "Role1", {
      assumedBy: new ServicePrincipal("test.service"),
    });
    const role2 = new Role(stack, "Role2", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    new Policy(stack, "MyTestPolicy", {
      policyName: "Foo",
      // users: [user1],
      // groups: [group1],
      roles: [role1, role2],
      statements: [
        new PolicyStatement({
          resources: ["*"],
          actions: ["dynamodb:PutItem"],
        }),
      ],
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // NOTE: without prepareStack, the IamRolePolicy is missing!
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: expect.arrayContaining([
          expect.objectContaining({
            resources: ["*"],
            actions: ["dynamodb:PutItem"],
          }),
        ]),
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        name: "Foo",
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyTestPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.Role1"),
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        name: "Foo",
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyTestPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.Role2"),
      },
    );
  });

  test("idempotent if a principal (user/group/role) is attached twice", () => {
    const p = new Policy(stack, "MyPolicy");
    p.addStatements(new PolicyStatement({ actions: ["*"], resources: ["*"] }));

    const role = new Role(stack, "Role1", {
      assumedBy: new ServicePrincipal("test.service"),
    });
    p.attachToRole(role);
    p.attachToRole(role);

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // NOTE: without prepareStack, the IamRolePolicy is missing!
    const iamRolePolicies = Object.values(
      JSON.parse(synthesized).resource.aws_iam_role_policy,
    );
    expect(iamRolePolicies.length).toStrictEqual(1);
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.Role1"),
      },
    );
  });

  test("users, groups, roles and permissions can be added using methods", () => {
    const p = new Policy(stack, "MyTestPolicy", {
      policyName: "Foo",
    });

    p.attachToRole(
      new Role(stack, "Role1", {
        assumedBy: new ServicePrincipal("test.service"),
      }),
    );
    p.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["dynamodb:GetItem"] }),
    );

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    // NOTE: without prepareStack, the IamRolePolicy is missing!
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          expect.objectContaining({
            resources: ["*"],
            actions: ["dynamodb:GetItem"],
          }),
        ],
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        name: "Foo",
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyTestPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.Role1"),
      },
    );
  });

  test("policy can be attached to users, groups or role via methods on the principal", () => {
    const policy = new Policy(stack, "MyPolicy");
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    role.attachInlinePolicy(policy);

    policy.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["*"] }),
    );

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    // NOTE: without prepareStack, the IamRolePolicy is missing!
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          expect.objectContaining({
            resources: ["*"],
            actions: ["*"],
          }),
        ],
      },
    );
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        policy: expect.stringContaining(
          "data.aws_iam_policy_document.MyPolicy",
        ),
        role: expect.stringContaining("aws_iam_role.MyRole"),
      },
    );
  });

  test("fails if policy name is not unique within a user/group/role", () => {
    // create two policies named Foo and attach them both to the same user/group/role
    const p1 = new Policy(stack, "P1", { policyName: "Foo" });
    const p2 = new Policy(stack, "P2", { policyName: "Foo" });
    const p3 = new Policy(stack, "P3"); // uses logicalID as name

    // const user = new User(stack, "MyUser");
    // const group = new Group(stack, "MyGroup");
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
    });

    // p1.attachToUser(user);
    // p1.attachToGroup(group);
    p1.attachToRole(role);

    // try to attach p2 to all of these and expect to fail
    // expect(() => p2.attachToUser(user)).toThrow(
    //   /A policy named "Foo" is already attached/,
    // );
    // expect(() => p2.attachToGroup(group)).toThrow(
    //   /A policy named "Foo" is already attached/,
    // );
    expect(() => p2.attachToRole(role)).toThrow(
      /A policy named "Foo" is already attached/,
    );

    // p3.attachToUser(user);
    // p3.attachToGroup(group);
    p3.attachToRole(role);
  });

  test("idempotent if an imported principal (user/group/role) is attached twice", () => {
    const p = new Policy(stack, "Policy");
    p.addStatements(new PolicyStatement({ resources: ["*"], actions: ["*"] }));

    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });
    const importedRole = Role.fromRoleArn(
      stack,
      "MyImportedRole",
      role.roleArn,
    );
    p.attachToRole(role);
    p.attachToRole(importedRole);

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const iamRolePolicies = Object.values(
      JSON.parse(synthesized).resource.aws_iam_role_policy,
    );
    expect(iamRolePolicies.length).toStrictEqual(1);
    expect(synthesized).toHaveResourceWithProperties(
      iamRolePolicy.IamRolePolicy,
      {
        policy: expect.stringContaining("data.aws_iam_policy_document.Policy"),
        role: expect.stringContaining("aws_iam_role.MyRole"),
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     Policy23B91518: {
    //       Type: "AWS::IAM::Policy",
    //       Properties: {
    //         Groups: [{ Ref: "MyGroupCBA54B1B" }],
    //         PolicyDocument: {
    //           Statement: [{ Action: "*", Effect: "Allow", Resource: "*" }],
    //           Version: "2012-10-17",
    //         },
    //         PolicyName: "Policy23B91518",
    //         Roles: [{ Ref: "MyRoleF48FFE04" }],
    //         Users: [{ Ref: "MyUserDC45028B" }],
    //       },
    //     },
    //     MyUserDC45028B: { Type: "AWS::IAM::User" },
    //     MyGroupCBA54B1B: { Type: "AWS::IAM::Group" },
    //     MyRoleF48FFE04: {
    //       Type: "AWS::IAM::Role",
    //       Properties: {
    //         AssumeRolePolicyDocument: {
    //           Statement: [
    //             {
    //               Action: "sts:AssumeRole",
    //               Effect: "Allow",
    //               Principal: { Service: "test.service" },
    //             },
    //           ],
    //           Version: "2012-10-17",
    //         },
    //       },
    //     },
    //   },
    // });
  });

  test("empty policy is OK if force=false", () => {
    // TODO: is an empty policy really ok?
    new Policy(stack, "Pol", { force: false });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    Testing.synth(stack);
    // If we got here, all OK
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
