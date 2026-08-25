// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-neptune-alpha/test/instance.test.ts

import { neptuneClusterInstance } from "@cdktn/provider-aws";
import { App, TerraformVariable, Testing, Tokenization } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsConstructBase, AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as compute from "../../../../src/aws/compute";
import * as iam from "../../../../src/aws/iam";
import * as neptune from "../../../../src/aws/storage/neptune";
import { Annotations, Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

/**
 * TEST-ONLY adapter implementing `neptune.IDatabaseCluster` directly on top of a bare
 * `compute.Connections`/identifier pair. This fixture stands in for the real `DatabaseCluster`
 * construct (`cluster.ts`) so `DatabaseInstance` (which requires a `neptune.IDatabaseCluster`) can
 * be exercised in isolation from `DatabaseCluster`'s own subnet-group/security-group machinery.
 * Mirrors the `TestDatabaseCluster` TEST-ONLY adapter pattern in `../docdb/instance.test.ts`.
 */
class TestDatabaseCluster
  extends AwsConstructBase
  implements neptune.IDatabaseCluster
{
  public readonly clusterIdentifier: string;
  public readonly clusterResourceIdentifier: string;
  public readonly clusterEndpoint: neptune.Endpoint;
  public readonly clusterReadEndpoint: neptune.Endpoint;
  public readonly connections: compute.Connections;

  constructor(scope: Construct, id: string) {
    super(scope, id, {});

    this.clusterIdentifier = "test-cluster";
    this.clusterResourceIdentifier = "cluster-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    this.clusterEndpoint = new neptune.Endpoint("cluster.endpoint", 8182);
    this.clusterReadEndpoint = new neptune.Endpoint(
      "cluster.reader.endpoint",
      8182,
    );
    this.connections = new compute.Connections();
  }

  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [
        this.stack.formatArn({
          service: "neptune-db",
          resource: this.clusterResourceIdentifier,
          resourceName: "*",
        }),
      ],
    });
  }

  public grantConnect(grantee: iam.IGrantable): iam.Grant {
    return this.grant(grantee, "neptune-db:connect");
  }

  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/Neptune",
      dimensionsMap: { DBClusterIdentifier: this.clusterIdentifier },
      metricName,
      ...props,
    });
  }

  public get outputs(): Record<string, any> {
    return { identifier: this.clusterIdentifier };
  }
}

let app: App;
let stack: AwsStack;
let cluster: neptune.IDatabaseCluster;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
  cluster = new TestDatabaseCluster(stack, "Database");
});

