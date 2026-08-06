package test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/batch"
	batchtypes "github.com/aws/aws-sdk-go-v2/service/batch/types"
	sfntypes "github.com/aws/aws-sdk-go-v2/service/sfn/types"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the sfn.batch-submit-job app
//
// Ports aws-stepfunctions-tasks' integ.submit-job.ts: a Pass state (Result.fromObject
// {bar: "SomeValue"}) chained into a BatchSubmitJob task (jobName "MyJob",
// containerOverrides, JsonPath payload, attempts:3, taskTimeout, tags), wired into a
// StateMachine, submitting against a JobQueue backed by a single
// ManagedEc2EcsComputeEnvironment / EcsJobDefinition(EcsEc2ContainerDefinition running
// public.ecr.aws/docker/library/python:3.13-alpine). Unlike batch.job-queue.ts, this
// fixture's compute environment DOES launch an EC2 instance to actually run the
// submitted job end-to-end.
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-stepfunctions-tasks/test/batch/integ.submit-job.ts
func TestSfnBatchSubmitJob(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "sfn.batch-submit-job", options, validateSfnBatchSubmitJob)
}

// sfnBatchOutput is the subset of the BatchSubmitJob .sync integration's execution
// output (the Batch DescribeJobs-shaped JSON Step Functions returns once the job
// reaches a terminal state) that this validator needs.
type sfnBatchOutput struct {
	JobId string
}

