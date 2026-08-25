// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/parameter-group.test.ts

import {
  neptuneClusterParameterGroup,
  neptuneParameterGroup,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
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
  test("create a cluster parameter group", () => {
    // WHEN
    new neptune.ClusterParameterGroup(stack, "Params", {
      description: "desc",
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(
      neptuneClusterParameterGroup.NeptuneClusterParameterGroup,
      {
        description: "desc",
        family: "neptune1",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test.each([
    ["neptune1", neptune.ParameterGroupFamily.NEPTUNE_1],
    ["neptune1.2", neptune.ParameterGroupFamily.NEPTUNE_1_2],
    ["neptune1.3", neptune.ParameterGroupFamily.NEPTUNE_1_3],
    ["neptune1.4", neptune.ParameterGroupFamily.NEPTUNE_1_4],
  ])(
    "create a cluster parameter group with family %s",
    (expectedFamily, family) => {
      // WHEN
      new neptune.ClusterParameterGroup(stack, "Params", {
        description: "desc",
        family,
        parameters: {
          key: "value",
        },
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        neptuneClusterParameterGroup.NeptuneClusterParameterGroup,
        {
          description: "desc",
          family: expectedFamily,
          parameter: [{ name: "key", value: "value" }],
        },
      );
    },
  );

  test("check automatically generated descriptions", () => {
    // WHEN
    new neptune.ClusterParameterGroup(stack, "Params", {
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneClusterParameterGroup.NeptuneClusterParameterGroup,
      {
        description: "Cluster parameter group for neptune db cluster",
        family: "neptune1",
      },
    );
  });

  test("check that name defaults to a gridUUID-scoped generated name", () => {
    // WHEN
    new neptune.ClusterParameterGroup(stack, "Params", {
      parameters: {},
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      neptuneClusterParameterGroup.NeptuneClusterParameterGroup,
    ) as any[];
    expect(resource.name).toEqual(expect.any(String));
    expect(resource.name).toEqual(resource.name.toLowerCase());
  });

  test("check that an explicit name is honored", () => {
    // WHEN
    new neptune.ClusterParameterGroup(stack, "Params", {
      clusterParameterGroupName: "my-group",
      parameters: {},
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneClusterParameterGroup.NeptuneClusterParameterGroup,
      {
        name: "my-group",
      },
    );
  });

  test("check that fromClusterParameterGroupName imports by name", () => {
    // WHEN
    const group = neptune.ClusterParameterGroup.fromClusterParameterGroupName(
      stack,
      "Imported",
      "my-existing-group",
    );

    // THEN
    expect(group.clusterParameterGroupName).toEqual("my-existing-group");
    const t = new Template(stack);
    t.resourceCountIs(
      neptuneClusterParameterGroup.NeptuneClusterParameterGroup,
      0,
    );
  });
});

describe("ParameterGroup", () => {
  test("create a instance/db parameter group", () => {
    // WHEN
    new neptune.ParameterGroup(stack, "Params", {
      description: "desc",
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(
      neptuneParameterGroup.NeptuneParameterGroup,
      {
        description: "desc",
        family: "neptune1",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test.each([
    ["neptune1", neptune.ParameterGroupFamily.NEPTUNE_1],
    ["neptune1.2", neptune.ParameterGroupFamily.NEPTUNE_1_2],
    ["neptune1.3", neptune.ParameterGroupFamily.NEPTUNE_1_3],
    ["neptune1.4", neptune.ParameterGroupFamily.NEPTUNE_1_4],
  ])(
    "create a instance/db parameter group with family %s",
    (expectedFamily, family) => {
      // WHEN
      new neptune.ParameterGroup(stack, "Params", {
        description: "desc",
        family,
        parameters: {
          key: "value",
        },
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        neptuneParameterGroup.NeptuneParameterGroup,
        {
          description: "desc",
          family: expectedFamily,
          parameter: [{ name: "key", value: "value" }],
        },
      );
    },
  );

  test("check automatically generated descriptions", () => {
    // WHEN
    new neptune.ParameterGroup(stack, "Params", {
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneParameterGroup.NeptuneParameterGroup,
      {
        description: "Instance parameter group for neptune db instances",
        family: "neptune1",
      },
    );
  });

  test("check that name defaults to a gridUUID-scoped generated name", () => {
    // WHEN
    new neptune.ParameterGroup(stack, "Params", {
      parameters: {},
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      neptuneParameterGroup.NeptuneParameterGroup,
    ) as any[];
    expect(resource.name).toEqual(expect.any(String));
    expect(resource.name).toEqual(resource.name.toLowerCase());
  });

  test("check that an explicit name is honored", () => {
    // WHEN
    new neptune.ParameterGroup(stack, "Params", {
      parameterGroupName: "my-group",
      parameters: {},
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneParameterGroup.NeptuneParameterGroup,
      {
        name: "my-group",
      },
    );
  });

  test("check that fromParameterGroupName imports by name", () => {
    // WHEN
    const group = neptune.ParameterGroup.fromParameterGroupName(
      stack,
      "Imported",
      "my-existing-group",
    );

    // THEN
    expect(group.parameterGroupName).toEqual("my-existing-group");
    const t = new Template(stack);
    t.resourceCountIs(neptuneParameterGroup.NeptuneParameterGroup, 0);
  });
});
