import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { iam, compute, AwsStack } from "../../../src/aws";

describe("TaskRole", () => {
  let stack: AwsStack;
  beforeEach(() => {
    // GIVEN
    const app = Testing.app();
    stack = new AwsStack(app);
  });

  describe("fromRole()", () => {
    test("returns expected roleArn and resource", () => {
      const iamRole = iam.Role.fromRoleArn(
        stack,
        "Role",
        "arn:aws:iam::123456789012:role/example-role",
      );
      const role = compute.TaskRole.fromRole(iamRole);

      expect(stack.resolve(role.roleArn)).toEqual(
        "arn:aws:iam::123456789012:role/example-role",
      );
      expect(role.resource).toEqual(
        "arn:aws:iam::123456789012:role/example-role",
      );
    });
  });

  describe("fromRoleArnJsonPath()", () => {
    test("returns expected roleArn and resource", () => {
      const role = compute.TaskRole.fromRoleArnJsonPath("$.RoleArn");

      expect(stack.resolve(role.roleArn)).toEqual("$.RoleArn");
      expect(role.resource).toEqual("*");
    });

    test("returns expected roleArn and resource", () => {
      expect(() => compute.TaskRole.fromRoleArnJsonPath("RoleArn")).toThrow();
    });
  });
});
