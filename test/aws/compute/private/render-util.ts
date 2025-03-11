import { Testing } from "cdktf";
import { TerraformConstructor } from "cdktf/lib/testing/matchers";
import { AwsStack } from "../../../../src/aws/aws-stack";
import { StateGraph } from "../../../../src/aws/compute/state-graph";
import { IChainable } from "../../../../src/aws/compute/types";

/**
 * Renders a state machine definition
 *
 * @param stack AwsStack for the state machine
 * @param definition state machine definition
 */
export function render(stack: AwsStack, definition: IChainable) {
  return stack.resolve(
    new StateGraph(definition.startState, "Test Graph").toGraphJson(),
  );
}

export function renderGraph(definition: IChainable) {
  const stack = new AwsStack(Testing.app(), `TestStack`, {
    environmentName: "Test",
    gridUUID: "123e4567-e89b-12d3",
    providerConfig: {
      region: "us-east-1",
    },
    gridBackendConfig: {
      address: "http://localhost:3000",
    },
  });
  return render(stack, definition);
}

export interface GetPropertyOptions {
  id: string;
  field: string;
}

/**
 * Deserialize a synthesized stack and return the deserialized value of a property of a resource
 */
export function innerJson(
  synthesized: string,
  constructor: TerraformConstructor,
  opts: GetPropertyOptions,
): any {
  const parsed = JSON.parse(synthesized);
  // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
  if (
    !parsed.resource ||
    !parsed.resource[constructor.tfResourceType] ||
    !parsed.resource[constructor.tfResourceType][opts.id]
  ) {
    throw new Error(
      `Resource of type ${constructor.tfResourceType} with id ${opts.id} not found in the synthesized stack`,
    );
  }
  const actual =
    parsed.resource[constructor.tfResourceType][opts.id][opts.field];
  if (getType(actual) !== "string") {
    throw new Error(
      `Expected ${constructor.tfResourceType}.${opts.field} to be JSON as a string, but got ${getType(actual)}`,
    );
  }

  let innerJsonObject: any;
  try {
    innerJsonObject = JSON.parse(actual);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON string: ${actual}`);
    } else {
      throw err;
    }
  }
  return innerJsonObject;
}

export type Type =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "symbol"
  | "undefined"
  | "object"
  | "function"
  | "array";

export function getType(obj: any): Type {
  return Array.isArray(obj) ? "array" : typeof obj;
}
