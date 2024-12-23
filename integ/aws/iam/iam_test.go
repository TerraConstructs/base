package test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/gruntwork-io/terratest/modules/aws"
	util "github.com/terraconstructs/base/integ/aws"
	"github.com/terraconstructs/go-synth/executors"

	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
)

// TODO: Addopt util.Assert instead of fragment snapshot testing?
// https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk-testing/framework-integ/test/aws-iam/test/integ.imported-role.ts#L42-L47

// Run the role integration test
func TestRole(t *testing.T) {
	testApp := "role"
	runIamIntegrationTest(t, testApp, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			testCases := []struct {
				outputs      string
				snapshotFile string
			}{
				{"TestRoleOutputs", "TestRole-assume-role.json"},
				{"TestRole2Outputs", "TestRole2-assume-role.tmpl.json"},
				{"TestRole3Outputs", "TestRole3-assume-role.json"},
			}

			for _, tc := range testCases {
				tc := tc // capture range variable
				t.Run(tc.outputs, func(t *testing.T) {
					snapshotPath := filepath.Join("snapshots", testApp)
					validateRole(t, awsRegion, tc.outputs, tfWorkingDir, snapshotPath,
						[]check{
							{
								fieldPath:   "AssumeRolePolicyDocument",
								shouldMatch: tc.snapshotFile,
								unmarshal:   true,
							}})
				})
			}
		})
}

// Run the composite-principal integration test
func TestCompositePrincipal(t *testing.T) {
	testApp := "composite-principal"
	runIamIntegrationTest(t, testApp, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", testApp)
			validateRole(t, awsRegion, "RoleWithCompositePrincipalOutputs", tfWorkingDir, snapshotPath,
				[]check{
					{
						fieldPath:   "AssumeRolePolicyDocument",
						shouldMatch: "assume-role.json",
						unmarshal:   true,
					},
				})
		})
}

// Run the condition-with-ref integration test
func TestConditionWithRef(t *testing.T) {
	testApp := "condition-with-ref"
	runIamIntegrationTest(t, testApp, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", testApp)
			validateRole(t, awsRegion, "MyRoleOutputs", tfWorkingDir, snapshotPath,
				[]check{
					{
						fieldPath:   "AssumeRolePolicyDocument",
						shouldMatch: "assume-role.tmpl.json",
						unmarshal:   true,
					},
				})
		})
}

// Run the managed-policy integration test
func TestManagedPolicy(t *testing.T) {
	testApp := "managed-policy"
	runIamIntegrationTest(t, testApp, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", testApp)
			validateRole(t, awsRegion, "RoleOutputs", tfWorkingDir, snapshotPath,
				[]check{
					{
						fieldPath:   "AssumeRolePolicyDocument",
						shouldMatch: "Role-assumeDoc.tmpl.json",
						unmarshal:   true,
					},
					{
						fieldPath:   "AttachedPolicyArns",
						shouldMatch: "Role-attachedPolicyArns.tmpl.json",
					},
				})
			validateManagedPolicy(t, awsRegion, "OneManagedPolicyOutputs", tfWorkingDir, snapshotPath,
				[]check{
					{
						fieldPath:   "PolicyDocument",
						shouldMatch: "OneManagedPolicy-doc.tmpl.json",
						unmarshal:   true,
					},
				})
			validateManagedPolicy(t, awsRegion, "TwoManagedPolicyOutputs", tfWorkingDir, snapshotPath,
				[]check{
					{
						fieldPath:   "PolicyDocument",
						shouldMatch: "TwoManagedPolicy-doc.tmpl.json",
						unmarshal:   true,
					},
				})
		})
}

// validate or snapshot the role created
func validateRole(t *testing.T, awsRegion string, roleKey string, tfWorkingDir string, snapshotDir string, checks []check) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	roleName := util.LoadOutputAttribute(t, terraformOptions, roleKey, "name")
	role := util.GetIamRole(t, awsRegion, roleName)
	if snapshotDir != "" {
		if os.Getenv("WRITE_SNAPSHOTS") == "true" {
			// write a single full role snapshot
			writeSnapshot(t, snapshotDir, role, roleKey)
		} else {
			tmplVars := util.Variables{
				"AccountId": aws.GetAccountId(t),
			}
			runChecks(t, snapshotDir, role, checks, &tmplVars)
		}
	}
}

// validate or snapshot the managed Policy created
func validateManagedPolicy(t *testing.T, awsRegion string, managedRoleKey string, tfWorkingDir string, snapshotDir string, checks []check) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	managedRoleArn := util.LoadOutputAttribute(t, terraformOptions, managedRoleKey, "arn")
	policy := util.GetIamManagedPolicy(t, awsRegion, managedRoleArn)
	if snapshotDir != "" {
		if os.Getenv("WRITE_SNAPSHOTS") == "true" {
			// write a single full policy snapshot
			writeSnapshot(t, snapshotDir, policy, managedRoleKey)
		} else {
			tmplVars := util.Variables{
				"AccountId": aws.GetAccountId(t),
			}
			runChecks(t, snapshotDir, policy, checks, &tmplVars)
		}
	}
}

// run integration test
func runIamIntegrationTest(t *testing.T, testApp, awsRegion string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars := executors.EnvMap(os.Environ())
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
		validate(t, tfWorkingDir, awsRegion)
	})
}
