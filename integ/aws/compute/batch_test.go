package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/batch"
	batchtypes "github.com/aws/aws-sdk-go-v2/service/batch/types"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the batch.job-queue app
//
// Ports aws-batch's integ.job-queue.ts: a Vpc + two default-config
// ManagedEc2EcsComputeEnvironments (no explicit instance types/counts, no spot fleet
// role, no launch template) + a FairshareSchedulingPolicy + a JobQueue wired via the
// ordered `computeEnvironments` prop and the imperative `addComputeEnvironment()` /
// `addShare()` APIs - validating the Lazy-produced ordered compute-environment list
// (job-queue.ts) and the Lazy-produced fair_share_policy.share_distribution
// (scheduling-policy.ts) both resolve correctly at synth time from state mutated
// after construction.
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-batch/test/integ.job-queue.ts
func TestBatchJobQueue(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "batch.job-queue", options, validateBatchJobQueue)
}

func validateBatchJobQueue(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	fairshareArn := util.LoadOutputAttribute(t, opts, "fairshare-policy", "arn")
	fairshareName := util.LoadOutputAttribute(t, opts, "fairshare-policy", "name")
	managedCEArn := util.LoadOutputAttribute(t, opts, "managed-ec2-ce", "arn")
	newManagedCEArn := util.LoadOutputAttribute(t, opts, "new-managed-ec2-ce", "arn")
	jobQueueArn := util.LoadOutputAttribute(t, opts, "job-queue", "arn")
	jobQueueName := util.LoadOutputAttribute(t, opts, "job-queue", "name")
	require.NotEmpty(t, fairshareArn)
	require.NotEmpty(t, fairshareName)
	require.NotEmpty(t, managedCEArn)
	require.NotEmpty(t, newManagedCEArn)
	require.NotEmpty(t, jobQueueArn)
	require.NotEmpty(t, jobQueueName)

	// --- Drift oracle: re-planning the already-applied stack must show zero changes.
	// Catches sentinel-default and read-back mismatches (e.g. a bare-name vs ARN, or
	// empty nested blocks the provider persists differently) invisible at synth time. ---
	planExitCode := terraform.PlanExitCode(t, opts)
	assert.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)

	client := util.NewBatchClient(t, awsRegion)
	ctx := context.Background()

	// --- Compute environments: both reach VALID/ENABLED. ---
	//
	// A compute environment's status transitions to VALID asynchronously after
	// creation (CREATING -> VALID), so poll rather than describing once.
	waitForComputeEnvironmentsValid(t, client, ctx, []string{managedCEArn, newManagedCEArn}, 30, 15*time.Second)

	ceOut, err := client.DescribeComputeEnvironments(ctx, &batch.DescribeComputeEnvironmentsInput{
		ComputeEnvironments: []string{managedCEArn, newManagedCEArn},
	})
	require.NoError(t, err)
	require.Len(t, ceOut.ComputeEnvironments, 2, "expected exactly 2 compute environments")
	for _, ce := range ceOut.ComputeEnvironments {
		assert.Equal(t, batchtypes.CEStatusValid, ce.Status,
			"expected compute environment %s to be VALID, got %s (%s)",
			aws.ToString(ce.ComputeEnvironmentName), ce.Status, aws.ToString(ce.StatusReason))
		assert.Equal(t, batchtypes.CEStateEnabled, ce.State,
			"expected compute environment %s to be ENABLED", aws.ToString(ce.ComputeEnvironmentName))
	}

	// --- Job queue: name, priority=10, state ENABLED, ordered compute-environment
	// associations (managedEc2CE at order 1, newManagedEc2CE added via
	// addComputeEnvironment() at order 2), scheduling_policy_arn set. ---
	jqOut, err := client.DescribeJobQueues(ctx, &batch.DescribeJobQueuesInput{
		JobQueues: []string{jobQueueArn},
	})
	require.NoError(t, err)
	require.Len(t, jqOut.JobQueues, 1)
	jq := jqOut.JobQueues[0]
	assert.Equal(t, jobQueueName, aws.ToString(jq.JobQueueName))
	assert.EqualValues(t, 10, aws.ToInt32(jq.Priority))
	assert.Equal(t, batchtypes.JQStateEnabled, jq.State)
	assert.Equal(t, fairshareArn, aws.ToString(jq.SchedulingPolicyArn),
		"expected the job queue's scheduling_policy_arn to reference the FairshareSchedulingPolicy")

	require.Len(t, jq.ComputeEnvironmentOrder, 2, "expected exactly 2 ordered compute environment associations")
	orderByArn := map[string]int32{}
	for _, ceo := range jq.ComputeEnvironmentOrder {
		orderByArn[aws.ToString(ceo.ComputeEnvironment)] = aws.ToInt32(ceo.Order)
	}
	assert.EqualValues(t, 1, orderByArn[managedCEArn],
		"expected managedEc2CE (configured via the `computeEnvironments` prop) at order 1")
	assert.EqualValues(t, 2, orderByArn[newManagedCEArn],
		"expected newManagedEc2CE (added via queue.addComputeEnvironment()) at order 2")

	// --- Scheduling policy: fair_share_policy.compute_reservation=75, with shares
	// shareA(0.5, set at construction) + shareB(7, added via
	// fairsharePolicy.addShare() after the JobQueue was already constructed). ---
	spOut, err := client.DescribeSchedulingPolicies(ctx, &batch.DescribeSchedulingPoliciesInput{
		Arns: []string{fairshareArn},
	})
	require.NoError(t, err)
	require.Len(t, spOut.SchedulingPolicies, 1)
	sp := spOut.SchedulingPolicies[0]
	assert.Equal(t, fairshareName, aws.ToString(sp.Name))
	require.NotNil(t, sp.FairsharePolicy)
	assert.EqualValues(t, 75, aws.ToInt32(sp.FairsharePolicy.ComputeReservation))

	shares := map[string]float32{}
	for _, share := range sp.FairsharePolicy.ShareDistribution {
		shares[aws.ToString(share.ShareIdentifier)] = aws.ToFloat32(share.WeightFactor)
	}
	require.Len(t, shares, 2, "expected exactly 2 shares (shareA from construction + shareB from addShare())")
	assert.InDelta(t, 0.5, shares["shareA"], 0.0001)
	assert.InDelta(t, 7, shares["shareB"], 0.0001)
}

