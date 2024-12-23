package test

import (
	"testing"

	// loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/stretchr/testify/require"

	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	util "github.com/terraconstructs/base/integ/aws"
)

func replanUsingTerraform(t *testing.T, workingDir string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	plan := terraform.InitAndPlanAndShowWithStructNoLogTempPlanFile(t, terraformOptions)
	// validate no replace in plan struct
	summarizePlan(t, plan)
	require.Equal(t, 0, countReplaceActions(plan))
}

func summarizePlan(t *testing.T, plan *terraform.PlanStruct) int {
	count := 0
	for _, change := range plan.ResourceChangesMap {
		addres := change.Address
		if change.Change.Actions.Create() {
			terratestLogger.Logf(t, "Create Action: %v", addres)
		} else if change.Change.Actions.Delete() {
			terratestLogger.Logf(t, "Delete Action: %v", addres)
		} else if change.Change.Actions.Replace() {
			prettyDiff, err := util.PrettyPrintResourceChange(change)
			require.NoError(t, err)
			terratestLogger.Logf(t, "Replace Action:  %v - %v", addres, prettyDiff)
		} else if change.Change.Actions.Update() {
			prettyDiff, err := util.PrettyPrintResourceChange(change)
			require.NoError(t, err)
			terratestLogger.Logf(t, "Update Action: %v - %v", addres, prettyDiff)
		}
	}
	return count
}

func countReplaceActions(plan *terraform.PlanStruct) int {
	count := 0
	for _, change := range plan.ResourceChangesMap {
		if change.Change.Actions.Replace() {
			count++
		}
	}
	return count
}
