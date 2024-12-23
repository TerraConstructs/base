import { cloudwatchEventArchive } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { IEventBus } from "./event-bus";
import { EventPattern } from "./event-pattern";
import { renderEventPattern } from "./util";
import { Duration } from "../..";

/**
 * Outputs which can be exposed through the grid
 */
export interface ArchiveOutputs {
  /**
   * The ARN of the archive created.
   */
  readonly arn: string;
  /**
   * The archive name.
   */
  readonly name: string;
}

/**
 * The event archive base properties
 */
export interface BaseArchiveProps extends AwsConstructProps {
  /**
   * The name of the archive.
   *
   * https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_CreateArchive.html#eventbridge-CreateArchive-request-ArchiveName
   *
   * @default - Automatically generated
   */
  readonly archiveName?: string;
  /**
   * A description for the archive.
   *
   * @default - none
   */
  readonly description?: string;
  /**
   * An event pattern to use to filter events sent to the archive.
   */
  readonly eventPattern: EventPattern;
  /**
   * The number of days to retain events for. Default value is 0. If set to 0, events are retained indefinitely.
   * @default - Infinite
   */
  readonly retention?: Duration;
}

/**
 * The event archive properties
 */
export interface ArchiveProps extends BaseArchiveProps {
  /**
   * The event source associated with the archive.
   */
  readonly sourceEventBus: IEventBus;
}

/**
 * Define an EventBridge Archive
 *
 * @resource aws_cloudwatch_event_archive
 */
export class Archive extends AwsConstructBase {
  public resource: cloudwatchEventArchive.CloudwatchEventArchive;
  /**
   * The archive name.
   * @attribute
   */
  public get archiveName() {
    return this.resource.name;
  }

  /**
   * The ARN of the archive created.
   * @attribute
   */
  public get archiveArn() {
    return this.resource.arn;
  }

  public readonly archiveOutputs: ArchiveOutputs;
  public get outputs(): Record<string, any> {
    return this.archiveOutputs;
  }

  constructor(scope: Construct, id: string, props: ArchiveProps) {
    super(scope, id, props);

    const name =
      props.archiveName ||
      this.stack.uniqueResourceNamePrefix(this, {
        prefix: this.gridUUID + "-",
        allowedSpecialCharacters: ".-_",
        maxLength: 48,
      });

    if (name.length < 1 || name.length > 48) {
      throw new Error(
        "archiveName must be between 1 and 48 characters in length.",
      );
    }
    if (!name.match(/^[\.\-_A-Za-z0-9]+$/)) {
      throw new Error(
        "archiveName must only contain the following characters: . - _ A-Z a-z 0-9",
      );
    }

    this.resource = new cloudwatchEventArchive.CloudwatchEventArchive(
      this,
      "Resource",
      {
        name,
        eventSourceArn: props.sourceEventBus.eventBusArn,
        description: props.description,
        eventPattern: renderEventPattern(props.eventPattern),
        retentionDays: props.retention?.toDays({ integral: true }) || 0,
      },
    );

    this.archiveOutputs = {
      arn: this.archiveArn,
      name: this.archiveName,
    };
  }
}
