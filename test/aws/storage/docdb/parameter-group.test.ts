// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-docdb/test/parameter-group.test.ts

import { docdbClusterParameterGroup } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as docdb from "../../../../src/aws/storage/docdb";
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
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

describe("ClusterParameterGroup", () => {
  test("check that instantiation works", () => {
    // WHEN
    new docdb.ClusterParameterGroup(stack, "Params", {
      family: "hello",
      description: "desc",
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(
      docdbClusterParameterGroup.DocdbClusterParameterGroup,
      {
        description: "desc",
        family: "hello",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test("check automatically generated descriptions", () => {
    // WHEN
    new docdb.ClusterParameterGroup(stack, "Params", {
      family: "hello",
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterParameterGroup.DocdbClusterParameterGroup,
      {
        description: "Cluster parameter group for hello",
        family: "hello",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test("check that name defaults to a gridUUID-scoped generated name", () => {
    // WHEN
    new docdb.ClusterParameterGroup(stack, "Params", {
      family: "hello",
      parameters: {},
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      docdbClusterParameterGroup.DocdbClusterParameterGroup,
    ) as any[];
    expect(resource.name).toEqual(expect.any(String));
    expect(resource.name).toEqual(resource.name.toLowerCase());
  });

  test("check that an explicit name is honored", () => {
    // WHEN
    new docdb.ClusterParameterGroup(stack, "Params", {
      family: "hello",
      dbClusterParameterGroupName: "my-group",
      parameters: {},
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      docdbClusterParameterGroup.DocdbClusterParameterGroup,
      {
        name: "my-group",
      },
    );
  });

  test("check that fromParameterGroupName imports by name", () => {
    // WHEN
    const group = docdb.ClusterParameterGroup.fromParameterGroupName(
      stack,
      "Imported",
      "my-existing-group",
    );

    // THEN
    expect(group.parameterGroupName).toEqual("my-existing-group");
    const t = new Template(stack);
    t.resourceCountIs(docdbClusterParameterGroup.DocdbClusterParameterGroup, 0);
  });
});
