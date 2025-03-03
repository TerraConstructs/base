import { sfnStateMachine } from "@cdktf/provider-aws";
import { Token, IResolvable } from "cdktf";
import { Construct } from "constructs";
import { Arn, ArnFormat } from "../arn";
import {
  AwsConstructBase,
  IAwsConstruct,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import { StateGraph } from "./state-graph";
import { IChainable } from "./types";
import { Duration } from "../../duration";
import * as iam from "../iam";

/**
 * Properties for defining a State Machine
 */
export interface StateMachineProps extends AwsConstructProps {
  /**
   * The name of the state machine.
   *
   * To enable logging with CloudWatch Logs, the name should only contain 0-9, A-Z, a-z, - and _.
   *
   * Length Constraints: Minimum length of 1. Maximum length of 80.
   *
   * @default - Terraform will assign a random, unique suffix.
   */
  readonly stateMachineName?: string;
  /**
   * Creates a unique name beginning with the specified prefix. Conflicts with `stateMachineName`
   *
   * The name should only contain 0-9, A-Z, a-z, - and _
   * Terraform Prefixes must reserve 26 characters for the terraform generated suffix.
   *
   * @default - GridUUID + Stack Unique Name
   */
  readonly namePrefix?: string;
  /**
   * Definition for this state machine
   */
  readonly definitionBody: DefinitionBody;
  /**
   * The execution role for the state machine service
   *
   * @default A role is automatically created
   */
  readonly role?: iam.IRole;
  /**
   * Maximum run time for this state machine
   *
   * @default No timeout
   */
  readonly timeout?: Duration;
  /**
   * Comment that describes this state machine
   *
   * @default - No comment
   */
  readonly comment?: string;
  /**
   * Type of the state machine
   *
   * @default StateMachineType.STANDARD
   */
  readonly stateMachineType?: StateMachineType;
  /**
   * Defines what execution history events are logged and where they are logged.
   *
   * @default No logging
   */
  readonly logs?: LogOptions;
  /**
   * Specifies whether Amazon X-Ray tracing is enabled for this state machine.
   *
   * @default false
   */
  readonly tracingEnabled?: boolean;
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sfn_state_machine#tags SfnStateMachine#tags}
   */
  readonly tags?: {
    [key: string]: string;
  };
  /**
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sfn_state_machine#publish SfnStateMachine#publish}
   */
  readonly publish?: boolean | IResolvable;
}

export interface StateMachineOutputs {
  /**
   * State Machine arn
   */
  readonly arn: string;
}

/**
 * A State Machine
 */
export interface IStateMachine extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly stateMachineOutputs: StateMachineOutputs;

  /**
   * The ARN of the state machine
   * @attribute
   */
  readonly stateMachineArn: string;

  /**
   * Grant the given identity permissions to start an execution of this state
   * machine.
   *
   * @param identity The principal
   */
  grantStartExecution(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions to start a synchronous execution of
   * this state machine.
   *
   * @param identity The principal
   */
  grantStartSyncExecution(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity read permissions for this state machine
   *
   * @param identity The principal
   */
  grantRead(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity read permissions for this state machine
   *
   * @param identity The principal
   */
  grantTaskResponse(identity: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions for all executions of a state machine
   *
   * @param identity The principal
   * @param actions The list of desired actions
   */
  grantExecution(identity: iam.IGrantable, ...actions: string[]): iam.Grant;

  /**
   * Grant the given identity custom permissions
   *
   * @param identity The principal
   * @param actions The list of desired actions
   */
  grant(identity: iam.IGrantable, ...actions: string[]): iam.Grant;
}

/**
 * A new or imported state machine.
 */
abstract class StateMachineBase
  extends AwsConstructBase
  implements IStateMachine
{
  /**
   * Import a state machine
   */
  public static fromStateMachineArn(
    scope: Construct,
    id: string,
    stateMachineArn: string,
  ): IStateMachine {
    class Import extends StateMachineBase {
      public get stateMachineOutputs(): StateMachineOutputs {
        return {
          arn: this.stateMachineArn,
        };
      }
      public get outputs(): Record<string, any> {
        return this.stateMachineOutputs;
      }

      public readonly stateMachineArn = stateMachineArn;
      public readonly grantPrincipal = new iam.UnknownPrincipal({
        resource: this,
      });
    }

    return new Import(scope, id, {
      environmentFromArn: stateMachineArn,
    });
  }

  /**
   * Import a state machine via resource name
   */
  public static fromStateMachineName(
    scope: Construct,
    id: string,
    stateMachineName: string,
  ): IStateMachine {
    const stateMachineArn = AwsStack.ofAwsConstruct(scope).formatArn({
      service: "states",
      resource: "stateMachine",
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      resourceName: stateMachineName,
    });
    return this.fromStateMachineArn(scope, id, stateMachineArn);
  }

  public abstract readonly stateMachineArn: string;
  public get stateMachineOutputs(): StateMachineOutputs {
    return {
      arn: this.stateMachineArn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.stateMachineOutputs;
  }

  /**
   * The principal this state machine is running as
   */
  public abstract readonly grantPrincipal: iam.IPrincipal;

  /**
   * Grant the given identity permissions to start an execution of this state
   * machine.
   */
  public grantStartExecution(identity: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions: ["states:StartExecution"],
      resourceArns: [this.stateMachineArn],
    });
  }

  /**
   * Grant the given identity permissions to start a synchronous execution of
   * this state machine.
   */
  public grantStartSyncExecution(identity: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions: ["states:StartSyncExecution"],
      resourceArns: [this.stateMachineArn],
    });
  }

  /**
   * Grant the given identity permissions to read results from state
   * machine.
   */
  public grantRead(identity: iam.IGrantable): iam.Grant {
    iam.Grant.addToPrincipal({
      grantee: identity,
      actions: ["states:ListExecutions", "states:ListStateMachines"],
      resourceArns: [this.stateMachineArn],
    });
    iam.Grant.addToPrincipal({
      grantee: identity,
      actions: [
        "states:DescribeExecution",
        "states:DescribeStateMachineForExecution",
        "states:GetExecutionHistory",
      ],
      resourceArns: [`${this.executionArn()}:*`],
    });
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions: [
        "states:ListActivities",
        "states:DescribeStateMachine",
        "states:DescribeActivity",
      ],
      resourceArns: ["*"],
    });
  }

  /**
   * Grant the given identity task response permissions on a state machine
   */
  public grantTaskResponse(identity: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions: [
        "states:SendTaskSuccess",
        "states:SendTaskFailure",
        "states:SendTaskHeartbeat",
      ],
      resourceArns: [this.stateMachineArn],
    });
  }

  /**
   * Grant the given identity permissions on all executions of the state machine
   */
  public grantExecution(identity: iam.IGrantable, ...actions: string[]) {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions,
      resourceArns: [`${this.executionArn()}:*`],
    });
  }

  /**
   * Grant the given identity custom permissions
   */
  public grant(identity: iam.IGrantable, ...actions: string[]): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee: identity,
      actions,
      resourceArns: [this.stateMachineArn],
    });
  }

  /**
   * Returns the pattern for the execution ARN's of the state machine
   */
  private executionArn(): string {
    return this.stack.formatArn({
      resource: "execution",
      service: "states",
      resourceName: Arn.split(
        this.stateMachineArn,
        ArnFormat.COLON_RESOURCE_NAME,
      ).resourceName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
  }
}

/**
 * Define a StepFunctions State Machine
 */
export class StateMachine extends StateMachineBase {
  /**
   * Execution role of this state machine
   */
  public readonly role: iam.IRole;
  public readonly resource: sfnStateMachine.SfnStateMachine;
  /**
   * The name of the state machine
   * @attribute
   */
  public get stateMachineName(): string {
    return this.resource.name;
  }

  /**
   * The ARN of the state machine
   */
  public get stateMachineArn(): string {
    return this.resource.arn;
  }

  /**
   * Type of the state machine
   * @attribute
   */
  public readonly stateMachineType: StateMachineType;

  /**
   * Identifier for the state machine revision, which is an immutable, read-only snapshot of a state machine’s definition and configuration.
   * @attribute
   */
  public readonly stateMachineRevisionId: string;

  constructor(scope: Construct, id: string, props: StateMachineProps) {
    super(scope, id, props);

    const { stateMachineName, namePrefix } = this.validateStateMachineName(
      props.stateMachineName,
      props.namePrefix,
    );

    this.role =
      props.role ||
      new iam.Role(this, "Role", {
        assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
      });

    const definitionBody = props.definitionBody;

    this.stateMachineType = props.stateMachineType ?? StateMachineType.STANDARD;

    let graph: StateGraph | undefined = undefined;
    if (definitionBody instanceof ChainDefinitionBody) {
      graph = new StateGraph(
        definitionBody.chainable.startState,
        "State Machine definition",
      );
      graph.timeout = props.timeout;
      for (const statement of graph.policyStatements) {
        this.addToRolePolicy(statement);
      }
    }

    this.resource = new sfnStateMachine.SfnStateMachine(this, "Resource", {
      name: stateMachineName,
      namePrefix,
      type: props.stateMachineType ?? undefined,
      roleArn: this.role.roleArn,
      loggingConfiguration: props.logs
        ? this.buildLoggingConfiguration(props.logs)
        : undefined,
      tracingConfiguration: this.buildTracingConfiguration(
        props.tracingEnabled,
      ),
      ...definitionBody.bind(this, this.role, props, graph),
      publish: props.publish,
      tags: props.tags,
      // encryptionConfiguration: buildEncryptionConfiguration(props.encryptionConfiguration),
    });

    if (definitionBody instanceof ChainDefinitionBody) {
      graph!.bind(this);
    }

    this.resource.node.addDependency(this.role);
    this.stateMachineRevisionId = this.resource.stateMachineVersionArn;
  }

  /**
   * The principal this state machine is running as
   */
  public get grantPrincipal() {
    return this.role.grantPrincipal;
  }

  /**
   * Add the given statement to the role's policy
   */
  public addToRolePolicy(statement: iam.PolicyStatement) {
    this.role.addToPrincipalPolicy(statement);
  }

  private validateStateMachineName(
    stateMachineName?: string,
    prefix?: string,
  ): { stateMachineName?: string; namePrefix?: string } {
    if (stateMachineName && prefix) {
      throw new Error(
        "Cannot specify both 'stateMachineName' and 'namePrefix'. Use only one.",
      );
    } else {
    }

    if (!stateMachineName) {
      return {
        namePrefix: this.stack.uniqueResourceNamePrefix(this, {
          prefix: (prefix ?? this.gridUUID) + "-",
          allowedSpecialCharacters: "-_",
          maxLength: 80,
        }),
      };
    } else {
      if (Token.isUnresolved(stateMachineName)) {
        // can't really validate...
        return {
          stateMachineName,
        };
      }

      if (stateMachineName.length < 1 || stateMachineName.length > 80) {
        throw new Error(
          `State Machine name must be between 1 and 80 characters. Received: ${stateMachineName}`,
        );
      }

      if (!stateMachineName.match(/^[a-z0-9\+\!\@\.\(\)\-\=\_\']+$/i)) {
        throw new Error(
          `State Machine name must match "^[a-z0-9+!@.()-=_']+$/i". Received: ${stateMachineName}`,
        );
      }
    }
    return {
      stateMachineName,
    };
  }

  private buildLoggingConfiguration(
    logOptions: LogOptions,
  ): sfnStateMachine.SfnStateMachineLoggingConfiguration {
    // https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html#cloudwatch-iam-policy
    this.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      }),
    );

    return {
      // TODO: Implement ILogGroup
      logDestination: logOptions.logDestination,
      includeExecutionData: logOptions.includeExecutionData,
      level: logOptions.level || "ERROR",
    };
  }

  private buildTracingConfiguration(
    isTracing?: boolean,
  ): sfnStateMachine.SfnStateMachineTracingConfiguration | undefined {
    if (isTracing === undefined) {
      return undefined;
    }

    if (isTracing) {
      this.addToRolePolicy(
        new iam.PolicyStatement({
          // https://docs.aws.amazon.com/xray/latest/devguide/security_iam_id-based-policy-examples.html#xray-permissions-resources
          // https://docs.aws.amazon.com/step-functions/latest/dg/xray-iam.html
          actions: [
            "xray:PutTraceSegments",
            "xray:PutTelemetryRecords",
            "xray:GetSamplingRules",
            "xray:GetSamplingTargets",
          ],
          resources: ["*"],
        }),
      );
    }

    return {
      enabled: isTracing,
    };
  }
}

