// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-iam/test/instance-profile.test.ts

import {
  dataAwsIamPolicyDocument,
  iamPolicy,
  iamRolePolicy,
  iamRole,
  iamInstanceProfile,
} from "@cdktf/provider-aws";
import { Token, Testing } from "cdktf";
import { AwsStack } from "../../../src/aws/aws-stack";
import "cdktf/lib/testing/adapters/jest";
import { Role, ServicePrincipal, InstanceProfile } from "../../../src/aws/iam";
// // without Barrel file, getting cyclic dependency error:
// import { InstanceProfile } from "../../../src/aws/iam/instance-profile";
// import { ServicePrincipal } from "../../../src/aws/iam/principals";
// import { Role } from "../../../src/aws/iam/role";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("IAM instance profiles", () => {
  let stack: AwsStack;

  beforeEach(() => {
    stack = new AwsStack(Testing.app(), "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props?
      // account: "1234",
      // region: "us-east-1",
    });
  });
  test("default instance profile", () => {
    // WHEN
    new InstanceProfile(stack, "InstanceProfile");

    // THEN
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          InstanceProfile_InstanceRole_AssumeRolePolicy_58D2B4B4: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_ec2.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_ec2: {
            service_name: "ec2",
          },
        },
      },
      resource: {
        aws_iam_instance_profile: {
          InstanceProfile_9F2F41CB: {
            name: "123e4567-e89b-12d3MyStackInstanceProfileF6A8DB39",
            role: "${aws_iam_role.InstanceProfile_InstanceRole_3FE337A6.name}",
          },
        },
        aws_iam_role: {
          InstanceProfile_InstanceRole_3FE337A6: {
            assume_role_policy:
              "${data.aws_iam_policy_document.InstanceProfile_InstanceRole_AssumeRolePolicy_58D2B4B4.json}",
            name: "123e4567-e89b-12d3MyStackInstanceProfileF6A8DB39-role",
          },
        },
      },
    });
  });

  test("given role", () => {
    // GIVEN
    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });

    // WHEN
    new InstanceProfile(stack, "InstanceProfile", { role });

    // THEN
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          Role_AssumeRolePolicy_B27E8126: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_ec2.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_ec2: {
            service_name: "ec2",
          },
        },
      },
      resource: {
        aws_iam_instance_profile: {
          InstanceProfile_9F2F41CB: {
            name: "123e4567-e89b-12d3MyStackInstanceProfileF6A8DB39",
            role: "${aws_iam_role.Role_1ABCC5F0.name}",
          },
        },
        aws_iam_role: {
          Role_1ABCC5F0: {
            assume_role_policy:
              "${data.aws_iam_policy_document.Role_AssumeRolePolicy_B27E8126.json}",
            name_prefix: "123e4567-e89b-12d3-MyStackRole",
          },
        },
      },
    });
  });

  test("given instance profile name", () => {
    // WHEN
    new InstanceProfile(stack, "InstanceProfile", {
      instanceProfileName: "MyInstanceProfile",
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          InstanceProfile_InstanceRole_AssumeRolePolicy_58D2B4B4: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_ec2.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_ec2: {
            service_name: "ec2",
          },
        },
      },
      resource: {
        aws_iam_instance_profile: {
          InstanceProfile_9F2F41CB: {
            name: "MyInstanceProfile",
            role: "${aws_iam_role.InstanceProfile_InstanceRole_3FE337A6.name}",
            tags: {
              Name: "Test-InstanceProfile",
            },
          },
        },
        aws_iam_role: {
          InstanceProfile_InstanceRole_3FE337A6: {
            assume_role_policy:
              "${data.aws_iam_policy_document.InstanceProfile_InstanceRole_AssumeRolePolicy_58D2B4B4.json}",
            name: "MyInstanceProfile-role",
            tags: {
              Name: "Test-InstanceProfile",
            },
          },
        },
      },
    });
  });

  test("given instance profile path", () => {
    // WHEN
    new InstanceProfile(stack, "InstanceProfile", {
      path: "/sample/path/",
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          InstanceProfile_InstanceRole_AssumeRolePolicy_58D2B4B4: {
            statement: [
              {
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [
                      "${data.aws_service_principal.aws_svcp_default_region_ec2.name}",
                    ],
                    type: "Service",
                  },
                ],
              },
            ],
          },
        },
        aws_service_principal: {
          aws_svcp_default_region_ec2: {
            service_name: "ec2",
          },
        },
      },
      resource: {
        aws_iam_instance_profile: {
          InstanceProfile_9F2F41CB: {
            name: "123e4567-e89b-12d3MyStackInstanceProfileF6A8DB39",
            path: "/sample/path/",
            role: "${aws_iam_role.InstanceProfile_InstanceRole_3FE337A6.name}",
            tags: {
              Name: "Test-InstanceProfile",
            },
          },
        },
        aws_iam_role: {
          InstanceProfile_InstanceRole_3FE337A6: {
            assume_role_policy:
              "${data.aws_iam_policy_document.InstanceProfile_InstanceRole_AssumeRolePolicy_58D2B4B4.json}",
            name: "123e4567-e89b-12d3MyStackInstanceProfileF6A8DB39-role",
            tags: {
              Name: "Test-InstanceProfile",
            },
          },
        },
      },
    });
  });

  test("instance profile imported by name has an arn", () => {
    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileName(
      stack,
      "InstanceProfile",
      "path/MyInstanceProfile",
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileArn)).toStrictEqual(
      "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:instance-profile/path/MyInstanceProfile",
    );
  });

  test("instance profile imported by arn has a name", () => {
    const instanceProfileName = "MyInstanceProfile";

    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileArn(
      stack,
      "InstanceProfile",
      `arn:aws:iam::account-id:instance-profile/${instanceProfileName}`,
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      instanceProfileName,
    );
  });

  test("instance profile imported by tokenzied arn has a name", () => {
    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileArn(
      stack,
      "InstanceProfile",
      Token.asString({ Ref: "ARN" }),
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      // Token.asString({ Ref: ARN }) is rendered as is.
      '${element(split(":instance-profile/", {"Ref" = "ARN"}), 1)}',
    );
  });

  test("instance profile imported by arn with path", () => {
    const instanceProfileName = "MyInstanceProfile";

    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileArn(
      stack,
      "InstanceProfile",
      `arn:aws:iam::account-id:instance-profile/path/${instanceProfileName}`,
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      instanceProfileName,
    );
  });

  test("instance profile imported by arn with multiple element path", () => {
    const instanceProfileName = "MyInstanceProfile";

    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileArn(
      stack,
      "InstanceProfile",
      `arn:aws:iam::account-id:instance-profile/p/a/t/h/${instanceProfileName}`,
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      instanceProfileName,
    );
  });

  test("instance profile imported by attributes has a name and a role", () => {
    const instanceProfileName = "MyInstanceProfile";
    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });

    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileAttributes(
      stack,
      "InstanceProfile",
      {
        instanceProfileArn: `arn:aws:iam::account-id:instance-profile/${instanceProfileName}`,
        role,
      },
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      instanceProfileName,
    );
    expect(stack.resolve(instanceProfile.role?.roleName)).toStrictEqual(
      stack.resolve(role.roleName),
    );
  });

  test("instance profile imported by tokenzied arn attribute has a name", () => {
    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileAttributes(
      stack,
      "InstanceProfile",
      {
        instanceProfileArn: Token.asString({ Ref: "ARN" }),
      },
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      // Token.asString({ Ref: ARN }) is rendered as is.
      '${element(split(":instance-profile/", {"Ref" = "ARN"}), 1)}',
    );
  });

  test("instance profile imported by arn attribute with path has a name", () => {
    const instanceProfileName = "MyInstanceProfile";

    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileArn(
      stack,
      "InstanceProfile",
      `arn:aws:iam::account-id:instance-profile/path/${instanceProfileName}`,
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      instanceProfileName,
    );
  });

  test("instance profile imported by an arn attribute with multiple element path has a name", () => {
    const instanceProfileName = "MyInstanceProfile";

    // WHEN
    const instanceProfile = InstanceProfile.fromInstanceProfileArn(
      stack,
      "InstanceProfile",
      `arn:aws:iam::account-id:instance-profile/p/a/t/h/${instanceProfileName}`,
    );

    // THEN
    expect(stack.resolve(instanceProfile.instanceProfileName)).toStrictEqual(
      instanceProfileName,
    );
  });
});

