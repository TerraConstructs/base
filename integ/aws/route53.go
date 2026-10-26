package aws

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	"github.com/aws/aws-sdk-go-v2/service/route53/types"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// NewRoute53ClientE returns a Route 53 client. Route 53 is a global service,
// the region only selects the endpoint partition.
func NewRoute53ClientE(t testing.TestingT, region string) (*route53.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return route53.NewFromConfig(cfg), nil
}

// NewRoute53Client returns a Route 53 client or fails the test.
func NewRoute53Client(t testing.TestingT, region string) *route53.Client {
	client, err := NewRoute53ClientE(t, region)
	require.NoError(t, err)
	return client
}

// FqdnWithTrailingDot returns name with exactly one trailing dot, the form
// Route 53 uses for record set names.
func FqdnWithTrailingDot(name string) string {
	return strings.TrimSuffix(name, ".") + "."
}

// GetRoute53RecordSetE returns the record set of the given name and type in
// the hosted zone, or a Route53RecordSetNotFoundError if it does not exist.
func GetRoute53RecordSetE(t testing.TestingT, region, hostedZoneID, recordName string, recordType types.RRType) (*types.ResourceRecordSet, error) {
	logger.Log(t, fmt.Sprintf("Looking up %s record %s in hosted zone %s", recordType, recordName, hostedZoneID))
	client, err := NewRoute53ClientE(t, region)
	if err != nil {
		return nil, err
	}
	name := FqdnWithTrailingDot(recordName)
	out, err := client.ListResourceRecordSets(context.Background(), &route53.ListResourceRecordSetsInput{
		HostedZoneId:    aws.String(hostedZoneID),
		StartRecordName: aws.String(name),
		StartRecordType: recordType,
		MaxItems:        aws.Int32(1),
	})
	if err != nil {
		return nil, err
	}
	for i := range out.ResourceRecordSets {
		rs := out.ResourceRecordSets[i]
		if strings.EqualFold(aws.ToString(rs.Name), name) && rs.Type == recordType {
			return &rs, nil
		}
	}
	return nil, NewRoute53RecordSetNotFoundError(hostedZoneID, name, recordType)
}

// GetRoute53RecordSet returns the record set of the given name and type in
// the hosted zone, failing the test if it cannot be found.
func GetRoute53RecordSet(t testing.TestingT, region, hostedZoneID, recordName string, recordType types.RRType) *types.ResourceRecordSet {
	rs, err := GetRoute53RecordSetE(t, region, hostedZoneID, recordName, recordType)
	require.NoError(t, err)
	return rs
}

// Route53RecordValues returns the values of a record set's resource records.
func Route53RecordValues(rs *types.ResourceRecordSet) []string {
	values := make([]string, 0, len(rs.ResourceRecords))
	for _, rr := range rs.ResourceRecords {
		values = append(values, aws.ToString(rr.Value))
	}
	return values
}
