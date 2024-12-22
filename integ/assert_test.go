package integ

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAssert_Success(t *testing.T) {
	Assert(t, testObject, []Assertion{
		{
			Path:           "request.uri",
			Exists:         true,
			ExpectedRegexp: ptr("index.html$"),
		},
		{
			Path:           "status",
			ExpectedRegexp: ptr(`^\d+$`),
		},
		// // lower is not supported by go-jmespath
		// {
		// 	Path:           "request.headers.*[lower(@) == 'host']",
		// 	ExpectedRegexp: strPtr("(?i)www\\.example\\.com"),
		// },
		{
			Path:           "request.querystring.test.value",
			ExpectedRegexp: ptr("true"),
		},
		{
			Path:           "request.headers.accept.multiValue[].value",
			ExpectedRegexp: ptr(`^text/html|application/xhtml+xml$`),
		},
		{
			Path:           "request.headers.accept.multiValue[0].value",
			ExpectedRegexp: ptr(`^text/html$`),
		},
		{
			Path:           "request.headers.accept.multiValue[2].value",
			ExpectedRegexp: ptr(`^1$`),
		},
	})
}

func TestAssert_Failure(t *testing.T) {
	err := AssertE(testObject, []Assertion{
		{
			Path:           "request.uri",
			ExpectedRegexp: ptr("^index.html"),
		},
		{
			Path:           "status",
			ExpectedRegexp: ptr(`^3..$`),
		},
		{
			Path:   "request.querystring.foo",
			Exists: true,
		},
	})
	assert.Error(t, err, "Expected error due to failed assertions")
}

func TestAssert_ShouldExistFalse(t *testing.T) {
	Assert(t, testObject, []Assertion{
		{
			Path:   "request.headers.authorization",
			Exists: false,
		},
	})
}

func TestAssert_NoExpectedRegexp(t *testing.T) {
	Assert(t, testObject, []Assertion{
		{
			Path:   "request.querystring",
			Exists: true,
		},
		{
			Path:   "request.uri",
			Exists: true,
		},
	})
}

func TestAssert_AdvancedJMESPath_ArrayValues(t *testing.T) {
	Assert(t, testObject, []Assertion{
		{
			// Check that 'val1' is among the 'multiValue[*].value'
			Path:           "request.querystring.arg.multiValue[*].value",
			ExpectedRegexp: ptr("^val1$"),
		},
		{
			// Check that 'val2' is also among the 'multiValue[*].value'
			Path:           "request.querystring.arg.multiValue[*].value",
			ExpectedRegexp: ptr("^val2$"),
		},
		{
			// Ensure that there are exactly two values in 'multiValue'
			Path:           "length(request.querystring.arg.multiValue)",
			ExpectedRegexp: ptr("^2$"),
		},
	})
}

func TestAssert_AdvancedJMESPath_Filters(t *testing.T) {
	Assert(t, testObject, []Assertion{
		{
			// Check if any value in 'multiValue' equals 'val2'
			Path:           "request.querystring.arg.multiValue[?value=='val2'] | [0].value",
			ExpectedRegexp: ptr("^val2$"),
		},
		{
			// Verify that no value equals 'val3'
			Path:   "request.querystring.arg.multiValue[?value=='val3']",
			Exists: false,
		},
		{
			// verify that all values are one of 'val1' or 'val2'
			Path:           "request.querystring.arg.multiValue[?value=='val1' || value=='val2'] | length(@)",
			ExpectedRegexp: ptr("^2$"),
		},
		{
			// verify that all array elements are one of 'val1' or 'val2'
			Path:           "array[] | [? !contains(['val1','val2'],@)] | length(@)",
			ExpectedRegexp: ptr("^0$"),
		},
	})
}

func TestAssert_InvalidJMESPath(t *testing.T) {
	err := AssertE(testObject, []Assertion{
		{
			Path:   "query[", // Invalid JMESPath
			Exists: true,
		},
	})
	assert.Error(t, err, "Expected error due to invalid JMESPath")
}

func TestAssert_InvalidRegexp(t *testing.T) {
	invalidRegexp := "(" // Invalid regexp
	err := AssertE(testObject, []Assertion{
		{
			Path:           "name",
			Exists:         true,
			ExpectedRegexp: &invalidRegexp,
		},
	})
	assert.Error(t, err, "Expected error due to invalid regexp")
}

func TestAssert_ValueIsNil(t *testing.T) {
	input := map[string]interface{}{
		"name": nil,
	}
	err := AssertE(input, []Assertion{
		{
			Path:   "name",
			Exists: true,
		},
	})
	assert.Error(t, err, "Expected error due to nil value")
}

// Test data, example Edge Function output...
// NOTE: go-jmespath fails on map[]interface{} unless we use a fork
var testObject = map[string]any{
	"status": 200,
	"request": map[string]any{
		"cookies": map[string]any{
			"id": map[string]any{
				"value": "CookeIdValue",
			},
			"loggedIn": map[string]any{
				"value": false,
			},
		},
		"headers": map[string]any{
			"accept": map[string]any{
				// some sample arrays and string pointers
				"multiValue": []map[string]any{
					{
						"value": ptr("text/html"),
					},
					{
						"value": ptr("application/xhtml+xml"),
					},
					{
						"value": ptr(1),
					},
				},
				"value": "text/html",
			},
			"host": map[string]any{
				"value": "www.example.com",
			},
		},
		"method": "GET",
		"querystring": map[string]any{
			"arg": map[string]any{
				"multiValue": []map[string]any{
					{
						"value": "val1",
					},
					{
						"value": "val2",
					},
				},
				"value": "val1",
			},
			"test": map[string]any{
				"value": true,
			},
		},
		"uri": "/index.html",
	},
	"array": []string{"val1", "val2"},
}

func ptr[T any](v T) *T {
	return &v
}