// waitForComputeEnvironmentsValid polls DescribeComputeEnvironments until every
// compute environment in arns reports status VALID (or fails the test on INVALID /
// after maxRetries).
func waitForComputeEnvironmentsValid(t *testing.T, client *batch.Client, ctx context.Context, arns []string, maxRetries int, sleepBetweenRetries time.Duration) {
	description := "Waiting for compute environments to become VALID"
	_, err := retry.DoWithRetryE(t, description, maxRetries, sleepBetweenRetries, func() (string, error) {
		out, err := client.DescribeComputeEnvironments(ctx, &batch.DescribeComputeEnvironmentsInput{
			ComputeEnvironments: arns,
		})
		if err != nil {
			return "", err
		}
		if len(out.ComputeEnvironments) != len(arns) {
			return "", fmt.Errorf("expected %d compute environments, got %d", len(arns), len(out.ComputeEnvironments))
		}
		for _, ce := range out.ComputeEnvironments {
			if ce.Status == batchtypes.CEStatusInvalid {
				require.FailNow(t, "compute environment became INVALID",
					"%s: %s", aws.ToString(ce.ComputeEnvironmentName), aws.ToString(ce.StatusReason))
			}
			if ce.Status != batchtypes.CEStatusValid {
				return "", fmt.Errorf("compute environment %s is %s, not yet VALID",
					aws.ToString(ce.ComputeEnvironmentName), ce.Status)
			}
		}
		return "all compute environments are VALID", nil
	})
	require.NoError(t, err, description)
}
