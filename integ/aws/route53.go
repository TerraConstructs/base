package aws

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	"github.com/stretchr/testify/require"
)

// IsEmulator reports whether the tests run against a custom AWS endpoint such as aws-emulator.
func IsEmulator() bool {
	return os.Getenv("AWS_ENDPOINT_URL") != ""
}

// CreateEmulatorHostedZone creates a public hosted zone and deletes it when the test ends.
//
// Real AWS runs use pre-existing zones. Only call this when IsEmulator is true.
func CreateEmulatorHostedZone(t *testing.T, awsRegion, domainName string) string {
	cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion(awsRegion))
	require.NoError(t, err)
	client := route53.NewFromConfig(cfg)
	out, err := client.CreateHostedZone(context.Background(), &route53.CreateHostedZoneInput{
		Name:            aws.String(domainName),
		CallerReference: aws.String(fmt.Sprintf("%s-%d", domainName, time.Now().UnixNano())),
	})
	require.NoError(t, err)
	zoneID := aws.ToString(out.HostedZone.Id)
	t.Cleanup(func() {
		_, _ = client.DeleteHostedZone(context.Background(), &route53.DeleteHostedZoneInput{Id: aws.String(zoneID)})
	})
	return trimZonePrefix(zoneID)
}

func trimZonePrefix(id string) string {
	const prefix = "/hostedzone/"
	if len(id) > len(prefix) && id[:len(prefix)] == prefix {
		return id[len(prefix):]
	}
	return id
}