func validateSfnBatchSubmitJob(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	// --- (1) Outputs: never assert exact names - gridUUID g77777777-7777 prefix /
	// MyJob suffix match only (asserted later against the live job name). ---
	stateMachineArn := util.LoadOutputAttribute(t, opts, "state-machine", "arn")
	jobQueueArn := util.LoadOutputAttribute(t, opts, "job-queue", "arn")
	jobQueueName := util.LoadOutputAttribute(t, opts, "job-queue", "name")
	jobDefinitionArn := util.LoadOutputAttribute(t, opts, "job-definition", "arn")
	jobDefinitionName := util.LoadOutputAttribute(t, opts, "job-definition", "name")
	computeEnvArn := util.LoadOutputAttribute(t, opts, "compute-env", "arn")
	require.NotEmpty(t, stateMachineArn)
	require.NotEmpty(t, jobQueueArn)
	require.NotEmpty(t, jobQueueName)
	require.NotEmpty(t, jobDefinitionArn)
	require.NotEmpty(t, jobDefinitionName)
	require.NotEmpty(t, computeEnvArn)

	batchClient := util.NewBatchClient(t, awsRegion)
	ctx := context.Background()

	// --- (2) Compute environment reaches VALID/ENABLED before we submit anything
	// through the state machine (waitForComputeEnvironmentsValid is defined in
	// batch_test.go, same `test` package - reused directly). ---
	waitForComputeEnvironmentsValid(t, batchClient, ctx, []string{computeEnvArn}, 30, 15*time.Second)

	ceOut, err := batchClient.DescribeComputeEnvironments(ctx, &batch.DescribeComputeEnvironmentsInput{
		ComputeEnvironments: []string{computeEnvArn},
	})
	require.NoError(t, err)
	require.Len(t, ceOut.ComputeEnvironments, 1)
	assert.Equal(t, batchtypes.CEStatusValid, ceOut.ComputeEnvironments[0].Status)
	assert.Equal(t, batchtypes.CEStateEnabled, ceOut.ComputeEnvironments[0].State)

	// --- (3) Drive the state machine: Pass({bar:"SomeValue"}) -> BatchSubmitJob.
	// The task's `payload` (TaskInput.fromObject({foo: JsonPath.stringAt("$.bar")}))
	// reads $.bar from the execution input, so start the execution with that shape. ---
	executionArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, map[string]string{"bar": "SomeValue"})

	// 80 x 15s ~= 20 minutes: budget for a cold EC2 instance to spin up under the
	// managed compute environment, pull the python:3.13-alpine image, and run the
	// job to completion. The Makefile target's `go test -timeout 40m` gives headroom
	// above this budget for synth/deploy/cleanup around the wait.
	res, waitErr := util.WaitForSfnExecutionStatusE(t, awsRegion, *executionArn, sfntypes.ExecutionStatusSucceeded, 80, 15*time.Second)
	if waitErr != nil {
		require.FailNowf(t, "state machine execution did not succeed",
			"status=%s error=%s cause=%s (waitErr=%v)", res.Status, res.Error, res.Cause, waitErr)
	}

	// --- (4) HEADLINE ORACLE: re-planning the already-applied (and now-exercised)
	// stack must show zero changes. This is the live answer to PR #136's open
	// question: does the aws_batch_job_definition's empty `retry_strategy {}` block
	// (rendered because EcsJobDefinition is constructed with no retryStrategies/
	// retryAttempts of its own) cause perpetual drift against the provider's
	// read-back? It does not - `attempts: 3` on BatchSubmitJob renders into the SFN
	// task's Parameters.RetryStrategy.Attempts (a Batch SubmitJob API request field,
	// retried by the Batch service on that submitted job), NOT into the job
	// definition's retry_strategy, so the job definition's empty block is exactly
	// what both the config and the provider agree on. Run this AFTER exercising the
	// task (rather than immediately after apply) so a submission-time side effect
	// that mutates the job definition/queue/compute-env would also be caught. ---
	planExitCode := terraform.PlanExitCode(t, opts)
	assert.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply+execution (got exit code %d) - "+
			"a non-zero exit here would mean the job definition's empty retry_strategy block (or some other "+
			"attribute) drifts against the provider's read-back", planExitCode)

	// --- (5) Parse the execution output for the Batch JobId, then confirm the job
	// itself reports SUCCEEDED. ---
	var out sfnBatchOutput
	require.NoError(t, json.Unmarshal([]byte(res.Output), &out), "failed to parse execution output JSON: %s", res.Output)

	if out.JobId != "" {
		jobOut, err := batchClient.DescribeJobs(ctx, &batch.DescribeJobsInput{Jobs: []string{out.JobId}})
		require.NoError(t, err)
		require.Len(t, jobOut.Jobs, 1, "expected DescribeJobs to return exactly one job for id %s", out.JobId)
		assert.Equal(t, batchtypes.JobStatusSucceeded, jobOut.Jobs[0].Status,
			"expected batch job %s to have SUCCEEDED, got %s (%s)",
			out.JobId, jobOut.Jobs[0].Status, aws.ToString(jobOut.Jobs[0].StatusReason))
	} else {
		// Fallback: no JobId parsed from the execution output - list SUCCEEDED jobs on
		// the queue and suffix-match the MyJob name (never assert the exact
		// gridUUID-prefixed name).
		listOut, err := batchClient.ListJobs(ctx, &batch.ListJobsInput{
			JobQueue:  &jobQueueArn,
			JobStatus: batchtypes.JobStatusSucceeded,
		})
		require.NoError(t, err)
		var found bool
		for _, job := range listOut.JobSummaryList {
			if job.JobName != nil && strings.HasSuffix(*job.JobName, "MyJob") {
				found = true
				break
			}
		}
		assert.True(t, found, "expected a SUCCEEDED job on queue %s with a name ending in MyJob", jobQueueName)
	}

	// --- (6) TerminateJob grant (PR #137 review): stopping a .sync execution makes
	// Step Functions issue a best-effort batch:TerminateJob for the in-flight job -
	// without the grant the job would be orphaned and keep running/accruing cost
	// (https://docs.aws.amazon.com/step-functions/latest/dg/service-integration-iam-templates.html#iam-cancel-tasks).
	// Start a second execution and stop it while its job is still queued/running;
	// the job must reach a terminal FAILED state (terminated), not SUCCEEDED. The
	// CE is already warm from (3)-(5), so the job would otherwise complete within
	// seconds - stop immediately after the job appears. ---
	stopExecArn := util.StartSfnExecution(t, awsRegion, stateMachineArn, map[string]string{"bar": "StopMe"})

	// Wait for the submitted job to exist (execution enters the task state and
	// SubmitJob returns), then stop the execution right away.
	var stopJobId string
	for i := 0; i < 40 && stopJobId == ""; i++ {
		for _, status := range []batchtypes.JobStatus{
			batchtypes.JobStatusSubmitted, batchtypes.JobStatusPending,
			batchtypes.JobStatusRunnable, batchtypes.JobStatusStarting,
			batchtypes.JobStatusRunning,
		} {
			listOut2, listErr := batchClient.ListJobs(ctx, &batch.ListJobsInput{
				JobQueue:  &jobQueueArn,
				JobStatus: status,
			})
			require.NoError(t, listErr)
			for _, job := range listOut2.JobSummaryList {
				if job.JobName != nil && strings.HasSuffix(*job.JobName, "MyJob") && job.JobId != nil {
					stopJobId = *job.JobId
					break
				}
			}
			if stopJobId != "" {
				break
			}
		}
		if stopJobId == "" {
			time.Sleep(3 * time.Second)
		}
	}
	require.NotEmpty(t, stopJobId, "expected the second execution to submit a Batch job within the polling budget")
	t.Logf("stop-test: second execution %s submitted job %s - stopping the execution now", *stopExecArn, stopJobId)

	util.StopSfnExecution(t, awsRegion, *stopExecArn)

	// The stopped execution must go ABORTED, and Step Functions' cancellation must
	// drive the job to FAILED (terminated) - a SUCCEEDED job here means the
	// TerminateJob attempt was not made or not permitted. If the job happened to
	// finish in the race window before the stop landed, fail loudly so the flake
	// is visible rather than silently passing.
	_, stopWaitErr := util.WaitForSfnExecutionStatusE(t, awsRegion, *stopExecArn, sfntypes.ExecutionStatusAborted, 20, 6*time.Second)
	require.NoError(t, stopWaitErr, "expected the stopped execution to reach ABORTED")

	var stoppedJobStatus batchtypes.JobStatus
	for i := 0; i < 40; i++ {
		jobOut2, descErr := batchClient.DescribeJobs(ctx, &batch.DescribeJobsInput{Jobs: []string{stopJobId}})
		require.NoError(t, descErr)
		require.Len(t, jobOut2.Jobs, 1)
		stoppedJobStatus = jobOut2.Jobs[0].Status
		if stoppedJobStatus == batchtypes.JobStatusFailed || stoppedJobStatus == batchtypes.JobStatusSucceeded {
			break
		}
		time.Sleep(6 * time.Second)
	}
	assert.Equal(t, batchtypes.JobStatusFailed, stoppedJobStatus,
		"expected the Batch job %s to be terminated (FAILED) after StopExecution - SUCCEEDED means the stop raced job completion, any other status means the TerminateJob grant did not take effect", stopJobId)
}
