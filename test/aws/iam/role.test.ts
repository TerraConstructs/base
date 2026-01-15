import {
  dataAwsIamPolicyDocument,
  iamPolicy,
  iamRolePolicy,
  iamRole,
  iamRolePolicyAttachment,
} from "@cdktf/provider-aws";
import {
  Testing,
  Token,
  Lazy,
  TerraformElement,
  AnnotationMetadataEntryType,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
// import {
//   Stage,
//   DefaultStackSynthesizer,
//   CliCredentialsStackSynthesizer,
//   // PERMISSIONS_BOUNDARY_CONTEXT_KEY,
//   // PermissionsBoundary,
// } from "../../core";
import { Duration } from "../../../src/";
import { AwsStack } from "../../../src/aws/aws-stack";
import { ManagedPolicy } from "../../../src/aws/iam/managed-policy";
import { Policy } from "../../../src/aws/iam/policy";
import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { PolicyStatement } from "../../../src/aws/iam/policy-statement";
import {
  AccountPrincipal,
  AnyPrincipal,
  ArnPrincipal,
  CompositePrincipal,
  FederatedPrincipal,
  ServicePrincipal,
} from "../../../src/aws/iam/principals";
import { Role } from "../../../src/aws/iam/role";
import { Annotations, Template } from "../../assertions";

const environmentName = "Test";
const gridUUID1 = "123e4567-e89b-12d3";
const gridUUID2 = "123e4567-e89b-12d4";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("isRole() returns", () => {
  test("true if given Role instance", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);
    // WHEN
    const pureRole = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("sns"),
    });
    // THEN
    expect(Role.isRole(pureRole)).toBe(true);
  });

  test("false if given imported role instance", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);
    // WHEN
    const importedRole = Role.fromRoleName(
      stack,
      "ImportedRole",
      "ImportedRole",
    );
    // THEN
    expect(Role.isRole(importedRole)).toBe(false);
  });

  test("false if given undefined", () => {
    // THEN
    expect(Role.isRole(undefined)).toBe(false);
  });
});

