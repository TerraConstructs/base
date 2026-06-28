// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ec2/test/vpc.from-lookup.test.ts

import * as cxschema from "@aws-cdk/cloud-assembly-schema";
import {
  dataAwsAvailabilityZones,
  dataAwsSubnet,
  dataAwsVpc,
} from "@cdktn/provider-aws";
import { Lazy } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../src/aws";
import {
  GenericLinuxImage,
  Instance,
  InstanceType,
  PublicSubnet,
  SubnetType,
  Vpc,
} from "../../../src/aws/compute";
import {
  ContextProvider,
  GetContextValueOptions,
  GetContextValueResult,
} from "../../../src/aws/context-provider";
import * as cxapi from "../../../src/aws/cx-api";
import { Template } from "../../assertions";

describe("vpc from lookup", () => {
  describe("Vpc.fromLookup()", () => {
    test("requires concrete values", () => {
      // GIVEN
      const stack = new AwsStack();

      expect(() => {
        Vpc.fromLookup(stack, "Vpc", {
          vpcId: Lazy.stringValue({ produce: () => "some-id" }),
        });
      }).toThrow("All arguments to Vpc.fromLookup() must be concrete");
    });

    test("selecting subnets by name from a looked-up VPC does not throw", () => {
      // GIVEN
      const stack = new AwsStack(undefined, undefined, {
        providerConfig: { region: "us-east-1" },
      });
      const vpc = Vpc.fromLookup(stack, "VPC", {
        vpcId: "vpc-1234",
      });

      // WHEN
      vpc.selectSubnets({ subnetName: "Bleep" });

      // THEN: no exception
    });

    test("accepts asymmetric subnets", () => {
      const previous = mockVpcContextProviderWith(
        {
          vpcId: "vpc-1234",
          subnetGroups: [
            {
              name: "Public",
              type: cxapi.VpcSubnetGroupType.PUBLIC,
              subnets: [
                {
                  subnetId: "pub-sub-in-us-east-1a",
                  availabilityZone: "us-east-1a",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pub-sub-in-us-east-1b",
                  availabilityZone: "us-east-1b",
                  routeTableId: "rt-123",
                },
              ],
            },
            {
              name: "Private",
              type: cxapi.VpcSubnetGroupType.PRIVATE,
              subnets: [
                {
                  subnetId: "pri-sub-1-in-us-east-1c",
                  availabilityZone: "us-east-1c",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pri-sub-2-in-us-east-1c",
                  availabilityZone: "us-east-1c",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pri-sub-1-in-us-east-1d",
                  availabilityZone: "us-east-1d",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pri-sub-2-in-us-east-1d",
                  availabilityZone: "us-east-1d",
                  routeTableId: "rt-123",
                },
              ],
            },
          ],
        },
        (options) => {
          expect(options.filter).toEqual({
            isDefault: "true",
          });

          expect(options.subnetGroupNameTag).toEqual(undefined);
        },
      );

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        isDefault: true,
      });

      expect(vpc.availabilityZones).toEqual([
        "us-east-1a",
        "us-east-1b",
        "us-east-1c",
        "us-east-1d",
      ]);
      expect(vpc.publicSubnets.length).toEqual(2);
      expect(vpc.privateSubnets.length).toEqual(4);
      expect(vpc.isolatedSubnets.length).toEqual(0);

      restoreContextProvider(previous);
    });

    test("selectSubnets onePerAz works on imported VPC", () => {
      const previous = mockVpcContextProviderWith(
        {
          vpcId: "vpc-1234",
          subnetGroups: [
            {
              name: "Public",
              type: cxapi.VpcSubnetGroupType.PUBLIC,
              subnets: [
                {
                  subnetId: "pub-sub-in-us-east-1a",
                  availabilityZone: "us-east-1a",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pub-sub-in-us-east-1b",
                  availabilityZone: "us-east-1b",
                  routeTableId: "rt-123",
                },
              ],
            },
            {
              name: "Private",
              type: cxapi.VpcSubnetGroupType.PRIVATE,
              subnets: [
                {
                  subnetId: "pri-sub-1-in-us-east-1c",
                  availabilityZone: "us-east-1c",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pri-sub-2-in-us-east-1c",
                  availabilityZone: "us-east-1c",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pri-sub-1-in-us-east-1d",
                  availabilityZone: "us-east-1d",
                  routeTableId: "rt-123",
                },
                {
                  subnetId: "pri-sub-2-in-us-east-1d",
                  availabilityZone: "us-east-1d",
                  routeTableId: "rt-123",
                },
              ],
            },
          ],
        },
        (options) => {
          expect(options.filter).toEqual({
            isDefault: "true",
          });

          expect(options.subnetGroupNameTag).toEqual(undefined);
        },
      );

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        isDefault: true,
      });

      // WHEN
      const subnets = vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        onePerAz: true,
      });

      // THEN: we got 2 subnets and not 4
      expect(subnets.subnets.map((s) => s.availabilityZone)).toEqual([
        "us-east-1c",
        "us-east-1d",
      ]);

      restoreContextProvider(previous);
    });

    test("AZ in fallback lookup VPC matches AZ in Stack", () => {
      // GIVEN
      const stack = new AwsStack(undefined, "MyTestStack", {
        providerConfig: { region: "us-east-1" },
      });
      const vpc = Vpc.fromLookup(stack, "vpc", { isDefault: true });

      // THEN - fallback VPC has non-empty AZs derived from the stack
      expect(vpc.availabilityZones.length).toEqual(2);
    });

    test("don't crash when using subnetgroup name in lookup VPC", () => {
      // GIVEN
      const stack = new AwsStack(undefined, "MyTestStack", {
        providerConfig: { region: "dummy" },
      });
      const vpc = Vpc.fromLookup(stack, "vpc", { isDefault: true });

      // WHEN
      new Instance(stack, "Instance", {
        vpc,
        instanceType: new InstanceType("t2.large"),
        machineImage: new GenericLinuxImage({ dummy: "ami-1234" }),
        vpcSubnets: {
          subnetGroupName: "application_layer",
        },
      });

      // THEN -- no exception occurred
    });
    test("subnets in imported VPC has all expected attributes", () => {
      const previous = mockVpcContextProviderWith(
        {
          vpcId: "vpc-1234",
          subnetGroups: [
            {
              name: "Public",
              type: cxapi.VpcSubnetGroupType.PUBLIC,
              subnets: [
                {
                  subnetId: "pub-sub-in-us-east-1a",
                  availabilityZone: "us-east-1a",
                  routeTableId: "rt-123",
                  cidr: "10.100.0.0/24",
                },
              ],
            },
          ],
        },
        (options) => {
          expect(options.filter).toEqual({
            isDefault: "true",
          });

          expect(options.subnetGroupNameTag).toEqual(undefined);
        },
      );

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        isDefault: true,
      });

      let subnet = vpc.publicSubnets[0];

      expect(subnet.availabilityZone).toEqual("us-east-1a");
      expect(subnet.subnetId).toEqual("pub-sub-in-us-east-1a");
      expect(subnet.routeTable.routeTableId).toEqual("rt-123");
      expect(subnet.ipv4CidrBlock).toEqual("10.100.0.0/24");

      restoreContextProvider(previous);
    });
    test("passes account and region", () => {
      const previous = mockVpcContextProviderWith(
        {
          vpcId: "vpc-1234",
          subnetGroups: [],
        },
        (options) => {
          expect(options.region).toEqual("region-1234");
        },
      );

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
        region: "region-1234",
      });

      expect(vpc.vpcId).toEqual("vpc-1234");

      restoreContextProvider(previous);
    });

    test("passes region to LookedUpVpc correctly", () => {
      const previous = mockVpcContextProviderWith(
        {
          vpcId: "vpc-1234",
          subnetGroups: [],
          region: "region-1234",
        },
        (options) => {
          expect(options.region).toEqual("region-1234");
        },
      );

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
        region: "region-1234",
      });

      expect(vpc.env.region).toEqual("region-1234");
      restoreContextProvider(previous);
    });

    test("passes owner account id to LookedUpVpc correctly", () => {
      const previous = mockVpcContextProviderWith({
        vpcId: "vpc-1234",
        subnetGroups: [],
        region: "region-1234",
        ownerAccountId: "123456789012",
      });

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
      });
      expect(vpc.env.account).toEqual("123456789012");
      restoreContextProvider(previous);
    });

    test("passes owner account id to context query correctly", () => {
      const previous = mockVpcContextProviderWith(
        {
          vpcId: "vpc-1234",
          subnetGroups: [],
          region: "region-1234",
          ownerAccountId: "123456789012",
        },
        (options) => {
          expect(options.filter["owner-id"]).toEqual("123456789012");
        },
      );

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
        ownerAccountId: "123456789012",
      });
      expect(vpc.env.account).toEqual("123456789012");
      restoreContextProvider(previous);
    });

    test("a looked up VPC in a different region shared from an account has correct VPC", () => {
      const previous = mockVpcContextProviderWith({
        vpcId: "vpc-1234",
        subnetGroups: [],
        region: "region-1234",
        ownerAccountId: "123456789012",
      });
      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
      });
      expect(stack.resolve(vpc.vpcArn)).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ec2:region-1234:123456789012:vpc/vpc-1234",
      );
      restoreContextProvider(previous);
    });

    test("a looked up VPC falls back to the parent stack's account and region", () => {
      const previous = mockVpcContextProviderWith({
        vpcId: "vpc-1234",
        subnetGroups: [],
      });
      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
      });
      expect(stack.resolve(vpc.vpcArn)).toEqual(
        "arn:${data.aws_partition.Partitition.partition}:ec2:${data.aws_region.Region.name}:${data.aws_caller_identity.CallerIdentity.account_id}:vpc/vpc-1234",
      );
      restoreContextProvider(previous);
    });

    test("can have looked up vpc and lookep up subnet", () => {
      // GIVEN
      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcName: "vpc-name",
      });

      // WHEN
      PublicSubnet.fromSubnetAttributes(vpc, "PublicSubnet", {
        subnetName: "public-subnet",
      });

      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(dataAwsVpc.DataAwsVpc, {
        filter: [
          {
            name: "tag:Name",
            values: ["vpc-name"],
          },
        ],
      });
      t.expect.toHaveDataSourceWithProperties(dataAwsSubnet.DataAwsSubnet, {
        filter: [
          {
            name: "tag:Name",
            values: ["public-subnet"],
          },
        ],
      });
    });

    test("cross-region fromLookup passes region to the DataAwsVpc data source", () => {
      // GIVEN
      const stack = new AwsStack(undefined, undefined, {
        providerConfig: { region: "us-east-1" },
      });

      // WHEN
      Vpc.fromLookup(stack, "Vpc", {
        vpcName: "remote-vpc",
        region: "us-west-2",
      });

      // THEN - the synthesized DataAwsVpc data source includes region
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(dataAwsVpc.DataAwsVpc, {
        region: "us-west-2",
        filter: [
          {
            name: "tag:Name",
            values: ["remote-vpc"],
          },
        ],
      });
    });

    test("cross-region fallback resolves availabilityZones for the lookup region", () => {
      // GIVEN - a stack in us-east-1 looking up a VPC in us-west-2
      const stack = new AwsStack(undefined, undefined, {
        providerConfig: { region: "us-east-1" },
      });

      // WHEN - fromLookup with a different region triggers the data-source fallback
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        vpcId: "vpc-1234",
        region: "us-west-2",
      });

      // THEN - the fallback AZs reference a region-scoped data source, not the
      // stack's default-region one (issue #102)
      expect(stack.resolve(vpc.availabilityZones)).toEqual([
        "${element(data.aws_availability_zones.AvailabilityZones_us_west_2.names, 0)}",
        "${element(data.aws_availability_zones.AvailabilityZones_us_west_2.names, 1)}",
      ]);

      // AND - that data source carries the per-resource region argument
      const t = new Template(stack);
      t.expect.toHaveDataSourceWithProperties(
        dataAwsAvailabilityZones.DataAwsAvailabilityZones,
        {
          region: "us-west-2",
        },
      );
    });

    test("fallback lookup VPC preserves availabilityZones from stack when no subnet groups", () => {
      // GIVEN - a stack with a known region so availabilityZones() returns token references
      const stack = new AwsStack(undefined, undefined, {
        providerConfig: { region: "us-east-1" },
      });

      // WHEN - fromLookup with isDefault triggers the fallback (no context provider response)
      const vpc = Vpc.fromLookup(stack, "DefaultVpc", {
        isDefault: true,
      });

      // THEN - availabilityZones is not empty (it uses the stack's AZ data source references)
      expect(vpc.availabilityZones).not.toEqual([]);
      expect(vpc.availabilityZones.length).toBeGreaterThan(0);
    });

    test("looked up VPC with subnet groups still derives AZs from subnets", () => {
      const previous = mockVpcContextProviderWith({
        vpcId: "vpc-1234",
        availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
        subnetGroups: [
          {
            name: "Public",
            type: cxapi.VpcSubnetGroupType.PUBLIC,
            subnets: [
              {
                subnetId: "pub-sub-in-us-east-1a",
                availabilityZone: "us-east-1a",
                routeTableId: "rt-123",
              },
              {
                subnetId: "pub-sub-in-us-east-1b",
                availabilityZone: "us-east-1b",
                routeTableId: "rt-123",
              },
            ],
          },
        ],
      });

      const stack = new AwsStack();
      const vpc = Vpc.fromLookup(stack, "Vpc", {
        isDefault: true,
      });

      // THEN - AZs come from subnet groups, not from props.availabilityZones
      expect(vpc.availabilityZones).toEqual(["us-east-1a", "us-east-1b"]);

      restoreContextProvider(previous);
    });
  });
});

