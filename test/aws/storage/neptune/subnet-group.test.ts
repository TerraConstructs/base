// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/subnet-group.test.ts

import { neptuneSubnetGroup } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as neptune from "../../../../src/aws/storage/neptune";
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
  // upstream 1:1 (mirrors `../rds/subnet-group.test.ts`'s identical adaptation) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/subnet-group.test.ts#L11
  vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
});

test("creates a subnet group from minimal properties", () => {
  new neptune.SubnetGroup(stack, "Group", {
    description: "MyGroup",
    vpc,
  });

  const t = new Template(stack, { snapshot: true });
  t.expect.toHaveResourceWithProperties(neptuneSubnetGroup.NeptuneSubnetGroup, {
    description: "MyGroup",
    subnet_ids: [
      stack.resolve(vpc.privateSubnets[0].subnetId),
      stack.resolve(vpc.privateSubnets[1].subnetId),
    ],
  });
});

test("creates a subnet group from all properties", () => {
  new neptune.SubnetGroup(stack, "Group", {
    description: "My Shared Group",
    subnetGroupName: "SharedGroup",
    vpc,
    vpcSubnets: { subnetType: compute.SubnetType.PRIVATE_WITH_EGRESS },
  });

  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(neptuneSubnetGroup.NeptuneSubnetGroup, {
    description: "My Shared Group",
    // TERRACONSTRUCTS DEVIATION: Neptune stores subnet group names lowercase server-side (see
    // `SubnetGroup`'s naming note in `../../../../src/aws/storage/neptune/subnet-group.ts`).
    name: "sharedgroup",
    subnet_ids: [
      stack.resolve(vpc.privateSubnets[0].subnetId),
      stack.resolve(vpc.privateSubnets[1].subnetId),
    ],
  });
});

describe("subnet selection", () => {
  test("defaults to private subnets", () => {
    new neptune.SubnetGroup(stack, "Group", {
      description: "MyGroup",
      vpc,
    });

    const t = new Template(stack);
    t.resourceCountIs(neptuneSubnetGroup.NeptuneSubnetGroup, 1);
    t.expect.toHaveResourceWithProperties(
      neptuneSubnetGroup.NeptuneSubnetGroup,
      {
        description: "MyGroup",
        subnet_ids: [
          stack.resolve(vpc.privateSubnets[0].subnetId),
          stack.resolve(vpc.privateSubnets[1].subnetId),
        ],
      },
    );
  });

  test("can specify subnet type", () => {
    new neptune.SubnetGroup(stack, "Group", {
      description: "MyGroup",
      vpc,
      vpcSubnets: { subnetType: compute.SubnetType.PUBLIC },
    });

    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneSubnetGroup.NeptuneSubnetGroup,
      {
        description: "MyGroup",
        subnet_ids: [
          stack.resolve(vpc.publicSubnets[0].subnetId),
          stack.resolve(vpc.publicSubnets[1].subnetId),
        ],
      },
    );
  });
});

test("import group by name", () => {
  const subnetGroup = neptune.SubnetGroup.fromSubnetGroupName(
    stack,
    "Group",
    "my-subnet-group",
  );

  expect(subnetGroup.subnetGroupName).toEqual("my-subnet-group");
});
