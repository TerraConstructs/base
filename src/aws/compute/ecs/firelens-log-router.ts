// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/firelens-log-router.ts

import { Token } from "cdktn";
import { Construct } from "constructs";
import { TaskDefinition } from "./base/task-definition";
import {
  ContainerDefinition,
  ContainerDefinitionConfig,
  ContainerDefinitionOptions,
  ContainerDefinitionProps,
} from "./container-definition";
import { ContainerImage } from "./container-image";
import { LogDriverConfig } from "./log-drivers/log-driver";
import { ValidationError } from "../../../errors";
import * as iam from "../../iam";
import * as ssm from "../../storage";

/**
 * Firelens log router type, fluentbit or fluentd.
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html
 */
export enum FirelensLogRouterType {
  /**
   * fluentbit
   */
  FLUENTBIT = "fluentbit",

  /**
   * fluentd
   */
  FLUENTD = "fluentd",
}

/**
 * Firelens configuration file type, s3 or file path.
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html#firelens-taskdef-customconfig
 */
export enum FirelensConfigFileType {
  /**
   * s3
   */
  S3 = "s3",

  /**
   * fluentd
   */
  FILE = "file",
}

/**
 * The options for firelens log router
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html#firelens-taskdef-customconfig
 */
export interface FirelensOptions {
  /**
   * By default, Amazon ECS adds additional fields in your log entries that help identify the source of the logs.
   * You can disable this action by setting enable-ecs-log-metadata to false.
   * @default - true
   */
  readonly enableECSLogMetadata?: boolean;

  /**
   * Custom configuration file, s3 or file.
   * Both configFileType and configFileValue must be used together
   * to define a custom configuration source.
   *
   * @default - determined by checking configFileValue with S3 ARN.
   */
  readonly configFileType?: FirelensConfigFileType;

  /**
   * Custom configuration file, S3 ARN or a file path
   * Both configFileType and configFileValue must be used together
   * to define a custom configuration source.
   *
   * @default - no config file value
   */
  readonly configFileValue?: string;
}

/**
 * Firelens Configuration
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html#firelens-taskdef
 */
export interface FirelensConfig {
  /**
   * The log router to use
   * @default - fluentbit
   */
  readonly type: FirelensLogRouterType;

  /**
   * Firelens options
   * @default - no additional options
   */
  readonly options?: FirelensOptions;
}

/**
 * The properties in a firelens log router.
 */
export interface FirelensLogRouterProps extends ContainerDefinitionProps {
  /**
   * Firelens configuration
   */
  readonly firelensConfig: FirelensConfig;
}

/**
 * The options for creating a firelens log router.
 */
export interface FirelensLogRouterDefinitionOptions
  extends ContainerDefinitionOptions {
  /**
   * Firelens configuration
   */
  readonly firelensConfig: FirelensConfig;
}

/**
 * The firelens configuration to use when creating the ECS container definition JSON, mirroring
 * the shape of the CloudFormation `AWS::ECS::TaskDefinition.FirelensConfiguration` property.
 */
export interface FirelensConfigurationProperty {
  /**
   * The options to use when configuring the log router.
   *
   * This field is optional and can be used to add additional metadata, such as the task, task
   * definition, cluster, and container instance details to the log event.
   *
   * If specified, valid option keys are:
   *
   * - `enable-ecs-log-metadata`, which can be `true` or `false`
   * - `config-file-type`, which can be `s3` or `file`
   * - `config-file-value`, which is either an S3 ARN or a file path
   */
  readonly options?: Record<string, string>;

  /**
   * The log router to use.
   *
   * The valid values are `fluentd` or `fluentbit`.
   */
  readonly type?: string;
}

/**
 * The container-definition JSON object rendered by `FirelensLogRouter`, extending the base
 * `ContainerDefinitionConfig` with the `firelensConfiguration` field.
 *
 * // TERRACONSTRUCTS DEVIATION: upstream renders to `CfnTaskDefinition.ContainerDefinitionProperty`,
 * which already declares `firelensConfiguration` as part of the full CFN property union.
 * `ContainerDefinitionConfig` (the plain JSON shape TerraConstructs renders into the
 * jsonencoded `container_definitions` string) does not carry that field since the base
 * `ContainerDefinition` never sets it, so it is added here via extension instead.
 */
export interface FirelensContainerDefinitionConfig
  extends ContainerDefinitionConfig {
  /**
   * The FireLens configuration for the container.
   *
   * This is used to specify and configure a log router for container logs.
   */
  readonly firelensConfiguration?: FirelensConfigurationProperty;
}

/**
 * Render to FirelensConfigurationProperty from FirelensConfig
 */
function renderFirelensConfig(
  firelensConfig: FirelensConfig,
): FirelensConfigurationProperty {
  if (!firelensConfig.options) {
    return { type: firelensConfig.type };
  } else if (firelensConfig.options.configFileValue === undefined) {
    // config file options work as a pair together to define a custom config source
    // a custom config source is optional,
    // and thus the `config-file-x` keys should be set together or not at all
    return {
      type: firelensConfig.type,
      options: {
        "enable-ecs-log-metadata": firelensConfig.options.enableECSLogMetadata
          ? "true"
          : "false",
      },
    };
  } else {
    // firelensConfig.options.configFileType has been filled with s3 or file type in constructor.
    return {
      type: firelensConfig.type,
      options: {
        "enable-ecs-log-metadata": firelensConfig.options.enableECSLogMetadata
          ? "true"
          : "false",
        "config-file-type": firelensConfig.options.configFileType!,
        "config-file-value": firelensConfig.options.configFileValue,
      },
    };
  }
}

