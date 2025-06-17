package aws

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// NewEc2ClientE returns a client for EC2 in the given region.
func NewEc2ClientE(t testing.TestingT, region string) (*ec2.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return ec2.NewFromConfig(cfg), nil
}

// NewEc2Client returns a client for EC2 in the given region or fails the test.
func NewEc2Client(t testing.TestingT, region string) *ec2.Client {
	client, err := NewEc2ClientE(t, region)
	require.NoError(t, err)
	return client
}

// GetEc2ImageDetailsE fetches the details of the image by image ID.
func GetEc2ImageDetailsE(t testing.TestingT, region, imageID string) (*types.Image, error) {
	logger.Log(t, fmt.Sprintf("Describing EC2 image %s in %s", imageID, region))
	client, err := NewEc2ClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribeImages(context.Background(), &ec2.DescribeImagesInput{
		ImageIds: []string{imageID},
	})
	if err != nil {
		return nil, err
	}
	if len(resp.Images) == 0 {
		return nil, fmt.Errorf("no EC2 image found for ID %s in %s", imageID, region)
	}
	return &resp.Images[0], nil
}

// GetEc2ImageDetails fetches the details of the image or fails the test.
func GetEc2ImageDetails(t testing.TestingT, region, imageID string) *types.Image {
	img, err := GetEc2ImageDetailsE(t, region, imageID)
	require.NoError(t, err)
	return img
}

// GetEc2InstanceDetailsE fetches the details of the instance with the given ID.
func GetEc2InstanceDetailsE(t testing.TestingT, region, instanceID string) (*types.Instance, error) {
	logger.Log(t, fmt.Sprintf("Describing EC2 instance %s in %s", instanceID, region))
	client, err := NewEc2ClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribeInstances(context.Background(), &ec2.DescribeInstancesInput{
		InstanceIds: []string{instanceID},
	})
	if err != nil {
		return nil, err
	}
	if len(resp.Reservations) == 0 || len(resp.Reservations[0].Instances) == 0 {
		return nil, fmt.Errorf("no EC2 instance found for ID %s in %s", instanceID, region)
	}
	return &resp.Reservations[0].Instances[0], nil
}

// GetEc2InstanceDetails fetches the details of the instance or fails the test.
func GetEc2InstanceDetails(t testing.TestingT, region, instanceID string) *types.Instance {
	inst, err := GetEc2InstanceDetailsE(t, region, instanceID)
	require.NoError(t, err)
	return inst
}

// AssertEc2InstanceRunningE checks if the instance is in the "running" state.
func AssertEc2InstanceRunningE(t testing.TestingT, region, instanceID string) error {
	logger.Log(t, fmt.Sprintf("Asserting EC2 instance %s is running in %s", instanceID, region))
	inst, err := GetEc2InstanceDetailsE(t, region, instanceID)
	if err != nil {
		return err
	}
	if inst.State == nil || inst.State.Name != types.InstanceStateNameRunning {
		state := "<unknown>"
		if inst.State != nil {
			state = string(inst.State.Name)
		}
		return fmt.Errorf("EC2 instance %s is in state %s; want %s", instanceID, state, types.InstanceStateNameRunning)
	}
	return nil
}

// AssertEc2InstanceRunning fails the test if the instance is not running.
func AssertEc2InstanceRunning(t testing.TestingT, region, instanceID string) {
	err := AssertEc2InstanceRunningE(t, region, instanceID)
	require.NoError(t, err)
}