describe("DatabaseInstance", () => {
  test("check that instantiation works", () => {
    // WHEN
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    const t = new Template(stack, { snapshot: true });
    t.expect.toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        cluster_identifier: stack.resolve(cluster.clusterIdentifier),
        instance_class: "db.r5.large",
      },
    );
  });

  test("check that the endpoint works", () => {
    // WHEN
    const instance = new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    expect(stack.resolve(instance.instanceEndpoint.port)).toEqual(
      stack.resolve(instance.resource.port),
    );
    // Built from the L1 attribute references directly (NOT from instanceEndpoint's own fields)
    // so this fails if socketAddress ever stops interpolating hostname:port.
    expect(stack.resolve(instance.instanceEndpoint.socketAddress)).toEqual(
      stack.resolve(
        `${instance.resource.endpoint}:${Tokenization.stringifyNumber(instance.resource.port)}`,
      ),
    );
  });

  test("check importing works as expected", () => {
    // GIVEN
    const instanceEndpointAddress = "127.0.0.1";
    const instanceIdentifier = "InstanceID";
    const port = 8888;

    // WHEN
    const instance = neptune.DatabaseInstance.fromDatabaseInstanceAttributes(
      stack,
      "ImportedInstance",
      {
        instanceEndpointAddress,
        instanceIdentifier,
        port,
      },
    );

    // THEN
    expect(instance.instanceIdentifier).toEqual(instanceIdentifier);
    expect(instance.instanceEndpoint.socketAddress).toEqual(
      `${instanceEndpointAddress}:${port}`,
    );
  });

  test("instance with parameter group", () => {
    // WHEN
    const group = new neptune.ParameterGroup(stack, "Params", {
      description: "bye",
      parameters: {
        param: "value",
      },
    });
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
      parameterGroup: group,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        neptune_parameter_group_name: stack.resolve(group.parameterGroupName),
      },
    );
  });

  test.each([true, false])(
    "instance with auto minor version upgrade: %p",
    (autoMinorVersionUpgrade) => {
      // WHEN
      new neptune.DatabaseInstance(stack, "Instance", {
        cluster,
        instanceType: neptune.InstanceType.R5_LARGE,
        autoMinorVersionUpgrade,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        neptuneClusterInstance.NeptuneClusterInstance,
        {
          auto_minor_version_upgrade: autoMinorVersionUpgrade,
        },
      );
    },
  );

  test("autoMinorVersionUpgrade left unset when not provided", () => {
    // WHEN
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      neptuneClusterInstance.NeptuneClusterInstance,
    ) as any[];
    expect(resource.auto_minor_version_upgrade).toBeUndefined();
  });

  test("instance type from a token", () => {
    // GIVEN
    const instanceType = new TerraformVariable(stack, "NeptuneInstanceType", {
      type: "string",
      default: "db.r5.8xlarge",
    });

    // WHEN
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.of(instanceType.stringValue),
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      neptuneClusterInstance.NeptuneClusterInstance,
    ) as any[];
    expect(stack.resolve(resource.instance_class)).toEqual(
      stack.resolve(instanceType.stringValue),
    );
  });

  test("instance type from string throws if missing db prefix", () => {
    expect(() => {
      neptune.InstanceType.of("r5.xlarge");
    }).toThrow(/instance type must start with 'db.'/);
  });

  test("metric - constructs metric with correct namespace and dimension and inputs", () => {
    // GIVEN
    const instance = new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // WHEN
    const metric = instance.metric("SparqlRequestsPerSec");
    new cloudwatch.Alarm(stack, "Alarm", {
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      metric,
    });

    // THEN
    expect(metric).toEqual(
      new cloudwatch.Metric({
        namespace: "AWS/Neptune",
        dimensionsMap: {
          DBInstanceIdentifier: instance.instanceIdentifier,
        },
        metricName: "SparqlRequestsPerSec",
      }),
    );
  });

  test("should instantiate a serverless instance", () => {
    // WHEN
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.SERVERLESS,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        instance_class: "db.serverless",
      },
    );
  });

  test("instance identifier defaults to a gridUUID-scoped, lowercased generated name", () => {
    // WHEN
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
    });

    // THEN
    const t = new Template(stack);
    const [resource] = t.resourceTypeArray(
      neptuneClusterInstance.NeptuneClusterInstance,
    ) as any[];
    expect(resource.identifier).toEqual(expect.any(String));
    expect(resource.identifier).toEqual(resource.identifier.toLowerCase());
  });

  test("an explicit dbInstanceName is lowercased", () => {
    // WHEN
    new neptune.DatabaseInstance(stack, "Instance", {
      cluster,
      instanceType: neptune.InstanceType.R5_LARGE,
      dbInstanceName: "MyInstanceName",
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      neptuneClusterInstance.NeptuneClusterInstance,
      {
        identifier: "myinstancename",
      },
    );
  });

  describe("skipFinalSnapshot", () => {
    test("passes through to the underlying resource", () => {
      // WHEN
      new neptune.DatabaseInstance(stack, "Instance", {
        cluster,
        instanceType: neptune.InstanceType.R5_LARGE,
        skipFinalSnapshot: true,
      });

      // THEN
      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        neptuneClusterInstance.NeptuneClusterInstance,
        {
          skip_final_snapshot: true,
        },
      );
    });

    test("warns when not set to true", () => {
      // WHEN
      new neptune.DatabaseInstance(stack, "Instance", {
        cluster,
        instanceType: neptune.InstanceType.R5_LARGE,
      });

      // THEN
      const warnings = Annotations.fromStack(stack).warnings;
      expect(
        warnings.some((w) =>
          w.message.toString().includes("skipFinalSnapshot"),
        ),
      ).toEqual(true);
    });

    test("does not warn when true", () => {
      // WHEN
      new neptune.DatabaseInstance(stack, "Instance", {
        cluster,
        instanceType: neptune.InstanceType.R5_LARGE,
        skipFinalSnapshot: true,
      });

      // THEN
      const warnings = Annotations.fromStack(stack).warnings;
      expect(
        warnings.some((w) =>
          w.message.toString().includes("skipFinalSnapshot"),
        ),
      ).toEqual(false);
    });
  });
});
