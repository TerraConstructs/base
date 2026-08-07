// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/subnet-group.test.ts

import { dbSubnetGroup } from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as rds from "../../../../src/aws/storage/rds";
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
let vpc: compute.IVpc;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  // TERRACONSTRUCTS DEVIATION: upstream's `new ec2.Vpc(stack, 'VPC')` picks up 2 AZs from the
  // CDK test app's agnostic environment; base's `AwsStack` availability-zone lookup defaults to
  // 3 AZs, so `maxAzs: 2` is pinned here to keep the subnet-count assertions below matching
  // upstream 1:1 — https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/subnet-group.test.ts#L12
  vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
});

describe("subnet group", () => {
  test("creates a subnet group from minimal properties", () => {
    new rds.SubnetGroup(stack, "Group", {
      description: "MyGroup",
      vpc,
    });

    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(dbSubnetGroup.DbSubnetGroup, {
      description: "MyGroup",
      subnet_ids: [
        stack.resolve(vpc.privateSubnets[0].subnetId),
        stack.resolve(vpc.privateSubnets[1].subnetId),
      ],
    });
  });

  test("creates a subnet group from all properties", () => {
    new rds.SubnetGroup(stack, "Group", {
      description: "My Shared Group",
      subnetGroupName: "SharedGroup",
      vpc,
      vpcSubnets: { subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS },
    });

    Template.synth(stack).toHaveResourceWithProperties(
      dbSubnetGroup.DbSubnetGroup,
      {
        description: "My Shared Group",
        name: "sharedgroup",
        // proves the explicit PRIVATE_WITH_EGRESS vpcSubnets selection was honored
        subnet_ids: [
          stack.resolve(vpc.privateSubnets[0].subnetId),
          stack.resolve(vpc.privateSubnets[1].subnetId),
        ],
      },
    );
  });

  test("correctly creates a subnet group with a deploy-time value for its name", () => {
    const parameter = new TerraformVariable(stack, "Parameter", {
      type: "string",
    });
    new rds.SubnetGroup(stack, "Group", {
      description: "My Shared Group",
      subnetGroupName: parameter.stringValue,
      vpc,
      vpcSubnets: { subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS },
    });

    Template.synth(stack).toHaveResourceWithProperties(
      dbSubnetGroup.DbSubnetGroup,
      {
        name: stack.resolve(parameter.stringValue),
      },
    );
  });

  describe("subnet selection", () => {
    test("defaults to private subnets", () => {
      new rds.SubnetGroup(stack, "Group", {
        description: "MyGroup",
        vpc,
      });

      const t = new Template(stack);
      t.resourceCountIs(dbSubnetGroup.DbSubnetGroup, 1);
      t.expect.toHaveResourceWithProperties(dbSubnetGroup.DbSubnetGroup, {
        description: "MyGroup",
        subnet_ids: [
          stack.resolve(vpc.privateSubnets[0].subnetId),
          stack.resolve(vpc.privateSubnets[1].subnetId),
        ],
      });
    });

    test("can specify subnet type", () => {
      new rds.SubnetGroup(stack, "Group", {
        description: "MyGroup",
        vpc,
        vpcSubnets: { subnetType: compute.SubnetType.PUBLIC },
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(dbSubnetGroup.DbSubnetGroup, {
        description: "MyGroup",
        subnet_ids: [
          stack.resolve(vpc.publicSubnets[0].subnetId),
          stack.resolve(vpc.publicSubnets[1].subnetId),
        ],
      });
    });
  });

  test("import group by name", () => {
    const subnetGroup = rds.SubnetGroup.fromSubnetGroupName(
      stack,
      "Group",
      "my-subnet-group",
    );

    expect(subnetGroup.subnetGroupName).toEqual("my-subnet-group");
  });
});
