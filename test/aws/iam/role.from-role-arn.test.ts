import { iamRolePolicy, dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import {
  // TerraformResource,
  Testing,
  Lazy,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Grant } from "../../../src/aws/iam/grant";
import { Policy } from "../../../src/aws/iam/policy";
import { PolicyStatement } from "../../../src/aws/iam/policy-statement";
import {
  AnyPrincipal,
  ArnPrincipal,
  AddToPrincipalPolicyResult,
} from "../../../src/aws/iam/principals";
import { Role, IRole } from "../../../src/aws/iam/role";

const environmentName = "Test";
const gridUUID1 = "123e4567-e89b-12d3";
const gridUUID2 = "123e4567-e89b-12d4";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const roleAccount = "123456789012";
// const notRoleAccount = "012345678901";

describe("IAM Role.fromRoleArn", () => {
  let roleStack: AwsStack;
  let importedRole: IRole;

  describe("imported with a static ARN", () => {
    const roleName = "MyRole";

    describe("into an env-agnostic stack", () => {
      // Print out snapshot for debug..
      const snapshot: boolean = false;
      beforeEach(() => {
        roleStack = getAwsStack("RoleStack", gridUUID1);
        importedRole = Role.fromRoleArn(
          roleStack,
          "ImportedRole",
          `arn:aws:iam::${roleAccount}:role/${roleName}`,
        );
      });

      test("correctly parses the imported role ARN", () => {
        expect(importedRole.roleArn).toBe(
          `arn:aws:iam::${roleAccount}:role/${roleName}`,
        );
      });

      test("correctly parses the imported role name", () => {
        expect(importedRole.roleName).toBe(roleName);
      });

      describe("then adding a PolicyStatement to it", () => {
        let addToPolicyResult: AddToPrincipalPolicyResult;

        beforeEach(() => {
          addToPolicyResult = importedRole.addToPrincipalPolicy(
            somePolicyStatement(),
          );
        });

        test("returns true", () => {
          expect(addToPolicyResult.statementAdded).toBe(true);
        });

        test("generates a default Policy resource pointing at the imported role's physical name", () => {
          assertRoleHasDefaultPolicy(roleStack, roleName, snapshot);
        });
      });

      describe("then attaching a Policy to it", () => {
        let policyStack: AwsStack;

        describe("that belongs to the same stack as the imported role", () => {
          beforeEach(() => {
            importedRole.attachInlinePolicy(somePolicy(roleStack, "MyPolicy"));
          });

          test("correctly attaches the Policy to the imported role", () => {
            assertRoleHasAttachedPolicy(
              roleStack,
              roleName,
              "MyPolicy",
              snapshot,
            );
          });
        });

        describe("that belongs to a different env-agnostic stack", () => {
          beforeEach(() => {
            policyStack = getAwsStack("PolicyStack", gridUUID2);
            // somePolicy is attached to SomeExampleRole in the policyStack
            importedRole.attachInlinePolicy(
              somePolicy(policyStack, "MyPolicy"),
            );
          });

          test("correctly attaches the Policy to the imported role", () => {
            assertRoleHasAttachedPolicy(
              policyStack,
              roleName,
              "MyPolicy",
              snapshot,
            );
          });
        });

        //   describe("that belongs to a targeted stack, with account set to", () => {
        //     describe("the same account as in the ARN of the imported role", () => {
        //       beforeEach(() => {
        //         policyStack = new AwsStack(app, "PolicyStack", {
        //           env: { account: roleAccount },
        //         });
        //         importedRole.attachInlinePolicy(
        //           somePolicy(policyStack, "MyPolicy"),
        //         );
        //       });

        //       test("correctly attaches the Policy to the imported role", () => {
        //         assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
        //       });
        //     });

        //     describe("a different account than in the ARN of the imported role", () => {
        //       beforeEach(() => {
        //         policyStack = new AwsStack(app, "PolicyStack", {
        //           env: { account: notRoleAccount },
        //         });
        //         importedRole.attachInlinePolicy(
        //           somePolicy(policyStack, "MyPolicy"),
        //         );
        //       });

        //       test("does NOT attach the Policy to the imported role", () => {
        //         assertPolicyDidNotAttachToRole(policyStack, "MyPolicy");
        //       });
        //     });
        //   });
        // });
      });

      // describe("into a targeted stack with account set to", () => {
      //   describe("the same account as in the ARN the role was imported with", () => {
      //     beforeEach(() => {
      //       roleStack = new AwsStack(app, "RoleStack", {
      //         env: { account: roleAccount },
      //       });
      //       importedRole = Role.fromRoleArn(
      //         roleStack,
      //         "ImportedRole",
      //         `arn:aws:iam::${roleAccount}:role/${roleName}`,
      //       );
      //     });

      //     describe("then adding a PolicyStatement to it", () => {
      //       let addToPolicyResult: boolean;

      //       beforeEach(() => {
      //         addToPolicyResult = importedRole.addToPolicy(somePolicyStatement());
      //       });

      //       test("returns true", () => {
      //         expect(addToPolicyResult).toBe(true);
      //       });

      //       test("generates a default Policy resource pointing at the imported role's physical name", () => {
      //         assertRoleHasDefaultPolicy(roleStack, roleName);
      //       });
      //     });

      //     describe("then attaching a Policy to it", () => {
      //       describe("that belongs to the same stack as the imported role", () => {
      //         beforeEach(() => {
      //           importedRole.attachInlinePolicy(
      //             somePolicy(roleStack, "MyPolicy"),
      //           );
      //         });

      //         test("correctly attaches the Policy to the imported role", () => {
      //           assertRoleHasAttachedPolicy(roleStack, roleName, "MyPolicy");
      //         });
      //       });

      //       describe("that belongs to an env-agnostic stack", () => {
      //         let policyStack: Stack;

      //         beforeEach(() => {
      //           policyStack = new AwsStack(app, "PolicyStack");
      //           importedRole.attachInlinePolicy(
      //             somePolicy(policyStack, "MyPolicy"),
      //           );
      //         });

      //         test("correctly attaches the Policy to the imported role", () => {
      //           assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
      //         });
      //       });

      //       describe("that belongs to a targeted stack, with account set to", () => {
      //         let policyStack: Stack;

      //         describe("the same account as in the imported role ARN and in the stack the imported role belongs to", () => {
      //           beforeEach(() => {
      //             policyStack = new AwsStack(app, "PolicyStack", {
      //               env: { account: roleAccount },
      //             });
      //             importedRole.attachInlinePolicy(
      //               somePolicy(policyStack, "MyPolicy"),
      //             );
      //           });

      //           test("correctly attaches the Policy to the imported role", () => {
      //             assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
      //           });
      //         });

      //         describe("a different account than in the imported role ARN and in the stack the imported role belongs to", () => {
      //           beforeEach(() => {
      //             policyStack = new AwsStack(app, "PolicyStack", {
      //               env: { account: notRoleAccount },
      //             });
      //             importedRole.attachInlinePolicy(
      //               somePolicy(policyStack, "MyPolicy"),
      //             );
      //           });

      //           test("does NOT attach the Policy to the imported role", () => {
      //             assertPolicyDidNotAttachToRole(policyStack, "MyPolicy");
      //           });
      //         });
      //       });
      //     });
      //   });

      //   describe("a different account than in the ARN the role was imported with", () => {
      //     beforeEach(() => {
      //       roleStack = new AwsStack(app, "RoleStack", {
      //         env: { account: notRoleAccount },
      //       });
      //       importedRole = Role.fromRoleArn(
      //         roleStack,
      //         "ImportedRole",
      //         `arn:aws:iam::${roleAccount}:role/${roleName}`,
      //       );
      //     });

      //     describe("then adding a PolicyStatement to it", () => {
      //       let addToPolicyResult: boolean;

      //       beforeEach(() => {
      //         addToPolicyResult = importedRole.addToPolicy(somePolicyStatement());
      //       });

      //       test("pretends to succeed", () => {
      //         expect(addToPolicyResult).toBe(true);
      //       });

      //       test("does NOT generate a default Policy resource pointing at the imported role's physical name", () => {
      //         Template.fromAwsStack(roleStack).resourceCountIs(
      //           "AWS::IAM::Policy",
      //           0,
      //         );
      //       });
      //     });

      //     describe("then attaching a Policy to it", () => {
      //       describe("that belongs to the same stack as the imported role", () => {
      //         beforeEach(() => {
      //           importedRole.attachInlinePolicy(
      //             somePolicy(roleStack, "MyPolicy"),
      //           );
      //         });

      //         test("does NOT attach the Policy to the imported role", () => {
      //           assertPolicyDidNotAttachToRole(roleStack, "MyPolicy");
      //         });
      //       });

      //       describe("that belongs to an env-agnostic stack", () => {
      //         let policyStack: Stack;

      //         beforeEach(() => {
      //           policyStack = new AwsStack(app, "PolicyStack");
      //           importedRole.attachInlinePolicy(
      //             somePolicy(policyStack, "MyPolicy"),
      //           );
      //         });

      //         test("does NOT attach the Policy to the imported role", () => {
      //           assertPolicyDidNotAttachToRole(policyStack, "MyPolicy");
      //         });
      //       });

      //       describe("that belongs to a different targeted stack, with account set to", () => {
      //         let policyStack: Stack;

      //         describe("the same account as in the ARN of the imported role", () => {
      //           beforeEach(() => {
      //             policyStack = new AwsStack(app, "PolicyStack", {
      //               env: { account: roleAccount },
      //             });
      //             importedRole.attachInlinePolicy(
      //               somePolicy(policyStack, "MyPolicy"),
      //             );
      //           });

      //           test("does NOT attach the Policy to the imported role", () => {
      //             assertPolicyDidNotAttachToRole(policyStack, "MyPolicy");
      //           });
      //         });

      //         describe("the same account as in the stack the imported role belongs to", () => {
      //           beforeEach(() => {
      //             policyStack = new AwsStack(app, "PolicyStack", {
      //               env: { account: notRoleAccount },
      //             });
      //             importedRole.attachInlinePolicy(
      //               somePolicy(policyStack, "MyPolicy"),
      //             );
      //           });

      //           test("does NOT attach the Policy to the imported role", () => {
      //             assertPolicyDidNotAttachToRole(policyStack, "MyPolicy");
      //           });
      //         });

      //         describe("a third account, different from both the role and scope stack accounts", () => {
      //           beforeEach(() => {
      //             policyStack = new AwsStack(app, "PolicyStack", {
      //               env: { account: "some-random-account" },
      //             });
      //             importedRole.attachInlinePolicy(
      //               somePolicy(policyStack, "MyPolicy"),
      //             );
      //           });

      //           test("does NOT attach the Policy to the imported role", () => {
      //             assertPolicyDidNotAttachToRole(policyStack, "MyPolicy");
      //           });
      //         });
      //       });
      //     });
      //   });
    });

    describe("and with mutable=false", () => {
      beforeEach(() => {
        roleStack = getAwsStack("RoleStack", gridUUID1);
        importedRole = Role.fromRoleArn(
          roleStack,
          "ImportedRole",
          `arn:aws:iam::${roleAccount}:role/${roleName}`,
          { mutable: false },
        );
      });

      describe("then adding a PolicyStatement to it", () => {
        let addToPolicyResult: AddToPrincipalPolicyResult;

        beforeEach(() => {
          addToPolicyResult = importedRole.addToPrincipalPolicy(
            somePolicyStatement(),
          );
        });

        // TODO: This should succeed in Terraform?
        test("pretends to succeed", () => {
          expect(addToPolicyResult.statementAdded).toBe(true);
        });

        // TODO: Should this still generate the iam_role_policy_attachment resource in Terraform?
        test("does NOT generate a default Policy resource pointing at the imported role's physical name", () => {
          // Do prepare run to resolve/add all Terraform resources
          roleStack.prepareStack();
          const iamRolePolicies = getResources(
            Testing.synth(roleStack),
            iamRolePolicy.IamRolePolicy.tfResourceType,
          );
          expect(iamRolePolicies.length).toStrictEqual(0);
        });
      });
    });

    describe("and with mutable=false and addGrantsToResources=true", () => {
      beforeEach(() => {
        roleStack = getAwsStack("RoleStack", gridUUID1);
        importedRole = Role.fromRoleArn(
          roleStack,
          "ImportedRole",
          `arn:aws:iam::${roleAccount}:role/${roleName}`,
          { mutable: false, addGrantsToResources: true },
        );
      });

      describe("then adding a PolicyStatement to it", () => {
        let addToPolicyResult: AddToPrincipalPolicyResult;

        beforeEach(() => {
          addToPolicyResult = importedRole.addToPrincipalPolicy(
            somePolicyStatement(),
          );
        });

        test("pretends to fail", () => {
          expect(addToPolicyResult.statementAdded).toBe(false);
        });

        test("does NOT generate a default Policy resource pointing at the imported role's physical name", () => {
          // Do prepare run to resolve/add all Terraform resources
          roleStack.prepareStack();
          const iamRolePolicies = getResources(
            Testing.synth(roleStack),
            iamRolePolicy.IamRolePolicy.tfResourceType,
          );
          expect(iamRolePolicies.length).toStrictEqual(0);
        });
      });
    });

    describe("imported with a user specified default policy name", () => {
      test("user specified default policy is used when fromRoleArn() creates a default policy", () => {
        roleStack = getAwsStack("RoleStack", gridUUID1);
        // new TerraformResource(roleStack, "SomeResource", {
        //   terraformResourceType: "null_test_resource",
        // });
        importedRole = Role.fromRoleArn(
          roleStack,
          "ImportedRole",
          `arn:aws:iam::${roleAccount}:role/${roleName}`,
          { defaultPolicyName: "UserSpecifiedDefaultPolicy" },
        );

        Grant.addToPrincipal({
          actions: ["service:DoAThing"],
          grantee: importedRole,
          resourceArns: ["*"],
        });

        roleStack.prepareStack();
        const synthesized = Testing.synth(roleStack);
        expect(synthesized).toHaveDataSourceWithProperties(
          dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
          {
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["service:DoAThing"],
                resources: ["*"],
              }),
            ]),
          },
        );
        expect(synthesized).toHaveResourceWithProperties(
          iamRolePolicy.IamRolePolicy,
          {
            name: "RoleStackImportedRoleUserSpecifiedDefaultPolicy40D95831",
            policy:
              "${data.aws_iam_policy_document.ImportedRole_UserSpecifiedDefaultPolicy_11DED2C9.json}",
          },
        );
      });

      test("`fromRoleName()` with options matches behavior of `fromRoleArn()`", () => {
        roleStack = getAwsStack("RoleStack", gridUUID1);
        // new TerraformResource(roleStack, "SomeResource", {
        //   terraformResourceType: "null_test_resource",
        // });
        importedRole = Role.fromRoleName(
          roleStack,
          "ImportedRole",
          `${roleName}`,
          { defaultPolicyName: "UserSpecifiedDefaultPolicy" },
        );

        Grant.addToPrincipal({
          actions: ["service:DoAThing"],
          grantee: importedRole,
          resourceArns: ["*"],
        });

        roleStack.prepareStack();
        const synthesized = Testing.synth(roleStack);
        expect(synthesized).toHaveDataSourceWithProperties(
          dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
          {
            statement: expect.arrayContaining([
              expect.objectContaining({
                actions: ["service:DoAThing"],
                resources: ["*"],
              }),
            ]),
          },
        );
        expect(synthesized).toHaveResourceWithProperties(
          iamRolePolicy.IamRolePolicy,
          {
            name: "RoleStackImportedRoleUserSpecifiedDefaultPolicy40D95831",
            policy:
              "${data.aws_iam_policy_document.ImportedRole_UserSpecifiedDefaultPolicy_11DED2C9.json}",
          },
        );
      });
    });
  });

  describe("imported with a dynamic ARN", () => {
    const dynamicValue = Lazy.stringValue({ produce: () => "role-arn" });
    // TF Expression getting role name from ARN
    const roleName =
      '${element(split("/", element(split(":", role-arn), 5)), 1)}';

    describe("into an env-agnostic stack", () => {
      beforeEach(() => {
        roleStack = getAwsStack("RoleStack", gridUUID1);
        importedRole = Role.fromRoleArn(
          roleStack,
          "ImportedRole",
          dynamicValue,
        );
      });

      test("correctly parses the imported role ARN", () => {
        expect(importedRole.roleArn).toBe(dynamicValue);
      });

      test("correctly parses the imported role name", () => {
        new Role(roleStack, "AnyRole", {
          roleName: "AnyRole",
          assumedBy: new ArnPrincipal(importedRole.roleName),
        });

        roleStack.prepareStack();
        const synthesized = Testing.synth(roleStack);
        // expect(synthesized).toMatchSnapshot();
        expect(synthesized).toHaveDataSourceWithProperties(
          dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
          {
            statement: [
              expect.objectContaining({
                actions: ["sts:AssumeRole"],
                effect: "Allow",
                principals: [
                  {
                    identifiers: [roleName],
                    type: "AWS",
                  },
                ],
              }),
            ],
          },
        );
      });

      // print out snapshot for debug
      const snapshot: boolean = false;
      describe("then adding a PolicyStatement to it", () => {
        let addToPolicyResult: AddToPrincipalPolicyResult;

        beforeEach(() => {
          addToPolicyResult = importedRole.addToPrincipalPolicy(
            somePolicyStatement(),
          );
        });

        test("returns true", () => {
          expect(addToPolicyResult.statementAdded).toBe(true);
        });

        test("generates a default Policy resource pointing at the imported role's physical name", () => {
          assertRoleHasDefaultPolicy(roleStack, roleName, snapshot);
        });
      });

      describe("then attaching a Policy to it", () => {
        let policyStack: AwsStack;

        describe("that belongs to the same stack as the imported role", () => {
          beforeEach(() => {
            importedRole.attachInlinePolicy(somePolicy(roleStack, "MyPolicy"));
          });

          test("correctly attaches the Policy to the imported role", () => {
            assertRoleHasAttachedPolicy(
              roleStack,
              roleName,
              "MyPolicy",
              snapshot,
            );
          });
        });

        describe("that belongs to a different env-agnostic stack", () => {
          beforeEach(() => {
            policyStack = getAwsStack("PolicyStack", gridUUID2);
            importedRole.attachInlinePolicy(
              somePolicy(policyStack, "MyPolicy"),
            );
          });

          test("correctly attaches the Policy to the imported role", () => {
            assertRoleHasAttachedPolicy(
              policyStack,
              roleName,
              "MyPolicy",
              snapshot,
            );
          });
        });

        //   describe("that belongs to a targeted stack", () => {
        //     beforeEach(() => {
        //       policyStack = new AwsStack(app, "PolicyStack", {
        //         env: { account: roleAccount },
        //       });
        //       importedRole.attachInlinePolicy(
        //         somePolicy(policyStack, "MyPolicy"),
        //       );
        //     });

        //     test("correctly attaches the Policy to the imported role", () => {
        //       assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
        //     });
        //   });
      });
    });

    // describe("into a targeted stack with account set", () => {
    //   beforeEach(() => {
    //     roleStack = new AwsStack(app, "RoleStack", {
    //       env: { account: roleAccount },
    //     });
    //     importedRole = Role.fromRoleArn(
    //       roleStack,
    //       "ImportedRole",
    //       dynamicValue,
    //     );
    //   });

    //   describe("then adding a PolicyStatement to it", () => {
    //     let addToPolicyResult: boolean;

    //     beforeEach(() => {
    //       addToPolicyResult = importedRole.addToPolicy(somePolicyStatement());
    //     });

    //     test("returns true", () => {
    //       expect(addToPolicyResult).toBe(true);
    //     });

    //     test("generates a default Policy resource pointing at the imported role's physical name", () => {
    //       assertRoleHasDefaultPolicy(roleStack, roleName);
    //     });
    //   });

    //   describe("then attaching a Policy to it", () => {
    //     let policyStack: Stack;

    //     describe("that belongs to the same stack as the imported role", () => {
    //       beforeEach(() => {
    //         importedRole.attachInlinePolicy(somePolicy(roleStack, "MyPolicy"));
    //       });

    //       test("correctly attaches the Policy to the imported role", () => {
    //         assertRoleHasAttachedPolicy(roleStack, roleName, "MyPolicy");
    //       });
    //     });

    //     describe("that belongs to an env-agnostic stack", () => {
    //       beforeEach(() => {
    //         policyStack = new AwsStack(app, "PolicyStack");
    //         importedRole.attachInlinePolicy(
    //           somePolicy(policyStack, "MyPolicy"),
    //         );
    //       });

    //       test("correctly attaches the Policy to the imported role", () => {
    //         assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
    //       });
    //     });

    //     describe("that belongs to a different targeted stack, with account set to", () => {
    //       describe("the same account as the stack the role was imported into", () => {
    //         beforeEach(() => {
    //           policyStack = new AwsStack(app, "PolicyStack", {
    //             env: { account: roleAccount },
    //           });
    //           importedRole.attachInlinePolicy(
    //             somePolicy(policyStack, "MyPolicy"),
    //           );
    //         });

    //         test("correctly attaches the Policy to the imported role", () => {
    //           assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
    //         });
    //       });

    //       describe("a different account than the stack the role was imported into", () => {
    //         beforeEach(() => {
    //           policyStack = new AwsStack(app, "PolicyStack", {
    //             env: { account: notRoleAccount },
    //           });
    //           importedRole.attachInlinePolicy(
    //             somePolicy(policyStack, "MyPolicy"),
    //           );
    //         });

    //         test("correctly attaches the Policy to the imported role", () => {
    //           assertRoleHasAttachedPolicy(policyStack, roleName, "MyPolicy");
    //         });
    //       });
    //     });
    //   });
    // });
  });

  describe("imported with the ARN of a service role", () => {
    // TODO: e2e test attaching Policy to service role!
    beforeEach(() => {
      roleStack = getAwsStack("RoleStack", gridUUID1);
    });

    describe("without a service principal in the role name", () => {
      beforeEach(() => {
        importedRole = Role.fromRoleArn(
          roleStack,
          "Role",
          `arn:aws:iam::${roleAccount}:role/service-role/codebuild-role`,
        );
      });

      it("correctly strips the 'service-role' prefix from the role name", () => {
        new Policy(roleStack, "Policy", {
          statements: [somePolicyStatement()],
          roles: [importedRole],
        });
        roleStack.prepareStack();
        expect(Testing.synth(roleStack)).toHaveResourceWithProperties(
          iamRolePolicy.IamRolePolicy,
          {
            role: "codebuild-role",
          },
        );
      });
    });

    describe("with a service principal in the role name", () => {
      beforeEach(() => {
        importedRole = Role.fromRoleArn(
          roleStack,
          "Role",
          `arn:aws:iam::${roleAccount}:role/aws-service-role/anyservice.amazonaws.com/codebuild-role`,
        );
      });

      it("correctly strips both the 'aws-service-role' prefix and the service principal from the role name", () => {
        new Policy(roleStack, "Policy", {
          statements: [somePolicyStatement()],
          roles: [importedRole],
        });
        roleStack.prepareStack();
        expect(Testing.synth(roleStack)).toHaveResourceWithProperties(
          iamRolePolicy.IamRolePolicy,
          {
            role: "codebuild-role",
          },
        );
      });
    });
  });

  // describe("for an incorrect ARN", () => {
  //   beforeEach(() => {
  //     roleStack = getAwsStack("RoleStack", gridUUID1);
  //   });

  //   describe("that accidentally skipped the 'region' fragment of the ARN", () => {
  //     test("throws an exception, indicating that error", () => {
  //       expect(() => {
  //         Role.fromRoleArn(
  //           roleStack,
  //           "Role",
  //           `arn:${Aws.PARTITION}:iam:${Aws.ACCOUNT_ID}:role/AwsCicd-${Aws.REGION}-CodeBuildRole`,
  //         );
  //       }).toThrow(
  //         /The `resource` component \(6th component\) of an ARN is required:/,
  //       );
  //     });
  //   });
  // });
});

