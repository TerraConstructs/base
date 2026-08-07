// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/parameter-group.test.ts

import { redshiftParameterGroup } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as redshift from "../../../../src/aws/storage/redshift";
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

test("create a cluster parameter group", () => {
  // WHEN
  new redshift.ClusterParameterGroup(stack, "Params", {
    description: "desc",
    parameters: {
      param: "value",
    },
  });

  // THEN
  const t = new Template(stack, { snapshot: true });
  t.expect.toHaveResourceWithProperties(
    redshiftParameterGroup.RedshiftParameterGroup,
    {
      description: "desc",
      family: "redshift-1.0",
      parameter: [
        {
          name: "param",
          value: "value",
        },
      ],
    },
  );
});

test("check automatically generated descriptions", () => {
  // WHEN
  new redshift.ClusterParameterGroup(stack, "Params", {
    parameters: {
      param: "value",
    },
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    redshiftParameterGroup.RedshiftParameterGroup,
    {
      description: "Cluster parameter group for family redshift-1.0",
      family: "redshift-1.0",
    },
  );
});

test("check that name defaults to a gridUUID-scoped generated name", () => {
  // WHEN
  new redshift.ClusterParameterGroup(stack, "Params", {
    parameters: {},
  });

  // THEN
  const t = new Template(stack);
  const [resource] = t.resourceTypeArray(
    redshiftParameterGroup.RedshiftParameterGroup,
  ) as any[];
  expect(resource.name).toEqual(expect.any(String));
  expect(resource.name).toEqual(resource.name.toLowerCase());
});

test("check that an explicit name is honored", () => {
  // WHEN
  new redshift.ClusterParameterGroup(stack, "Params", {
    clusterParameterGroupName: "my-group",
    parameters: {},
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    redshiftParameterGroup.RedshiftParameterGroup,
    {
      name: "my-group",
    },
  );
});

test("check that fromClusterParameterGroupName imports by name", () => {
  // WHEN
  const group = redshift.ClusterParameterGroup.fromClusterParameterGroupName(
    stack,
    "Imported",
    "my-existing-group",
  );

  // THEN
  expect(group.clusterParameterGroupName).toEqual("my-existing-group");
  const t = new Template(stack);
  t.resourceCountIs(redshiftParameterGroup.RedshiftParameterGroup, 0);
});

describe("Adding parameters to an existing group", () => {
  test("Adding a new parameter", () => {
    // GIVEN
    const params = new redshift.ClusterParameterGroup(stack, "Params", {
      description: "desc",
      parameters: {
        param: "value",
      },
    });

    // WHEN
    params.addParameter("param2", "value2");

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      redshiftParameterGroup.RedshiftParameterGroup,
      {
        description: "desc",
        family: "redshift-1.0",
        parameter: [
          { name: "param", value: "value" },
          { name: "param2", value: "value2" },
        ],
      },
    );
  });

  test("Adding an existing named parameter with the same value", () => {
    // GIVEN
    const params = new redshift.ClusterParameterGroup(stack, "Params", {
      description: "desc",
      parameters: {
        param: "value",
      },
    });

    // WHEN
    params.addParameter("param", "value");

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      redshiftParameterGroup.RedshiftParameterGroup,
      {
        description: "desc",
        family: "redshift-1.0",
        parameter: [{ name: "param", value: "value" }],
      },
    );
  });

  test("Adding an existing named parameter with a different value", () => {
    // GIVEN
    const params = new redshift.ClusterParameterGroup(stack, "Params", {
      description: "desc",
      parameters: {
        param: "value",
      },
    });

    // WHEN
    expect(() => params.addParameter("param", "value2"))
      // THEN
      .toThrow("The parameter group already contains the parameter");
  });
});
