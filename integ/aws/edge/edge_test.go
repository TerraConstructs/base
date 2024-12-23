package test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func validateMultiZoneAcmPubCert(t *testing.T, workingDir string, awsRegion string) {
	// Load the Terraform Options saved by the earlier deploy_terraform stage
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	certificateArn := util.LoadOutputAttribute(t, terraformOptions, "certificate", "arn")
	util.WaitForCertificateIssued(t, certificateArn, awsRegion, 10, 10*time.Second)
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
