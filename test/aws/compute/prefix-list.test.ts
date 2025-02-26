// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/ip-addresses.test.ts

import { ec2ManagedPrefixList } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  AddressFamily,
  PrefixList,
} from "../../../src/aws/compute/prefix-list";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("prefix list", () => {
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

  test("default empty prefixlist", () => {
    // GIVEN
    new PrefixList(stack, "prefix-list", {
      maxEntries: 100,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      ec2ManagedPrefixList.Ec2ManagedPrefixList,
      {
        address_family: "IPv4",
        max_entries: 100,
      },
    );
  });
  test("default empty IPv6 prefixlist", () => {
    // GIVEN
    new PrefixList(stack, "prefix-list", {
      maxEntries: 100,
      prefixListName: "prefix-list",
      addressFamily: AddressFamily.IP_V6,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      ec2ManagedPrefixList.Ec2ManagedPrefixList,
      {
        address_family: "IPv6",
        max_entries: 100,
        name: "prefix-list",
      },
    );
  });

  test("prefixlist with entries", () => {
    // GIVEN
    new PrefixList(stack, "prefix-list", {
      entries: [
        { cidr: "10.0.0.1/32" },
        { cidr: "10.0.0.2/32", description: "sample1" },
      ],
      prefixListName: "prefix-list",
    });

    Template.synth(stack).toHaveResourceWithProperties(
      ec2ManagedPrefixList.Ec2ManagedPrefixList,
      {
        address_family: "IPv4",
        max_entries: 2,
        entry: [
          { Cidr: "10.0.0.1/32" },
          { Cidr: "10.0.0.2/32", Description: "sample1" },
        ],
      },
    );
  });

  test("invalid prefixlist name startwith amazon", () => {
    // GIVEN
    expect(() => {
      new PrefixList(stack, "prefix-list", {
        maxEntries: 100,
        prefixListName: "com.amazonawsprefix-list",
      });
    }).toThrow("The name cannot start with 'com.amazonaws.'");
  });

  test("invalid prefixlist-name over 255 characters", () => {
    // GIVEN
    expect(() => {
      new PrefixList(stack, "prefix-list", {
        maxEntries: 100,
        prefixListName: "a".repeat(256),
      });
    }).toThrow("Lengths exceeding 255 characters cannot be set.");
  });

  test("invalid ipv4", () => {
    // GIVEN
    expect(() => {
      new PrefixList(stack, "prefix-list", {
        entries: [
          { cidr: "10.0.0.1/32" },
          { cidr: "::/0", description: "sample1" },
        ],
      });
    }).toThrow("Invalid IPv4 address range: ::/0");
  });

  test("invalid ipv6", () => {
    // GIVEN
    expect(() => {
      new PrefixList(stack, "prefix-list", {
        addressFamily: AddressFamily.IP_V6,
        entries: [
          { cidr: "10.0.0.1/32" },
          { cidr: "::/0", description: "sample1" },
        ],
      });
    }).toThrow("Invalid IPv6 address range: 10.0.0.1/32");
  });
});