/**
 * Partial object from the StateMachine L1 construct properties containing definition information
 */
export interface DefinitionConfig {
  readonly definition: string;
}

export abstract class DefinitionBody {
  public static fromString(definition: string): DefinitionBody {
    return new StringDefinitionBody(definition);
  }

  public static fromChainable(chainable: IChainable): DefinitionBody {
    return new ChainDefinitionBody(chainable);
  }

  public abstract bind(
    scope: Construct,
    sfnPrincipal: iam.IPrincipal,
    sfnProps: StateMachineProps,
    graph?: StateGraph,
  ): DefinitionConfig;
}

export class StringDefinitionBody extends DefinitionBody {
  constructor(public readonly body: string) {
    super();
  }

  public bind(
    _scope: Construct,
    _sfnPrincipal: iam.IPrincipal,
    _sfnProps: StateMachineProps,
    _graph?: StateGraph,
  ): DefinitionConfig {
    return {
      definition: this.body,
    };
  }
}

export class ChainDefinitionBody extends DefinitionBody {
  constructor(public readonly chainable: IChainable) {
    super();
  }

  public bind(
    scope: Construct,
    _sfnPrincipal: iam.IPrincipal,
    sfnProps: StateMachineProps,
    graph?: StateGraph,
  ): DefinitionConfig {
    const graphJson = graph!.toGraphJson();
    return {
      definition: AwsStack.ofAwsConstruct(scope).toJsonString({
        ...graphJson,
        Comment: sfnProps.comment,
      }),
    };
  }
}

