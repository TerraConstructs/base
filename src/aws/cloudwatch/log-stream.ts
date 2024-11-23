// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-logs/lib/log-stream.ts

import { cloudwatchLogStream } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { IAwsBeacon, AwsBeaconBase, AwsBeaconProps, AwsSpec } from "..";
import { ILogGroup } from "./log-group";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface LogStreamOutputs {
  /**
   * The name of this log stream
   * @attribute
   */
  readonly logStreamName: string;
}

export interface ILogStream extends IAwsBeacon {
  /** Strongly typed outputs */
  readonly logStreamOutputs: LogStreamOutputs;

  /**
   * The name of this log stream
   * @attribute
   */
  readonly logStreamName: string;
}

/**
 * Properties for a LogStream
 */
export interface LogStreamProps extends AwsBeaconProps {
  /**
   * The log group to create a log stream for.
   */
  readonly logGroup: ILogGroup;

  /**
   * The name of the log stream to create.
   *
   * The name must be unique within the log group.
   *
   * @default Automatically generated
   */
  readonly logStreamName?: string;
}

/**
 * Define a Log Stream in a Log Group
 */
export class LogStream extends AwsBeaconBase implements ILogStream {
  /**
   * Import an existing LogGroup
   */
  public static fromLogStreamName(
    scope: Construct,
    id: string,
    logStreamName: string,
  ): ILogStream {
    class Import extends AwsBeaconBase implements ILogStream {
      public get logStreamOutputs(): LogStreamOutputs {
        return {
          logStreamName: this.logStreamName,
        };
      }
      public get outputs(): Record<string, any> {
        return this.logStreamOutputs;
      }
      public readonly logStreamName = logStreamName;
    }

    return new Import(scope, id);
  }

  public readonly resource: cloudwatchLogStream.CloudwatchLogStream;
  /**
   * The name of this log stream
   */
  public readonly logStreamName: string;
  public get logStreamOutputs(): LogStreamOutputs {
    return {
      logStreamName: this.logStreamName,
    };
  }
  public get outputs(): Record<string, any> {
    return this.logStreamOutputs;
  }

  constructor(scope: Construct, id: string, props: LogStreamProps) {
    super(scope, id, props);

    const spec = AwsSpec.ofAwsBeacon(this);

    const name =
      props.logStreamName ||
      spec.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    this.resource = new cloudwatchLogStream.CloudwatchLogStream(
      this,
      "Resource",
      {
        logGroupName: props.logGroup.logGroupName,
        name,
      },
    );

    this.logStreamName = this.resource.name;
  }
}
