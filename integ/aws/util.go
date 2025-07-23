package aws

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"text/template"

	"github.com/google/go-cmp/cmp"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/terraform"
	test_structure "github.com/gruntwork-io/terratest/modules/test-structure"
	tfjson "github.com/hashicorp/terraform-json"
	"github.com/spf13/afero"
	"github.com/stretchr/testify/require"
	"github.com/terraconstructs/go-synth"
	"github.com/terraconstructs/go-synth/executors"
	"github.com/terraconstructs/go-synth/models"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var terratestLogger = loggers.Default

const (
	// path from integ/aws/* to repo root
	repoRoot = "../../../"
	// copy the root as relative Path for bun install
	relPath = "./terraconstructs"
)

var (
	// Directories to skip when copying files to the synth app fs
	defaultCopyOptions = models.CopyOptions{
		SkipDirs: []string{
			"integ", // ignore self - prevent recursive loops
			"src",   // package.json entrypoint is lib/index.js!
			".git",
			".github",
			".vscode",
			".projen",
			"projenrc",
			"node_modules",
			"test-reports",
			"dist",
			"test",
			"coverage",
		},
	}
)

// Synth app relative to the integration namespace
func SynthApp(t *testing.T, testApp, tfWorkingDir string, env map[string]string, additionalAppDirs ...string) {
	zapLogger := ForwardingLogger(t, terratestLogger)
	ctx := context.Background()
	// path from integ/aws/*/apps/*.ts to repo root src
	mainPathToSrc := filepath.Join("..", repoRoot, "src")
	if _, err := os.Stat(filepath.Join(repoRoot, "lib")); err != nil {
		t.Fatal("No lib folder, run pnpm compile before go test")
	}
	mainTsFile := filepath.Join("apps", testApp+".ts")
	mainTsBytes, err := os.ReadFile(mainTsFile)
	if err != nil {
		t.Fatal("Failed to read" + mainTsFile)
	}

	// load dependencies to Synth app
	var synthDependencies map[string]string
	LoadSynthDependencies(t, tfWorkingDir, &synthDependencies)
	if synthDependencies == nil {
		synthDependencies = make(map[string]string)
	}
	synthDependencies["terraconstructs"] = relPath

	thisFs := afero.NewOsFs()
	app := synth.NewApp(executors.NewBunExecutor, zapLogger)
	app.Configure(ctx, models.AppConfig{
		EnvVars: env,
		// copy additionalDirs and terraconstructs to synth App fs
		PreSetupFn: func(e models.Executor) error {
			// if cdktf.json file exists in apps dir, copy it to the synth app fs as well..
			cdktfPath := filepath.Join("apps", "cdktf.json")
			if _, err := os.Stat(cdktfPath); err == nil {
				if err := e.CopyFileFrom(ctx, thisFs, cdktfPath, "cdktf.json"); err != nil {
					return err
				}
			}
			for _, dirName := range additionalAppDirs {
				relDir := filepath.Join("apps", dirName)
				if err := e.CopyFrom(ctx, thisFs, relDir, dirName, defaultCopyOptions); err != nil {
					return err
				}
			}
			return e.CopyFrom(ctx, thisFs, repoRoot, relPath, defaultCopyOptions)
		},
		Dependencies: synthDependencies,
	})
	// replace the path to src with relative package "terraconstructs"
	mainTs := strings.ReplaceAll(string(mainTsBytes), mainPathToSrc, "terraconstructs")
	err = app.Eval(ctx, thisFs, mainTs, "cdktf.out/stacks/"+testApp, tfWorkingDir)
	if err != nil {
		t.Fatal("Failed to synth app", err)
	}
}

// SaveSynthDependencies serializes and saves map of dependencies at test time to the given path.
func SaveSynthDependencies(t *testing.T, testFolder string, dependencies *map[string]string) {
	path := formatSynthDependenciesPath(testFolder)
	test_structure.SaveTestData(t, path, true, dependencies)
}

// LoadSynthDependencies reads a saved map of dependencies at synth time to the given path.
func LoadSynthDependencies(t *testing.T, testFolder string, dependencies *map[string]string) {
	path := formatSynthDependenciesPath(testFolder)
	if !test_structure.IsTestDataPresent(t, path) {
		terratestLogger.Logf(t, "[INFORMATION] No additional synth dependencies found at \"%v\".\n.", path)
		return
	}
	test_structure.LoadTestData(t, path, dependencies)
}

// formatSynthDependenciesPath formats a path to save Synth Dependencies in the given folder.
func formatSynthDependenciesPath(testFolder string) string {
	return test_structure.FormatTestDataPath(testFolder, "app-dependencies.json")
}

