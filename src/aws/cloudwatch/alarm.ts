// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-cloudwatch/lib/alarm.ts

// TODO: use https://registry.terraform.io/providers/hashicorp/awscc/latest/docs/resources/cloudwatch_alarm
import { cloudwatchMetricAlarm } from "@cdktf/provider-aws";
import { Lazy, Token, Annotations } from "cdktf";
import { Construct } from "constructs";
import { ArnFormat } from "../arn";
import { AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import { IAlarmAction } from "./alarm-action";
import { AlarmBase, IAlarm } from "./alarm-base";
import { HorizontalAnnotation } from "./graph";
import { CreateAlarmOptions } from "./metric";
import {
  IMetric,
  MetricExpressionConfig,
  MetricStatConfig,
} from "./metric-types";
import { dispatchMetric, metricPeriod } from "./private/metric-util";
import { dropUndefined } from "./private/object";
import { MetricSet } from "./private/rendering";
import { normalizeStatistic, parseStatistic } from "./private/statistic";

/**
 * Properties for Alarms
 */
export interface AlarmProps extends CreateAlarmOptions, AwsConstructProps {
  /**
   * The metric to add the alarm on
   *
   * Metric objects can be obtained from most resources, or you can construct
   * custom Metric objects by instantiating one.
   */
  readonly metric: IMetric;
}

/**
 * Comparison operator for evaluating alarms
 */
export enum ComparisonOperator {
  /**
   * Specified statistic is greater than or equal to the threshold
   */
  GREATER_THAN_OR_EQUAL_TO_THRESHOLD = "GreaterThanOrEqualToThreshold",

  /**
   * Specified statistic is strictly greater than the threshold
   */
  GREATER_THAN_THRESHOLD = "GreaterThanThreshold",

  /**
   * Specified statistic is strictly less than the threshold
   */
  LESS_THAN_THRESHOLD = "LessThanThreshold",

  /**
   * Specified statistic is less than or equal to the threshold.
   */
  LESS_THAN_OR_EQUAL_TO_THRESHOLD = "LessThanOrEqualToThreshold",

  /**
   * Specified statistic is lower than or greater than the anomaly model band.
   * Used only for alarms based on anomaly detection models
   */
  LESS_THAN_LOWER_OR_GREATER_THAN_UPPER_THRESHOLD = "LessThanLowerOrGreaterThanUpperThreshold",

  /**
   * Specified statistic is greater than the anomaly model band.
   * Used only for alarms based on anomaly detection models
   */
  GREATER_THAN_UPPER_THRESHOLD = "GreaterThanUpperThreshold",

  /**
   * Specified statistic is lower than the anomaly model band.
   * Used only for alarms based on anomaly detection models
   */
  LESS_THAN_LOWER_THRESHOLD = "LessThanLowerThreshold",
}

const OPERATOR_SYMBOLS: { [key: string]: string } = {
  GreaterThanOrEqualToThreshold: ">=",
  GreaterThanThreshold: ">",
  LessThanThreshold: "<",
  LessThanOrEqualToThreshold: "<=",
};

/**
 * Specify how missing data points are treated during alarm evaluation
 */
export enum TreatMissingData {
  /**
   * Missing data points are treated as breaching the threshold
   */
  BREACHING = "breaching",

  /**
   * Missing data points are treated as being within the threshold
   */
  NOT_BREACHING = "notBreaching",

  /**
   * The current alarm state is maintained
   */
  IGNORE = "ignore",

  /**
   * The alarm does not consider missing data points when evaluating whether to change state
   */
  MISSING = "missing",
}

/**
 * An alarm on a CloudWatch metric
 */
export class Alarm extends AlarmBase {
  /**
   * Import an existing CloudWatch alarm provided an Name.
   *
   * @param scope The parent creating construct (usually `this`)
   * @param id The construct's name
   * @param alarmName Alarm Name
   */
  public static fromAlarmName(
    scope: Construct,
    id: string,
    alarmName: string,
  ): IAlarm {
    const stack = AwsStack.ofAwsConstruct(scope);

    return this.fromAlarmArn(
      scope,
      id,
      stack.formatArn({
        service: "cloudwatch",
        resource: "alarm",
        resourceName: alarmName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
    );
  }

  /**
   * Import an existing CloudWatch alarm provided an ARN
   *
   * @param scope The parent creating construct (usually `this`).
   * @param id The construct's name
   * @param alarmArn Alarm ARN (i.e. arn:aws:cloudwatch:<region>:<account-id>:alarm:Foo)
   */
  public static fromAlarmArn(
    scope: Construct,
    id: string,
    alarmArn: string,
  ): IAlarm {
    class Import extends AlarmBase implements IAlarm {
      public readonly alarmArn = alarmArn;
      public readonly alarmName = AwsStack.ofAwsConstruct(scope).splitArn(
        alarmArn,
        ArnFormat.COLON_RESOURCE_NAME,
      ).resourceName!;
    }
    return new Import(scope, id);
  }

  public readonly resource: cloudwatchMetricAlarm.CloudwatchMetricAlarm;

  /**
   * ARN of this alarm
   *
   * @attribute
   */
  public readonly alarmArn: string;

  /**
   * Name of this alarm.
   *
   * @attribute
   */
  public readonly alarmName: string;

  /**
   * The metric object this alarm was based on
   */
  public readonly metric: IMetric;

  /**
   * This metric as an annotation
   */
  private readonly annotation: HorizontalAnnotation;

  constructor(scope: Construct, id: string, props: AlarmProps) {
    super(scope, id, props);

    const alarmName =
      props.alarmName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
        maxLength: 255,
      });

    const comparisonOperator =
      props.comparisonOperator ||
      ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;

    // Render metric, process potential overrides from the alarm
    // (It would be preferable if the statistic etc. was worked into the metric,
    // but hey we're allowing overrides...)
    const metricProps: Writeable<
      Partial<cloudwatchMetricAlarm.CloudwatchMetricAlarmConfig>
    > = this.renderMetric(props.metric);
    if (props.period) {
      metricProps.period = props.period.toSeconds();
    }
    if (props.statistic) {
      // Will overwrite both fields if present
      Object.assign(metricProps, {
        statistic: renderIfSimpleStatistic(props.statistic),
        extendedStatistic: renderIfExtendedStatistic(props.statistic),
      });
    }

    this.resource = new cloudwatchMetricAlarm.CloudwatchMetricAlarm(
      this,
      "Resource",
      {
        alarmName,
        // Meta
        alarmDescription: props.alarmDescription,

        // Evaluation
        comparisonOperator,
        threshold: props.threshold,
        datapointsToAlarm: props.datapointsToAlarm,
        evaluateLowSampleCountPercentiles:
          props.evaluateLowSampleCountPercentile,
        evaluationPeriods: props.evaluationPeriods,
        treatMissingData: props.treatMissingData,

        // Actions
        actionsEnabled: props.actionsEnabled,
        alarmActions: Lazy.listValue({ produce: () => this.alarmActionArns }),
        insufficientDataActions: Lazy.listValue({
          produce: () => this.insufficientDataActionArns,
        }),
        okActions: Lazy.listValue({ produce: () => this.okActionArns }),

        // Metric
        ...metricProps,
      },
    );

    this.alarmArn = this.resource.arn;
    this.alarmName = this.resource.id;

    this.metric = props.metric;
    const datapoints = props.datapointsToAlarm || props.evaluationPeriods;
    this.annotation = {
      label: `${this.metric} ${OPERATOR_SYMBOLS[comparisonOperator]} ${props.threshold} for ${datapoints} datapoints within ${describePeriod(props.evaluationPeriods * metricPeriod(props.metric).toSeconds())}`,
      value: props.threshold,
    };

    for (const [_, message] of Object.entries(this.metric.warningsV2 ?? {})) {
      Annotations.of(this).addWarning(message);
    }
  }

  /**
   * Turn this alarm into a horizontal annotation
   *
   * This is useful if you want to represent an Alarm in a non-AlarmWidget.
   * An `AlarmWidget` can directly show an alarm, but it can only show a
   * single alarm and no other metrics. Instead, you can convert the alarm to
   * a HorizontalAnnotation and add it as an annotation to another graph.
   *
   * This might be useful if:
   *
   * - You want to show multiple alarms inside a single graph, for example if
   *   you have both a "small margin/long period" alarm as well as a
   *   "large margin/short period" alarm.
   *
   * - You want to show an Alarm line in a graph with multiple metrics in it.
   */
  public toAnnotation(): HorizontalAnnotation {
    return this.annotation;
  }

  /**
   * Trigger this action if the alarm fires
   *
   * Typically SnsAction or AutoScalingAction.
   */
  public addAlarmAction(...actions: IAlarmAction[]) {
    if (this.alarmActionArns === undefined) {
      this.alarmActionArns = [];
    }

    this.alarmActionArns.push(
      ...actions.map((a) =>
        this.validateActionArn(a.bind(this, this).alarmActionArn),
      ),
    );
  }

  private validateActionArn(actionArn: string): string {
    // ref: https://github.com/aws/aws-cdk/pull/20224/files
    const ec2ActionsRegexp: RegExp =
      /arn:aws[a-z0-9-]*:automate:[a-z|\d|-]+:ec2:[a-z]+/;
    let requiresPerInstanceMetric: boolean = false;
    if (Token.isUnresolved(actionArn)) {
      requiresPerInstanceMetric =
        actionArn.startsWith("arn:") &&
        actionArn.includes(":automate:") &&
        actionArn.includes(":ec2:");
    } else {
      requiresPerInstanceMetric = ec2ActionsRegexp.test(actionArn);
    }
    if (requiresPerInstanceMetric) {
      const metricConfig = this.metric.toMetricConfig();
      const dimensions = metricConfig.metricStat?.dimensions;

      if (
        !dimensions ||
        Object.keys(dimensions).length !== 1 ||
        !("InstanceId" in dimensions)
      ) {
        throw new Error(
          `EC2 alarm actions requires an EC2 Per-Instance Metric. (${JSON.stringify(metricConfig)} does not have an 'InstanceId' dimension)`,
        );
      }
    }
    return actionArn;
  }

  private renderMetric(
    metric: IMetric,
  ): Writeable<Partial<cloudwatchMetricAlarm.CloudwatchMetricAlarmConfig>> {
    const self = this;
    return dispatchMetric(metric, {
      withStat(stat, conf) {
        self.validateMetricStat(stat, metric);
        const canRenderAsLegacyMetric =
          conf.renderingProperties?.label == undefined &&
          !self.requiresAccountId(stat);
        // Do this to disturb existing templates as little as possible
        if (canRenderAsLegacyMetric) {
          return dropUndefined({
            dimensions: stat.dimensions,
            namespace: stat.namespace,
            metricName: stat.metricName,
            period: stat.period?.toSeconds(),
            statistic: renderIfSimpleStatistic(stat.statistic),
            extendedStatistic: renderIfExtendedStatistic(stat.statistic),
            unit: stat.unitFilter,
          });
        }

        return {
          metricQuery: [
            {
              metric: {
                metricName: stat.metricName,
                namespace: stat.namespace,
                dimensions: stat.dimensions,
                period: stat.period.toSeconds(),
                stat: stat.statistic,
              },
              unit: stat.unitFilter,
              id: "m1",
              accountId: self.requiresAccountId(stat)
                ? stat.account
                : undefined,
              label: conf.renderingProperties?.label,
              returnData: true,
            } as cloudwatchMetricAlarm.CloudwatchMetricAlarmMetricQuery,
          ],
        };
      },

      withExpression() {
        // Expand the math expression metric into a set
        const mset = new MetricSet<boolean>();
        mset.addTopLevel(true, metric);

        let eid = 0;
        function uniqueMetricId() {
          return `expr_${++eid}`;
        }

        return {
          metricQuery: mset.entries.map(
            (entry) =>
              dispatchMetric(entry.metric, {
                withStat(stat, conf) {
                  self.validateMetricStat(stat, entry.metric);

                  return {
                    metric: {
                      metricName: stat.metricName,
                      namespace: stat.namespace,
                      dimensions: stat.dimensions,
                      period: stat.period.toSeconds(),
                      stat: stat.statistic,
                    },
                    unit: stat.unitFilter,
                    id: entry.id || uniqueMetricId(),
                    accountId: self.requiresAccountId(stat)
                      ? stat.account
                      : undefined,
                    label: conf.renderingProperties?.label,
                    returnData: entry.tag ? true : false, // entry.tag evaluates to true if the metric is the math expression the alarm is based on.
                  };
                },
                withExpression(expr, conf) {
                  const hasSubmetrics = mathExprHasSubmetrics(expr);

                  if (hasSubmetrics) {
                    assertSubmetricsCount(expr);
                  }

                  self.validateMetricExpression(expr);

                  return {
                    expression: expr.expression,
                    id: entry.id || uniqueMetricId(),
                    label: conf.renderingProperties?.label,
                    period: hasSubmetrics ? undefined : expr.period,
                    returnData: entry.tag ? true : false, // entry.tag evaluates to true if the metric is the math expression the alarm is based on.
                  };
                },
              }) as cloudwatchMetricAlarm.CloudwatchMetricAlarmMetricQuery,
          ),
        };
      },
    });
  }

  /**
   * Validate that if a region is in the given stat config, they match the Alarm
   */
  private validateMetricStat(stat: MetricStatConfig, metric: IMetric) {
    const stack = AwsStack.ofAwsConstruct(this);

    if (definitelyDifferent(stat.region, stack.region)) {
      throw new Error(
        `Cannot create an Alarm in region '${stack.region}' based on metric '${metric}' in '${stat.region}'`,
      );
    }
  }

  /**
   * Validates that the expression config does not specify searchAccount or searchRegion props
   * as search expressions are not supported by Alarms.
   */
  private validateMetricExpression(expr: MetricExpressionConfig) {
    if (expr.searchAccount !== undefined || expr.searchRegion !== undefined) {
      throw new Error(
        "Cannot create an Alarm based on a MathExpression which specifies a searchAccount or searchRegion",
      );
    }
  }

  /**
   * Determine if the accountId property should be included in the metric.
   */
  private requiresAccountId(stat: MetricStatConfig): boolean {
    const stackAccount = AwsStack.ofAwsConstruct(this).account;

    // if stat.account is undefined, it's by definition in the same account
    if (stat.account === undefined) {
      return false;
    }

    // Return true if they're different. The ACCOUNT_ID token is interned
    // so will always have the same string value (and even if we guess wrong
    // it will still work).
    return stackAccount !== stat.account;
  }
}

function definitelyDifferent(x: string | undefined, y: string) {
  return x && !Token.isUnresolved(y) && x !== y;
}

/**
 * Return a human readable string for this period
 *
 * We know the seconds are always one of a handful of allowed values.
 */
function describePeriod(seconds: number) {
  if (seconds === 60) {
    return "1 minute";
  }
  if (seconds === 1) {
    return "1 second";
  }
  if (seconds > 60) {
    return seconds / 60 + " minutes";
  }
  return seconds + " seconds";
}

function renderIfSimpleStatistic(statistic?: string): string | undefined {
  if (statistic === undefined) {
    return undefined;
  }

  const parsed = parseStatistic(statistic);
  if (parsed.type === "simple") {
    return normalizeStatistic(parsed);
  }
  return undefined;
}

function renderIfExtendedStatistic(statistic?: string): string | undefined {
  if (statistic === undefined) {
    return undefined;
  }

  const parsed = parseStatistic(statistic);
  if (parsed.type === "simple") {
    // This statistic will have been rendered by renderIfSimpleStatistic
    return undefined;
  }

  if (parsed.type === "single" || parsed.type === "pair") {
    return normalizeStatistic(parsed);
  }

  // We can't not render anything here. Just put whatever we got as input into
  // the ExtendedStatistic and hope it's correct. Either that, or we throw
  // an error.
  return parsed.statistic;
}

function mathExprHasSubmetrics(expr: MetricExpressionConfig) {
  return Object.keys(expr.usingMetrics).length > 0;
}

function assertSubmetricsCount(expr: MetricExpressionConfig) {
  if (Object.keys(expr.usingMetrics).length > 10) {
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarms-on-metric-math-expressions
    throw new Error(
      "Alarms on math expressions cannot contain more than 10 individual metrics",
    );
  }
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