// test("Role.fromRoleName with no options ", () => {
//   const app = new App();
//   const stack = new AwsStack(app, "Stack", {
//     env: { region: "asdf", account: "1234" },
//   });
//   const role = Role.fromRoleName(stack, "MyRole", "MyRole");

//   expect(stack.resolve(role.roleArn)).toEqual({
//     "Fn::Join": [
//       "",
//       ["arn:", { Ref: "AWS::Partition" }, ":iam::1234:role/MyRole"],
//     ],
//   });
// });

function somePolicyStatement() {
  return new PolicyStatement({
    actions: ["s3:*"],
    resources: ["xyz"],
  });
}

function somePolicy(policyStack: AwsStack, policyName: string) {
  const someRole = new Role(policyStack, "SomeExampleRole", {
    assumedBy: new AnyPrincipal(),
  });
  // TODO: overrideLogicalId doesn't seem to work...
  // someRole.resource.overrideLogicalId("SomeRole"); // force a particular logical ID in the Ref expression

  return new Policy(policyStack, "MyPolicy", {
    policyName,
    statements: [somePolicyStatement()],
    // need at least one of user/group/role, otherwise validation fails
    roles: [someRole],
  });
}

function assertRoleHasDefaultPolicy(
  stack: AwsStack,
  roleName: string,
  withSnapshot: boolean = false,
) {
  _assertStackContainsPolicyResource(
    stack,
    [roleName],
    undefined,
    withSnapshot,
  );
}