describe("IAM role", () => {
  test("default role", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns"),
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                ],
              },
            ],
          },
        ],
      },
    );
    expect(synthesized).toHaveResourceWithProperties(iamRole.IamRole, {
      assume_role_policy:
        "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
      name_prefix: "123e4567-e89b-12d3-RoleStackMyRole",
    });
  });

  test("a role can grant PassRole permissions", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);
    const role1 = new Role(stack, "Role1", {
      assumedBy: new ServicePrincipal("henk"),
    });
    const role2 = new Role(stack, "Role2", {
      assumedBy: new ServicePrincipal("sns"),
    });

    // WHEN
    role1.grantPassRole(role2);

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["iam:PassRole"],
            effect: "Allow",
            resources: ["${aws_iam_role.Role1_3A5C70C1.arn}"],
          },
        ],
      },
    );
  });

  test("a role can grant AssumeRole permissions", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);
    const role1 = new Role(stack, "Role1", {
      assumedBy: new ServicePrincipal("henk"),
    });
    const role2 = new Role(stack, "Role2", {
      assumedBy: new ServicePrincipal("sns"),
    });

    // WHEN
    role1.grantAssumeRole(role2);

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    // confirm role2 default policy grants rights to assume role1
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            resources: ["${aws_iam_role.Role1_3A5C70C1.arn}"],
          },
        ],
      },
    );
  });

  test("a role cannot grant AssumeRole permission to a Service Principal", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);

    // WHEN
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("henk"),
    });

    // THEN
    expect(() =>
      role.grantAssumeRole(new ServicePrincipal("beep-boop")),
    ).toThrow(
      "Cannot use a service or account principal with grantAssumeRole, use assumeRolePolicy instead.",
    );
  });

  test("a role cannot grant AssumeRole permission to an Account Principal", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);

    // WHEN
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("henk"),
    });

    // THEN
    expect(() =>
      role.grantAssumeRole(new AccountPrincipal("123456789")),
    ).toThrow(
      "Cannot use a service or account principal with grantAssumeRole, use assumeRolePolicy instead.",
    );
  });

  test("can supply single externalIds", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);

    // WHEN
    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns"),
      externalIds: ["SomeSecret"],
    });

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            condition: [
              {
                test: "StringEquals",
                variable: "sts:ExternalId",
                values: ["SomeSecret"],
              },
            ],
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                ],
              },
            ],
          },
        ],
      },
    );
  });

  test("can supply multiple externalIds", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);

    // WHEN
    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      externalIds: ["SomeSecret", "AnotherSecret"],
    });

    // THEN
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            condition: [
              {
                test: "StringEquals",
                variable: "sts:ExternalId",
                values: ["SomeSecret", "AnotherSecret"],
              },
            ],
            principals: [
              {
                type: "Service",
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                ],
              },
            ],
          },
        ],
      },
    );
  });

  test("policy is attached automatically when permissions are added", () => {
    // by default we don't expect a role policy
    const before = getAwsStack("BeforeStack", gridUUID1);
    new Role(before, "MyRole", {
      assumedBy: new ServicePrincipal("sns"),
    });
    // Do prepare run to resolve/add all Terraform resources
    before.prepareStack();
    const synthBefore = Testing.synth(before);
    // expect(synthBefore).toMatchSnapshot("before");
    let template = JSON.parse(synthBefore);
    expect(resourceCount(template, iamRolePolicy.IamRolePolicy)).toBe(0);

    // add a policy to the role
    const after = getAwsStack("AfterStack", gridUUID2);
    const afterRole = new Role(after, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
    });
    afterRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["myresource"],
        actions: ["service:myaction"],
      }),
    );
    // Do prepare run to resolve/add all Terraform resources
    after.prepareStack();
    const synthAfter = Testing.synth(after);
    // expect(synthAfter).toMatchSnapshot("after");
    template = JSON.parse(synthAfter);
    expect(resourceCount(template, iamPolicy.IamPolicy)).toBe(0);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyRole_AssumeRolePolicy_4BED951C: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
            ],
          },
          MyRole_DefaultPolicy_6017B917: {
            statement: [
              {
                actions: ["service:myaction"],
                effect: "Allow",
                resources: ["myresource"],
              },
            ],
          },
        },
      },
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d4-AfterStackMyRole",
          },
        },
        aws_iam_role_policy: {
          MyRole_DefaultPolicy_ResourceRoles0_B7F96EAE: {
            name: "AfterStackMyRoleDefaultPolicyE40CFEBE",
            policy:
              "${data.aws_iam_policy_document.MyRole_DefaultPolicy_6017B917.json}",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("managed policy arns can be supplied upon initialization and also added later", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("test.service"),
      managedPolicies: [
        ManagedPolicy.fromManagedPolicyName(stack, "fromProp1", "managed1"),
        ManagedPolicy.fromManagedPolicyName(stack, "fromProp2", "managed2"),
      ],
    });

    role.addManagedPolicy(
      ManagedPolicy.fromManagedPolicyName(stack, "fromMethod1", "managed3"),
    );
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(resourceCount(template, iamPolicy.IamPolicy)).toBe(0);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-RoleStackMyRole",
          },
        },
        aws_iam_role_policy_attachment: {
          fromProp1_Roles0_6E098A61: {
            policy_arn:
              "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:policy/managed1",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
          fromProp2_Roles0_FABE88E9: {
            policy_arn:
              "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:policy/managed2",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
          fromMethod1_Roles0_22BA2368: {
            policy_arn:
              "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:policy/managed3",
            role: "${aws_iam_role.MyRole_F48FFE04.name}",
          },
        },
      },
    });
  });

  test("federated principal can change AssumeRoleAction", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const cognitoPrincipal = new FederatedPrincipal(
      "foo",
      [
        {
          test: "StringEquals",
          variable: "key",
          values: ["value"],
        },
      ],
      "sts:AssumeSomething",
    );

    new Role(stack, "MyRole", { assumedBy: cognitoPrincipal });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyRole_AssumeRolePolicy_4BED951C: {
            statement: [
              {
                actions: ["sts:AssumeSomething"],
                condition: [
                  {
                    test: "StringEquals",
                    values: ["value"],
                    variable: "key",
                  },
                ],
                effect: "Allow",
                principals: [
                  {
                    identifiers: ["foo"],
                    type: "Federated",
                  },
                ],
              },
            ],
          },
        },
      },
    });
  });

  test("role path can be used to specify the path", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    new Role(stack, "MyRole", {
      path: "/",
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
    });
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(resourceCount(template, iamPolicy.IamPolicy)).toBe(0);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            assume_role_policy:
              "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
            name_prefix: "123e4567-e89b-12d3-RoleStackMyRole",
            path: "/",
          },
        },
      },
    });
  });

  test("role path can be 1 character", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const assumedBy = new ServicePrincipal("bla");

    expect(
      () => new Role(stack, "MyRole", { assumedBy, path: "/" }),
    ).not.toThrow();
  });

  test("role path cannot be empty", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const assumedBy = new ServicePrincipal("bla");

    expect(() => new Role(stack, "MyRole", { assumedBy, path: "" })).toThrow(
      "Role path must be between 1 and 512 characters. The provided role path is 0 characters.",
    );
  });

  test("role path must be less than or equal to 512", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const assumedBy = new ServicePrincipal("bla");

    expect(
      () =>
        new Role(stack, "MyRole", {
          assumedBy,
          path: "/" + Array(512).join("a") + "/",
        }),
    ).toThrow(
      "Role path must be between 1 and 512 characters. The provided role path is 513 characters.",
    );
  });

  test("role path must start with a forward slash", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const assumedBy = new ServicePrincipal("bla");

    const expected = (val: any) =>
      "Role path must be either a slash or valid characters (alphanumerics and symbols) surrounded by slashes. " +
      `Valid characters are unicode characters in [\\u0021-\\u007F]. However, ${val} is provided.`;
    expect(() => new Role(stack, "MyRole", { assumedBy, path: "aaa" })).toThrow(
      expected("aaa"),
    );
  });

  test("role path must end with a forward slash", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const assumedBy = new ServicePrincipal("bla");

    const expected = (val: any) =>
      "Role path must be either a slash or valid characters (alphanumerics and symbols) surrounded by slashes. " +
      `Valid characters are unicode characters in [\\u0021-\\u007F]. However, ${val} is provided.`;
    expect(() => new Role(stack, "MyRole", { assumedBy, path: "/a" })).toThrow(
      expected("/a"),
    );
  });

  test("role path must contain unicode chars within [\\u0021-\\u007F]", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const assumedBy = new ServicePrincipal("bla");

    const expected = (val: any) =>
      "Role path must be either a slash or valid characters (alphanumerics and symbols) surrounded by slashes. " +
      `Valid characters are unicode characters in [\\u0021-\\u007F]. However, ${val} is provided.`;
    expect(
      () => new Role(stack, "MyRole", { assumedBy, path: "/\u0020\u0080/" }),
    ).toThrow(expected("/\u0020\u0080/"));
  });

  describe("maxSessionDuration", () => {
    test("is not specified by default", () => {
      const stack = getAwsStack("RoleStack", gridUUID1);
      new Role(stack, "MyRole", {
        assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      });
      // Do prepare run to resolve/add all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      const template = JSON.parse(synthesized);
      expect(template).toMatchObject({
        data: {
          aws_iam_policy_document: {
            MyRole_AssumeRolePolicy_4BED951C: {
              statement: [
                {
                  actions: ["sts:AssumeRole"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: [
                        "${data.aws_service_principal.aws_svcp_default_region_sns.name}",
                      ],
                      type: "Service",
                    },
                  ],
                },
              ],
            },
          },
        },
      });
    });

    test("can be used to specify the maximum session duration for assuming the role", () => {
      const stack = getAwsStack("RoleStack", gridUUID1);

      new Role(stack, "MyRole", {
        maxSessionDuration: Duration.seconds(3700),
        assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      });

      // Do prepare run to resolve/add all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      const template = JSON.parse(synthesized);
      expect(template).toMatchObject({
        resource: {
          aws_iam_role: {
            MyRole_F48FFE04: {
              max_session_duration: 3700,
            },
          },
        },
      });
    });

    test("must be between 3600 and 43200", () => {
      const stack = getAwsStack("RoleStack", gridUUID1);

      const assumedBy = new ServicePrincipal("bla");

      new Role(stack, "MyRole1", {
        assumedBy,
        maxSessionDuration: Duration.hours(1),
      });
      new Role(stack, "MyRole2", {
        assumedBy,
        maxSessionDuration: Duration.hours(12),
      });

      const expected = (val: any) =>
        `maxSessionDuration is set to ${val}, but must be >= 3600sec (1hr) and <= 43200sec (12hrs)`;
      expect(
        () =>
          new Role(stack, "MyRole3", {
            assumedBy,
            maxSessionDuration: Duration.minutes(1),
          }),
      ).toThrow(expected(60));
      expect(
        () =>
          new Role(stack, "MyRole4", {
            assumedBy,
            maxSessionDuration: Duration.seconds(3599),
          }),
      ).toThrow(expected(3599));
      expect(
        () =>
          new Role(stack, "MyRole5", {
            assumedBy,
            maxSessionDuration: Duration.seconds(43201),
          }),
      ).toThrow(expected(43201));
    });
  });

  test("allow role with multiple principals", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    new Role(stack, "MyRole", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("boom"),
        new ArnPrincipal("1111111"),
      ),
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_service_principal: {
          aws_svcp_default_region_boom: {
            service_name: "boom",
          },
        },
        aws_iam_policy_document: {
          MyRole_AssumeRolePolicy_4BED951C: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_boom.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: ["1111111"],
                    type: "AWS",
                  },
                ],
              },
            ],
          },
        },
      },
    });
  });

  test("can supply permissions boundary managed policy", () => {
    // GIVEN
    const stack = getAwsStack("RoleStack", gridUUID1);

    const permissionsBoundary = ManagedPolicy.fromAwsManagedPolicyName(
      stack,
      "ManagedPolicy",
      "managed-policy",
    );

    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      permissionsBoundary,
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            permissions_boundary:
              "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/managed-policy",
          },
        },
      },
    });
  });

  test('Principal-* in an AssumeRolePolicyDocument gets translated to { "AWS": "*" }', () => {
    // The docs say that "Principal: *" and "Principal: { AWS: * }" are equivalent
    // (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html)
    // but in practice CreateRole errors out if you use "Principal: *" in an AssumeRolePolicyDocument:
    // An error occurred (MalformedPolicyDocument) when calling the CreateRole operation: AssumeRolepolicy contained an invalid principal: "STAR":"*".

    // Make sure that we handle this case specially.
    const stack = getAwsStack("RoleStack", gridUUID1);
    new Role(stack, "Role", {
      assumedBy: new AnyPrincipal(),
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      data: {
        aws_iam_policy_document: {
          Role_AssumeRolePolicy_B27E8126: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: ["*"],
                    type: "AWS",
                  },
                ],
              },
            ],
          },
        },
      },
    });
  });

  test("can have a description", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      description: "This is a role description.",
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            description: "This is a role description.",
          },
        },
      },
    });
  });

  test("should not have an empty description", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      description: "",
    });

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    const template = JSON.parse(synthesized);
    expect(template).not.toMatchObject({
      resource: {
        aws_iam_role: {
          MyRole_F48FFE04: {
            description: "",
          },
        },
      },
    });
  });

  test("description can only be 1000 characters long", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);

    expect(() => {
      new Role(stack, "MyRole", {
        assumedBy: new ServicePrincipal("sns.amazonaws.com"),
        description:
          "1000+ character long description: Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
        Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
        nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
        massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
        imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
        Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
        eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
        varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
        Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
        sem neque sed ipsum.",
      });
    }).toThrow(/Role description must be no longer than 1000 characters./);
  });

  test("fails if managed policy is invalid", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      managedPolicies: [
        new ManagedPolicy(stack, "MyManagedPolicy", {
          statements: [
            new PolicyStatement({
              resources: ["*"],
              actions: ["*"],
              principals: [new ServicePrincipal("sns.amazonaws.com")],
            }),
          ],
        }),
      ],
    });
    stack.prepareStack();

    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement used in an identity-based policy cannot specify any IAM principals/,
    );
  });

  test("fails if default role policy is invalid", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
    });
    role.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["*"],
        principals: [new ServicePrincipal("sns.amazonaws.com")],
      }),
    );
    stack.prepareStack();

    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement used in an identity-based policy cannot specify any IAM principals/,
    );
  });

  test("fails if inline policy from props is invalid", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      inlinePolicies: {
        testPolicy: new PolicyDocument(stack, "Policy", {
          statement: [
            new PolicyStatement({
              resources: ["*"],
              actions: ["*"],
              principals: [new ServicePrincipal("sns.amazonaws.com")],
            }),
          ],
        }),
      },
    });
    stack.prepareStack();

    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement used in an identity-based policy cannot specify any IAM principals/,
    );
  });

  test("fails if attached inline policy is invalid", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
    });
    role.attachInlinePolicy(
      new Policy(stack, "MyPolicy", {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["*"],
            principals: [new ServicePrincipal("sns.amazonaws.com")],
          }),
        ],
      }),
    );
    stack.prepareStack();

    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement used in an identity-based policy cannot specify any IAM principals/,
    );
  });

  test("fails if assumeRolePolicy is invalid", () => {
    const stack = getAwsStack("RoleStack", gridUUID1);
    const role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      managedPolicies: [new ManagedPolicy(stack, "MyManagedPolicy")],
    });
    role.assumeRolePolicy?.addStatements(
      new PolicyStatement({ actions: ["*"] }),
    );
    stack.prepareStack();

    expect(() => Testing.synth(stack, true)).toThrow(
      /A PolicyStatement used in a resource-based policy must specify at least one IAM principal/,
    );
  });
});

