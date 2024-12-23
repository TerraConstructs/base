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
