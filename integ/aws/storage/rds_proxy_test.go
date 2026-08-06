package test

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/rds"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
)

// Run the apps/rds.proxy.ts integration test: a real RDS Proxy fronting a
// MySQL db.t3.micro through the DatabaseProxy L2. Validates proxy read-back
// (engine family, TLS), target registration through the
// default-target-group/target resource split, and the post-apply drift oracle.
func TestRdsProxy(t *testing.T) {
	runStorageIntegrationTest(t, "rds.proxy", "us-east-1", validateRdsProxy)
}

func validateRdsProxy(t *testing.T, tfWorkingDir string, awsRegion string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
	outputs := terraform.OutputAll(t, terraformOptions)

	proxyName := outputs["proxy_name"].(string)
	instanceID := outputs["instance_identifier"].(string)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := rds.NewFromConfig(cfg)

	// --- 1. Proxy read-back. ---
	dp, err := client.DescribeDBProxies(ctx, &rds.DescribeDBProxiesInput{
		DBProxyName: &proxyName,
	})
	require.NoError(t, err)
	require.Len(t, dp.DBProxies, 1)
	p := dp.DBProxies[0]
	require.Equal(t, "available", string(p.Status))
	require.NotNil(t, p.EngineFamily)
	require.Equal(t, "MYSQL", *p.EngineFamily)
	require.NotNil(t, p.RequireTLS)
	require.True(t, *p.RequireTLS, "requireTLS default must map to require_tls")
	t.Logf("rds-proxy: %s available (engine family %s, TLS required)", proxyName, *p.EngineFamily)

	// --- 2. The instance is registered as a target through the
	// default-target-group + target resource split. Registration is
	// asynchronous -- poll briefly. ---
	deadline := time.Now().Add(5 * time.Minute)
	registered := false
	for time.Now().Before(deadline) {
		targets, terr := client.DescribeDBProxyTargets(ctx, &rds.DescribeDBProxyTargetsInput{
			DBProxyName: &proxyName,
		})
		require.NoError(t, terr)
		for _, tgt := range targets.Targets {
			if tgt.RdsResourceId != nil && *tgt.RdsResourceId == instanceID {
				registered = true
			}
		}
		if registered {
			break
		}
		time.Sleep(15 * time.Second)
	}
	require.True(t, registered, "instance %s must be registered as a proxy target", instanceID)
	t.Logf("rds-proxy: instance %s registered as proxy target", instanceID)

	// --- Drift oracle: re-planning the already-applied stack must show zero
	// changes (proves the default-target-group/target split reads back cleanly). ---
	planExitCode := terraform.PlanExitCode(t, terraformOptions)
	require.Equal(t, terraform.DefaultSuccessExitCode, planExitCode,
		"expected `tofu plan -detailed-exitcode` to report no drift after apply (got exit code %d)", planExitCode)
}