// describe("permissions boundary", () => {
//   test("can be applied to an app", () => {
//     // GIVEN
//     const app = new App({
//       context: {
//         [PERMISSIONS_BOUNDARY_CONTEXT_KEY]: {
//           name: "cdk-${Qualifier}-PermissionsBoundary",
//         },
//       },
//     });
//     const stack = new Stack(app);

//     // WHEN
//     new Role(stack, "Role", {
//       assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     });

//     // THEN
//     Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
//       PermissionsBoundary: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::",
//             {
//               Ref: "AWS::AccountId",
//             },
//             ":policy/cdk-hnb659fds-PermissionsBoundary",
//           ],
//         ],
//       },
//     });
//   });

//   test("can be applied to a stage", () => {
//     // GIVEN
//     const app = new App();
//     const stage = new Stage(app, "Stage", {
//       permissionsBoundary: PermissionsBoundary.fromName(
//         "cdk-${Qualifier}-PermissionsBoundary",
//       ),
//     });
//     const stack = new Stack(stage);

//     // WHEN
//     new Role(stack, "Role", {
//       assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     });

//     // THEN
//     Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
//       PermissionsBoundary: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::",
//             {
//               Ref: "AWS::AccountId",
//             },
//             ":policy/cdk-hnb659fds-PermissionsBoundary",
//           ],
//         ],
//       },
//     });
//   });

