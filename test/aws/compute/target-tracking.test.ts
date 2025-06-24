import {
  appautoscalingPolicy,
  appautoscalingTarget,
  iamRole,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as appscaling from "../../../src/aws/compute";
import * as cloudwatch from "../../../src/aws/cloudwatch";
import { Template } from "../../assertions";
import { createScalableTarget } from "./util";

const environmentName = "TestEnv";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };

describe("target tracking", () => {
  let stack: AwsStack;
  let target: appscaling.ScalableTarget;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "Default", {
      environmentName,
      gridUUID,
      providerConfig,
    });
    target = createScalableTarget(stack);
  });

  test("test setup target tracking on predefined metric", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric
          .EC2_SPOT_FLEET_REQUEST_AVERAGE_CPU_UTILIZATION,
      targetValue: 30,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "TargetTrackingScaling",
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type: "EC2SpotFleetRequestAverageCPUUtilization",
          },
          target_value: 30,
        },
      },
    );
  });

  test("test setup target tracking on predefined metric for lambda", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric.LAMBDA_PROVISIONED_CONCURRENCY_UTILIZATION,
      targetValue: 0.9,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "TargetTrackingScaling",
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type: "LambdaProvisionedConcurrencyUtilization",
          },
          target_value: 0.9,
        },
      },
    );
  });

  test("test setup target tracking on predefined metric for DYNAMODB_WRITE_CAPACITY_UTILIZATION", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric.DYNAMODB_WRITE_CAPACITY_UTILIZATION,
      targetValue: 0.9,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type: "DynamoDBWriteCapacityUtilization",
          },
          target_value: 0.9,
        },
      },
    );
  });

  test("test setup target tracking on predefined metric for SAGEMAKER_VARIANT_PROVISIONED_CONCURRENCY_UTILIZATION", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric
          .SAGEMAKER_VARIANT_PROVISIONED_CONCURRENCY_UTILIZATION,
      targetValue: 0.5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type:
              "SageMakerVariantProvisionedConcurrencyUtilization",
          },
          target_value: 0.5,
        },
      },
    );
  });

  test("test setup target tracking on predefined metric for SAGEMAKER_VARIANT_CONCURRENT_REQUESTS_PER_MODEL_HIGH_RESOLUTION", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric
          .SAGEMAKER_VARIANT_CONCURRENT_REQUESTS_PER_MODEL_HIGH_RESOLUTION,
      targetValue: 0.5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type:
              "SageMakerVariantConcurrentRequestsPerModelHighResolution",
          },
          target_value: 0.5,
        },
      },
    );
  });

  test("test setup target tracking on predefined metric for SAGEMAKER_INFERENCE_COMPONENT_CONCURRENT_REQUESTS_PER_COPY_HIGH_RESOLUTION", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric
          .SAGEMAKER_INFERENCE_COMPONENT_CONCURRENT_REQUESTS_PER_COPY_HIGH_RESOLUTION,
      targetValue: 0.5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type:
              "SageMakerInferenceComponentConcurrentRequestsPerCopyHighResolution",
          },
          target_value: 0.5,
        },
      },
    );
  });

  test("test setup target tracking on predefined metric for WORKSPACES_AVERAGE_USER_SESSIONS_CAPACITY_UTILIZATION", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      predefinedMetric:
        appscaling.PredefinedMetric
          .WORKSPACES_AVERAGE_USER_SESSIONS_CAPACITY_UTILIZATION,
      targetValue: 0.5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        target_tracking_scaling_policy_configuration: {
          predefined_metric_specification: {
            predefined_metric_type:
              "WorkSpacesAverageUserSessionsCapacityUtilization",
          },
          target_value: 0.5,
        },
      },
    );
  });

  test("test setup target tracking on custom metric", () => {
    // WHEN
    target.scaleToTrackMetric("Tracking", {
      customMetric: new cloudwatch.Metric({
        namespace: "Test",
        metricName: "Metric",
        // statistic: 'Average' is default for cloudwatch.Metric
      }),
      targetValue: 30,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      appautoscalingPolicy.AppautoscalingPolicy,
      {
        policy_type: "TargetTrackingScaling",
        target_tracking_scaling_policy_configuration: {
          customized_metric_specification: expect.objectContaining({
            metric_name: "Metric",
            namespace: "Test",
            statistic: "Average",
          }),
          target_value: 30,
        },
      },
    );
  });
});
