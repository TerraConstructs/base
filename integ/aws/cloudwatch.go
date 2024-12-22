package aws

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	types "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchevents"
	eventtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatchevents/types"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	logtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// WaitForLogEvents waits for log events to appear in the given CloudWatch Log group in the given region
func WaitForLogEvents(
	t testing.TestingT,
	awsRegion string,
	logGroupName string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) []string {
	events, err := WaitForLogEventsE(t, awsRegion, logGroupName, maxRetries, sleepBetweenRetries)
	require.NoError(t, err)
	return events
}

// WaitForLogEventsE waits for log events to appear in the given CloudWatch Log group in the given region
func WaitForLogEventsE(
	t testing.TestingT,
	awsRegion string,
	logGroupName string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) ([]string, error) {
	var result []string

	description := fmt.Sprintf("Waiting for log events in log group %s", logGroupName)

	_, err := retry.DoWithRetryE(
		t,
		description,
		maxRetries,
		sleepBetweenRetries,
		func() (string, error) {
			messages, err := FilterLogEventsE(t, awsRegion, logGroupName)
			if err != nil {
				return "", err
			}

			if len(messages) > 0 {
				result = messages
				return "Log events found", nil
			} else {
				return "", fmt.Errorf("no log events found yet")
			}
		},
	)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// GetCloudWatchLogEntries returns the CloudWatch log messages in the given region for the given log stream and log group.
func FilterLogEvents(t testing.TestingT, awsRegion string, logGroupName string) []string {
	out, err := FilterLogEventsE(t, awsRegion, logGroupName)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// GetCloudWatchLogEntriesE returns the CloudWatch log messages in the given region for the given log stream and log group.
func FilterLogEventsE(t testing.TestingT, awsRegion string, logGroupName string) ([]string, error) {
	client, err := terratestaws.NewCloudWatchLogsClientE(t, awsRegion)
	if err != nil {
		return nil, err
	}

	output, err := client.FilterLogEvents(context.Background(), &cloudwatchlogs.FilterLogEventsInput{
		LogGroupName: aws.String(logGroupName),
	})

	if err != nil {
		return nil, err
	}

	entries := []string{}
	for _, event := range output.Events {
		entries = append(entries, *event.Message)
	}

	return entries, nil
}

// DescribeEventRule returns the details of the specified rule.
func DescribeEventRule(t testing.TestingT, awsRegion string, ruleName string) *CloudwatchEventsRuleInfo {
	out, err := DescribeEventRuleE(t, awsRegion, ruleName)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

type CloudwatchEventsRuleInfo struct {
	Name               string               // The name of the rule.
	Description        string               // The description of the rule.
	State              eventtypes.RuleState // Specifies whether the rule is enabled or disabled.
	EventPattern       string               // The event pattern.
	ScheduleExpression string               // The scheduling expression. For example, "cron(0 20 * * ? *)", "rate(5 minutes)".
}

// DescribeEventRuleE returns the details of the specified rule.
func DescribeEventRuleE(t testing.TestingT, awsRegion string, ruleName string) (*CloudwatchEventsRuleInfo, error) {
	client, err := NewCloudWatchEventsClientE(t, awsRegion)
	if err != nil {
		return nil, err
	}

	output, err := client.DescribeRule(context.Background(), &cloudwatchevents.DescribeRuleInput{
		Name: aws.String(ruleName),
	})

	if err != nil {
		return nil, err
	}
	ruleInfo := &CloudwatchEventsRuleInfo{
		Name:               aws.ToString(output.Name),
		Description:        aws.ToString(output.Description),
		State:              output.State,
		EventPattern:       aws.ToString(output.EventPattern),
		ScheduleExpression: aws.ToString(output.ScheduleExpression),
	}
	return ruleInfo, nil
}

// NewCloudWatchEventsClient creates a new CloudWatch Events client.
func NewCloudWatchEventsClient(t testing.TestingT, region string) *cloudwatchevents.Client {
	client, err := NewCloudWatchEventsClientE(t, region)
	require.NoError(t, err)
	return client
}

// NewCloudWatchEventsClientE creates a new CloudWatch Logs client.
func NewCloudWatchEventsClientE(t testing.TestingT, region string) (*cloudwatchevents.Client, error) {
	sess, err := terratestaws.NewAuthenticatedSession(region)
	if err != nil {
		return nil, err
	}
	return cloudwatchevents.NewFromConfig(*sess), nil
}

// GetDataProtectionPolicyDocument returns the policy of the specified log group data protection policy.
func GetDataProtectionPolicyDocument(t testing.TestingT, awsRegion string, logGroupName string) string {
	out, err := GetDataProtectionPolicyDocumentE(t, awsRegion, logGroupName)
	require.NoError(t, err)
	return *out
}

// GetDataProtectionPolicyDocumentE returns the details of the specified log group data protection policy.
func GetDataProtectionPolicyDocumentE(t testing.TestingT, awsRegion string, logGroupName string) (*string, error) {
	client, err := terratestaws.NewCloudWatchLogsClientE(t, awsRegion)
	if err != nil {
		return nil, err
	}

	output, err := client.GetDataProtectionPolicy(context.Background(), &cloudwatchlogs.GetDataProtectionPolicyInput{
		LogGroupIdentifier: aws.String(logGroupName),
	})

	if err != nil {
		return nil, err
	}
	return output.PolicyDocument, nil
}

// GetLogGroup returns the details of the specified log group.
func GetLogGroup(t testing.TestingT, awsRegion string, logGroupName string) *logtypes.LogGroup {
	out, err := GetLogGroupE(t, awsRegion, logGroupName)
	require.NoError(t, err)
	return out
}

// GetLogGroupE returns the details of the specified log group.
func GetLogGroupE(t testing.TestingT, awsRegion string, logGroupName string) (*logtypes.LogGroup, error) {
	client, err := terratestaws.NewCloudWatchLogsClientE(t, awsRegion)
	if err != nil {
		return nil, err
	}

	output, err := client.DescribeLogGroups(context.Background(), &cloudwatchlogs.DescribeLogGroupsInput{
		LogGroupNamePrefix: aws.String(logGroupName),
	})

	if err != nil {
		return nil, err
	}
	if len(output.LogGroups) == 0 {
		return nil, fmt.Errorf("no log groups found")
	}
	return &output.LogGroups[0], nil
}

// GetMetricAlarm returns the details of the specified alarm.
func GetMetricAlarm(t testing.TestingT, awsRegion string, alarmName string) *types.MetricAlarm {
	out, err := GetMetricAlarmE(t, awsRegion, alarmName)
	require.NoError(t, err)
	return out
}

// GetMetricAlarmE returns the details of the specified composite alarm.
func GetMetricAlarmE(t testing.TestingT, awsRegion string, alarmName string) (*types.MetricAlarm, error) {
	out, err := GetAlarmE(t, awsRegion, alarmName, types.AlarmTypeMetricAlarm)
	if err != nil {
		return nil, err
	}
	if len(out.MetricAlarms) == 0 {
		return nil, fmt.Errorf("no metric alarms %q found", alarmName)
	}
	alarm := out.MetricAlarms[0]
	return &alarm, nil
}

// GetMetricAlarm returns the details of the specified metric alarm.
func GetCompositeAlarm(t testing.TestingT, awsRegion string, alarmName string) *types.CompositeAlarm {
	out, err := GetCompositeAlarmE(t, awsRegion, alarmName)
	require.NoError(t, err)
	return out
}

// GetMetricAlarmE returns the details of the specified alarm.
func GetCompositeAlarmE(t testing.TestingT, awsRegion string, alarmName string) (*types.CompositeAlarm, error) {
	out, err := GetAlarmE(t, awsRegion, alarmName, types.AlarmTypeCompositeAlarm)
	if err != nil {
		return nil, err
	}
	if len(out.CompositeAlarms) == 0 {
		return nil, fmt.Errorf("no composite alarms %q found", alarmName)
	}
	alarm := out.CompositeAlarms[0]
	return &alarm, nil
}

// GetMetricAlarmE returns the details of the specified alarm.
func GetAlarmE(t testing.TestingT, awsRegion string, alarmName string, alarmType types.AlarmType) (*cloudwatch.DescribeAlarmsOutput, error) {
	client, err := NewCloudWatchClientE(t, awsRegion)
	if err != nil {
		return nil, err
	}

	output, err := client.DescribeAlarms(context.Background(), &cloudwatch.DescribeAlarmsInput{
		AlarmNames: []string{alarmName},
		AlarmTypes: []types.AlarmType{alarmType},
	})

	if err != nil {
		return nil, err
	}
	return output, nil
}

// GetDashboardBody returns the body of the specified dashboard.
func GetDashboardBody(t testing.TestingT, awsRegion string, dashboardName string) *string {
	out, err := GetDashboardBodyE(t, awsRegion, dashboardName)
	require.NoError(t, err)
	return out
}

// GetDashboardBodyE returns the body of the specified dashboard.
func GetDashboardBodyE(t testing.TestingT, awsRegion string, dashboardName string) (*string, error) {
	client, err := NewCloudWatchClientE(t, awsRegion)
	if err != nil {
		return nil, err
	}

	output, err := client.GetDashboard(context.Background(), &cloudwatch.GetDashboardInput{
		DashboardName: aws.String(dashboardName),
	})

	if err != nil {
		return nil, err
	}
	return output.DashboardBody, nil
}

// NewCloudWatchEventsClient creates a new CloudWatch Events client.
func NewCloudWatchClient(t testing.TestingT, region string) *cloudwatch.Client {
	client, err := NewCloudWatchClientE(t, region)
	require.NoError(t, err)
	return client
}

// NewCloudWatchEventsClientE creates a new CloudWatch Logs client.
func NewCloudWatchClientE(t testing.TestingT, region string) (*cloudwatch.Client, error) {
	sess, err := terratestaws.NewAuthenticatedSession(region)
	if err != nil {
		return nil, err
	}
	return cloudwatch.NewFromConfig(*sess), nil
}