/**
 * Two types of state machines are available in AWS Step Functions: EXPRESS AND STANDARD.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/concepts-standard-vs-express.html
 *
 * @default STANDARD
 */
export enum StateMachineType {
  /**
   * Express Workflows are ideal for high-volume, event processing workloads.
   */
  EXPRESS = "EXPRESS",

  /**
   * Standard Workflows are ideal for long-running, durable, and auditable workflows.
   */
  STANDARD = "STANDARD",
}

/**
 * Defines which category of execution history events are logged.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/cloudwatch-log-level.html
 *
 * @default ERROR
 */
export enum LogLevel {
  /**
   * No Logging
   */
  OFF = "OFF",
  /**
   * Log everything
   */
  ALL = "ALL",
  /**
   * Log all errors
   */
  ERROR = "ERROR",
  /**
   * Log fatal errors
   */
  FATAL = "FATAL",
}

export interface LogOptions {
  // TODO: why not just use StructBuilder for SfnStateMachineLoggingConfiguration?

  /**
   * Determines whether execution data is included in your log.
   *
   * When set to false, data is excluded.
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sfn_state_machine#include_execution_data SfnStateMachine#include_execution_data}
   * @default false
   */
  readonly includeExecutionData?: boolean | IResolvable;
  /**
   * Defines which category of execution history events are logged.
   *
   * @default ERROR
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sfn_state_machine#level SfnStateMachine#level}
   */
  readonly level?: LogLevel;
  /**
   * The log group where the execution history events will be logged.
   *
   * Amazon Resource Name (ARN) of a CloudWatch log group.
   * Make sure the State Machine has the correct IAM policies for logging.
   * The ARN must end with `:*`
   *
   * Docs at Terraform Registry: {@link https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/sfn_state_machine#log_destination SfnStateMachine#log_destination}
   */
  readonly logDestination?: string; //TODO Implement ILogGroup
}