//   test("can be applied to a stage, and will replace placeholders", () => {
//     // GIVEN
//     const app = new App();
//     const stage = new Stage(app, "Stage", {
//       env: {
//         region: "test-region",
//         account: "123456789012",
//       },
//       permissionsBoundary: PermissionsBoundary.fromName(
//         "cdk-${Qualifier}-PermissionsBoundary-${AWS::AccountId}-${AWS::Region}",
//       ),
//     });
//     const stack = new Stack(stage);

//     // WHEN
//     new Role(stack, "Role", {
//       assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     });

//     // THEN
//     Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
//       PermissionsBoundary: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::123456789012:policy/cdk-hnb659fds-PermissionsBoundary-123456789012-test-region",
//           ],
//         ],
//       },
//     });
//   });

//   test("with a custom qualifier", () => {
//     // GIVEN
//     const app = new App();
//     const stage = new Stage(app, "Stage", {
//       permissionsBoundary: PermissionsBoundary.fromName(
//         "cdk-${Qualifier}-PermissionsBoundary",
//       ),
//     });
//     const stack = new Stack(stage, "MyStack", {
//       synthesizer: new DefaultStackSynthesizer({
//         qualifier: "custom",
//       }),
//     });

//     // WHEN
//     new Role(stack, "Role", {
//       assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     });

