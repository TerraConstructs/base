// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-stepfunctions-tasks/lib/batch/submit-job.ts

import { Token } from "cdktn";
import { Construct } from "constructs";
import * as compute from "../../";
import { ValidationError } from "../../../../errors";
import { Size } from "../../../../size";
import { withResolved } from "../../../../token";
import { AwsStack } from "../../../aws-stack";
import * as iam from "../../../iam";
import {
  integrationResourceArn,
  validatePatternSupported,
} from "../private/task-utils";

/**
 * The overrides that should be sent to a container.
 */
export interface BatchContainerOverrides {
  /**
   * The command to send to the container that overrides
   * the default command from the Docker image or the job definition.
   *
   * @default - No command overrides
   */
  readonly command?: string[];

  /**
   * The environment variables to send to the container.
   * You can add new environment variables, which are added to the container
   * at launch, or you can override the existing environment variables from
   * the Docker image or the job definition.
   *
   * @default - No environment overrides
   */
  readonly environment?: { [key: string]: string };

  /**
   * The instance type to use for a multi-node parallel job.
   * This parameter is not valid for single-node container jobs.
   *
   * @default - No instance type overrides
   */
  readonly instanceType?: compute.InstanceType;

  /**
   * Memory reserved for the job.
   *
   * @default - No memory overrides. The memory supplied in the job definition will be used.
   */
  readonly memory?: Size;

  /**
   * The number of physical GPUs to reserve for the container.
   * The number of GPUs reserved for all containers in a job
   * should not exceed the number of available GPUs on the compute
   * resource that the job is launched on.
   *
   * @default - No GPU reservation
   */
  readonly gpuCount?: number;

  /**
   * The number of vCPUs to reserve for the container.
   * This value overrides the value set in the job definition.
   *
   * @default - No vCPUs overrides
   */
  readonly vcpus?: number;
}

/**
 * An object representing an AWS Batch job dependency.
 */
export interface BatchJobDependency {
  /**
   * The job ID of the AWS Batch job associated with this dependency.
   *
   * @default - No jobId
   */
  readonly jobId?: string;

  /**
   * The type of the job dependency.
   *
   * @default - No type
   */
  readonly type?: string;
}

interface BatchSubmitJobOptions {
  /**
   * The arn of the job definition used by this job.
   */
  readonly jobDefinitionArn: string;

  /**
   * The name of the job.
   * The first character must be alphanumeric, and up to 128 letters (uppercase and lowercase),
   * numbers, hyphens, and underscores are allowed.
   */
  readonly jobName: string;

  /**
   * The arn of the job queue into which the job is submitted.
   */
  readonly jobQueueArn: string;

  /**
   * The array size can be between 2 and 10,000.
   * If you specify array properties for a job, it becomes an array job.
   * For more information, see Array Jobs in the AWS Batch User Guide.
   *
   * @default - No array size
   */
  readonly arraySize?: number;

  /**
   * A list of container overrides in JSON format that specify the name of a container
   * in the specified job definition and the overrides it should receive.
   *
   * @see https://docs.aws.amazon.com/batch/latest/APIReference/API_SubmitJob.html#Batch-SubmitJob-request-containerOverrides
   *
   * @default - No container overrides
   */
  readonly containerOverrides?: BatchContainerOverrides;

  /**
   * A list of dependencies for the job.
   * A job can depend upon a maximum of 20 jobs.
   *
   * @see https://docs.aws.amazon.com/batch/latest/APIReference/API_SubmitJob.html#Batch-SubmitJob-request-dependsOn
   *
   * @default - No dependencies
   */
  readonly dependsOn?: BatchJobDependency[];

  /**
   * The payload to be passed as parameters to the batch job
   *
   * @default - No parameters are passed
   */
  readonly payload?: compute.TaskInput;

  /**
   * The number of times to move a job to the RUNNABLE status.
   * You may specify between 1 and 10 attempts.
   * If the value of attempts is greater than one,
   * the job is retried on failure the same number of attempts as the value.
   *
   * @default 1
   */
  readonly attempts?: number;

  /**
   * The tags applied to the job request.
   *
   * @default {} - no tags
   */
  readonly tags?: { [key: string]: string };
}

/**
 * Properties for BatchSubmitJob
 */
export interface BatchSubmitJobProps
  extends compute.TaskStateBaseProps,
    BatchSubmitJobOptions {}

/**
 * Task to submits an AWS Batch job from a job definition.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/connect-batch.html
 */
export class BatchSubmitJob extends compute.TaskStateBase {
  private static readonly SUPPORTED_INTEGRATION_PATTERNS: compute.IntegrationPattern[] =
    [
      compute.IntegrationPattern.REQUEST_RESPONSE,
      compute.IntegrationPattern.RUN_JOB,
    ];

  // protected readonly taskMetrics?: compute.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];