/**
 * SSM parameters for latest fluent bit docker image in ECR
 * https://github.com/aws/aws-for-fluent-bit#using-ssm-to-find-available-versions
 */
const fluentBitImageSSMPath = "/aws/service/aws-for-fluent-bit";

/**
 * Obtain Fluent Bit image in Amazon ECR and setup corresponding IAM permissions.
 * ECR image pull permissions will be granted in task execution role.
 * Cloudwatch logs, Kinesis data stream or firehose permissions will be grant by check options in logDriverConfig.
 * https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_firelens.html#firelens-using-fluentbit
 */
export function obtainDefaultFluentBitECRImage(
  task: TaskDefinition,
  logDriverConfig?: LogDriverConfig,
  imageTag?: string,
): ContainerImage {
  // grant ECR image pull permissions to executor role
  task.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
      ],
      resources: ["*"],
    }),
  );

  // grant cloudwatch or firehose permissions to task role
  const logName =
    logDriverConfig &&
    logDriverConfig.logDriver === "awsfirelens" &&
    logDriverConfig.options &&
    logDriverConfig.options.Name;
  if (logName === "cloudwatch") {
    const actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ];

    if (
      logDriverConfig &&
      logDriverConfig.options &&
      "log_retention_days" in logDriverConfig.options
    ) {
      actions.push("logs:PutRetentionPolicy");
    }

    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions,
        resources: ["*"],
      }),
    );
  } else if (logName === "firehose") {
    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["firehose:PutRecordBatch"],
        resources: ["*"],
      }),
    );
  } else if (logName === "kinesis") {
    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["kinesis:PutRecords"],
        resources: ["*"],
      }),
    );
  }

  const fluentBitImageTag = imageTag || "latest";
  const fluentBitImage = `${fluentBitImageSSMPath}/${fluentBitImageTag}`;

  // Not use ContainerImage.fromEcrRepository since it's not support parsing ECR repo URI,
  // use repo ARN might result in complex Fn:: functions in cloudformation template.
  return ContainerImage.fromRegistry(
    ssm.StringParameter.valueForStringParameter(task, fluentBitImage),
  );
}

/**
 * Firelens log router
 */
export class FirelensLogRouter extends ContainerDefinition {
  /**
   * Firelens configuration
   */
  public readonly firelensConfig: FirelensConfig;

  /**
   * Constructs a new instance of the FirelensLogRouter class.
   */
  constructor(scope: Construct, id: string, props: FirelensLogRouterProps) {
    super(scope, id, props);
    const options = props.firelensConfig.options;
    if (options) {
      if (
        (options.configFileValue && options.configFileType === undefined) ||
        (options.configFileValue === undefined && options.configFileType)
      ) {
        throw new ValidationError(
          "configFileValue and configFileType must be set together to define a custom config source",
          this,
        );
      }

      const hasConfig = options.configFileValue !== undefined;
      const enableECSLogMetadata =
        options.enableECSLogMetadata ||
        options.enableECSLogMetadata === undefined;
      const configFileType =
        (options.configFileType === undefined ||
          options.configFileType === FirelensConfigFileType.S3) &&
        (Token.isUnresolved(options.configFileValue) ||
          /arn:aws[a-zA-Z-]*:s3:::.+/.test(options.configFileValue || ""))
          ? FirelensConfigFileType.S3
          : FirelensConfigFileType.FILE;

      this.firelensConfig = {
        type: props.firelensConfig.type,
        options: {
          enableECSLogMetadata,
          ...(hasConfig
            ? {
                configFileType,
                configFileValue: options.configFileValue,
              }
            : {}),
        },
      };

      if (hasConfig) {
        // grant s3 access permissions
        if (configFileType === FirelensConfigFileType.S3) {
          props.taskDefinition.addToExecutionRolePolicy(
            new iam.PolicyStatement({
              actions: ["s3:GetObject"],
              resources: [options.configFileValue ?? ""],
            }),
          );
          props.taskDefinition.addToExecutionRolePolicy(
            new iam.PolicyStatement({
              actions: ["s3:GetBucketLocation"],
              // TERRACONSTRUCTS DEVIATION: upstream v2.233.0 scopes this to configFileValue.split('/')[0],
              // which cannot derive the bucket ARN from an unresolved token. GetBucketLocation is not
              // usefully resource-scoped; use the '*' wildcard already used by base-service.ts for the
              // same action so token-derived S3 config ARNs get an effective permission.
              resources: ["*"],
            }),
          );
        }
      }
    } else {
      this.firelensConfig = props.firelensConfig;
    }
  }

  /**
   * Render this container definition to a container definition JSON object
   */
  public renderContainerDefinition(
    _taskDefinition?: TaskDefinition,
  ): FirelensContainerDefinitionConfig {
    return {
      ...super.renderContainerDefinition(),
      firelensConfiguration:
        this.firelensConfig && renderFirelensConfig(this.firelensConfig),
    };
  }
}