//     // THEN
//     Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
//       PermissionsBoundary: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::",
//             {
//               Ref: "AWS::AccountId",
//             },
//             ":policy/cdk-custom-PermissionsBoundary",
//           ],
//         ],
//       },
//     });
//   });

//   test("with a custom permissions boundary", () => {
//     // GIVEN
//     const app = new App();
//     const stage = new Stage(app, "Stage", {
//       permissionsBoundary: PermissionsBoundary.fromName(
//         "my-permissions-boundary",
//       ),
//     });
//     const stack = new Stack(stage);

//     // WHEN
//     new Role(stack, "Role", {
//       assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     });

//     // THEN
//     Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
//       PermissionsBoundary: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::",
//             {
//               Ref: "AWS::AccountId",
//             },
//             ":policy/my-permissions-boundary",
//           ],
//         ],
//       },
//     });
//   });

//   test("with a custom permissions boundary and qualifier", () => {
//     // GIVEN
//     const app = new App();
//     const stage = new Stage(app, "Stage", {
//       permissionsBoundary: PermissionsBoundary.fromName(
//         "my-${Qualifier}-permissions-boundary",
//       ),
//     });
//     const stack = new Stack(stage, "MyStack", {
//       synthesizer: new CliCredentialsStackSynthesizer({
//         qualifier: "custom",
//       }),
//     });

