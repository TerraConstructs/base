// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-rds/test/proxy-endpoint.test.ts

import { dbProxyEndpoint } from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
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
  vpc = new compute.Vpc(stack, "VPC", { maxAzs: 2 });
});

describe("Proxy endpoint", () => {
  test("create a DB proxy from an instance", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_4_5,
      }),
      vpc,
    });

    const dbProxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // WHEN
    new rds.DatabaseProxyEndpoint(stack, "ProxyEndpoint", {
      dbProxy,
      vpc,
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(dbProxyEndpoint.DbProxyEndpoint, {
      db_proxy_name: stack.resolve(dbProxy.dbProxyName),
    });
  });

  test("can specify targetRole", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_4_5,
      }),
      vpc,
    });

    const dbProxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    // WHEN
    new rds.DatabaseProxyEndpoint(stack, "ProxyEndpoint", {
      dbProxy,
      vpc,
      targetRole: rds.ProxyEndpointTargetRole.READ_ONLY,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxyEndpoint.DbProxyEndpoint, {
      db_proxy_name: stack.resolve(dbProxy.dbProxyName),
      target_role: "READ_ONLY",
    });
  });

  test("can specify security group", () => {
    // GIVEN
    const instance = new rds.DatabaseInstance(stack, "Instance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_4_5,
      }),
      vpc,
    });

    const dbProxy = new rds.DatabaseProxy(stack, "Proxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(instance),
      secrets: [instance.secret!],
      vpc,
    });

    const sg = new compute.SecurityGroup(stack, "SecurityGroup", {
      vpc,
    });

    // WHEN
    new rds.DatabaseProxyEndpoint(stack, "ProxyEndpoint", {
      dbProxyEndpointName: "test",
      dbProxy,
      vpc,
      securityGroups: [sg],
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(dbProxyEndpoint.DbProxyEndpoint, {
      db_proxy_endpoint_name: "test",
      db_proxy_name: stack.resolve(dbProxy.dbProxyName),
      vpc_security_group_ids: [stack.resolve(sg.securityGroupId)],
    });
  });

  test("throw when security group empty", () => {
    expect(() => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_4_5,
        }),
        vpc,
      });

      const dbProxy = new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromInstance(instance),
        secrets: [instance.secret!],
        vpc,
      });

      new rds.DatabaseProxyEndpoint(stack, "ProxyEndpoint", {
        dbProxy,
        vpc,
        securityGroups: [],
      });
    }).toThrow(/`securityGroups` must be undefined or a non-empty array/);
  });

  test("throw when less than 2 subnets", () => {
    expect(() => {
      // GIVEN
      const instance = new rds.DatabaseInstance(stack, "Instance", {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_4_5,
        }),
        vpc,
      });

      const dbProxy = new rds.DatabaseProxy(stack, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromInstance(instance),
        secrets: [instance.secret!],
        vpc,
      });

      new rds.DatabaseProxyEndpoint(stack, "ProxyEndpoint", {
        dbProxy,
        vpc,
        vpcSubnets: vpc.selectSubnets({ subnets: [vpc.privateSubnets[0]] }),
      });
    }).toThrow(/`subnets` requires at least 2 subnets/);
  });

  test("import an existing DB proxy endpoint", () => {
    const imported =
      rds.DatabaseProxyEndpoint.fromDatabaseProxyEndpointAttributes(
        stack,
        "ImportedProxyEndpoint",
        {
          dbProxyEndpointName: "my-proxy-endpoint",
          dbProxyEndpointArn:
            "arn:aws:rds:us-east-1:123456789012:db-proxy-endpoint:prxend-1234abcd",
          endpoint: "my-endpoint",
        },
      );

    expect(imported.dbProxyEndpointName).toEqual("my-proxy-endpoint");
    expect(imported.endpoint).toEqual("my-endpoint");
  });
});
