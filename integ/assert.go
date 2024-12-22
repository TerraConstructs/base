package integ

import (
	"fmt"
	"reflect"
	"regexp"
	"testing"

	"github.com/hashicorp/go-multierror"
	"github.com/jmespath/go-jmespath"
)

type Assertion struct {
	Path           string  // JMESPath of the value to assert
	Exists         bool    // Whether the value should exist, `true` if ExpectedRegexp is provided
	ExpectedRegexp *string // Regexp to match the value against
}

// ref https://github.com/aws/aws-cdk/blob/v2.161.1/packages/%40aws-cdk/integ-tests-alpha/lib/assertions/sdk.ts

// Assert asserts the given input against the provided assertions.
// Fails the test if any assertion fails.
func Assert(t *testing.T, input any, assertions []Assertion) {
	if err := AssertE(input, assertions); err != nil {
		t.Errorf("failed assertions: %v", err)
	}
}

// AssertE asserts the given input against the provided assertions and returns an error if any assertion fails.
func AssertE(input any, assertions []Assertion) error {
	var combinedErr error
	for _, a := range assertions {
		if a.Path == "" {
			combinedErr = multierror.Append(combinedErr, fmt.Errorf("path cannot be empty"))
			continue
		}
		p, err := jmespath.Compile(a.Path)
		if err != nil {
			combinedErr = multierror.Append(combinedErr, fmt.Errorf("error compiling JMESPath '%s': '%v'", a.Path, err))
			continue
		}
		value, err := p.Search(input)
		if err != nil || value == nil {
			if !a.Exists && a.ExpectedRegexp == nil {
				// If the path does not exist or is nil and the value should not exist, we consider this a success
				continue
			}
			if err != nil {
				combinedErr = multierror.Append(combinedErr, fmt.Errorf("error searching JMESPath '%s': %v", a.Path, err))
			} else {
				combinedErr = multierror.Append(combinedErr, fmt.Errorf("value at '%s' is nil", a.Path))
			}
			continue
		}
		// debug print JMES expression result
		// fmt.Printf("%q => %#v\n", a.Path, value)
		if a.ExpectedRegexp != nil {
			if err := assertRegexp(value, *a.ExpectedRegexp); err != nil {
				combinedErr = multierror.Append(combinedErr, fmt.Errorf("error asserting value at '%s': %v", a.Path, err))
			}
		}
	}
	return combinedErr
}

func assertRegexp(value any, expectedRegexp string) error {
	re, err := regexp.Compile(expectedRegexp)
	if err != nil {
		return fmt.Errorf("invalid regexp '%s': %v", expectedRegexp, err)
	}

	v := reflect.ValueOf(value)
	if v.Kind() == reflect.Ptr && !v.IsNil() {
		value = v.Elem().Interface()
	}

	switch v := value.(type) {
	case []interface{}:
		for _, elem := range v {
			e := reflect.ValueOf(elem)
			if e.Kind() == reflect.Ptr && !e.IsNil() {
				elem = e.Elem().Interface()
			}
			elemStr := fmt.Sprintf("%v", elem)
			if re.MatchString(elemStr) {
				return nil // Success if any element matches
			}
		}
		return fmt.Errorf("none of the values '%v' match regexp '%s'", v, expectedRegexp)
	default:
		valueStr := fmt.Sprintf("%v", value)
		if !re.MatchString(valueStr) {
			return fmt.Errorf("value '%s' does not match regexp '%s'", valueStr, expectedRegexp)
		}
		return nil
	}
}