func DeployUsingTerraform(t *testing.T, workingDir string, additionalRetryableErrors map[string]string) {
	// Construct the terraform options with default retryable errors to handle the most common retryable errors in
	// terraform testing.
	terraformOptions := terraform.WithDefaultRetryableErrors(t, &terraform.Options{
		TerraformDir:    workingDir,
		TerraformBinary: "tofu",
	})

	for k, v := range additionalRetryableErrors {
		terraformOptions.RetryableTerraformErrors[k] = v
	}

	// Save the Terraform Options struct, so future test stages can use it
	test_structure.SaveTerraformOptions(t, workingDir, terraformOptions)
	terraform.InitAndApply(t, terraformOptions)
}

func UndeployUsingTerraform(t *testing.T, workingDir string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	terraform.Destroy(t, terraformOptions)
}

// ReplaceTerraformResource replaces a Terraform resource in the given working directory by running a terraform apply command
// with the -replace flag. This is useful for triggering a re-deployment of a resource without changing its configuration.
// It fails the test if the resource cannot be found or if the apply command fails.
func ReplaceTerraformResource(t *testing.T, workingDir, resourceType, resourceName string) {
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	// find the resource to replace
	deploymentResource := FindResourceByType(t, workingDir, resourceType, resourceName)
	require.NotEmpty(t, deploymentResource, "Expected to find an API Gateway deployment resource")
	replaceArg := fmt.Sprintf("-replace=%s", deploymentResource)

	// trigger a re-deployment of the API Gateway
	terraform.RunTerraformCommand(t, terraformOptions, terraform.FormatArgs(terraformOptions, "apply", "-input=false", "-auto-approve", replaceArg)...)
}

// FindResourceByType searches for a resource of a specific type in the given output from terraform list command.
// resourceName is optional and can be used to further filter the results.
// It returns the first matching resource or fails the test if no matching resource is found.
func FindResourceByType(t *testing.T, workingDir, resourceType, resourceName string) string {
	terraformOptions := test_structure.LoadTerraformOptions(t, workingDir)
	resources := terraform.RunTerraformCommand(t, terraformOptions, "state", "list")
	if resources == "" {
		require.Fail(t, "No resources found in Terraform state")
		return ""
	}
	for _, line := range strings.Split(resources, "\n") {
		if strings.Contains(line, resourceType) && (resourceName == "" || strings.Contains(line, resourceName)) {
			// Return the resource name if it matches the type and name
			return strings.TrimSpace(line)
		}
	}
	if resourceName != "" {
		require.Fail(t, fmt.Sprintf("Resource of type %s with name %s not found in resources:\n%s", resourceType, resourceName, resources))
	}
	// If no resource name is specified, just return the first matching resource type
	require.Fail(t, fmt.Sprintf("No Resources of type %s in resources:\n%s", resourceType, resources))
	return ""
}

// LoadOutputAttribute loads the attribute of a output key from Terraform outputs and ensures it is not empty.
func LoadOutputAttribute(t *testing.T, terraformOptions *terraform.Options, key, attribute string) string {
	outputs := terraform.OutputMap(t, terraformOptions, key)
	value := outputs[attribute]
	require.NotEmpty(t, value, fmt.Sprintf("Output %s.%s should not be empty", key, attribute))
	return value
}

// URLDecode decodes a URL-encoded string.
func URLDecode(encoded string) (string, error) {
	decoded, err := url.QueryUnescape(encoded)
	if err != nil {
		return "", err
	}
	return decoded, nil
}

type Variables map[string]any

// apply the variables to the test app
func (p *Variables) Apply(contents string) (string, error) {
	tmpl, err := template.New("test").Parse(contents)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	err = tmpl.Execute(&buf, p)
	if err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ForwardingLogger returns a zap logger that forwards all log messages to terratestLogger
func ForwardingLogger(t *testing.T, targetLogger *loggers.Logger) *zap.Logger {
	config := zap.NewProductionConfig()
	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(config.EncoderConfig),
		zapcore.AddSync(zapcore.Lock(os.Stdout)),
		config.Level,
	)

	forwardingCore := &ForwardingCore{
		Core:         core,
		t:            t,
		targetLogger: targetLogger,
	}

	return zap.New(forwardingCore)
}

// a simple Zap Logger which forwards all log messages to terratestLogger
type ForwardingCore struct {
	zapcore.Core
	t            *testing.T
	targetLogger *loggers.Logger
}

func (fc *ForwardingCore) Check(e zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	return ce.AddCore(e, fc)
}

func (fc *ForwardingCore) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	fc.targetLogger.Logf(fc.t, "[%s] %s", entry.Level, entry.Message)
	return nil
}

func PrettyPrintResourceChange(rc *tfjson.ResourceChange) (string, error) {
	return PrettyPrintBeforeAfter(rc.Change.Before, rc.Change.After)
}

func PrettyPrintBeforeAfter(before interface{}, after interface{}) (string, error) {
	// Convert Before and After to JSON strings
	beforeJSON, err := json.MarshalIndent(before, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal Before: %v", err)
	}
	afterJSON, err := json.MarshalIndent(after, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal After: %v", err)
	}
	return cmp.Diff(string(beforeJSON), string(afterJSON)), nil
}
