// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/batch/integ.submit-job.ts

import { App, LocalBackend } from "cdktn";
import { aws, Duration, Size } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sfn.batch-submit-job";

const app = new App({
  outdir,
});

const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g77777777-7777",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

// Upstream (RunBatchStack in integ.submit-job.ts) uses a full ec2.Vpc(stack, 'vpc',
// { restrictDefaultSecurityGroup: false }) with default NAT gateways per AZ. Unlike
// batch.job-queue.ts (whose CEs never scale past minvCpus=0 and therefore need no
// outbound path), this fixture's ManagedEc2EcsComputeEnvironment DOES launch an EC2
// instance to run the submitted job, and that instance must reach the Batch/ECS/ECR
// service endpoints. Rather than pay for NAT Gateways, pin the CE to PUBLIC subnets
// (map-public-ip-on-launch gives the instance a public IP / route to the internet
// gateway directly) - the same cost-saving swap ecs.asg-capacity-provider uses for
// its capacity-provider-backed ASG.
const vpc = new aws.compute.Vpc(stack, "vpc", {
  maxAzs: 2,
  natGateways: 0,
  subnetConfiguration: [
    {
      name: "public",
      subnetType: aws.compute.SubnetType.PUBLIC,
      cidrMask: 24,
    },
  ],
});

const computeEnvironment = new aws.compute.batch.ManagedEc2EcsComputeEnvironment(
  stack,
  "ComputeEnv",
  {
    vpc,
    // public-only VPC (above) - select the public subnets explicitly rather than
    // relying on the no-private-subnets fallback of the default selection.
    vpcSubnets: { subnetType: aws.compute.SubnetType.PUBLIC },
    registerOutputs: true,
    outputName: "compute-env",
  },
);

const jobQueue = new aws.compute.batch.JobQueue(stack, "JobQueue", {
  computeEnvironments: [
    {
      order: 1,
      computeEnvironment,
    },
  ],
  registerOutputs: true,
  outputName: "job-queue",
});

const jobDefinition = new aws.compute.batch.EcsJobDefinition(
  stack,
  "JobDefinition",
  {
    container: new aws.compute.batch.EcsEc2ContainerDefinition(
      stack,
      "Container",
      {
        // Upstream pulls a Docker asset (batchjob-image/) that prints "Hello from
        // Batch!" and exits 0. Replicate that behavior without an asset build by
        // running the same one-liner through the public python:3.13-alpine image.
        image: aws.compute.ecs.ContainerImage.fromRegistry(
          "public.ecr.aws/docker/library/python:3.13-alpine",
        ),
        command: ["python", "-c", "print('Hello from Batch!')"],
        cpu: 256,
        memory: Size.mebibytes(2048),
      },
    ),
    registerOutputs: true,
    outputName: "job-definition",
  },
);

const submitJob = new aws.compute.tasks.BatchSubmitJob(stack, "Submit Job", {
  jobDefinitionArn: jobDefinition.jobDefinitionArn,
  jobQueueArn: jobQueue.jobQueueArn,
  jobName: "MyJob",
  containerOverrides: {
    environment: { key: "value" },
    memory: Size.mebibytes(256),
    vcpus: 1,
  },
  payload: aws.compute.TaskInput.fromObject({
    foo: aws.compute.JsonPath.stringAt("$.bar"),
  }),
  attempts: 3,
  // attempts renders into the SFN task's Parameters.RetryStrategy.Attempts (a Batch
  // SubmitJob API field, retried by Batch itself) - NOT the job definition's
  // retry_strategy - see the PlanExitCode assertion in sfn_batch_test.go.
  taskTimeout: aws.compute.Timeout.duration(Duration.seconds(60)),
  tags: {
    key: "value",
  },
});

const definition = new aws.compute.Pass(stack, "Start", {
  result: aws.compute.Result.fromObject({ bar: "SomeValue" }),
}).next(submitJob);

new aws.compute.StateMachine(stack, "StateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(definition),
  registerOutputs: true,
  outputName: "state-machine",
});

// --- Cancellation fixture (no upstream counterpart): the StopExecution/TerminateJob
// regression in sfn_batch_test.go needs a job that is reliably STILL RUNNING when the
// validator stops the execution. The happy-path print-and-exit job races completion on
// a warm compute environment, so the stop path gets its own INTENTIONALLY LONG-RUNNING
// BUT BOUNDED workload (sleep 300 - Batch's attempt timeout below caps it even if
// termination never arrives) and a UNIQUE job name (MyStopJob) so the validator
// correlates jobs to this path without racing the happy-path job. ---
const stopJobDefinition = new aws.compute.batch.EcsJobDefinition(
  stack,
  "StopJobDefinition",
  {
    container: new aws.compute.batch.EcsEc2ContainerDefinition(
      stack,
      "StopContainer",
      {
        image: aws.compute.ecs.ContainerImage.fromRegistry(
          "public.ecr.aws/docker/library/python:3.13-alpine",
        ),
        command: ["python", "-c", "import time; time.sleep(300)"],
        cpu: 256,
        memory: Size.mebibytes(2048),
      },
    ),
    registerOutputs: true,
    outputName: "stop-job-definition",
  },
);

const submitStopJob = new aws.compute.tasks.BatchSubmitJob(
  stack,
  "Submit Stop Job",
  {
    jobDefinitionArn: stopJobDefinition.jobDefinitionArn,
    jobQueueArn: jobQueue.jobQueueArn,
    jobName: "MyStopJob",
    // Bounded even without termination: Batch kills the attempt at 360s.
    taskTimeout: aws.compute.Timeout.duration(Duration.seconds(360)),
  },
);

new aws.compute.StateMachine(stack, "StopStateMachine", {
  definitionBody: aws.compute.DefinitionBody.fromChainable(submitStopJob),
  registerOutputs: true,
  outputName: "stop-state-machine",
});

app.synth();
