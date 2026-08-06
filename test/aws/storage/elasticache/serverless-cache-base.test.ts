// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/test/serverless-cache-base.test.ts

import {
  cloudwatchMetricAlarm,
  dataAwsIamPolicyDocument,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as cloudwatch from "../../../../src/aws/cloudwatch";
import * as compute from "../../../../src/aws/compute";
import * as iam from "../../../../src/aws/iam";
import * as elasticache from "../../../../src/aws/storage/elasticache";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "a123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

function testStack(app?: App, stackId?: string): AwsStack {
  return new AwsStack(app ?? Testing.app(), stackId ?? "MyStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}

describe("serverless cache base", () => {
  describe("metrics", () => {
    let stack: AwsStack;
    let vpc: compute.Vpc;
    let cache: elasticache.ServerlessCache;
    beforeEach(() => {
      stack = testStack();
      vpc = new compute.Vpc(stack, "VPC");
      cache = new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
      });
    });

    test("creating an alarm based on metric", () => {
      const metric = cache.metric("Metric", {});
      new cloudwatch.Alarm(stack, "Alarm", {
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        metric: metric,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        cloudwatchMetricAlarm.CloudwatchMetricAlarm,
        {
          namespace: "AWS/ElastiCache",
          metric_name: "Metric",
          dimensions: {
            ServerlessCacheName: stack.resolve(cache.serverlessCacheName),
          },
          comparison_operator: "LessThanThreshold",
          evaluation_periods: 1,
          threshold: 1,
        },
      );
    });

    test.each([
      {
        testDescription: "creating an alarm based on cache hit metric",
        methodName: "metricCacheHitCount",
        metricName: "CacheHits",
      },
      {
        testDescription: "creating an alarm based on cache miss count metric",
        methodName: "metricCacheMissCount",
        metricName: "CacheMisses",
      },
      {
        testDescription: "creating an alarm based on cache hit rate metric",
        methodName: "metricCacheHitRate",
        metricName: "CacheHitRate",
      },
      {
        testDescription: "creating an alarm based on cache data stored metric",
        methodName: "metricDataStored",
        metricName: "BytesUsedForCache",
      },
      {
        testDescription:
          "creating an alarm based on cache ECPUs consumed metric",
        methodName: "metricProcessingUnitsConsumed",
        metricName: "ElastiCacheProcessingUnits",
      },
      {
        testDescription:
          "creating an alarm based on cache newtork bytes in metric",
        methodName: "metricNetworkBytesIn",
        metricName: "NetworkBytesIn",
      },
      {
        testDescription:
          "creating an alarm based on cache network bytes out metric",
        methodName: "metricNetworkBytesOut",
        metricName: "NetworkBytesOut",
      },
      {
        testDescription:
          "creating an alarm based on cache active connections metric",
        methodName: "metricActiveConnections",
        metricName: "CurrConnections",
      },
      {
        testDescription:
          "creating an alarm based on cache write request latency metric",
        methodName: "metricWriteRequestLatency",
        metricName: "SuccessfulWriteRequestLatency",
      },
      {
        testDescription:
          "creating an alarm based on cache read request latency metric",
        methodName: "metricReadRequestLatency",
        metricName: "SuccessfulReadRequestLatency",
      },
    ] as const)("$testDescription", ({ methodName, metricName }) => {
      const metric = (cache as any)[methodName]({});
      new cloudwatch.Alarm(stack, "Alarm", {
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        metric: metric,
      });

      const t = new Template(stack);
      t.expect.toHaveResourceWithProperties(
        cloudwatchMetricAlarm.CloudwatchMetricAlarm,
        {
          namespace: "AWS/ElastiCache",
          metric_name: metricName,
          dimensions: {
            ServerlessCacheName: stack.resolve(cache.serverlessCacheName),
          },
          comparison_operator: "LessThanThreshold",
          evaluation_periods: 1,
          threshold: 1,
        },
      );
    });
  });

  describe("IAM permissions", () => {
    let role: iam.Role;
    let stack: AwsStack;
    let vpc: compute.Vpc;
    let cache: elasticache.ServerlessCache;

    beforeEach(() => {
      stack = testStack();
      vpc = new compute.Vpc(stack, "VPC");
      cache = new elasticache.ServerlessCache(stack, "Cache", {
        vpc,
      });
      role = new iam.Role(stack, "TestRole", {
        assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      });
    });

    test("grantConnect adds correct permissions", () => {
      cache.grantConnect(role);

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "elasticache:Connect",
                "elasticache:DescribeServerlessCaches",
              ],
              effect: "Allow",
              resources: [stack.resolve(cache.serverlessCacheArn)],
            },
          ],
        },
      );
    });

    test("grant adds custom IAM permissions", () => {
      cache.grant(role, "elasticache:Connect");

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["elasticache:Connect"],
              effect: "Allow",
              resources: [stack.resolve(cache.serverlessCacheArn)],
            },
          ],
        },
      );
    });

    // TERRACONSTRUCTS DEVIATION: upstream's "grant adds custom IAM permissions to L1" case passes a
    // raw `CfnServerlessCache` (the CloudFormation L1) to `ServerlessCacheGrants.fromServerlessCache`
    // to exercise the grants-collection's structural-typing contract against the generated L1
    // directly. There is no CFN-generated L1 analog in TerraConstructs -- instead this exercises the
    // same structural-typing contract against a bare object satisfying `IServerlessCacheRef`
    // (`{ serverlessCacheArn }`), which is exactly what the reconstructed
    // `elasticache-grants.generated.ts` claims to accept in place of the stripped
    // `elasticache.IServerlessCacheRef` marker interface.
    test("grant adds custom IAM permissions via ServerlessCacheGrants.fromServerlessCache", () => {
      const bareRef = {
        serverlessCacheArn:
          "arn:aws:elasticache:us-east-1:123456789012:serverlesscache/bare-cache",
      };
      elasticache.ServerlessCacheGrants.fromServerlessCache(bareRef).actions(
        role,
        ["elasticache:Connect"],
      );

      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["elasticache:Connect"],
              effect: "Allow",
              resources: [bareRef.serverlessCacheArn],
            },
          ],
        },
      );
    });
  });
});
