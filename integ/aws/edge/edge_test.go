package test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/servicediscovery/types"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/base/integ"
	util "github.com/terraconstructs/base/integ/aws"
	"github.com/terraconstructs/go-synth/executors"

	// loggers "github.com/gruntwork-io/terratest/modules/logger"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
)

// var terratestLogger = loggers.Default

// Test the multi-zone-acm-pub-cert app
func TestMultiZoneAcmPubCert(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	envVars["DNS_DOMAIN_NAME1"] = "test2.e2e.terraconstructs.dev"
	envVars["DNS_ZONE_ID1"] = "Z08908061QI3ISWIOB5X"
	envVars["DNS_DOMAIN_NAME2"] = "test1.e2e.terraconstructs.dev"
	envVars["DNS_ZONE_ID2"] = "Z08908052RMPRLAUIXH2Z"
	runEdgeIntegrationTest(t, "multi-zone-acm-pub-cert", "us-east-1", envVars, validateMultiZoneAcmPubCert)
}

// Test the url-rewrite-spa app
func TestUrlRewriteSpa(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	runEdgeIntegrationTest(t, "url-rewrite-spa", "us-east-1", envVars, validateURLRewriteFunction)
}

// Secret to sign JWT Tokens for tests
const jwtTestSecret = "terratest-test-secret"

// Test the kvs-jwt-verify app
func TestKvsJwtVerify(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	envVars["SECRET_KEY"] = jwtTestSecret
	runEdgeIntegrationTest(t, "kvs-jwt-verify", "us-east-1", envVars, validateJwtVerifyFunction)
}

// Run the apps/distribution-policies.ts integration test
func TestDistributionPolicies(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	runEdgeIntegrationTest(t, "distribution-policies", "us-east-1", envVars,
		func(t *testing.T, tfWorkingDir string, awsRegion string) {
			// Load the Terraform Options saved by the earlier deploy_terraform stage
			terraformOptions := test_structure.LoadTerraformOptions(t, tfWorkingDir)
			distributionId := util.LoadOutputAttribute(t, terraformOptions, "distribution", "id")
			util.WaitForDistributionDeployed(t, awsRegion, distributionId, 10, 10*time.Second)
		})
}

// Test the apps/service-with-http-namespace.ts app
// ref: https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-servicediscovery/test/integ.service-with-http-namespace.lit.ts
func TestServiceWithHttpNamespace(t *testing.T) {
	envVars := executors.EnvMap(os.Environ())
	runEdgeIntegrationTest(t, "service-with-http-namespace", "us-east-1", envVars, validateServiceWithHttpNamespace)
}

func validateMultiZoneAcmPubCert(t *testing.T, workingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	certificateArn := util.LoadOutputAttribute(t, terraformOptions, "certificate", "arn")
	util.WaitForCertificateIssued(t, certificateArn, awsRegion, 10, 10*time.Second)
}

