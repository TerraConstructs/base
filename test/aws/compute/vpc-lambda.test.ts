// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-lambda/test/vpc-lambda.test.ts

import * as path from "path";
import {
  dataAwsSecurityGroup,
  dataAwsSubnet,
  dataAwsVpc,
  lambdaFunction,
  vpcSecurityGroupEgressRule,
  vpcSecurityGroupIngressRule,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  Vpc,
  Runtime,
  LambdaFunction,
  InlineCode,
  SubnetType,
  Connections,
  SecurityGroup,
  IConnectable,
  Port,
  PrivateSubnet,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const TEST_APPDIR = path.join(__dirname, "fixtures", "app");
const CDKTFJSON_PATH = path.join(TEST_APPDIR, "cdktf.json");

let app: App;
beforeEach(() => {
  app = Testing.stubVersion(
    new App({
      stackTraces: false,
      context: {
        cdktfJsonPath: path.resolve(__dirname, CDKTFJSON_PATH),
      },
    }),
  );
});

describe("lambda in vpc", () => {
  let stack: AwsStack;
  let vpc: Vpc;
  let fn: LambdaFunction;
  beforeEach(() => {
    stack = getAwsStack("MyStack");
    vpc = new Vpc(stack, "VPC");
    fn = new LambdaFunction(stack, "Lambda", {
      code: new InlineCode("foo"),
      handler: "index.handler",
      runtime: Runtime.NODEJS_LATEST,
      vpc,
      allowAllOutbound: false,
    });
  });
  test("has subnet and securitygroup", () => {
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        vpc_config: {
          security_group_ids: [
            "${aws_security_group.Lambda_SecurityGroup_E74659A1.id}",
          ],
          subnet_ids: [
            "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id}",
            "${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id}",
            "${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
          ],
        },
      },
    );
  });

  test("has all the securitygroups that are passed as a list of SG in props", () => {
    // WHEN
    new LambdaFunction(stack, "LambdaWithCustomSGList", {
      code: new InlineCode("foo"),
      handler: "index.handler",
      runtime: Runtime.NODEJS_LATEST,
      vpc,
      securityGroups: [
        new SecurityGroup(stack, "CustomSecurityGroupA", { vpc }),
        new SecurityGroup(stack, "CustomSecurityGroupB", { vpc }),
      ],
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      lambdaFunction.LambdaFunction,
      {
        vpc_config: {
          security_group_ids: [
            "${aws_security_group.Lambda_SecurityGroup_E74659A1.id}",
          ],
          subnet_ids: [
            "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id}",
            "${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id}",
            "${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
          ],
        },
      },
    );
  });

  test("participates in Connections objects", () => {
    // GIVEN
    const securityGroup = new SecurityGroup(stack, "SomeSecurityGroup", {
      vpc,
    });
    const somethingConnectable = new SomethingConnectable(
      new Connections({ securityGroups: [securityGroup] }),
    );

    // WHEN
    fn.connections.allowTo(
      somethingConnectable,
      Port.allTcp(),
      "Lambda can call connectable",
    );

    // THEN: Lambda can connect to SomeSecurityGroup
    Template.synth(stack).toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        description: "Lambda can call connectable",
        from_port: 0,
        ip_protocol: "tcp",
        referenced_security_group_id:
          "${aws_security_group.SomeSecurityGroup_EF219AD6.id}",
        security_group_id:
          "${aws_security_group.Lambda_SecurityGroup_E74659A1.id}",
        to_port: 65535,
      },
    );

    // THEN: SomeSecurityGroup accepts connections from Lambda
    Template.synth(stack).toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        description: "Lambda can call connectable",
        from_port: 0,
        ip_protocol: "tcp",
        referenced_security_group_id:
          "${aws_security_group.Lambda_SecurityGroup_E74659A1.id}",
        security_group_id:
          "${aws_security_group.SomeSecurityGroup_EF219AD6.id}",
        to_port: 65535,
      },
    );
  });

  test("can still make Connections after export/import", () => {
    // GIVEN
    const stack2 = getAwsStack("stack2");
    const securityGroup = new SecurityGroup(stack2, "SomeSecurityGroup", {
      vpc,
    });
    const somethingConnectable = new SomethingConnectable(
      new Connections({ securityGroups: [securityGroup] }),
    );

    // WHEN
    somethingConnectable.connections.allowFrom(
      fn.connections,
      Port.allTcp(),
      "Lambda can call connectable",
    );

    // THEN: SomeSecurityGroup accepts connections from Lambda
    Template.synth(stack2).toHaveResourceWithProperties(
      vpcSecurityGroupEgressRule.VpcSecurityGroupEgressRule,
      {
        description: "Lambda can call connectable",
        from_port: 0,
        ip_protocol: "tcp",
        referenced_security_group_id:
          "${aws_security_group.SomeSecurityGroup_EF219AD6.id}",
        security_group_id:
          "${data.terraform_remote_state.cross-stack-reference-input-MyStack.outputs.cross-stack-output-aws_security_groupLambda_SecurityGroup_E74659A1id}",
        to_port: 65535,
      },
    );

    // THEN: Lambda can connect to SomeSecurityGroup
    Template.synth(stack2).toHaveResourceWithProperties(
      vpcSecurityGroupIngressRule.VpcSecurityGroupIngressRule,
      {
        description: "Lambda can call connectable",
        from_port: 0,
        ip_protocol: "tcp",
        referenced_security_group_id:
          "${data.terraform_remote_state.cross-stack-reference-input-MyStack.outputs.cross-stack-output-aws_security_groupLambda_SecurityGroup_E74659A1id}",
        security_group_id:
          "${aws_security_group.SomeSecurityGroup_EF219AD6.id}",
        to_port: 65535,
      },
    );
  });
});

