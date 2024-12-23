// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-logs/lib/metric-filter.ts

import { cloudwatchLogMetricFilter } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { ILogGroup, MetricFilterOptions } from "./log-group";
import { Metric, MetricOptions } from "./metric";
import { AwsConstructBase, AwsConstructProps } from "../";

/**
 * Properties for a MetricFilter
 */
export interface MetricFilterProps
  extends MetricFilterOptions,
    AwsConstructProps {
  /**
   * The log group to create the filter on.
   */
  readonly logGroup: ILogGroup;
}

/**
 * A filter that extracts information from CloudWatch Logs and emits to CloudWatch Metrics
 */
export class MetricFilter extends AwsConstructBase {
  public readonly resource: cloudwatchLogMetricFilter.CloudwatchLogMetricFilter;

  public get outputs(): Record<string, any> {
    return {
      id: this.resource.id,
    };
  }
  private readonly metricName: string;
  private readonly metricNamespace: string;

  constructor(scope: Construct, id: string, props: MetricFilterProps) {
    super(scope, id, props);
    const name =
      props.filterName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    this.metricName = props.metricName;
    this.metricNamespace = props.metricNamespace;

    const numberOfDimensions = Object.keys(props.dimensions ?? {}).length;
    if (numberOfDimensions > 3) {
      throw new Error(
        `MetricFilter only supports a maximum of 3 dimensions but received ${numberOfDimensions}.`,
      );
    }

    // > Currently, you can specify only one metric transformation for
    // > each metric filter. If you want to specify multiple metric
    // > transformations, you must specify multiple metric filters.
    //
    // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-metricfilter.html
    this.resource = new cloudwatchLogMetricFilter.CloudwatchLogMetricFilter(
      this,
      "Resource",
      {
        name,
        logGroupName: props.logGroup.logGroupName,
        pattern: props.filterPattern.logPatternString,
        metricTransformation: {
          namespace: props.metricNamespace,
          name: props.metricName,
          value: props.metricValue ?? "1",
          defaultValue: props.defaultValue
            ? String(props.defaultValue)
            : undefined,
          dimensions: props.dimensions,
          unit: props.unit,
        },
      },
    );
  }

  /**
   * Return the given named metric for this Metric Filter
   *
   * @default avg over 5 minutes
   */
  public metric(props?: MetricOptions): Metric {
    return new Metric({
      metricName: this.metricName,
      namespace: this.metricNamespace,
      statistic: "avg",
      ...props,
    }).attachTo(this);
  }
}
