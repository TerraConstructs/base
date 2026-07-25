package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the ecs.ebs-taskattach app
//
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-ecs/test/fargate/integ.ebs-taskattach.ts
func TestEcsEbsTaskattach(t *testing.T) {
	options := integrationTestOptions{
		Region: region,
	}
	runComputeIntegrationTest(t, "ecs.ebs-taskattach", options, validateEcsEbsTaskattach)
}

func validateEcsEbsTaskattach(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)

	clusterName := util.LoadOutputAttribute(t, opts, "cluster", "name")
	serviceName := util.LoadOutputAttribute(t, opts, "service", "name")

	// Wait for the service to reach steady state (task RUNNING, EBS volume attached)
	// before inspecting the running task's attachments.
	ecsClient := terratestaws.NewEcsClient(t, awsRegion)
	waitForEcsServiceStable(t, ecsClient, clusterName, serviceName, 10*time.Minute)

	// Validate the `new ecs.FargateService(stack, 'FargateService', { cluster,
	// taskDefinition, desiredCount: 1 })` - default launch type FARGATE, desired count 1.
	service := terratestaws.GetEcsService(t, awsRegion, clusterName, serviceName)
	assert.Equal(t, types.LaunchTypeFargate, service.LaunchType)
	assert.Equal(t, int32(1), service.DesiredCount)

	// Find the (single) running task for the service, and validate that it has an
	// ElasticBlockStorage attachment in ATTACHED status - proof that BaseService's
	// prepare-time `toTerraform()` correctly wired `volume_configuration.managed_ebs_volume`
	// on the `aws_ecs_service` Terraform resource, and ECS actually attached the volume.
	ctx := context.Background()
	listOut, err := ecsClient.ListTasks(ctx, &ecs.ListTasksInput{
		Cluster:     aws.String(clusterName),
		ServiceName: aws.String(serviceName),
	})
	require.NoError(t, err, "expected to list tasks for the service")
	require.NotEmpty(t, listOut.TaskArns, "expected at least one running task for the service")

	describeOut, err := ecsClient.DescribeTasks(ctx, &ecs.DescribeTasksInput{
		Cluster: aws.String(clusterName),
		Tasks:   listOut.TaskArns,
	})
	require.NoError(t, err, "expected to describe the service's tasks")
	require.NotEmpty(t, describeOut.Tasks, "expected DescribeTasks to return at least one task")

	var ebsVolumeID string
	for _, task := range describeOut.Tasks {
		for _, attachment := range task.Attachments {
			if attachment.Type != nil && strings.Contains(*attachment.Type, "ElasticBlockStorage") {
				require.NotNil(t, attachment.Status)
				assert.Equal(t, "ATTACHED", *attachment.Status)
				for _, detail := range attachment.Details {
					if detail.Name != nil && *detail.Name == "volumeId" && detail.Value != nil {
						ebsVolumeID = *detail.Value
					}
				}
			}
		}
	}
	assert.NotEmpty(t, ebsVolumeID, "expected the running task to have an ElasticBlockStorage attachment with a volumeId")

	// Validate the `managedEBSVolume: { encrypted: true, volumeType: GP3, size: 15 GiB,
	// iops: 4000, throughput: 500, tagSpecifications: [{ tags: { purpose: 'production' },
	// propagateTags: SERVICE }, ...] }` configuration actually provisioned the EBS volume
	// with the requested attributes.
	//
	// github.com/aws/aws-sdk-go-v2/service/ec2 is already a go.mod dependency (used by
	// ec2_test.go), so we can describe the volume directly instead of only asserting
	// attachment status above.
	ec2Client := util.NewEc2Client(t, awsRegion)
	volOut, err := ec2Client.DescribeVolumes(ctx, &ec2.DescribeVolumesInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("tag:purpose"),
				Values: []string{"production"},
			},
		},
	})
	require.NoError(t, err, "expected to describe the EBS volume tagged purpose=production")
	require.Len(t, volOut.Volumes, 1, "expected exactly one EBS volume tagged purpose=production (propagated from the service-level tagSpecification)")

	vol := volOut.Volumes[0]
	if ebsVolumeID != "" {
		require.NotNil(t, vol.VolumeId)
		assert.Equal(t, ebsVolumeID, *vol.VolumeId, "expected the tagged volume to match the task's attached EBS volume")
	}
	require.NotNil(t, vol.Encrypted)
	assert.True(t, *vol.Encrypted)
	assert.Equal(t, ec2types.VolumeTypeGp3, vol.VolumeType)
	require.NotNil(t, vol.Size)
	assert.Equal(t, int32(15), *vol.Size)
	require.NotNil(t, vol.Iops)
	assert.Equal(t, int32(4000), *vol.Iops)
	require.NotNil(t, vol.Throughput)
	assert.Equal(t, int32(500), *vol.Throughput)
}