// // TODO: Cross Stack tests
// test("cross-env instance profile ARNs include path", () => {
//   // GIVEN
//   const app = new Testing.App();
//   const instanceProfileStack = new AwsStack(app, "instance-profile-stack", {
//     env: { account: "123456789012", region: "us-east-1" },
//   });
//   const referencerStack = new AwsStack(app, "referencer-stack", {
//     env: { region: "us-east-2" },
//   });
//   const role = new Role(instanceProfileStack, "Role", {
//     assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
//   });
//   const instanceProfile = new InstanceProfile(
//     instanceProfileStack,
//     "InstanceProfile",
//     {
//       role,
//       path: "/sample/path/",
//       instanceProfileName: "sample-name",
//     },
//   );

//   // WHEN
//   new TerraformResource(referencerStack, "Referencer", {
//     type: "Custom::InstanceProfileReferencer",
//     properties: { InstanceProfileArn: instanceProfile.instanceProfileArn },
//   });

//   // THEN
//   Template.fromStack(referencerStack).hasResourceProperties(
//     "Custom::InstanceProfileReferencer",
//     {
//       InstanceProfileArn: {
//         "Fn::Join": [
//           "",
//           [
//             "arn:",
//             {
//               Ref: "AWS::Partition",
//             },
//             ":iam::123456789012:instance-profile/sample/path/sample-name",
//           ],
//         ],
//       },
//     },
//   );
// });