//     // WHEN
//     new Role(stack, "Role", {
//       assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     });

//     // THEN
//     Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
//       PermissionsBoundary: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::",
//             {
//               Ref: "AWS::AccountId",
//             },
//             ":policy/my-custom-permissions-boundary",
//           ],
//         ],
//       },
//     });
//   });
// });

test("managed policy ARNs are deduplicated", () => {
  const stack = getAwsStack("RoleStack", gridUUID1);
  const role = new Role(stack, "MyRole", {
    assumedBy: new ServicePrincipal("sns.amazonaws.com"),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName(
        stack,
        "propAttach1",
        "SuperDeveloper",
      ),
      ManagedPolicy.fromAwsManagedPolicyName(
        stack,
        "propAttach2",
        "SuperDeveloper",
      ),
    ],
  });
  role.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ["s3:*"],
      resources: ["*"],
    }),
  );

  for (let i = 0; i < 20; i++) {
    role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        stack,
        `addMethod${i}`,
        "SuperDeveloper",
      ),
    );
  }

  // Do prepare run to resolve/add all Terraform resources
  stack.prepareStack();
  // CDKTF attaches warnings/errors to stack metadata
  // TODO: filter down by expected warning message?
  const warnings = stack.node.metadata.filter(
    (e) => e.type === AnnotationMetadataEntryType.WARN,
  );
  expect(warnings.length).toBe(0);

  const template = new Template(stack);
  template.resourceCountIs(iamRolePolicyAttachment.IamRolePolicyAttachment, 1);
  template.expect.toHaveResourceWithProperties(
    iamRolePolicyAttachment.IamRolePolicyAttachment,
    {
      policy_arn:
        "arn:${data.aws_partition.Partitition.partition}:iam::aws:policy/SuperDeveloper",
      role: "${aws_iam_role.MyRole_F48FFE04.name}",
    },
  );
});

