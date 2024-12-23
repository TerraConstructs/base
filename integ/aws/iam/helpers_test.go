package test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	loggers "github.com/gruntwork-io/terratest/modules/logger"
	"github.com/stretchr/testify/require"
	util "github.com/terraconstructs/base/integ/aws"
)

var terratestLogger = loggers.Default

// Check defines fragments to match a snapshot.
// the snapshot may include `regex::` prefix for matching string fields with regular expressions.
type check struct {
	fieldPath   string // the path to the field in the struct
	unmarshal   bool   // if the the field should be unmarshalled
	shouldMatch string // the name of the snapshot file to compare against
}

// runChecks validates entity fields against snapshot files
// the snapshot files may include `regex::` prefix for matching string fields with regular expressions.
// the entity fields are accessed using the fieldPath.
func runChecks(t *testing.T, snapshotDir string, entity any, checks []check, tmplVars *util.Variables) {
	for _, c := range checks {
		t.Run(c.shouldMatch, func(t *testing.T) {
			t.Parallel()
			snapFullPath := filepath.Join(snapshotDir, c.shouldMatch)
			if _, err := os.Stat(snapFullPath); err != nil {
				t.Fatalf("Expected snapshot file %s to exist", snapFullPath)
			}

			expectedBytes, err := os.ReadFile(snapFullPath)
			require.NoError(t, err)

			if strings.HasSuffix(c.shouldMatch, ".tmpl.json") {
				expectedString, err := tmplVars.Apply(string(expectedBytes))
				require.NoError(t, err)
				expectedBytes = []byte(expectedString)
			}

			var expected interface{}
			err = json.Unmarshal(expectedBytes, &expected)
			require.NoError(t, err)

			val, err := getFieldValue(entity, c.fieldPath)
			require.NoError(t, err)

			var actual interface{}
			if c.unmarshal {
				strVal, ok := val.(string)
				if !ok {
					t.Fatalf("Expected field %s to be a string containing JSON, but got %T", c.fieldPath, val)
				}
				err = json.Unmarshal([]byte(strVal), &actual)
				require.NoError(t, err)
			} else {
				actual = val
			}

			// Try to match actual type
			switch actual.(type) {
			case []string:
				expectedSlice, ok := expected.([]interface{})
				if ok {
					expectedStrings := make([]string, len(expectedSlice))
					for i, v := range expectedSlice {
						expectedStrings[i], ok = v.(string)
						if !ok {
							t.Fatalf("Expected element %d to be a string, but got %T", i, v)
						}
					}
					expected = expectedStrings
				}
			}
			result := cmp.Diff(expected, actual, cmp.Comparer(regexStringComparer))
			require.Empty(t, result, "(-want +got)")
		})
	}
}

// Access a nested field in the struct
func getFieldValue(data interface{}, fieldPath string) (interface{}, error) {
	// TODO: use jmespath instead?
	if fieldPath == "." {
		return data, nil
	}
	fields := strings.Split(fieldPath, ".")
	val := reflect.ValueOf(data)
	for _, field := range fields {
		if val.Kind() == reflect.Ptr {
			val = val.Elem()
		}
		if val.Kind() != reflect.Struct {
			return nil, fmt.Errorf("expected struct but got %s", val.Kind())
		}
		val = val.FieldByName(field)
		if !val.IsValid() {
			return nil, fmt.Errorf("field '%s' not found", field)
		}
	}
	return val.Interface(), nil
}

// regexStringComparer is a custom comparer for strings that allows for regex pattern matching.
//
// Option configures for specific behavior of Equal and Diff.
// In particular, the fundamental Option functions (Ignore, Transformer, and Comparer),
// configure how equality is determined.
//
// ref: https://pkg.go.dev/github.com/google/go-cmp/cmp#example-Option-EqualNaNs
func regexStringComparer(a, b string) bool {
	getPattern := func(s string) (string, bool) {
		if strings.HasPrefix(s, "regex::") {
			return strings.TrimPrefix(s, "regex::"), true
		}
		return s, false
	}

	patternA, isRegexA := getPattern(a)
	patternB, isRegexB := getPattern(b)

	switch {
	case isRegexA && isRegexB:
		return patternA == patternB
	case isRegexA:
		matched, err := regexp.MatchString(patternA, b)
		if err != nil {
			panic(fmt.Sprintf("Invalid regex pattern '%s': %v", patternA, err))
		}
		return matched
	case isRegexB:
		matched, err := regexp.MatchString(patternB, a)
		if err != nil {
			panic(fmt.Sprintf("Invalid regex pattern '%s': %v", patternB, err))
		}
		return matched
	default:
		return a == b
	}
}

// writeSnapshot writes the full entity to a snapshot file
// this is useful in an initial run to capture the created resources in AWS.
func writeSnapshot(t *testing.T, snapshotDir string, entity any, entityName string) {
	fileName := filepath.Join(snapshotDir, "outputs", entityName+".json")
	roleString, err := json.MarshalIndent(entity, "", "  ")
	require.NoError(t, err)
	err = os.MkdirAll(filepath.Dir(fileName), 0755)
	require.NoError(t, err)
	terratestLogger.Logf(t, "Writing snapshot to %s", fileName)
	err = os.WriteFile(fileName, roleString, 0644)
	require.NoError(t, err)
}