// validateServiceWithHttpNamespace hand-mirrors every literal from
// apps/service-with-http-namespace.ts: the HttpNamespace name, the two
// Service.createService() calls (description + HTTP health check), and the
// registerNonIpInstance/registerIpInstance custom attributes. It also exercises
// Cloud Map's core client-facing DiscoverInstances API to prove the
// Namespace->Service->Instance discovery flow actually works end-to-end.
func validateServiceWithHttpNamespace(t *testing.T, workingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)

	namespaceId := util.LoadOutputAttribute(t, terraformOptions, "namespace", "httpNamespaceId")
	namespaceName := util.LoadOutputAttribute(t, terraformOptions, "namespace", "httpNamespaceName")
	require.Equal(t, "MyHTTPNamespace", namespaceName)

	namespace := util.GetCloudMapNamespace(t, awsRegion, namespaceId)
	require.Equal(t, "MyHTTPNamespace", aws.ToString(namespace.Name))
	require.Equal(t, types.NamespaceTypeHttp, namespace.Type)

	// --- NonIpService / NonIpInstance ---

	nonIpServiceId := util.LoadOutputAttribute(t, terraformOptions, "non_ip_service", "serviceId")
	nonIpServiceName := util.LoadOutputAttribute(t, terraformOptions, "non_ip_service", "serviceName")

	nonIpService := util.GetCloudMapService(t, awsRegion, nonIpServiceId)
	require.Equal(t, nonIpServiceName, aws.ToString(nonIpService.Name))
	require.Equal(t, "service registering non-ip instances", aws.ToString(nonIpService.Description))
	// HTTP namespaces only support API-based discovery.
	require.Equal(t, types.ServiceTypeHttp, nonIpService.Type)
	require.Nil(t, nonIpService.HealthCheckConfig)

	nonIpInstanceId := util.LoadOutputAttribute(t, terraformOptions, "non_ip_instance", "instanceId")
	nonIpInstance := util.GetCloudMapInstance(t, awsRegion, nonIpServiceId, nonIpInstanceId)
	require.Equal(t, "arn:aws:s3:::amzn-s3-demo-bucket", nonIpInstance.Attributes["arn"])

	// --- IpService / IpInstance ---

	ipServiceId := util.LoadOutputAttribute(t, terraformOptions, "ip_service", "serviceId")
	ipServiceName := util.LoadOutputAttribute(t, terraformOptions, "ip_service", "serviceName")

	ipService := util.GetCloudMapService(t, awsRegion, ipServiceId)
	require.Equal(t, ipServiceName, aws.ToString(ipService.Name))
	require.Equal(t, "service registering ip instances", aws.ToString(ipService.Description))
	require.Equal(t, types.ServiceTypeHttp, ipService.Type)
	require.NotNil(t, ipService.HealthCheckConfig)
	require.Equal(t, types.HealthCheckTypeHttp, ipService.HealthCheckConfig.Type)
	require.Equal(t, "/check", aws.ToString(ipService.HealthCheckConfig.ResourcePath))
	require.EqualValues(t, 1, aws.ToInt32(ipService.HealthCheckConfig.FailureThreshold))

	ipInstanceId := util.LoadOutputAttribute(t, terraformOptions, "ip_instance", "instanceId")
	ipInstanceIpv4 := util.LoadOutputAttribute(t, terraformOptions, "ip_instance", "ipv4")
	ipInstancePort := util.LoadOutputAttribute(t, terraformOptions, "ip_instance", "port")
	require.Equal(t, "54.239.25.192", ipInstanceIpv4)
	require.Equal(t, "80", ipInstancePort)

	ipInstance := util.GetCloudMapInstance(t, awsRegion, ipServiceId, ipInstanceId)
	require.Equal(t, "54.239.25.192", ipInstance.Attributes["AWS_INSTANCE_IPV4"])
	require.Equal(t, "80", ipInstance.Attributes["AWS_INSTANCE_PORT"])

	// --- Exercise the actual discovery flow via the Cloud Map client API ---
	// Health checks against a non-existent IP will never turn healthy, so query
	// with HealthStatus=ALL to confirm both instances are discoverable regardless.

	nonIpDiscoveredAttrs := util.WaitForCloudMapInstanceDiscoverable(
		t, awsRegion, namespaceName, nonIpServiceName, nonIpInstanceId, 10, 10*time.Second)
	require.Equal(t, "arn:aws:s3:::amzn-s3-demo-bucket", nonIpDiscoveredAttrs["arn"])

	ipDiscoveredAttrs := util.WaitForCloudMapInstanceDiscoverable(
		t, awsRegion, namespaceName, ipServiceName, ipInstanceId, 10, 10*time.Second)
	require.Equal(t, "54.239.25.192", ipDiscoveredAttrs["AWS_INSTANCE_IPV4"])
	require.Equal(t, "80", ipDiscoveredAttrs["AWS_INSTANCE_PORT"])
}

// validateURLRewriteFunction with testevents
func validateURLRewriteFunction(t *testing.T, workingDir string, _awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	functionName := util.LoadOutputAttribute(t, terraformOptions, "url_rewrite_function", "name")
	functionStage := "LIVE"
	for name, testEventPath := range map[string]string{
		"file-name-and-extension": "testevents/url-rewrite-spa/file-name-and-extension.json",
		"file-name-no-extension":  "testevents/url-rewrite-spa/file-name-no-extension.json",
		"no-file-name":            "testevents/url-rewrite-spa/no-file-name.json",
	} {
		t.Run(name, func(st *testing.T) {
			st.Parallel()
			testEvent, err := util.ReadCloudFrontEvent(testEventPath)
			require.NoError(st, err)
			require.NotNil(st, testEvent)
			util.TestCloudFrontFunctionWithCustomValidation(st, functionName, functionStage, *testEvent,
				func(r *util.CloudFrontTestFunctionResult) error {
					if r.Output == nil {
						return fmt.Errorf("got nil Output response")
					}
					// terratestLogger.Logf(t, fmt.Sprintf("Output: %v", r.Output))
					switch testEvent.Request.URI {
					case "/":
						return integ.AssertE(r.Output, []integ.Assertion{
							{
								Path:           "request.uri",
								ExpectedRegexp: strPtr("^/index.html$"),
							}})
					case "/blog", "/blog/index.html":
						return integ.AssertE(r.Output, []integ.Assertion{
							{
								Path:           "request.uri",
								ExpectedRegexp: strPtr("^/blog/index.html$"),
							}})
					default:
						return fmt.Errorf("unexpected input testEvent URI: %s", testEvent.Request.URI)
					}
				})
		})
	}
}

