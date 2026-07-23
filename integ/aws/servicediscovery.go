package aws

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/servicediscovery"
	"github.com/aws/aws-sdk-go-v2/service/servicediscovery/types"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/retry"
	"github.com/gruntwork-io/terratest/modules/testing"
	"github.com/stretchr/testify/require"
)

// NewServiceDiscoveryClientE returns a client for AWS Cloud Map (ServiceDiscovery) in the given region.
func NewServiceDiscoveryClientE(t testing.TestingT, region string) (*servicediscovery.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return servicediscovery.NewFromConfig(cfg), nil
}

// NewServiceDiscoveryClient returns a client for AWS Cloud Map (ServiceDiscovery) in the given region or fails the test.
func NewServiceDiscoveryClient(t testing.TestingT, region string) *servicediscovery.Client {
	client, err := NewServiceDiscoveryClientE(t, region)
	require.NoError(t, err)
	return client
}

// GetCloudMapNamespaceE fetches the details of a Cloud Map namespace by ID.
func GetCloudMapNamespaceE(t testing.TestingT, region, namespaceID string) (*types.Namespace, error) {
	logger.Log(t, fmt.Sprintf("Describing Cloud Map namespace %s in %s", namespaceID, region))
	client, err := NewServiceDiscoveryClientE(t, region)
	if err != nil {
		return nil, err
	}
	out, err := client.GetNamespace(context.Background(), &servicediscovery.GetNamespaceInput{
		Id: &namespaceID,
	})
	if err != nil {
		return nil, err
	}
	return out.Namespace, nil
}

// GetCloudMapNamespace fetches the details of a Cloud Map namespace by ID, failing the test on error.
func GetCloudMapNamespace(t testing.TestingT, region, namespaceID string) *types.Namespace {
	ns, err := GetCloudMapNamespaceE(t, region, namespaceID)
	require.NoError(t, err)
	return ns
}

// GetCloudMapServiceE fetches the details of a Cloud Map service by ID.
func GetCloudMapServiceE(t testing.TestingT, region, serviceID string) (*types.Service, error) {
	logger.Log(t, fmt.Sprintf("Describing Cloud Map service %s in %s", serviceID, region))
	client, err := NewServiceDiscoveryClientE(t, region)
	if err != nil {
		return nil, err
	}
	out, err := client.GetService(context.Background(), &servicediscovery.GetServiceInput{
		Id: &serviceID,
	})
	if err != nil {
		return nil, err
	}
	return out.Service, nil
}

// GetCloudMapService fetches the details of a Cloud Map service by ID, failing the test on error.
func GetCloudMapService(t testing.TestingT, region, serviceID string) *types.Service {
	svc, err := GetCloudMapServiceE(t, region, serviceID)
	require.NoError(t, err)
	return svc
}

// GetCloudMapInstanceE fetches the details of a Cloud Map service instance.
func GetCloudMapInstanceE(t testing.TestingT, region, serviceID, instanceID string) (*types.Instance, error) {
	logger.Log(t, fmt.Sprintf("Describing Cloud Map instance %s (service %s) in %s", instanceID, serviceID, region))
	client, err := NewServiceDiscoveryClientE(t, region)
	if err != nil {
		return nil, err
	}
	out, err := client.GetInstance(context.Background(), &servicediscovery.GetInstanceInput{
		ServiceId:  &serviceID,
		InstanceId: &instanceID,
	})
	if err != nil {
		return nil, err
	}
	return out.Instance, nil
}

// GetCloudMapInstance fetches the details of a Cloud Map service instance, failing the test on error.
func GetCloudMapInstance(t testing.TestingT, region, serviceID, instanceID string) *types.Instance {
	instance, err := GetCloudMapInstanceE(t, region, serviceID, instanceID)
	require.NoError(t, err)
	return instance
}

// DiscoverCloudMapInstancesE calls the Cloud Map DiscoverInstances API (the core client-facing
// discovery operation for HTTP namespaces) for the given namespace/service name, including
// instances of any health status.
func DiscoverCloudMapInstancesE(t testing.TestingT, region, namespaceName, serviceName string) ([]types.HttpInstanceSummary, error) {
	logger.Log(t, fmt.Sprintf("Discovering Cloud Map instances for %s/%s in %s", namespaceName, serviceName, region))
	client, err := NewServiceDiscoveryClientE(t, region)
	if err != nil {
		return nil, err
	}
	out, err := client.DiscoverInstances(context.Background(), &servicediscovery.DiscoverInstancesInput{
		NamespaceName: &namespaceName,
		ServiceName:   &serviceName,
		HealthStatus:  types.HealthStatusFilterAll,
	})
	if err != nil {
		return nil, err
	}
	return out.Instances, nil
}

// WaitForCloudMapInstanceDiscoverable polls DiscoverInstances until the given instance ID shows up
// for the namespace/service (discovery propagation is eventually consistent right after
// registration) and returns its attributes.
func WaitForCloudMapInstanceDiscoverable(
	t testing.TestingT,
	region, namespaceName, serviceName, instanceID string,
	maxRetries int,
	sleepBetweenRetries time.Duration,
) map[string]string {
	var attributes map[string]string
	msg, err := retry.DoWithRetryE(
		t,
		fmt.Sprintf("Waiting for instance %s to be discoverable via %s/%s", instanceID, namespaceName, serviceName),
		maxRetries,
		sleepBetweenRetries,
		func() (string, error) {
			instances, err := DiscoverCloudMapInstancesE(t, region, namespaceName, serviceName)
			if err != nil {
				return "", err
			}
			for _, instance := range instances {
				if instance.InstanceId != nil && *instance.InstanceId == instanceID {
					attributes = instance.Attributes
					return fmt.Sprintf("Instance %s is now discoverable", instanceID), nil
				}
			}
			return "", fmt.Errorf("instance %s not yet discoverable via %s/%s", instanceID, namespaceName, serviceName)
		},
	)
	logger.Log(t, msg)
	require.NoError(t, err)
	return attributes
}
