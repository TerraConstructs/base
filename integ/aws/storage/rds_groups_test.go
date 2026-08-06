package test

import (
	"context"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/rds"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
	util "github.com/terraconstructs/base/integ/aws"

	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
)

// Run the apps/rds.groups.ts integration test: SubnetGroup, ParameterGroup via
// BOTH bind paths (aws_db_parameter_group + aws_rds_cluster_parameter_group
// from one L2), OptionGroup with a real MariaDB audit-plugin option, and
// DatabaseSecret. No database instances -- validates the Terraform mapping
// round-trip of the RDS foundations PR.
func TestRdsGroups(t *testing.T) {
	runStorageIntegrationTest(t, "rds.groups", "us-east-1", validateRdsGroups)
}

func validateRdsGroups(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	subnetGroupName := outputs["subnet_group_name"].(string)
	instanceParamsName := outputs["instance_parameter_group_name"].(string)
	clusterParamsName := outputs["cluster_parameter_group_name"].(string)
	optionGroupName := outputs["option_group_name"].(string)
	secretArn := outputs["secret_arn"].(string)
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := rds.NewFromConfig(cfg)

	// --- 1. Subnet group spans both isolated subnets. ---
	sg, err := client.DescribeDBSubnetGroups(ctx, &rds.DescribeDBSubnetGroupsInput{
		DBSubnetGroupName: &subnetGroupName,
	})
	require.NoError(t, err)
	require.Len(t, sg.DBSubnetGroups, 1)
	require.Len(t, sg.DBSubnetGroups[0].Subnets, 2)
	t.Logf("rds-groups: subnet group %s spans %d subnets", subnetGroupName, len(sg.DBSubnetGroups[0].Subnets))

	// --- 2. Instance parameter group exists with the requested parameter. ---
	pg, err := client.DescribeDBParameters(ctx, &rds.DescribeDBParametersInput{
		DBParameterGroupName: &instanceParamsName,
		Source:               strptr("user"),
	})
	require.NoError(t, err)
	require.True(t, hasParameter(pgNames(pg), "log_connections"),
		"instance parameter group %s missing user parameter log_connections", instanceParamsName)
	t.Logf("rds-groups: instance parameter group %s has user log_connections", instanceParamsName)

	// --- 3. Cluster parameter group exists with the requested parameter (the
	// second provider resource behind the same L2). ---
	cpg, err := client.DescribeDBClusterParameters(ctx, &rds.DescribeDBClusterParametersInput{
		DBClusterParameterGroupName: &clusterParamsName,
		Source:                      strptr("user"),
	})
	require.NoError(t, err)
	names := make([]string, 0, len(cpg.Parameters))
	for _, p := range cpg.Parameters {
		if p.ParameterName != nil {
			names = append(names, *p.ParameterName)
		}
	}
	require.True(t, hasParameter(names, "log_connections"),
		"cluster parameter group %s missing user parameter log_connections", clusterParamsName)
	t.Logf("rds-groups: cluster parameter group %s has user log_connections", clusterParamsName)

	// --- 4. Option group carries the MariaDB audit plugin option. ---
	og, err := client.DescribeOptionGroups(ctx, &rds.DescribeOptionGroupsInput{
		OptionGroupName: &optionGroupName,
	})
	require.NoError(t, err)
	require.Len(t, og.OptionGroupsList, 1)
	foundOption := false
	for _, opt := range og.OptionGroupsList[0].Options {
		if opt.OptionName != nil && strings.EqualFold(*opt.OptionName, "MARIADB_AUDIT_PLUGIN") {
			foundOption = true
		}
	}
	require.True(t, foundOption, "option group %s missing MARIADB_AUDIT_PLUGIN", optionGroupName)
	t.Logf("rds-groups: option group %s carries MARIADB_AUDIT_PLUGIN", optionGroupName)

	// --- 5. DatabaseSecret exists and holds a username/password JSON pair. ---
	desc := util.DescribeSecret(t, awsRegion, secretArn)
	require.NotNil(t, desc.ARN)
	secretValue := terratestaws.GetSecretValue(t, awsRegion, secretArn)
	require.Contains(t, secretValue, "\"username\":\"dbadmin\"")
	require.Contains(t, secretValue, "\"password\"")
	t.Logf("rds-groups: database secret %s holds dbadmin credentials", secretArn)

	// --- Drift oracle: re-planning the already-applied stack must show zero
	// changes. Catches sentinel-default and read-back mismatches invisible at
	// synth time (e.g. option/parameter block normalization by the provider). ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}

func strptr(s string) *string { return &s }

func pgNames(out *rds.DescribeDBParametersOutput) []string {
	names := make([]string, 0, len(out.Parameters))
	for _, p := range out.Parameters {
		if p.ParameterName != nil {
			names = append(names, *p.ParameterName)
		}
	}
	return names
}

func hasParameter(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}
