// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/parameter-group.test.ts

import {
  dbParameterGroup,
  rdsClusterParameterGroup,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
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

// TERRACONSTRUCTS DEVIATION: upstream engines (`DatabaseClusterEngine.AURORA_MYSQL`) come from
// `instance-engine.ts`/`cluster-engine.ts`, which land in a later PR (RDS PR 2b). This minimal
// `IEngine` stand-in only carries the `parameterGroupFamily` this suite reads —
// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/parameter-group.test.ts#L3
const AURORA_MYSQL: IEngine = {
  engineType: "aurora-mysql",
  parameterGroupFamily: "aurora-mysql5.7",
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

describe("parameter group", () => {
  test("does not create a parameter group if it wasn't bound to a cluster or instance", () => {
    // WHEN
    new rds.ParameterGroup(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.resourceCountIs(dbParameterGroup.DbParameterGroup, 0);
    t.resourceCountIs(rdsClusterParameterGroup.RdsClusterParameterGroup, 0);
  });

  test("create instance parameter group explicitly with forInstance() static method", () => {
    // WHEN
    rds.ParameterGroup.forInstance(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      name: "name",
      parameters: {
        key: "value",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      dbParameterGroup.DbParameterGroup,
      {
        name: "name",
        description: "desc",
        family: "aurora-mysql5.7",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test("create cluster parameter group explicitly with forCluster() static method", () => {
    // WHEN
    rds.ParameterGroup.forCluster(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      name: "name",
      parameters: {
        key: "value",
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      rdsClusterParameterGroup.RdsClusterParameterGroup,
      {
        name: "name",
        description: "desc",
        family: "aurora-mysql5.7",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test("can create both instance and cluster parameter groups", () => {
    // WHEN
    rds.ParameterGroup.forInstance(stack, "InstanceParams", {
      engine: AURORA_MYSQL,
      description: "instance desc",
      parameters: {
        key: "value",
      },
    });
    rds.ParameterGroup.forCluster(stack, "ClusterParams", {
      engine: AURORA_MYSQL,
      description: "cluster desc",
      parameters: {
        key: "value",
      },
    });

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(dbParameterGroup.DbParameterGroup, 1);
    t.resourceCountIs(rdsClusterParameterGroup.RdsClusterParameterGroup, 1);
  });

  test("create a parameter group when bound to an instance", () => {
    // WHEN
    const parameterGroup = new rds.ParameterGroup(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      name: "name",
      parameters: {
        key: "value",
      },
    });
    parameterGroup.bindToInstance({});

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      dbParameterGroup.DbParameterGroup,
      {
        name: "name",
        description: "desc",
        family: "aurora-mysql5.7",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test("create a parameter group when bound to a cluster", () => {
    // WHEN
    const parameterGroup = new rds.ParameterGroup(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      name: "name",
      parameters: {
        key: "value",
      },
    });
    parameterGroup.bindToCluster({});

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      rdsClusterParameterGroup.RdsClusterParameterGroup,
      {
        name: "name",
        description: "desc",
        family: "aurora-mysql5.7",
        parameter: [{ name: "key", value: "value" }],
      },
    );
  });

  test("creates 2 parameter groups when bound to a cluster and an instance", () => {
    // WHEN
    const parameterGroup = new rds.ParameterGroup(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      parameters: {
        key: "value",
      },
    });
    parameterGroup.bindToCluster({});
    parameterGroup.bindToInstance({});

    // THEN
    const t = new Template(stack);
    t.resourceCountIs(dbParameterGroup.DbParameterGroup, 1);
    t.resourceCountIs(rdsClusterParameterGroup.RdsClusterParameterGroup, 1);
  });

  // TODO: omitted — "...they have the correct removal policy" / "removal policy is applied when
  // using forInstance() and forCluster() methods": both depend on `cdk.RemovalPolicy`, which is
  // not ported in this repo (see the TERRACONSTRUCTS DEVIATION note on
  // `ParameterGroupProps.removalPolicy` in `../../../../src/aws/storage/rds/parameter-group.ts`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/parameter-group.test.ts#L171-L226

  test("addParameter() works with forInstance() static method", () => {
    // WHEN
    const parameterGroup = rds.ParameterGroup.forInstance(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      parameters: {
        key1: "value1",
      },
    });
    parameterGroup.addParameter("key2", "value2");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      dbParameterGroup.DbParameterGroup,
      {
        description: "desc",
        family: "aurora-mysql5.7",
        parameter: [
          { name: "key1", value: "value1" },
          { name: "key2", value: "value2" },
        ],
      },
    );
  });

  test("Add an additional parameter to an existing parameter group with bindToCluster()", () => {
    // WHEN
    const clusterParameterGroup = new rds.ParameterGroup(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      parameters: {
        key1: "value1",
      },
    });
    clusterParameterGroup.bindToCluster({});
    clusterParameterGroup.addParameter("key2", "value2");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      rdsClusterParameterGroup.RdsClusterParameterGroup,
      {
        description: "desc",
        family: "aurora-mysql5.7",
        parameter: [
          { name: "key1", value: "value1" },
          { name: "key2", value: "value2" },
        ],
      },
    );
  });

  test("backward compatibility: bindToInstance after forInstance() returns existing resource", () => {
    // WHEN
    const parameterGroup = rds.ParameterGroup.forInstance(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      parameters: {
        key: "value",
      },
    });
    parameterGroup.bindToInstance({});

    // THEN - should only have 1 resource, not 2
    const t = new Template(stack);
    t.resourceCountIs(dbParameterGroup.DbParameterGroup, 1);
  });

  test("backward compatibility: bindToCluster after forCluster() returns existing resource", () => {
    // WHEN
    const parameterGroup = rds.ParameterGroup.forCluster(stack, "Params", {
      engine: AURORA_MYSQL,
      description: "desc",
      parameters: {
        key: "value",
      },
    });
    parameterGroup.bindToCluster({});

    // THEN - should only have 1 resource, not 2
    const t = new Template(stack);
    t.resourceCountIs(rdsClusterParameterGroup.RdsClusterParameterGroup, 1);
  });
});