// validateJwtVerifyFunction with testevents
func validateJwtVerifyFunction(t *testing.T, workingDir string, _awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	functionName := util.LoadOutputAttribute(t, terraformOptions, "jwt_verify_function", "name")
	// TODO: don't hardcode Edge Function stage?
	functionStage := "LIVE"
	for _, tc := range []jwtTest{
		{"Missing JWT", "", 401, false},
		{"Invalid JWT", "invalid-jwt", 401, false},
		{"Valid JWT", generateValidJWT(t), 200, true}, // TODO: Flaky?
		{"Expired JWT", generateExpiredJWT(t), 401, false},
	} {
		tc := tc // Capture range variable
		t.Run(tc.name, func(st *testing.T) {
			st.Parallel()
			testEvent, err := util.ReadCloudFrontEvent("testevents/kvs-jwt-verify/missing-jwt.json")
			require.NoError(st, err)
			if tc.jwtValue != "" {
				testEvent.Request.Querystring["jwt"] = util.ValueEntry{Value: tc.jwtValue}
			}
			util.TestCloudFrontFunctionWithCustomValidation(st, functionName, functionStage, *testEvent,
				func(r *util.CloudFrontTestFunctionResult) error {
					if r.Output == nil {
						return fmt.Errorf("got nil Output response")
					}
					if tc.expectOriginalRequest {
						if _, ok := r.Output["request"]; !ok {
							// TODO: Fix flaky test?
							return fmt.Errorf("expected request but did not find it in Function Output")
						}
						return nil
					}

					expectedStatusStr := fmt.Sprintf("%d", int(tc.expectedStatus))
					return integ.AssertE(r.Output, []integ.Assertion{
						{
							Path:           "response.statusCode",
							ExpectedRegexp: &expectedStatusStr,
						},
					})
				})
		})
	}
}

type jwtTest struct {
	name                  string
	jwtValue              string
	expectedStatus        float64
	expectOriginalRequest bool
}

func generateValidJWT(t *testing.T) string {
	jwt, err := GenerateJWT(jwtTestSecret, "test-user", "Test User", 1*time.Hour, 0*time.Second)
	require.NoError(t, err)
	return jwt
}

func generateExpiredJWT(t *testing.T) string {
	jwt, err := GenerateJWT(jwtTestSecret, "test-user", "Test User", 0*time.Second, 0*time.Second)
	require.NoError(t, err)
	return jwt
}

func strPtr(s string) *string {
	return &s
}

// run integration test
func runEdgeIntegrationTest(t *testing.T, testApp, awsRegion string, envVars map[string]string, validate func(t *testing.T, tfWorkingDir string, awsRegion string)) {
	t.Parallel()
	tfWorkingDir := filepath.Join("tf", testApp)
	envVars["AWS_REGION"] = awsRegion
	envVars["ENVIRONMENT_NAME"] = "test"
	envVars["STACK_NAME"] = testApp

	defer test_structure.RunTestStage(t, "cleanup_terraform", func() {
		util.UndeployUsingTerraform(t, tfWorkingDir)
	})

	test_structure.RunTestStage(t, "synth_app", func() {
		util.SynthApp(t, testApp, tfWorkingDir, envVars, "handlers")
	})
	test_structure.RunTestStage(t, "deploy_terraform", func() {
		util.DeployUsingTerraform(t, tfWorkingDir, nil)
	})
	test_structure.RunTestStage(t, "validate", func() {
		validate(t, tfWorkingDir, awsRegion)
	})
}