test("lambda without VPC throws Error upon accessing connections", () => {
  // GIVEN
  const stack = getAwsStack("stack");
  const lambdaFn = new LambdaFunction(stack, "Lambda", {
    code: new InlineCode("foo"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_LATEST,
  });

  // WHEN
  expect(() => {
    lambdaFn.connections.allowToAnyIpv4(
      Port.allTcp(),
      "Reach for the world Lambda!",
    );
  }).toThrow();
});

test("can pick public subnet for Lambda", () => {
  // GIVEN
  const stack = getAwsStack("stack");
  const vpc = new Vpc(stack, "VPC");

  // WHEN
  new LambdaFunction(stack, "PublicLambda", {
    allowPublicSubnet: true,
    code: new InlineCode("foo"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_LATEST,
    vpc,
    vpcSubnets: { subnetType: SubnetType.PUBLIC },
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      vpc_config: {
        security_group_ids: [
          "${aws_security_group.PublicLambda_SecurityGroup_61D896FD.id}",
        ],
        subnet_ids: [
          "${aws_subnet.VPC_PublicSubnet1_0D1B5E48.id}",
          "${aws_subnet.VPC_PublicSubnet2_E52FD57B.id}",
          "${aws_subnet.VPC_PublicSubnet3_7031327B.id}",
        ],
      },
    },
  );
});

test("can pick private subnet for Lambda", () => {
  // GIVEN
  const stack = getAwsStack("stack");
  const vpc = new Vpc(stack, "VPC");

  // WHEN
  new LambdaFunction(stack, "PrivateLambda", {
    code: new InlineCode("foo"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_LATEST,
    vpc,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      vpc_config: {
        security_group_ids: [
          "${aws_security_group.PrivateLambda_SecurityGroup_F53C8342.id}",
        ],
        subnet_ids: [
          "${aws_subnet.VPC_PrivateSubnet1_05F5A6DA.id}",
          "${aws_subnet.VPC_PrivateSubnet2_8C0AEF3A.id}",
          "${aws_subnet.VPC_PrivateSubnet3_EAEE5839.id}",
        ],
      },
    },
  );
});

test("can pick isolated subnet for Lambda", () => {
  // GIVEN
  const stack = getAwsStack("stack");
  const vpc = new Vpc(stack, "VPC", {
    subnetConfiguration: [
      {
        name: "Isolated",
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    ],
  });

  // WHEN
  new LambdaFunction(stack, "IsolatedLambda", {
    code: new InlineCode("foo"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_LATEST,
    vpc,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    lambdaFunction.LambdaFunction,
    {
      vpc_config: {
        security_group_ids: [
          "${aws_security_group.IsolatedLambda_SecurityGroup_CE25B6A9.id}",
        ],
        subnet_ids: [
          "${aws_subnet.VPC_IsolatedSubnet1_878DBDC3.id}",
          "${aws_subnet.VPC_IsolatedSubnet2_44717885.id}",
          "${aws_subnet.VPC_IsolatedSubnet3_73305576.id}",
        ],
      },
    },
  );
});

test("picking public subnet type is not allowed if not overriding allowPublicSubnet", () => {
  // GIVEN
  const stack = getAwsStack("stack");
  const vpc = new Vpc(stack, "VPC", {
    subnetConfiguration: [
      {
        name: "Public",
        subnetType: SubnetType.PUBLIC,
      },
      {
        name: "Private",
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      {
        name: "Isolated",
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    ],
  });

  // WHEN
  expect(() => {
    new LambdaFunction(stack, "PublicLambda", {
      code: new InlineCode("foo"),
      handler: "index.handler",
      runtime: Runtime.NODEJS_LATEST,
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });
  }).toThrow(/Lambda Functions in a public subnet/);
});

test("specifying vpcSubnets without a vpc throws an Error", () => {
  // GIVEN
  const stack = getAwsStack("stack");

  // WHEN
  expect(() => {
    new LambdaFunction(stack, "Function", {
      code: new InlineCode("foo"),
      handler: "index.handler",
      runtime: Runtime.NODEJS_LATEST,
      vpcSubnets: { subnetType: SubnetType.PRIVATE },
    });
  }).toThrow("Cannot configure 'vpcSubnets' without configuring a VPC");
});

test("can have looked up vpc, subnets and security group in config", () => {
  // GIVEN
  const stack = new AwsStack();
  const vpcName = "vpc-name";
  const vpc = Vpc.fromLookup(stack, "Vpc", {
    vpcName,
  });
  const subnets = ["a", "b", "c"].map((suffix, index) => {
    const subnetName = `${vpcName}-private-${stack.region}${suffix}`;
    return PrivateSubnet.fromSubnetAttributes(vpc, `PrivateSubnet${index}`, {
      subnetName,
    });
  });
  const defaultSecurityGroup = SecurityGroup.fromLookupByName(
    stack,
    "SecurityGroup",
    "default",
    vpc,
    true,
  );

  // WHEN
  new LambdaFunction(stack, "PrivateLambda", {
    code: new InlineCode("foo"),
    handler: "index.handler",
    runtime: Runtime.NODEJS_LATEST,
    vpc,
    vpcSubnets: { subnets },
    securityGroups: [defaultSecurityGroup],
  });

  // THEN
  const t = new Template(stack);
  t.dataSourceCountIs(dataAwsVpc.DataAwsVpc, 1);
  t.dataSourceCountIs(dataAwsSubnet.DataAwsSubnet, 3);
  t.dataSourceCountIs(dataAwsSecurityGroup.DataAwsSecurityGroup, 1);
  t.expect.toHaveResourceWithProperties(lambdaFunction.LambdaFunction, {
    vpc_config: {
      security_group_ids: ["${data.aws_security_group.DataSecurityGroup.id}"],
      subnet_ids: [
        "${data.aws_subnet.Vpc_PrivateSubnet0_3FB0679D.id}",
        "${data.aws_subnet.Vpc_PrivateSubnet1_F6513F49.id}",
        "${data.aws_subnet.Vpc_PrivateSubnet2_53755717.id}",
      ],
    },
  });
});

class SomethingConnectable implements IConnectable {
  constructor(public readonly connections: Connections) {}
}

function getAwsStack(id: string): AwsStack {
  return new AwsStack(app, id, {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
