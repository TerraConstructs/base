package test

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth/executors"

	"github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/terraform"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

// Test the instance app
func TestInstance(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	// See if app deploys
	testApp := "instance"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars)
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
	// test_structure.RunTestStage(t, "validate", func() {
	// 	validate(t, tfWorkingDir, awsRegion)
	// })
}

// Test the launch-template app
func TestLaunchTemplate(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	testApp := "launch-template"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars)
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})

	test_structure.RunTestStage(t, "validate", func() {
		validateLaunchTemplate(t, tfWorkingDir, awsRegion)
	})
}

func validateLaunchTemplate(t *testing.T, tfWorkingDir, awsRegion string) {
	opts := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, opts)

	ltID := outputs["LaunchTemplateId"].(string)
	sg1ID := outputs["Sg1Id"].(string)
	sg2ID := outputs["Sg2Id"].(string)

	// Describe the latest version of this LT
	ltVersion := util.GetLaunchTemplateLatestVersion(t, awsRegion, ltID)
	data := ltVersion.LaunchTemplateData

	// Validate VersionDescription
	assert.Equal(t, "test template v1", *ltVersion.VersionDescription)

	// TODO: Validate MetadataOptions
	// mo := data.MetadataOptions
	// assert.True(t, *mo.HttpEndpoint)
	// assert.True(t, *mo.HttpProtocolIpv6)
	// assert.Equal(t, int32(2), *mo.HttpPutResponseHopLimit)
	// assert.Equal(t, types.LaunchTemplateHttpTokensRequired, mo.HttpTokens)
	// assert.Equal(t, types.LaunchTemplateInstanceMetadataTagsEnabled, mo.InstanceMetadataTags)

	// Validate SecurityGroups
	sgs := data.SecurityGroupIds
	assert.Contains(t, sgs, sg1ID)
	assert.Contains(t, sgs, sg2ID)

	// Validate BlockDeviceMappings
	found := false
	for _, bd := range data.BlockDeviceMappings {
		if *bd.DeviceName == "/dev/xvda" {
			e := bd.Ebs
			assert.Equal(t, int32(15), *e.VolumeSize)
			assert.Equal(t, types.VolumeTypeGp3, e.VolumeType)
			assert.Equal(t, int32(250), *e.Throughput)
			found = true
		}
	}
	require.True(t, found, "expected /dev/xvda block device mapping")
}

// Test the instance-public app
func TestInstancePublic(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	// See if app deploys
	testApp := "instance-public"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars)
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
}

// Test the machine-image app
func TestMachineImage(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())

	testApp := "machine-image"
	awsRegion := "us-east-1"
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars)
	})
	// TODO: Resolve permanent diff on the AMI due to the "resolve:ssm" string
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
	test_structure.RunTestStage(t, "validate", func() {
		validateMachineImage(t, tfWorkingDir, awsRegion)
	})
}

func validateMachineImage(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	vpcID := outputs["VpcId"].(string)
	amiParameterName := outputs["AmiParameterOutput"].(string)
	instanceIDs := map[string]string{
		"amzn2":                outputs["amzn2Output"].(string),
		"al2023":               outputs["al2023Output"].(string),
		"al2023MinimalEdition": outputs["al2023WithMinimalAMIOutput"].(string),
		"ssmResolveInstance":   outputs["ssmInstanceTestOutput"].(string),
	}

	// Pre-fetch subnets for VPC (TODO: Resolve errors)
	// logger.Log(t, "Fetching all subnets for VPC "+vpcID)
	// subnets := aws.GetSubnetsForVpc(t, awsRegion, vpcID)

	// Iterate validations
	for name, instanceID := range instanceIDs {
		t.Run(name, func(t *testing.T) {
			// 1. Wait until running & fetch details
			util.WaitForEc2InstanceRunning(t, awsRegion, instanceID, 10, 10*time.Second)
			details := util.GetEc2InstanceDetails(t, awsRegion, instanceID)

			// Validate Instance type
			assert.Equal(t, "t3.nano", string(details.InstanceType))

			// Validate VPC membership
			assert.Equal(t, vpcID, *details.VpcId)

			// TODO: Validate Subnet membership
			// assert.Contains(t, subnets, *details.SubnetId)

			// Basic SG check (at least one SG attached)
			require.True(t, len(details.SecurityGroups) > 0, "expected ≥ 1 security group on %s", instanceID)

			ami := util.GetEc2ImageDetails(t, awsRegion, *details.ImageId)

			// AMI-specific assertions
			switch name {
			case "amzn2":
				assert.Regexp(t, regexp.MustCompile(`amazon/amzn2-ami-`), *ami.ImageLocation)
			case "al2023":
				assert.Regexp(t, regexp.MustCompile(`amazon/al2023-ami-`), *ami.ImageLocation)
			case "al2023MinimalEdition":
				assert.Regexp(t, regexp.MustCompile(`amazon/al2023-ami-minimal-`), *ami.ImageLocation)
			case "ssmResolve":
				// Verify SSM parameter still matches
				amiFromSSM := aws.GetParameter(t, awsRegion, amiParameterName)
				assert.Regexp(t, `^ami-[0-9a-f]+$`, amiFromSSM)
				assert.Equal(t, amiFromSSM, *details.ImageId)
			}
		})
	}
}