interface MockVpcContextResponse {
  readonly vpcId: string;
  readonly subnetGroups: cxapi.VpcSubnetGroup[];
  readonly availabilityZones?: string[];
  readonly ownerAccountId?: string;
  readonly region?: string;
}

function mockVpcContextProviderWith(
  response: MockVpcContextResponse,
  paramValidator?: (options: cxschema.VpcContextQuery) => void,
) {
  const previous = ContextProvider.getValue;
  ContextProvider.getValue = (
    _scope: Construct,
    options: GetContextValueOptions,
  ) => {
    // do some basic sanity checks
    expect(options.provider).toEqual(cxschema.ContextProvider.VPC_PROVIDER);
    expect(options.props?.returnAsymmetricSubnets).toEqual(true);

    if (paramValidator) {
      paramValidator(options.props as any);
    }

    return {
      value: {
        availabilityZones: [],
        isolatedSubnetIds: undefined,
        isolatedSubnetNames: undefined,
        isolatedSubnetRouteTableIds: undefined,
        privateSubnetIds: undefined,
        privateSubnetNames: undefined,
        privateSubnetRouteTableIds: undefined,
        publicSubnetIds: undefined,
        publicSubnetNames: undefined,
        publicSubnetRouteTableIds: undefined,
        ...response,
      } as cxapi.VpcContextResponse,
    };
  };
  return previous;
}

function restoreContextProvider(
  previous: (
    scope: Construct,
    options: GetContextValueOptions,
  ) => GetContextValueResult,
): void {
  ContextProvider.getValue = previous;
}
