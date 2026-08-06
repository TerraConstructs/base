package test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	ecstypes "github.com/aws/aws-sdk-go-v2/service/ecs/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
)

// Run the apps/ecs-insights-metrics.ts integration test.
//
// Port of the upstream integ.cluster-enhanced-container-insights.ts describeClusters
// assertion, extended to validate the alarms created from the ECS/ContainerInsights
// canned metrics on BaseService.
func TestEcsInsightsMetrics(t *testing.T) {
	app := "ecs-insights-metrics"
	runMonitoringIntegrationTest(t, app, "us-east-1",
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			snapshotPath := filepath.Join("snapshots", app)
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			clusterName := util.LoadOutputAttribute(t, terraformOptions, "cluster", "name")
			serviceName := util.LoadOutputAttribute(t, terraformOptions, "service", "name")

			// Upstream assertion: the cluster reports containerInsights=enhanced.
			ecsClient := terratestaws.NewEcsClient(t, awsRegion)
			describeOut, err := ecsClient.DescribeClusters(context.Background(), &ecs.DescribeClustersInput{
				Clusters: []string{clusterName},
				// Container insights is in the settings array, so it must be included.
				Include: []ecstypes.ClusterField{ecstypes.ClusterFieldSettings},
			})
			require.NoError(t, err)
			require.Len(t, describeOut.Clusters, 1)
			insightsValue := ""
			for _, setting := range describeOut.Clusters[0].Settings {
				if setting.Name == ecstypes.ClusterSettingNameContainerInsights {
					insightsValue = aws.ToString(setting.Value)
				}
			}
			require.Equal(t, "enhanced", insightsValue,
				"expected containerInsights=enhanced on cluster %s", clusterName)

			// The alarms created from the canned metrics. The first four use the canned
			// Maximum statistic; the escape-hatch alarm keeps the cloudwatch.Metric
			// default of Average.
			alarms := []struct {
				outputName string
				metricName string
				statistic  string
			}{
				{"memory_utilized_alarm", "MemoryUtilized", "Maximum"},
				{"memory_reserved_alarm", "MemoryReserved", "Maximum"},
				{"cpu_utilized_alarm", "CpuUtilized", "Maximum"},
				{"cpu_reserved_alarm", "CpuReserved", "Maximum"},
				{"ephemeral_storage_alarm", "EphemeralStorageUtilized", "Average"},
			}
			for _, expected := range alarms {
				alarmName := util.LoadOutputAttribute(t, terraformOptions, expected.outputName, "alarmName")
				alarm := util.GetMetricAlarm(t, awsRegion, alarmName)
				require.NotNil(t, alarm)
				if os.Getenv("WRITE_SNAPSHOTS") == "true" {
					writeSnapshot(t, snapshotPath, alarm, expected.outputName)
				} else {
					integ.Assert(t, alarm, []integ.Assertion{
						{
							Path:           "Namespace",
							ExpectedRegexp: aws.String(`^ECS/ContainerInsights$`),
						},
						{
							Path:           "MetricName",
							ExpectedRegexp: aws.String(fmt.Sprintf("^%s$", expected.metricName)),
						},
						{
							Path:           "Period",
							ExpectedRegexp: aws.String(`^300$`),
						},
					})
					require.Equal(t, expected.statistic, string(alarm.Statistic),
						"unexpected statistic on alarm %s", alarmName)
					dims := map[string]string{}
					for _, d := range alarm.Dimensions {
						dims[aws.ToString(d.Name)] = aws.ToString(d.Value)
					}
					require.Equal(t, clusterName, dims["ClusterName"],
						"expected ClusterName dimension on alarm %s", alarmName)
					require.Equal(t, serviceName, dims["ServiceName"],
						"expected ServiceName dimension on alarm %s", alarmName)
				}
			}
		})
}