// TODO: too many managed policies warning is set in splitLargePolicy
// TODO: Implement splitLargePolicy
test.skip("too many managed policies warning", () => {
  const stack = getAwsStack("RoleStack", gridUUID1);
  const role = new Role(stack, "MyRole", {
    assumedBy: new ServicePrincipal("sns.amazonaws.com"),
  });
  role.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ["s3:*"],
      resources: ["*"],
    }),
  );

  for (let i = 0; i < 20; i++) {
    role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        stack,
        `SuperDeveloper${i}`,
        `SuperDeveloper${i}`,
      ),
    );
  }

  Annotations.fromStack(stack).hasWarnings({
    constructPath: "RoleStack/MyRole",
  });
  // Annotations.fromStack(stack).hasWarning(
  //   "/my-stack/MyRole",
  //   Match.stringLikeRegexp(".*"),
  // );
});

describe("role with too large inline policy", () => {
  const N = 100;

  let stack: AwsStack;
  let role: Role;
  beforeEach(() => {
    stack = getAwsStack("RoleStack", gridUUID1);
    role = new Role(stack, "MyRole", {
      assumedBy: new ServicePrincipal("service.amazonaws.com"),
    });

    for (let i = 0; i < N; i++) {
      role.addToPrincipalPolicy(
        new PolicyStatement({
          actions: ["aws:DoAThing"],
          resources: [
            `arn:aws:service:us-east-1:111122223333:someResource/SomeSpecificResource${i}`,
          ],
        }),
      );
    }
  });

  // TODO: Implement splitLargePolicy
  test.skip("excess gets split off into ManagedPolicies", () => {
    // THEN
    // Do prepare run to resolve/add all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    expect(synthesized).toMatchSnapshot();
    // const template = Template.fromStack(stack);
    // template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
    //   PolicyDocument: {
    //     Statement: Match.arrayWith([
    //       Match.objectLike({
    //         Resource: `arn:aws:service:us-east-1:111122223333:someResource/SomeSpecificResource${N - 1}`,
    //       }),
    //     ]),
    //   },
    //   Roles: [{ Ref: "MyRoleF48FFE04" }],
    // });
  });

  test.skip("Dependables track the final declaring construct", () => {
    // WHEN
    const result = role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["aws:DoAThing"],
        resources: [
          `arn:aws:service:us-east-1:111122223333:someResource/SomeSpecificResource${N}`,
        ],
      }),
    );

    const res = new TerraformElement(stack, "Depender", "AWS::Some::Resource");

    expect(result.policyDependable).toBeTruthy();
    res.node.addDependency(result.policyDependable!);

    Template.synth(stack).toMatchSnapshot();
    // THEN
    // const template = Template.fromStack(stack);
    // template.hasResource("AWS::Some::Resource", {
    //   DependsOn: ["MyRoleOverflowPolicy13EF5596A"],
    // });
  });
});

test.skip("many copies of the same statement do not result in overflow policies", () => {
  const N = 100;

  const stack = getAwsStack("RoleStack", gridUUID1);
  const role = new Role(stack, "MyRole", {
    assumedBy: new ServicePrincipal("service.amazonaws.com"),
  });

  for (let i = 0; i < N; i++) {
    role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["aws:DoAThing"],
        resources: [
          "arn:aws:service:us-east-1:111122223333:someResource/SomeSpecificResource",
        ],
      }),
    );
  }

  // THEN
  // Do prepare run to resolve/add all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  expect(synthesized).toMatchSnapshot();
  // const template = JSON.parse(synthesized);
  expect(
    getResources(synthesized, iamPolicy.IamPolicy.tfResourceType),
  ).toHaveLength(0);
  // const template = Template.fromStack(stack);
  // template.resourceCountIs("AWS::IAM::ManagedPolicy", 0);
});

