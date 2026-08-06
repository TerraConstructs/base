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
	"github.com/gruntwork-io/terratest/modules/terraform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the batch.spot-mnp app
//
// Deploy-validates the PR #136 follow-up review fixes (see apps/batch.spot-mnp.ts):
//  1. the construct-generated BEST_FIT Spot Fleet role carries the
//     AmazonEC2SpotFleetTaggingRole managed policy and the spot compute environment
//     reaches VALID/ENABLED with it wired as spot_iam_fleet_role;
//  2. AWS accepts the nested node-range topology (0:10 + 4:5) and DescribeJobDefinitions
//     reports numNodes=11 with both node-range entries;
//  3. AWS accepts the five-node-group boundary topology (numNodes=5, 5 entries);
// plus the standard post-apply drift oracle.
//
// https://github.com/TerraConstructs/base/pull/136#issuecomment-5199505992
func TestBatchSpotMnp(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "batch.spot-mnp", options, validateBatchSpotMnp)
}

// nodeProperties is the DescribeJobDefinitions NodeProperties JSON shape.
type nodePropertiesDoc struct {
	NumNodes            int `json:"numNodes"`
	MainNode            int `json:"mainNode"`
	NodeRangeProperties []struct {
		TargetNodes string `json:"targetNodes"`
	} `json:"nodeRangeProperties"`
}

func validateBatchSpotMnp(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	spotCEArn := util.LoadOutputAttribute(t, opts, "spot-ce", "arn")
	spotFleetRoleName := terraform.Output(t, opts, "spot-fleet-role-name")
	nestedMnpArn := util.LoadOutputAttribute(t, opts, "nested-mnp", "arn")
	fiveGroupMnpArn := util.LoadOutputAttribute(t, opts, "five-group-mnp", "arn")
	require.NotEmpty(t, spotCEArn)
	require.NotEmpty(t, spotFleetRoleName)
	require.NotEmpty(t, nestedMnpArn)
	require.NotEmpty(t, fiveGroupMnpArn)

	batchClient := util.NewBatchClient(t, awsRegion)
	ctx := context.Background()

	// --- (1a) The generated Spot Fleet role carries AmazonEC2SpotFleetTaggingRole. ---
	role := util.GetIamRole(t, awsRegion, spotFleetRoleName)
	var hasTaggingPolicy bool
	for _, arn := range role.AttachedPolicyArns {
		if strings.HasSuffix(arn, "service-role/AmazonEC2SpotFleetTaggingRole") {
			hasTaggingPolicy = true
			break
		}
	}
	assert.True(t, hasTaggingPolicy,
		"expected role %s to have the AmazonEC2SpotFleetTaggingRole managed policy attached, got %v",
		spotFleetRoleName, role.AttachedPolicyArns)

	// --- (1b) The spot CE reaches VALID/ENABLED with that role as spot_iam_fleet_role. ---
	waitForComputeEnvironmentsValid(t, batchClient, ctx, []string{spotCEArn}, 30, 15*time.Second)
	ceOut, err := batchClient.DescribeComputeEnvironments(ctx, &batch.DescribeComputeEnvironmentsInput{
		ComputeEnvironments: []string{spotCEArn},
	})
	require.NoError(t, err)
	require.Len(t, ceOut.ComputeEnvironments, 1)
	ce := ceOut.ComputeEnvironments[0]
	assert.Equal(t, batchtypes.CEStatusValid, ce.Status)
	assert.Equal(t, batchtypes.CEStateEnabled, ce.State)
	require.NotNil(t, ce.ComputeResources)
	assert.Equal(t, batchtypes.CRTypeSpot, ce.ComputeResources.Type)
	require.NotNil(t, ce.ComputeResources.SpotIamFleetRole)
	assert.True(t, strings.HasSuffix(*ce.ComputeResources.SpotIamFleetRole, spotFleetRoleName),
		"expected the CE's SpotIamFleetRole %s to be the construct-generated role %s",
		*ce.ComputeResources.SpotIamFleetRole, spotFleetRoleName)

	// --- (2)/(3) AWS accepted both multi-node topologies - read numNodes and the
	// node-range entries back via DescribeJobDefinitions. ---
	assertNodeProperties(t, batchClient, ctx, nestedMnpArn, 11, []string{"0:10", "4:5"})
	assertNodeProperties(t, batchClient, ctx, fiveGroupMnpArn, 5, []string{"0:0", "1:1", "2:2", "3:3", "4:4"})

	// --- Drift oracle: re-planning the applied stack must show zero changes. ---
	planExitCode := terraform.PlanExitCode(t, opts)
	assert.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}

func assertNodeProperties(t *testing.T, client *batch.Client, ctx context.Context, jobDefinitionArn string, wantNumNodes int, wantTargetNodes []string) {
	jdOut, err := client.DescribeJobDefinitions(ctx, &batch.DescribeJobDefinitionsInput{
		JobDefinitions: []string{jobDefinitionArn},
	})
	require.NoError(t, err)
	require.Len(t, jdOut.JobDefinitions, 1, "expected exactly one job definition for %s", jobDefinitionArn)
	jd := jdOut.JobDefinitions[0]
	assert.Equal(t, "ACTIVE", aws.ToString(jd.Status))
	require.NotNil(t, jd.NodeProperties, "expected %s to be a multinode job definition", jobDefinitionArn)

	// Round-trip through JSON to reuse one assertion shape for the SDK struct.
	raw, err := json.Marshal(jd.NodeProperties)
	require.NoError(t, err)
	var np nodePropertiesDoc
	require.NoError(t, json.Unmarshal(raw, &np))

	assert.Equal(t, wantNumNodes, np.NumNodes, "numNodes mismatch for %s", jobDefinitionArn)
	var gotTargets []string
	for _, nr := range np.NodeRangeProperties {
		gotTargets = append(gotTargets, nr.TargetNodes)
	}
	assert.ElementsMatch(t, wantTargetNodes, gotTargets, "targetNodes mismatch for %s", jobDefinitionArn)
}