function assertRoleHasAttachedPolicy(
  stack: AwsStack,
  roleName: string,
  attachedPolicyName: string,
  withSnapshot: boolean = false,
) {
  _assertStackContainsPolicyResource(
    stack,
    ["aws_iam_role.SomeExampleRole", roleName],
    attachedPolicyName,
    withSnapshot,
  );
}

// function assertPolicyDidNotAttachToRole(stack: AwsStack, policyName: string) {
//   _assertStackContainsPolicyResource(
//     stack,
//     [expect.stringContaining("aws_iam_role.SomeRole")],
//     policyName,
//   );
// }

function _assertStackContainsPolicyResource(
  stack: AwsStack,
  roleNames: any[],
  nameOfPolicy: string | undefined,
  withSnapshot: boolean = false,
) {
  // Do prepare run to resolve/add all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  if (withSnapshot) {
    expect(synthesized).toMatchSnapshot();
  }
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: expect.arrayContaining([
        expect.objectContaining({
          actions: ["s3:*"],
          effect: "Allow",
          resources: ["xyz"],
        }),
      ]),
    },
  );
  const iamRolePolicies = getResources(
    synthesized,
    iamRolePolicy.IamRolePolicy.tfResourceType,
  );
  expect(iamRolePolicies.length).toStrictEqual(roleNames.length);
  for (const _roleName of roleNames) {
    expect(iamRolePolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policy: expect.stringContaining("data.aws_iam_policy_document"),
          role: expect.stringContaining(_roleName),
          ...(nameOfPolicy ? { name: nameOfPolicy } : {}),
        }),
      ]),
    );
  }
}

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

function getAwsStack(id: string, gridUUID: string): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, id, {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
