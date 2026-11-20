// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/option-group.test.ts

import { dbOptionGroup, securityGroup } from "@cdktn/provider-aws";
import { App, Testing, Token } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import { IEngine } from "../../../../src/aws/storage/rds";
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

// TERRACONSTRUCTS DEVIATION: upstream's `DatabaseInstanceEngine.oracleSe2({ version:
// OracleEngineVersion.VER_12_1 })` comes from `instance-engine.ts`, which lands in a later PR
// (RDS PR 2b). This minimal `IEngine` stand-in only carries the `engineType`/`engineVersion`
// this suite reads —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/option-group.test.ts#L13-L15
const ORACLE_SE2_12_1: IEngine = {
  engineType: "oracle-se2",
  engineVersion: { fullVersion: "12.1.0.2.v22", majorVersion: "12.1" },
};

let app: App;
let stack: AwsStack;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

describe("option group", () => {
  test("create an option group", () => {
    // WHEN
    new rds.OptionGroup(stack, "Options", {
      engine: ORACLE_SE2_12_1,
      configurations: [
        {
          name: "XMLDB",
        },
      ],
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(dbOptionGroup.DbOptionGroup, {
      engine_name: "oracle-se2",
      major_engine_version: "12.1",
      option: [
        {
          option_name: "XMLDB",
        },
      ],
    });
  });

  test("option group with new security group", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });

    // WHEN
    const optionGroup = new rds.OptionGroup(stack, "Options", {
      engine: ORACLE_SE2_12_1,
      configurations: [
        {
          name: "OEM",
          port: 1158,
          vpc,
        },
      ],
    });
    optionGroup.optionConnections.OEM.connections.allowDefaultPortFromAnyIpv4();

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbOptionGroup.DbOptionGroup, {
      option: [
        {
          option_name: "OEM",
          port: 1158,
          vpc_security_group_memberships: [
            stack.resolve(
              (
                optionGroup.optionConnections.OEM
                  .securityGroups[0] as compute.SecurityGroup
              ).securityGroupId,
            ),
          ],
        },
      ],
    });

    t.resourceTypeArrayContaining(securityGroup.SecurityGroup, [
      expect.objectContaining({
        description: "Security group for OEM option",
        ingress: expect.arrayContaining([
          expect.objectContaining({
            cidr_blocks: ["0.0.0.0/0"],
            description: "from 0.0.0.0/0:1158",
            from_port: 1158,
            protocol: "tcp",
            to_port: 1158,
          }),
        ]),
        vpc_id: stack.resolve(vpc.vpcId),
      }),
    ]);
  });

  test("option group with existing security group", () => {
    // GIVEN
    const vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
    const sg = new compute.SecurityGroup(stack, "CustomSecurityGroup", {
      vpc,
    });

    // WHEN
    new rds.OptionGroup(stack, "Options", {
      engine: ORACLE_SE2_12_1,
      configurations: [
        {
          name: "OEM",
          port: 1158,
          vpc,
          securityGroups: [sg],
        },
      ],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      dbOptionGroup.DbOptionGroup,
      {
        option: [
          {
            option_name: "OEM",
            port: 1158,
            vpc_security_group_memberships: [stack.resolve(sg.securityGroupId)],
          },
        ],
      },
    );
  });

  test("throws when using an option with port and no vpc", () => {
    expect(
      () =>
        new rds.OptionGroup(stack, "Options", {
          engine: ORACLE_SE2_12_1,
          configurations: [
            {
              name: "OEM",
              port: 1158,
            },
          ],
        }),
    ).toThrow(/`port`.*`vpc`/);
  });

  test("option group with option group name", () => {
    const optionGroup = new rds.OptionGroup(stack, "Options", {
      engine: ORACLE_SE2_12_1,
      configurations: [],
      optionGroupName: "my-custom-group",
    });

    expect(optionGroup.optionGroupName).toBe("my-custom-group");

    Template.synth(stack).toHaveResourceWithProperties(
      dbOptionGroup.DbOptionGroup,
      {
        name: "my-custom-group",
      },
    );
  });

  test("option group without option group name gets a uniqueResourceName default", () => {
    const optionGroup = new rds.OptionGroup(stack, "Options", {
      engine: ORACLE_SE2_12_1,
      configurations: [],
    });

    // optionGroupName still surfaces the resource-attribute token (matching
    // upstream's ref behavior); the synthesized name below is what matters.
    expect(Token.isUnresolved(optionGroup.optionGroupName)).toBe(true);

    // TERRACONSTRUCTS DEVIATION: repo invariant -- unnamed resources get a
    // gridUUID-scoped uniqueResourceName default (lowercased), never the
    // provider's opaque terraform-<hash> fallback.
    const t = new Template(stack);
    const [group] = t.resourceTypeArray(dbOptionGroup.DbOptionGroup);
    const name = (group as { name?: string }).name;
    expect(name).toBeDefined();
    expect(name).toEqual(name?.toLowerCase());
    expect(name).toContain("options");
  });
});
