// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/aws-cdk-lib/core/test/errors.test.ts

import { App } from "cdktf";
import { AwsStack } from "../src/aws";
import {
  Errors,
  UnscopedValidationError,
  ValidationError,
} from "../src/errors";

jest.useFakeTimers().setSystemTime(new Date("2020-01-01"));

describe("ValidationError", () => {
  test("ValidationError is ValidationError and ConstructError", () => {
    const error = new ValidationError("this is an error", new App());

    expect(Errors.isConstructError(error)).toBe(true);
    expect(Errors.isValidationError(error)).toBe(true);
  });

  test("ValidationError data", () => {
    const app = new App();
    const environmentName = "Test";
    const gridUUID = "123e4567-e89b-12d3";
    const providerConfig = { region: "us-east-1" };
    const gridBackendConfig = {
      address: "http://localhost:3000",
    };
    const stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const error = new ValidationError("this is an error", stack);

    expect(error.time).toBe("2020-01-01T00:00:00.000Z");
    expect(error.type).toBe("validation");
    expect(error.level).toBe("error");
    expect(error.constructPath).toBe("MyStack");
    expect(error.message).toBe("this is an error");
    expect(error.stack).toContain("ValidationError: this is an error");
    expect(error.stack).toContain("at path [MyStack]");
  });

  test("UnscopedValidationError is ValidationError and ConstructError", () => {
    const error = new UnscopedValidationError("this is an error");

    expect(Errors.isConstructError(error)).toBe(true);
    expect(Errors.isValidationError(error)).toBe(true);
    expect(error.name).toBe("ValidationError");
    expect(error.stack).toContain("ValidationError: this is an error");
  });
});