// test("cross-env role ARNs include path", () => {
//   const roleStack = new Stack(app, "role-stack", {
//     env: { account: "123456789012", region: "us-east-1" },
//   });
//   const referencerStack = new Stack(app, "referencer-stack", {
//     env: { region: "us-east-2" },
//   });
//   const role = new Role(roleStack, "Role", {
//     assumedBy: new ServicePrincipal("sns.amazonaws.com"),
//     path: "/sample/path/",
//     roleName: "sample-name",
//   });
//   new CfnResource(referencerStack, "Referencer", {
//     type: "Custom::RoleReferencer",
//     properties: { RoleArn: role.roleArn },
//   });

//   Template.fromStack(referencerStack).hasResourceProperties(
//     "Custom::RoleReferencer",
//     {
//       RoleArn: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::123456789012:role/sample/path/sample-name",
//           ],
//         ],
//       },
//     },
//   );
// });

test("doesn't throw with roleName of 64 chars", () => {
  const stack = getAwsStack("RoleStack", gridUUID1);
  const valdName = "a".repeat(64);

  expect(() => {
    new Role(stack, "Test", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      roleName: valdName,
    });
  }).not.toThrow("Invalid roleName");
});

test("throws with roleName over 64 chars", () => {
  const stack = getAwsStack("RoleStack", gridUUID1);
  const longName = "a".repeat(65);

  expect(() => {
    new Role(stack, "Test", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      roleName: longName,
    });
  }).toThrow("Invalid roleName");
});

describe("roleName validation", () => {
  const stack = getAwsStack("RoleStack", gridUUID1);
  const invalidChars = "!#$%^&*()";

  it("rejects names with spaces", () => {
    expect(() => {
      new Role(stack, "test spaces", {
        assumedBy: new ServicePrincipal("sns.amazonaws.com"),
        roleName: "invalid name",
      });
    }).toThrow("Invalid roleName");
  });

  invalidChars.split("").forEach((char) => {
    it(`rejects name with ${char}`, () => {
      expect(() => {
        new Role(stack, `test ${char}`, {
          assumedBy: new ServicePrincipal("sns.amazonaws.com"),
          roleName: `invalid${char}`,
        });
      }).toThrow("Invalid roleName");
    });
  });
});

test("roleName validation with Tokens", () => {
  const stack = getAwsStack("RoleStack", gridUUID1);
  const token = Lazy.stringValue({ produce: () => "token" });

  // Mock isUnresolved to return false
  jest.spyOn(Token, "isUnresolved").mockReturnValue(false);

  expect(() => {
    new Role(stack, "Valid", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      roleName: token,
    });
  }).toThrow("Invalid roleName");

  // Mock isUnresolved to return true
  jest.spyOn(Token, "isUnresolved").mockReturnValue(true);

  expect(() => {
    new Role(stack, "Invalid", {
      assumedBy: new ServicePrincipal("sns.amazonaws.com"),
      roleName: token,
    });
  }).not.toThrow("Invalid roleName");

  jest.clearAllMocks();
});

/**
 * Get all resources of a given type from a synthesized stack
 */
function getResources(synthesized: string, resourceType: string): any[] {
  // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
  const parsed = JSON.parse(synthesized);
  if (!parsed.resource || !parsed.resource[resourceType]) {
    return [];
  }
  return Object.values(parsed.resource[resourceType]) as any[];
}

// /**
//  * Get all resources of a given type from a synthesized stack
//  */
// function getDataSources(synthesized: string, dataSourceType: string): any[] {
//   // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
//   const parsed = JSON.parse(synthesized);
//   if (!parsed.data || !parsed.data[dataSourceType]) {
//     return [];
//   }
//   return Object.values(parsed.data[dataSourceType]) as any[];
// }

// /**
//  * Get data source count of a given type from a synthesized stack
//  */
// function dataSourceCount(parsed: any, constructor: TerraformConstructor) {
//   // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
//   if (!parsed.data || !parsed.data[constructor.tfResourceType]) {
//     return 0;
//   }
//   return Object.values(parsed.data[constructor.tfResourceType]).length;
// }

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

function getAwsStack(id: string, gridUUID: string): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, id, {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

interface TerraformConstructor {
  readonly tfResourceType: string;
}