// GetEc2InstancesByTagE returns all instances matching the tag filter.
func GetEc2InstancesByTagE(t testing.TestingT, region, tagName, tagValue string) ([]types.Instance, error) {
	logger.Log(t, fmt.Sprintf("Describing EC2 instances with tag %s=%s in %s", tagName, tagValue, region))
	client, err := NewEc2ClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribeInstances(context.Background(), &ec2.DescribeInstancesInput{
		Filters: []types.Filter{
			{
				Name:   aws.String("tag:" + tagName),
				Values: []string{tagValue},
			},
			{
				Name:   aws.String("instance-state-name"),
				Values: []string{string(types.InstanceStateNameRunning)},
			},
		},
	})
	if err != nil {
		return nil, err
	}

	var instances []types.Instance
	for _, res := range resp.Reservations {
		instances = append(instances, res.Instances...)
	}
	return instances, nil
}

// GetEc2InstancesByTag fails the test if there is an error.
func GetEc2InstancesByTag(t testing.TestingT, region, tagName, tagValue string) []types.Instance {
	insts, err := GetEc2InstancesByTagE(t, region, tagName, tagValue)
	require.NoError(t, err)
	return insts
}

// WaitForEc2InstanceStateE waits until the instance reaches the desired state.
func WaitForEc2InstanceStateE(t testing.TestingT, region, instanceID string, desired types.InstanceStateName, maxRetries int, sleepBetweenRetries time.Duration) error {
	description := fmt.Sprintf("Waiting for EC2 instance %s to be %s", instanceID, desired)
	logger.Log(t, description)
	msg, err := retry.DoWithRetryE(
		t,
		description,
		maxRetries,
		sleepBetweenRetries,
		func() (string, error) {
			inst, err := GetEc2InstanceDetailsE(t, region, instanceID)
			if err != nil {
				return "", err
			}
			if inst.State != nil && inst.State.Name == desired {
				return fmt.Sprintf("Instance %s is now %s", instanceID, desired), nil
			}
			current := "<unknown>"
			if inst.State != nil {
				current = string(inst.State.Name)
			}
			return "", fmt.Errorf("current state is %s; want %s", current, desired)
		})
	logger.Log(t, msg)
	return err
}

// WaitForEc2InstanceRunning waits for the instance to be in the running state.
func WaitForEc2InstanceRunning(t testing.TestingT, region, instanceID string, maxRetries int, sleepBetweenRetries time.Duration) {
	err := WaitForEc2InstanceStateE(t, region, instanceID, types.InstanceStateNameRunning, maxRetries, sleepBetweenRetries)
	require.NoError(t, err)
}

// Describe LaunchTemplate helpers

// GetLaunchTemplateVersionE describes a specific version of the launch template.
func GetLaunchTemplateVersionE(t testing.TestingT, region, launchTemplateID, version string) (*types.LaunchTemplateVersion, error) {
	logger.Log(t, fmt.Sprintf("Describing LaunchTemplate %s version %s in %s", launchTemplateID, version, region))
	client, err := NewEc2ClientE(t, region)
	if err != nil {
		return nil, err
	}

	resp, err := client.DescribeLaunchTemplateVersions(context.Background(), &ec2.DescribeLaunchTemplateVersionsInput{
		LaunchTemplateId: aws.String(launchTemplateID),
		Versions:         []string{version},
	})
	if err != nil {
		return nil, err
	}

	if len(resp.LaunchTemplateVersions) == 0 {
		return nil, fmt.Errorf("no launch template version %s found for ID %s", version, launchTemplateID)
	}
	return &resp.LaunchTemplateVersions[0], nil
}

// GetLaunchTemplateLatestVersionE describes the "$Latest" version of the launch template.
func GetLaunchTemplateLatestVersionE(t testing.TestingT, region, launchTemplateID string) (*types.LaunchTemplateVersion, error) {
	return GetLaunchTemplateVersionE(t, region, launchTemplateID, "$Latest")
}

// GetLaunchTemplateLatestVersion fetches the "$Latest" version and fails the test if there is an error.
func GetLaunchTemplateLatestVersion(t testing.TestingT, region, launchTemplateID string) *types.LaunchTemplateVersion {
	lt, err := GetLaunchTemplateLatestVersionE(t, region, launchTemplateID)
	require.NoError(t, err)
	return lt
}
