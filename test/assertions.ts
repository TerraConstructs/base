import {
  Testing,
  TerraformStack,
  StackAnnotation,
  AnnotationMetadataEntryType,
} from "cdktf";
import { TerraformConstructor } from "cdktf/lib/testing/matchers";
import { MetadataEntry } from "constructs";

export interface SynthOptions {
  /**
   * snapshot full synthesized template
   */
  snapshot?: boolean;
  /**
   * Run all validations on the stack before synth
   */
  runValidations?: boolean;
}

/**
 * Helper class to create Jest Matchers for a TerraformStack
 */
export class Template {
  /**
   * Create Jest Matchers from the parsed synthesized spec
   */
  static fromStack(
    stack: TerraformStack,
    options: SynthOptions = {},
  ): jest.JestMatchers<any> {
    const synthesized = Template.getSynthString(stack, options);
    const parsed = JSON.parse(synthesized);
    return expect(parsed);
  }
  /**
   * Create Jest Matchers for the synthesized JSON string
   *
   * This always runs TerraformStack.prepareStack() as this
   * library heavily depends on it for pre-synth resource
   * generation.
   */
  static synth(
    stack: TerraformStack,
    options: SynthOptions = {},
  ): jest.JestMatchers<any> {
    const synthesized = Template.getSynthString(stack, options);
    return expect(synthesized);
  }

  static expectStacksEqual(stack1: TerraformStack, stack2: TerraformStack) {
    const synth1 = Template.getSynthString(stack1);
    const synth2 = Template.getSynthString(stack2);
    expect(synth1).toEqual(synth2);
  }

  /**
   * Create Jest Matchers for stack resources of a specific type
   *
   * This always runs TerraformStack.prepareStack() as this
   * library heavily depends on it for pre-synth resource
   * generation.
   */
  static resources(
    stack: TerraformStack,
    type: TerraformConstructor,
    options: SynthOptions = {},
  ) {
    const resourceObjects = Template.resourceObjects(stack, type, options);
    return expect(Object.values(resourceObjects));
  }

  /**
   * Create Jest Matchers for stack resources of a specific type
   *
   * This always runs TerraformStack.prepareStack() as this
   * library heavily depends on it for pre-synth resource
   * generation.
   */
  static resourceObjects(
    stack: TerraformStack,
    type: TerraformConstructor,
    options: SynthOptions = {},
  ) {
    const synthesized = Template.getSynthString(stack, options);
    const parsed = JSON.parse(synthesized);
    return parsed.resource ? (parsed.resource[type.tfResourceType] ?? {}) : {};
  }

  /**
   * Create Jest Matchers for stack outputs of a specific type
   *
   * This always runs TerraformStack.prepareStack() as this
   * library heavily depends on it for pre-synth resource
   * generation.
   */
  static dataSources(
    stack: TerraformStack,
    type: TerraformConstructor,
    options: SynthOptions = {},
  ) {
    const synthesized = Template.getSynthString(stack, options);
    const parsed = JSON.parse(synthesized);
    const dataSources = parsed.data
      ? Object.values(parsed.data[type.tfResourceType] ?? {})
      : [];
    return expect(dataSources);
  }

  /**
   * Create Jest Matchers for a specific stack output or
   * throw an error if the output is not found
   *
   * This always runs TerraformStack.prepareStack() as this
   * library heavily depends on it for pre-synth resource
   * generation.
   */
  static expectOutput(
    stack: TerraformStack,
    outputName: string,
    options: SynthOptions = {},
  ) {
    const synthesized = Template.getSynthString(stack, options);
    const parsed = JSON.parse(synthesized);
    expect(parsed.output).toHaveProperty(outputName);
    expect(parsed.output[outputName]).toBeDefined();
    return expect(parsed.output[outputName]);
  }

  private static getSynthString(
    stack: TerraformStack,
    options: SynthOptions = {},
  ): string {
    const { snapshot = false, runValidations = false } = options;
    stack.prepareStack(); // required to add pre-synth resources
    const result = Testing.synth(stack, runValidations);
    if (snapshot) {
      expect(result).toMatchSnapshot();
    }
    return result;
  }
}

export class Annotations {
  public static fromStack(stack: TerraformStack): Annotations {
    // https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/synthesize/synthesizer.ts#L59-L74
    // collect Annotations into Manifest
    const annotations = stack.node
      .findAll()
      .map((node) => ({
        node,
        metadatas: node.node.metadata.filter(isAnnotationMetadata),
      }))
      .map<StackAnnotation[]>(({ node, metadatas }) =>
        metadatas.map((metadata) => ({
          constructPath: node.node.path,
          level: metadata.type as AnnotationMetadataEntryType,
          message: metadata.data,
          stacktrace: metadata.trace,
        })),
      )
      .reduce((list, metadatas) => [...list, ...metadatas], []); // Array.flat()
    return new Annotations(annotations);
  }

  private constructor(private readonly annotations: StackAnnotation[]) {}

  public get warnings(): StackAnnotation[] {
    return this.annotations.filter(isWarningAnnotation);
  }
  public get errors(): StackAnnotation[] {
    return this.annotations.filter(isErrorAnnotation);
  }

  /**
   * check if the stack has a warning for certain context path and message
   */
  public hasWarnings(
    ...expectedWarnings: Array<Partial<StackAnnotationMatcher>>
  ) {
    const warningMatchers = expectedWarnings.map((warning) => {
      const transformed: Partial<StackAnnotationMatcher> = {};
      for (const key in warning) {
        const value = warning[key as keyof StackAnnotationMatcher];
        if (value instanceof RegExp) {
          transformed[key as keyof StackAnnotationMatcher] =
            expect.stringMatching(value);
        } else {
          transformed[key as keyof StackAnnotationMatcher] = value;
        }
      }
      return expect.objectContaining(transformed);
    });
    expect(this.warnings).toEqual(expect.arrayContaining(warningMatchers));
  }

  /**
   * check if the stack has an error for certain context path and message
   */
  public hasErrors(...expectedErrors: Array<Partial<StackAnnotationMatcher>>) {
    const errorMatchers = expectedErrors.map((error) => {
      const transformed: Partial<StackAnnotationMatcher> = {};
      for (const key in error) {
        const value = error[key as keyof StackAnnotationMatcher];
        if (value instanceof RegExp) {
          transformed[key as keyof StackAnnotationMatcher] =
            expect.stringMatching(value);
        } else {
          transformed[key as keyof StackAnnotationMatcher] = value;
        }
      }
      return expect.objectContaining(transformed);
    });
    expect(this.errors).toEqual(expect.arrayContaining(errorMatchers));
  }
}

// https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/synthesize/synthesizer.ts#L164-L173
const annotationMetadataEntryTypes = [
  AnnotationMetadataEntryType.INFO,
  AnnotationMetadataEntryType.WARN,
  AnnotationMetadataEntryType.ERROR,
] as string[];
function isAnnotationMetadata(metadata: MetadataEntry): boolean {
  return annotationMetadataEntryTypes.includes(metadata.type);
}

function isErrorAnnotation(annotation: StackAnnotation): boolean {
  return annotation.level === AnnotationMetadataEntryType.ERROR;
}

function isWarningAnnotation(annotation: StackAnnotation): boolean {
  return annotation.level === AnnotationMetadataEntryType.WARN;
}

export interface StackAnnotationMatcher {
  constructPath: string | RegExp;
  message: string | RegExp;
}
