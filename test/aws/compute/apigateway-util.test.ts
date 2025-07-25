// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/test/util.test.ts

import {
  JsonSchema,
  JsonSchemaType,
  JsonSchemaVersion,
} from "../../../src/aws/compute";
import {
  JsonSchemaMapper,
  parseAwsApiCall,
  parseMethodOptionsPath,
} from "../../../src/aws/compute/apigateway-util";

describe("util", () => {
  describe("parseMethodResourcePath", () => {
    test("fails if path does not start with a /", () => {
      expect(() => parseMethodOptionsPath("foo")).toThrow(
        /Method options path must start with/,
      );
      expect(() => parseMethodOptionsPath("/")).toThrow(
        /Method options path must include at least two components/,
      );
      expect(() => parseMethodOptionsPath("/foo")).toThrow(
        /Method options path must include at least two components/,
      );
      expect(() => parseMethodOptionsPath("/foo/")).toThrow(
        /Invalid HTTP method ""/,
      );
    });

    test("fails if a non-supported http method is used", () => {
      expect(() => parseMethodOptionsPath("/foo/bar")).toThrow(
        /Invalid HTTP method "BAR"/,
      );
    });

    // Original creates JSONPath encoded resourcePath
    // modified to confirm with Terraoform requirements (no leading slash, no JSONPath encoding)
    test("extracts resource path and method correctly", () => {
      expect(parseMethodOptionsPath("/foo/GET")).toEqual({
        // resourcePath: "/~1foo",
        resourcePath: "foo",
        httpMethod: "GET",
      });
      expect(parseMethodOptionsPath("/foo/bar/GET")).toEqual({
        // resourcePath: "/~1foo~1bar",
        resourcePath: "foo/bar",
        httpMethod: "GET",
      });
      expect(parseMethodOptionsPath("/foo/*/GET")).toEqual({
        // resourcePath: "/~1foo~1*",
        resourcePath: "foo/*",
        httpMethod: "GET",
      });
      expect(parseMethodOptionsPath("/*/GET")).toEqual({
        // resourcePath: "/*",
        resourcePath: "*",
        httpMethod: "GET",
      });
      expect(parseMethodOptionsPath("/*/*")).toEqual({
        // resourcePath: "/*",
        resourcePath: "*",
        httpMethod: "*",
      });
      expect(parseMethodOptionsPath("//POST")).toEqual({
        // resourcePath: "/",
        resourcePath: "",
        httpMethod: "POST",
      });
    });
  });

  describe("parseAwsApiCall", () => {
    test('fails if "actionParams" is set but "action" is undefined', () => {
      expect(() =>
        parseAwsApiCall(undefined, undefined, { foo: "123" }),
      ).toThrow(/"actionParams" requires that "action" will be set/);
    });

    test('fails since "action" and "path" are mutually exclusive', () => {
      expect(() => parseAwsApiCall("foo", "bar")).toThrow(
        /"path" and "action" are mutually exclusive \(path="foo", action="bar"\)/,
      );
    });

    test('fails if "path" and "action" are both undefined', () => {
      expect(() => parseAwsApiCall()).toThrow(
        /Either "path" or "action" are required/,
      );
    });

    test('"path" mode', () => {
      expect(parseAwsApiCall("my/path")).toEqual({
        apiType: "path",
        apiValue: "my/path",
      });
    });

    test('"action" mode with no parameters', () => {
      expect(parseAwsApiCall(undefined, "MyAction")).toEqual({
        apiType: "action",
        apiValue: "MyAction",
      });
    });

    test('"action" mode with parameters (url-encoded)', () => {
      expect(
        parseAwsApiCall(undefined, "GetObject", {
          Bucket: "MyBucket",
          Key: "MyKey",
        }),
      ).toEqual({
        apiType: "action",
        apiValue: "GetObject&Bucket=MyBucket&Key=MyKey",
      });
    });
  });

  describe("JsonSchemaMapper.toTFJsonSchema", () => {
    test('maps "ref" found under properties', () => {
      const schema: JsonSchema = {
        type: JsonSchemaType.OBJECT,
        properties: {
          collection: {
            type: JsonSchemaType.ARRAY,
            items: {
              ref: "#/some/reference",
            },
            uniqueItems: true,
          },
        },
        required: ["collection"],
      };

      const actual = JsonSchemaMapper.toTFJsonSchema(schema);
      expect(actual).toEqual({
        $schema: "http://json-schema.org/draft-04/schema#",
        type: "object",
        properties: {
          collection: {
            type: "array",
            items: {
              $ref: "#/some/reference",
            },
            uniqueItems: true,
          },
        },
        required: ["collection"],
      });
    });

    test('does not map a "ref" property name', () => {
      const schema: JsonSchema = {
        type: JsonSchemaType.OBJECT,
        properties: {
          ref: {
            type: JsonSchemaType.ARRAY,
            items: {
              ref: "#/some/reference",
            },
            uniqueItems: true,
          },
        },
        required: ["ref"],
      };

      const actual = JsonSchemaMapper.toTFJsonSchema(schema);
      expect(actual).toEqual({
        $schema: "http://json-schema.org/draft-04/schema#",
        type: "object",
        properties: {
          ref: {
            type: "array",
            items: {
              $ref: "#/some/reference",
            },
            uniqueItems: true,
          },
        },
        required: ["ref"],
      });
    });

    test('"default" for enum', () => {
      const schema: JsonSchema = {
        type: JsonSchemaType.STRING,
        enum: ["green", "blue", "red"],
        default: "blue",
      };

      const actual = JsonSchemaMapper.toTFJsonSchema(schema);
      expect(actual).toEqual({
        $schema: "http://json-schema.org/draft-04/schema#",
        type: "string",
        enum: ["green", "blue", "red"],
        default: "blue",
      });
    });

    test('"id" maps to "id" when using DRAFT-04', () => {
      const schema: JsonSchema = {
        schema: JsonSchemaVersion.DRAFT4,
        id: "http://json-schema.org/draft-04/schema#",
      };

      const actual = JsonSchemaMapper.toTFJsonSchema(schema);
      expect(actual).toEqual({
        $schema: "http://json-schema.org/draft-04/schema#",
        id: "http://json-schema.org/draft-04/schema#",
      });
    });
  });
});
