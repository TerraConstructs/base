import { iamPolicy, dataAwsIamPolicy } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack, AwsConstructBase } from "../../../src/aws";
import { Grant, IAwsConstructWithPolicy } from "../../../src/aws/iam/grant";
import { ManagedPolicy } from "../../../src/aws/iam/managed-policy";
import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { PolicyStatement } from "../../../src/aws/iam/policy-statement";
import {
  AddToPrincipalPolicyResult,
  ServicePrincipal,
} from "../../../src/aws/iam/principals";
import { Role } from "../../../src/aws/iam/role";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("managed policy", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props?
      // account: "1234",
      // region: "us-east-1",
    });
  });

  test("simple AWS managed policy", () => {
    const mp = ManagedPolicy.fromAwsManagedPolicyName(
      stack,
      "SomePolicy",
      "service-role/SomePolicy",
    );

    expect(stack.resolve(mp.managedPolicyArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/service-role/SomePolicy",
    );
  });

  test("simple customer managed policy", () => {
    const mp = ManagedPolicy.fromManagedPolicyName(
      stack,
      "MyCustomerManagedPolicy",
      "SomeCustomerPolicy",
    );

    expect(stack.resolve(mp.managedPolicyArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:policy/SomeCustomerPolicy",
    );
  });

  test("managed policy by arn", () => {
    const mp = ManagedPolicy.fromManagedPolicyArn(
      stack,
      "MyManagedPolicyByArn",
      "arn:aws:iam::1234:policy/my-policy",
    );

    expect(stack.resolve(mp.managedPolicyArn)).toEqual(
      "arn:aws:iam::1234:policy/my-policy",
    );
  });

  test("managed policy with statements", () => {
    const policy = new ManagedPolicy(stack, "MyManagedPolicy", {
      managedPolicyName: "MyManagedPolicyName",
    });
    policy.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["sqs:SendMessage"] }),
    );
    policy.addStatements(
      new PolicyStatement({ resources: ["arn"], actions: ["sns:Subscribe"] }),
    );

    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });
    role.addManagedPolicy(policy);

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot for debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyManagedPolicy_2C71A5F2: {
            statement: [
              {
                actions: ["sqs:SendMessage"],
                effect: "Allow",
                resources: ["*"],
              },
              {
                actions: ["sns:Subscribe"],
                effect: "Allow",
                resources: ["arn"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name: "MyManagedPolicyName",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyManagedPolicy_2C71A5F2.json}",
          },
        },
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("managed policy from policy document alone", () => {
    new ManagedPolicy(stack, "MyManagedPolicy", {
      managedPolicyName: "MyManagedPolicyName",
      document: PolicyDocument.fromJson(stack, "MyPolicyDocument", {
        Statement: [
          {
            Action: "sqs:SendMessage",
            Effect: "Allow",
            Resource: "*",
          },
        ],
      }),
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const template = JSON.parse(Testing.synth(stack));
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyPolicyDocument_8939B00D: {
            statement: [
              {
                actions: ["sqs:SendMessage"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name: "MyManagedPolicyName",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyPolicyDocument_8939B00D.json}",
          },
        },
      },
    });
  });

  test("managed policy from policy document with additional statements", () => {
    new ManagedPolicy(stack, "MyManagedPolicy", {
      managedPolicyName: "MyManagedPolicyName",
      document: PolicyDocument.fromJson(stack, "MyPolicyDocument", {
        Statement: [
          {
            Action: "sqs:SendMessage",
            Effect: "Allow",
            Resource: "*",
          },
        ],
      }),
      statements: [
        new PolicyStatement({ resources: ["arn"], actions: ["sns:Subscribe"] }),
      ],
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const template = JSON.parse(Testing.synth(stack));
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyPolicyDocument_8939B00D: {
            statement: [
              {
                actions: ["sqs:SendMessage"],
                effect: "Allow",
                resources: ["*"],
              },
              {
                actions: ["sns:Subscribe"],
                effect: "Allow",
                resources: ["arn"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name: "MyManagedPolicyName",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyPolicyDocument_8939B00D.json}",
          },
        },
      },
    });
  });

  test("policy name can be omitted, in which case the logical id will be used", () => {
    const policy = new ManagedPolicy(stack, "MyManagedPolicy");
    policy.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["sqs:SendMessage"] }),
    );
    policy.addStatements(
      new PolicyStatement({ resources: ["arn"], actions: ["sns:Subscribe"] }),
    );

    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });
    role.addManagedPolicy(policy);

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyManagedPolicy_2C71A5F2: {
            statement: [
              {
                actions: ["sqs:SendMessage"],
                effect: "Allow",
                resources: ["*"],
              },
              {
                actions: ["sns:Subscribe"],
                effect: "Allow",
                resources: ["arn"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name_prefix: "123e4567-e89b-12d3-MyStackMyManagedPolicy",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyManagedPolicy_2C71A5F2.json}",
          },
        },
        aws_iam_role: {
          MyRole_F48FFE04: {
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  // TODO: Re-add users and groups support
  test("via props, managed policy can be attached to users, groups and roles and permissions, description and path can be added", () => {
    const role1 = new Role(stack, "Role1", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    new ManagedPolicy(stack, "MyTestManagedPolicy", {
      managedPolicyName: "Foo",
      roles: [role1],
      description: "My Policy Description",
      path: "tahiti/is/a/magical/place",
      statements: [
        new PolicyStatement({
          resources: ["*"],
          actions: ["dynamodb:PutItem"],
        }),
      ],
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const template = JSON.parse(Testing.synth(stack));
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyTestManagedPolicy_A5644D50: {
            statement: [
              {
                actions: ["dynamodb:PutItem"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_testservice: {
            service_name: "test.service",
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyTestManagedPolicy_6535D9F5: {
            description: "My Policy Description",
            name: "Foo",
            path: "tahiti/is/a/magical/place",
            policy:
              "${data.aws_iam_policy_document.MyTestManagedPolicy_A5644D50.json}",
          },
        },
        aws_iam_role: {
          Role1_3A5C70C1: {
            assume_role_policy:
              "${data.aws_iam_policy_document.Role1_AssumeRolePolicy_3ECFD151.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackRole1",
          },
        },
        aws_iam_role_policy_attachment: {
          MyTestManagedPolicy_Roles0_C31343D6: {
            policy_arn: "${aws_iam_policy.MyTestManagedPolicy_6535D9F5.arn}",
            role: "${aws_iam_role.Role1_3A5C70C1.name}",
          },
        },
      },
    });
  });

  test("idempotent if a principal (user/group/role) is attached twice", () => {
    const p = new ManagedPolicy(stack, "MyManagedPolicy");
    p.addStatements(new PolicyStatement({ actions: ["*"], resources: ["*"] }));

    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });
    p.attachToRole(role);
    p.attachToRole(role);

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyManagedPolicy_2C71A5F2: {
            statement: [
              {
                actions: ["*"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_testservice: {
            service_name: "test.service",
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name_prefix: "123e4567-e89b-12d3-MyStackMyManagedPolicy",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyManagedPolicy_2C71A5F2.json}",
          },
        },
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("idempotent if an imported principal (user/group/role) is attached twice", () => {
    const p = new ManagedPolicy(stack, "MyManagedPolicy");
    p.addStatements(new PolicyStatement({ actions: ["*"], resources: ["*"] }));

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

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyManagedPolicy_2C71A5F2: {
            statement: [
              {
                actions: ["*"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_testservice: {
            service_name: "test.service",
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name_prefix: "123e4567-e89b-12d3-MyStackMyManagedPolicy",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyManagedPolicy_2C71A5F2.json}",
          },
        },
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("users, groups, roles and permissions can be added using methods", () => {
    const p = new ManagedPolicy(stack, "MyManagedPolicy", {
      managedPolicyName: "Foo",
    });

    p.attachToRole(
      new Role(stack, "Role1", {
        assumedBy: new ServicePrincipal("test.service"),
      }),
    );
    p.attachToRole(
      new Role(stack, "Role2", {
        assumedBy: new ServicePrincipal("test.service"),
      }),
    );
    p.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["dynamodb:GetItem"] }),
    );

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);

    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyManagedPolicy_2C71A5F2: {
            statement: [
              {
                actions: ["dynamodb:GetItem"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_testservice: {
            service_name: "test.service",
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name: "Foo",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyManagedPolicy_2C71A5F2.json}",
          },
        },
        aws_iam_role: {
          Role1_3A5C70C1: {
            assume_role_policy:
              "${data.aws_iam_policy_document.Role1_AssumeRolePolicy_3ECFD151.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackRole1",
          },
          Role2_91939BC6: {
            assume_role_policy:
              "${data.aws_iam_policy_document.Role2_AssumeRolePolicy_E4538858.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackRole2",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.Role1_3A5C70C1.name}",
          },
          MyManagedPolicy_Roles1_0EB68266: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.Role2_91939BC6.name}",
          },
        },
      },
    });
  });

  test("policy can be attached to users, groups or role via methods on the principal", () => {
    const policy = new ManagedPolicy(stack, "MyManagedPolicy");
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    role.addManagedPolicy(policy);

    policy.addStatements(
      new PolicyStatement({ resources: ["*"], actions: ["*"] }),
    );

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);

    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyManagedPolicy_2C71A5F2: {
            statement: [
              {
                actions: ["*"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_testservice: {
            service_name: "test.service",
          },
        },
      },
      resource: {
        aws_iam_policy: {
          MyManagedPolicy_9F3720AE: {
            name_prefix: "123e4567-e89b-12d3-MyStackMyManagedPolicy",
            path: "/",
            policy:
              "${data.aws_iam_policy_document.MyManagedPolicy_2C71A5F2.json}",
          },
        },
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("policy from AWS managed policy lookup can be attached to users, groups or role via methods on the principal", () => {
    const policy = ManagedPolicy.fromAwsManagedPolicyName(
      stack,
      "polRef",
      "AnAWSManagedPolicy",
    );
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    role.addManagedPolicy(policy);

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    // ensure no policy is created, only AWS Managed Policy is referenced
    expect(resourceCount(template, iamPolicy.IamPolicy)).toBe(0);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          polRef_Roles0_EAE7DD30: {
            policy_arn:
              "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/AnAWSManagedPolicy",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("policy from customer managed policy lookup can be attached to users, groups or role via methods", () => {
    const policy = ManagedPolicy.fromManagedPolicyName(
      stack,
      "MyManagedPolicy",
      "ACustomerManagedPolicyName",
    );
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    role.addManagedPolicy(policy);

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    // ensure no policy is created, only Existing Customer Managed Policy is referenced
    expect(resourceCount(template, iamPolicy.IamPolicy)).toBe(0);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn:
              "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:policy/ACustomerManagedPolicyName",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("policy from customer managed policy attributes data source can be attached to users, groups or role via methods", () => {
    const policy = ManagedPolicy.fromPolicyAttributes(
      stack,
      "MyManagedPolicy",
      {
        name: "ACustomerManagedPolicyName",
      },
    );
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
    });

    role.addManagedPolicy(policy);

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(dataSourceCount(template, dataAwsIamPolicy.DataAwsIamPolicy)).toBe(
      1,
    );
    expect(resourceCount(template, iamPolicy.IamPolicy)).toBe(0);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          MyManagedPolicy_Roles0_8B8C8B56: {
            policy_arn: "${data.aws_iam_policy.MyManagedPolicy_9F3720AE.arn}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("fails if policy document is empty", () => {
    new ManagedPolicy(stack, "MyPolicy");
    expect(() => app.synth()).toThrow(
      /Managed Policy is empty. You must add statements to the policy/,
    );
  });

  test("managed policy name is correctly calculated", () => {
    const mp = new ManagedPolicy(stack, "Policy");
    mp.addStatements(
      new PolicyStatement({
        actions: ["a:abc"],
      }),
    );

    expect(stack.resolve(mp.managedPolicyName)).toEqual(
      "${aws_iam_policy.Policy_23B91518.name}",
    );
  });

  test("fails if policy document does not specify resources", () => {
    new ManagedPolicy(stack, "MyManagedPolicy", {
      statements: [new PolicyStatement({ actions: ["*"] })],
    });

    expect(() => app.synth()).toThrow(
      /A PolicyStatement used in an identity-based policy must specify at least one resource/,
    );
  });

  test("fails if policy document specifies principals", () => {
    new ManagedPolicy(stack, "MyManagedPolicy", {
      statements: [
        new PolicyStatement({
          actions: ["*"],
          resources: ["*"],
          principals: [new ServicePrincipal("test.service")],
        }),
      ],
    });

    expect(() => app.synth()).toThrow(
      /A PolicyStatement used in an identity-based policy cannot specify any IAM principals/,
    );
  });

  // test("cross-stack hard-name contains the right resource type", () => {
  //   const mp = new ManagedPolicy(spec, "Policy", {
  //     managedPolicyName: PhysicalName.GENERATE_IF_NEEDED,
  //   });
  //   mp.addStatements(
  //     new PolicyStatement({
  //       actions: ["a:abc"],
  //       resources: ["*"],
  //     }),
  //   );

  //   const stack2 = new Stack(app, "Stack2", {
  //     env: { account: "5678", region: "us-east-1" },
  //   });
  //   new CfnOutput(stack2, "Output", {
  //     value: mp.managedPolicyArn,
  //   });

  //   Template.fromStack(stack2).templateMatches({
  //     Outputs: {
  //       Output: {
  //         Value: {
  //           "Fn::Join": [
  //             "",
  //             [
  //               "arn:",
  //               {
  //                 Ref: "AWS::Partition",
  //               },
  //               ":iam::1234:policy/mystackmystackpolicy17395e221b1b6deaf875",
  //             ],
  //           ],
  //         },
  //       },
  //     },
  //   });
  // });

  test("Policies can be granted principal permissions", () => {
    const mp = new ManagedPolicy(stack, "Policy", {
      managedPolicyName: "MyManagedPolicyName",
    });
    Grant.addToPrincipal({
      actions: ["dummy:Action"],
      grantee: mp,
      resourceArns: ["*"],
    });

    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          Policy_C96C8195: {
            statement: [
              {
                actions: ["dummy:Action"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_policy: {
          Policy_23B91518: {
            name: "MyManagedPolicyName",
            path: "/",
            policy: "${data.aws_iam_policy_document.Policy_C96C8195.json}",
          },
        },
      },
    });
  });

  test("addPrincipalOrResource() correctly grants Policies permissions", () => {
    const mp = new ManagedPolicy(stack, "Policy", {
      managedPolicyName: "MyManagedPolicyName",
    });

    class DummyResource
      extends AwsConstructBase
      implements IAwsConstructWithPolicy
    {
      public get outputs() {
        return {};
      }
      addToResourcePolicy(
        _statement: PolicyStatement,
      ): AddToPrincipalPolicyResult {
        throw new Error("should not be called.");
      }
    }
    const resource = new DummyResource(stack, "Dummy");
    Grant.addToPrincipalOrResource({
      actions: ["dummy:Action"],
      grantee: mp,
      resourceArns: ["*"],
      resource,
    });

    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // refer to full snapshot to debug
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          Policy_C96C8195: {
            statement: [
              {
                actions: ["dummy:Action"],
                effect: "Allow",
                resources: ["*"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_policy: {
          Policy_23B91518: {
            name: "MyManagedPolicyName",
            path: "/",
            policy: "${data.aws_iam_policy_document.Policy_C96C8195.json}",
          },
        },
      },
    });
  });

  test("Policies cannot be granted principal permissions across accounts", () => {
    const mp = new ManagedPolicy(stack, "Policy", {
      managedPolicyName: "MyManagedPolicyName",
    });

    class DummyResource
      extends AwsConstructBase
      implements IAwsConstructWithPolicy
    {
      public get outputs() {
        return {};
      }
      addToResourcePolicy(
        _statement: PolicyStatement,
      ): AddToPrincipalPolicyResult {
        throw new Error("should not be called.");
      }
    }
    const resource = new DummyResource(stack, "Dummy", { account: "5678" });

    expect(() => {
      Grant.addToPrincipalOrResource({
        actions: ["dummy:Action"],
        grantee: mp,
        resourceArns: ["*"],
        resource,
      });
    }).toThrow(/Cannot use a ManagedPolicy 'MyStack\/Policy'/);
  });

  test("Policies cannot be granted resource permissions", () => {
    const mp = new ManagedPolicy(stack, "Policy", {
      managedPolicyName: "MyManagedPolicyName",
    });

    class DummyResource
      extends AwsConstructBase
      implements IAwsConstructWithPolicy
    {
      public get outputs() {
        return {};
      }
      addToResourcePolicy(
        _statement: PolicyStatement,
      ): AddToPrincipalPolicyResult {
        throw new Error("should not be called.");
      }
    }
    const resource = new DummyResource(stack, "Dummy");

    expect(() => {
      Grant.addToPrincipalAndResource({
        actions: ["dummy:Action"],
        grantee: mp,
        resourceArns: ["*"],
        resource,
      });
    }).toThrow(/Cannot use a ManagedPolicy 'MyStack\/Policy'/);
  });

  // test("prevent creation when customizeRoles is configured", () => {
  //   // GIVEN
  //   const otherStack = new Stack();
  //   Role.customizeRoles(otherStack);

  //   // WHEN
  //   new ManagedPolicy(otherStack, "CustomPolicy", {
  //     statements: [
  //       new PolicyStatement({
  //         effect: Effect.ALLOW,
  //         resources: ["*"],
  //         actions: ["*"],
  //       }),
  //     ],
  //   });

  //   // THEN
  //   Template.fromStack(otherStack).resourceCountIs(
  //     "AWS::IAM::ManagedPolicy",
  //     0,
  //   );
  // });

  // test("do not prevent creation when customizeRoles.preventSynthesis=false", () => {
  //   // GIVEN
  //   const otherStack = new Stack();
  //   Role.customizeRoles(otherStack, {
  //     preventSynthesis: false,
  //   });

  //   // WHEN
  //   new ManagedPolicy(otherStack, "CustomPolicy", {
  //     statements: [
  //       new PolicyStatement({
  //         effect: Effect.ALLOW,
  //         resources: ["*"],
  //         actions: ["*"],
  //       }),
  //     ],
  //   });

  //   // THEN
  //   // Do prepare run to resolve/add all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(otherStack).resourceCountIs(
  //   //   "AWS::IAM::ManagedPolicy",
  //   //   1,
  //   // );
  // });
});

test("ARN for two instances of the same AWS Managed Policy is the same", () => {
  const app = Testing.app();
  const stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
    //   account: "1234",
    //   region: "us-east-1",
  });
  const mp1 = ManagedPolicy.fromAwsManagedPolicyName(stack, "Bar", "foo/bar");
  const mp2 = ManagedPolicy.fromAwsManagedPolicyName(stack, "Foo", "foo/bar");

  expect(stack.resolve(mp1.managedPolicyArn)).toEqual(
    stack.resolve(mp2.managedPolicyArn),
  );
});

/**
 * Get data source count of a given type from a synthesized stack
 */
function dataSourceCount(parsed: any, constructor: TerraformConstructor) {
  // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
  if (!parsed.data || !parsed.data[constructor.tfResourceType]) {
    return 0;
  }
  return Object.values(parsed.data[constructor.tfResourceType]).length;
}

/**
 * Get resources count of a given type from a synthesized stack
 */
function resourceCount(parsed: any, constructor: TerraformConstructor) {
  // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
  if (!parsed.resource || !parsed.resource[constructor.tfResourceType]) {
    return 0;
  }
  return Object.values(parsed.resource[constructor.tfResourceType]).length;
}
interface TerraformConstructor {
  readonly tfResourceType: string;
}