  private readonly integrationPattern: compute.IntegrationPattern;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: BatchSubmitJobProps,
  ) {
    super(scope, id, props);

    this.integrationPattern =
      props.integrationPattern ?? compute.IntegrationPattern.RUN_JOB;
    validatePatternSupported(
      this.integrationPattern,
      BatchSubmitJob.SUPPORTED_INTEGRATION_PATTERNS,
    );

    // validate arraySize limits
    withResolved(props.arraySize, (arraySize) => {
      if (arraySize !== undefined && (arraySize < 2 || arraySize > 10_000)) {
        throw new ValidationError(
          `arraySize must be between 2 and 10,000. Received ${arraySize}.`,
          this,
        );
      }
    });

    // validate dependency size
    if (props.dependsOn && props.dependsOn.length > 20) {
      throw new ValidationError(
        `dependencies must be 20 or less. Received ${props.dependsOn.length}.`,
        this,
      );
    }

    // validate attempts
    withResolved(props.attempts, (attempts) => {
      if (attempts !== undefined && (attempts < 1 || attempts > 10)) {
        throw new ValidationError(
          `attempts must be between 1 and 10. Received ${attempts}.`,
          this,
        );
      }
    });

    // validate timeout
    (props.timeout !== undefined || props.taskTimeout !== undefined) &&
      withResolved(
        props.timeout?.toSeconds(),
        props.taskTimeout?.seconds,
        (timeout, taskTimeout) => {
          const definedTimeout = timeout ?? taskTimeout;
          // `!== undefined` (not truthiness): a literal 0-second timeout must be
          // rejected here, not silently skipped (upstream has the truthiness bug).
          if (definedTimeout !== undefined && definedTimeout < 60) {
            throw new ValidationError(
              `attempt duration must be greater than 60 seconds. Received ${definedTimeout} seconds.`,
              this,
            );
          }
        },
      );

    // This is required since environment variables must not start with AWS_BATCH;
    // this naming convention is reserved for variables that are set by the AWS Batch service.
    if (props.containerOverrides?.environment) {
      Object.keys(props.containerOverrides.environment).forEach((key) => {
        if (key.match(/^AWS_BATCH/)) {
          throw new ValidationError(
            `Invalid environment variable name: ${key}. Environment variable names starting with 'AWS_BATCH' are reserved.`,
            this,
          );
        }
      });
    }

    this.validateTags(props.tags);

    this.taskPolicies = this.configurePolicyStatements();
  }

  /**
   * @internal
   */
  protected _renderTask(): any {
    // `!== undefined` (not truthiness) so a 0-second value cannot silently vanish
    // from the rendered Parameters (upstream has the truthiness bug; 0 is rejected
    // by the constructor validation above regardless).
    let timeout: number | undefined = undefined;
    if (this.props.timeout !== undefined) {
      timeout = this.props.timeout.toSeconds();
    } else if (this.props.taskTimeout?.seconds !== undefined) {
      timeout = this.props.taskTimeout.seconds;
    } else if (this.props.taskTimeout?.path) {
      timeout = compute.JsonPath.numberAt(this.props.taskTimeout.path);
    }

    return {
      Resource: integrationResourceArn(
        this,
        "batch",
        "submitJob",
        this.integrationPattern,
      ),
      Parameters: compute.FieldUtils.renderObject({
        JobDefinition: this.props.jobDefinitionArn,
        JobName: this.props.jobName,
        JobQueue: this.props.jobQueueArn,
        Parameters: this.props.payload?.value,
        ArrayProperties:
          this.props.arraySize !== undefined
            ? { Size: this.props.arraySize }
            : undefined,

        ContainerOverrides: this.props.containerOverrides
          ? this.configureContainerOverrides(this.props.containerOverrides)
          : undefined,

        DependsOn: this.props.dependsOn
          ? this.props.dependsOn.map((jobDependency) => ({
              JobId: jobDependency.jobId,
              Type: jobDependency.type,
            }))
          : undefined,

        RetryStrategy:
          this.props.attempts !== undefined
            ? { Attempts: this.props.attempts }
            : undefined,
        Tags: this.props.tags,
        Timeout:
          timeout !== undefined
            ? { AttemptDurationSeconds: timeout }
            : undefined,
      }),
      // BatchSubmitJob repurposes timeout/taskTimeout to mean the Batch
      // AttemptDurationSeconds (rendered above, nested in Parameters.Timeout).
      // renderTaskBase() (invoked before _renderTask() in toStateJson()) already
      // emitted a (spurious) SFN-level TimeoutSeconds/TimeoutSecondsPath from
      // those same props; overriding them back to undefined here strips that,
      // matching upstream aws-cdk behavior.
      TimeoutSeconds: undefined,
      TimeoutSecondsPath: undefined,
    };
  }

  private configurePolicyStatements(): iam.PolicyStatement[] {
    const statements = [
      // Resource level access control for job-definition requires revision which batch does not support yet
      // Using the alternative permissions as mentioned here:
      // https://docs.aws.amazon.com/batch/latest/userguide/batch-supported-iam-actions-resources.html
      new iam.PolicyStatement({
        resources: compute.JsonPath.isEncodedJsonPath(this.props.jobQueueArn)
          ? ["*"]
          : [
              AwsStack.ofAwsConstruct(this).formatArn({
                service: "batch",
                resource: "job-definition",
                resourceName: "*",
              }),
              this.props.jobQueueArn,
            ],
        // upstream also branches on isValidJsonataExpression(jobQueueArn); base compute
        // has no JSONata support, so only the JsonPath check applies here.
        //
        // TERRACONSTRUCTS DEVIATION: SubmitJob calls that carry tags additionally
        // require batch:TagResource (AWS returns AccessDeniedException on the
        // job-definition otherwise - caught by the sfn.batch-submit-job live integ
        // test). Upstream aws-cdk grants only batch:SubmitJob and has the same
        // runtime failure.
        actions: this.props.tags
          ? ["batch:SubmitJob", "batch:TagResource"]
          : ["batch:SubmitJob"],
      }),
    ];

    // TERRACONSTRUCTS DEVIATION: upstream grants only batch:SubmitJob plus the (unconditional)
    // EventBridge managed-rule statement. Per AWS's IAM policy template for the Batch
    // integration (https://docs.aws.amazon.com/step-functions/latest/dg/connect-batch.html),
    // the Run a Job (.sync) pattern additionally requires batch:DescribeJobs (the polling
    // fallback - without it an execution can get STUCK if the EventBridge completion event
    // is missed or incomplete) and batch:TerminateJob (Step Functions' best-effort job
    // cancellation when an execution is stopped - without it a stopped execution leaves the
    // Batch job running and accruing cost). Job ids are generated at runtime, so AWS
    // documents Resource "*" for these. Request Response gets neither statement: it does
    // not poll, cancel, or use the EventBridge managed rule.
    if (this.integrationPattern === compute.IntegrationPattern.RUN_JOB) {
      statements.push(
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["batch:DescribeJobs", "batch:TerminateJob"],
        }),
        new iam.PolicyStatement({
          resources: [
            AwsStack.ofAwsConstruct(this).formatArn({
              service: "events",
              resource: "rule",
              resourceName: "StepFunctionsGetEventsForBatchJobsRule",
            }),
          ],
          actions: [
            "events:PutTargets",
            "events:PutRule",
            "events:DescribeRule",
          ],
        }),
      );
    }

    return statements;
  }

  private configureContainerOverrides(
    containerOverrides: BatchContainerOverrides,
  ) {
    let environment;
    if (containerOverrides.environment) {
      environment = Object.entries(containerOverrides.environment).map(
        ([key, value]) => ({
          Name: key,
          Value: value,
        }),
      );
    }

    let resources: Array<any> = [];
    if (containerOverrides.gpuCount) {
      resources.push({
        Type: "GPU",
        Value: this.renderResourceRequirementValue(containerOverrides.gpuCount),
      });
    }
    if (containerOverrides.memory) {
      resources.push({
        Type: "MEMORY",
        Value: this.renderResourceRequirementValue(
          containerOverrides.memory.toMebibytes(),
        ),
      });
    }
    if (containerOverrides.vcpus) {
      resources.push({
        Type: "VCPU",
        Value: this.renderResourceRequirementValue(containerOverrides.vcpus),
      });
    }

    return {
      Command: containerOverrides.command,
      Environment: environment,
      InstanceType: containerOverrides.instanceType?.toString(),
      ResourceRequirements: resources.length ? resources : undefined,
    };
  }

  // TERRACONSTRUCTS DEVIATION: upstream stringifies unconditionally (`` `${value}` ``)
  // because the Batch SubmitJob API requires ResourceRequirements[].Value to be a string
  // even for literal numbers. Upstream's Token system can reverse a JsonPath-derived
  // number token that has been coerced through JS string interpolation (its
  // STRING_TOKEN_REGEX also matches the stringified-number sentinel pattern - see
  // aws-cdk-lib/core/lib/private/encoding.ts STRINGIFIED_NUMBER_PATTERN). cdktn's
  // equivalent (node_modules/cdktn/lib/tokens/private/encoding.js STRING_TOKEN_REGEX)
  // has no such alternation, so a JsonPath number token stringified this way would
  // resolve to a dead literal string instead of a Parameters `.$` path (verified: fails
  // the "container overrides are tokens" unit test otherwise). Passing the raw token
  // through undisguised lets FieldUtils.renderObject's handleNumber path detect it via
  // Tokenization.reverseNumber() (which IS supported), while literal numbers are still
  // stringified to match the upstream/API-required string shape.
  private renderResourceRequirementValue(value: number): string | number {
    return Token.isUnresolved(value) ? value : `${value}`;
  }

  private validateTags(tags?: { [key: string]: string }) {
    if (tags === undefined) return;
    const tagEntries = Object.entries(tags);
    if (tagEntries.length > 50) {
      throw new ValidationError(
        `Maximum tag number of entries is 50. Received ${tagEntries.length}.`,
        this,
      );
    }
    for (const [key, value] of tagEntries) {
      if (key.length < 1 || key.length > 128) {
        throw new ValidationError(
          `Tag key size must be between 1 and 128, but got ${key.length}.`,
          this,
        );
      }
      if (value.length > 256) {
        throw new ValidationError(
          `Tag value maximum size is 256, but got ${value.length}.`,
          this,
        );
      }
    }
  }
}
