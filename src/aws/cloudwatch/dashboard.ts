// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-cloudwatch/lib/dashboard.ts

import { cloudwatchDashboard } from "@cdktf/provider-aws";
import { Lazy, Token, Annotations } from "cdktf";
import { Construct } from "constructs";
import { AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { AwsSpec } from "../spec";
import { Column, Row } from "./layout";
import { IVariable } from "./variable";
import { IWidget } from "./widget";
import { Duration } from "../../duration";

/**
 * Specify the period for graphs when the CloudWatch dashboard loads
 */
export enum PeriodOverride {
  /**
   * Period of all graphs on the dashboard automatically adapt to the time range of the dashboard.
   */
  AUTO = "auto",

  /**
   * Period set for each graph will be used
   */
  INHERIT = "inherit",
}

/**
 * Properties for defining a CloudWatch Dashboard
 */
export interface DashboardProps extends AwsBeaconProps {
  /**
   * Name of the dashboard.
   *
   * If set, must only contain alphanumerics, dash (-) and underscore (_)
   *
   * @default - automatically generated name
   */
  readonly dashboardName?: string;

  /**
   * Interval duration for metrics.
   * You can specify defaultInterval with the relative time(eg. cdk.Duration.days(7)).
   *
   * Both properties `defaultInterval` and `start` cannot be set at once.
   *
   * @default When the dashboard loads, the defaultInterval time will be the default time range.
   */
  readonly defaultInterval?: Duration;

  /**
   * The start of the time range to use for each widget on the dashboard.
   * You can specify start without specifying end to specify a relative time range that ends with the current time.
   * In this case, the value of start must begin with -P, and you can use M, H, D, W and M as abbreviations for
   * minutes, hours, days, weeks and months. For example, -PT8H shows the last 8 hours and -P3M shows the last three months.
   * You can also use start along with an end field, to specify an absolute time range.
   * When specifying an absolute time range, use the ISO 8601 format. For example, 2018-12-17T06:00:00.000Z.
   *
   * Both properties `defaultInterval` and `start` cannot be set at once.
   *
   * @default When the dashboard loads, the start time will be the default time range.
   */
  readonly start?: string;

  /**
   * The end of the time range to use for each widget on the dashboard when the dashboard loads.
   * If you specify a value for end, you must also specify a value for start.
   * Specify an absolute time in the ISO 8601 format. For example, 2018-12-17T06:00:00.000Z.
   *
   * @default When the dashboard loads, the end date will be the current time.
   */
  readonly end?: string;

  /**
   * Use this field to specify the period for the graphs when the dashboard loads.
   * Specifying `Auto` causes the period of all graphs on the dashboard to automatically adapt to the time range of the dashboard.
   * Specifying `Inherit` ensures that the period set for each graph is always obeyed.
   *
   * @default Auto
   */
  readonly periodOverride?: PeriodOverride;

  /**
   * Initial set of widgets on the dashboard
   *
   * One array represents a row of widgets.
   *
   * @default - No widgets
   */
  readonly widgets?: IWidget[][];

  /**
   * A list of dashboard variables
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_dashboard_variables.html#cloudwatch_dashboard_variables_types
   *
   * @default - No variables
   */
  readonly variables?: IVariable[];
}

export interface DashboardOutputs {
  /**
   * The name of this dashboard
   * @attribute
   */
  readonly dashboardName: string;

  /**
   * ARN of this dashboard
   * @attribute
   */
  readonly dashboardArn: string;
}

/**
 * A CloudWatch dashboard
 */
export class Dashboard extends AwsBeaconBase {
  public readonly resource: cloudwatchDashboard.CloudwatchDashboard;
  /**
   * The name of this dashboard
   *
   * @attribute
   */
  public readonly dashboardName: string;

  /**
   * ARN of this dashboard
   *
   * @attribute
   */
  public readonly dashboardArn: string;

  public get dashboardOutputs(): DashboardOutputs {
    return {
      dashboardName: this.dashboardName,
      dashboardArn: this.dashboardArn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.dashboardOutputs;
  }

  private readonly rows: IWidget[] = [];

  private readonly variables: IVariable[] = [];

  constructor(scope: Construct, id: string, props: DashboardProps = {}) {
    super(scope, id, props);
    const dashboardName =
      props.dashboardName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
        allowedSpecialCharacters: "-_",
      });

    if (
      dashboardName &&
      !Token.isUnresolved(dashboardName) &&
      !dashboardName.match(/^[\w-]+$/)
    ) {
      throw new Error(
        [
          `The value ${dashboardName} for field dashboardName contains invalid characters.`,
          "It can only contain alphanumerics, dash (-) and underscore (_).",
        ].join(" "),
      );
    }

    if (props.start !== undefined && props.defaultInterval !== undefined) {
      throw new Error(
        "both properties defaultInterval and start cannot be set at once",
      );
    }

    if (props.end !== undefined && props.start === undefined) {
      throw new Error(
        "If you specify a value for end, you must also specify a value for start.",
      );
    }

    this.resource = new cloudwatchDashboard.CloudwatchDashboard(
      this,
      "Resource",
      {
        dashboardName,
        dashboardBody: Lazy.stringValue({
          produce: () => {
            const column = new Column(...this.rows);
            column.position(0, 0);
            return AwsSpec.ofAwsBeacon(this).toJsonString({
              start:
                props.defaultInterval !== undefined
                  ? `-${props.defaultInterval?.toIsoString()}`
                  : props.start,
              end: props.defaultInterval !== undefined ? undefined : props.end,
              periodOverride: props.periodOverride,
              widgets: column.toJson(),
              variables:
                this.variables.length > 0
                  ? this.variables.map((variable) => variable.toJson())
                  : undefined,
            });
          },
        }),
      },
    );

    this.dashboardName = this.resource.dashboardName;

    (props.widgets || []).forEach((row) => {
      this.addWidgets(...row);
    });

    (props.variables || []).forEach((variable) => this.addVariable(variable));

    this.dashboardArn = this.resource.dashboardArn;
  }

  /**
   * Add a widget to the dashboard.
   *
   * Widgets given in multiple calls to add() will be laid out stacked on
   * top of each other.
   *
   * Multiple widgets added in the same call to add() will be laid out next
   * to each other.
   */
  public addWidgets(...widgets: IWidget[]) {
    if (widgets.length === 0) {
      return;
    }

    const warnings = allWidgetsDeep(widgets).reduce(
      (prev, curr) => {
        return {
          ...prev,
          ...curr.warningsV2,
        };
      },
      {} as { [id: string]: string },
    );
    for (const [_, message] of Object.entries(warnings ?? {})) {
      // TODO: v2 warning with message id
      Annotations.of(this).addWarning(message);
    }

    const w = widgets.length > 1 ? new Row(...widgets) : widgets[0];
    this.rows.push(w);
  }

  /**
   * Add a variable to the dashboard.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_dashboard_variables.html
   */
  public addVariable(variable: IVariable) {
    this.variables.push(variable);
  }
}

function allWidgetsDeep(ws: IWidget[]) {
  const ret = new Array<IWidget>();
  ws.forEach(recurse);
  return ret;

  function recurse(w: IWidget) {
    ret.push(w);
    if (hasSubWidgets(w)) {
      w.widgets.forEach(recurse);
    }
  }
}

function hasSubWidgets(w: IWidget): w is IWidget & { widgets: IWidget[] } {
  return "widgets" in w;
}
