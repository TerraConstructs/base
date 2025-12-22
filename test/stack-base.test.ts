import {
  App,
  Testing,
  TerraformResource,
  TerraformElement,
  TerraformVariable,
  TerraformOutput,
  TerraformLocal,
} from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { StackBase } from "../src";
import { Template } from "./assertions";
import { TestResource } from "./test-resource";

const terraformResourceType = "test_resource";

describe("StackBase", () => {
  test("a stack can be serialized into a Terraform template, initially it's empty", () => {
    const stack = new MyStack();
    expect(toTerraform(stack)).toEqual({});
  });

  test("gridUUID cannot exceed 36 characters", () => {
    // GIVEN
    const reallyLongName = "ThisGridUuidIsReallyLongerThan36Characters";

    // THEN
    expect(() => {
      new MyStack(undefined, "MyStack", {
        gridUUID: reallyLongName,
      });
    }).toThrow(
      `GridUUID must be <= 36 characters. GridUUID: '${reallyLongName}'`,
    );
  });

  test("Stack.isStack indicates that a construct is a stack", () => {
    const stack = new MyStack();
    const c = new Construct(stack, "Construct");
    expect(MyStack.isStack(stack)).toBeDefined();
    expect(!MyStack.isStack(c)).toBeDefined();
  });

  test("stack.id is not included in the logical identities of resources within it", () => {
    const stack = new MyStack(undefined, "MyStack");
    new TerraformResource(stack, "MyResource", {
      terraformResourceType,
    });

    expect(toTerraform(stack).resource).toEqual({
      test_resource: {
        MyResource: {},
      },
    });
  });

  test("Stack.getByPath can be used to find any Terraform element (Variable, Local, etc)", () => {
    const stack = new MyStack();

    const p = new TerraformVariable(stack, "MyVariable", { type: "string" });
    const l = new TerraformLocal(stack, "MyLocal", {
      expression: "SomeExpression",
    });
    const o = new TerraformOutput(stack, "MyOutput", { value: "boom" });

    expect(stack.node.findChild(p.node.id)).toEqual(p);
    expect(stack.node.findChild(l.node.id)).toEqual(l);
    expect(stack.node.findChild(o.node.id)).toEqual(o);
  });

  test("Stack ids can have hyphens in them", () => {
    new MyStack(undefined, "Hello-World");
    // Did not throw
  });

  test("cross stack references and dependencies work within child stacks (non-nested)", () => {
    // GIVEN
    const app = new App();
    const parent = new MyStack(app, "Parent");
    const child1 = new MyStack(parent, "Child1");
    const child2 = new MyStack(parent, "Child2");
    const resourceA = new TestResource(child1, "ResourceA", {
      properties: {
        names: ["name1", "name2"],
      },
    });
    const resourceB = new TerraformResource(child1, "ResourceB", {
      terraformResourceType: "rb",
    });
    // WHEN
    new TestResource(child2, "Resource1", {
      dependsOn: [resourceB],
      properties: {
        RefToResource1: resourceA.names,
      },
    });
    // THEN
    const parentTemplate = toTerraform(parent);
    const child1Template = toTerraform(child1);
    const child2Template = toTerraform(child2);
    expect(parentTemplate).toEqual({});
    expect(child1Template).toEqual({
      resource: {
        test_resource: {
          ResourceA: {
            names: ["name1", "name2"],
          },
        },
        rb: {
          ResourceB: {},
        },
      },
    });
    expect(child2Template).toEqual({
      resource: {
        test_resource: {
          Resource1: {
            depends_on: ["rb.ResourceB"],
            RefToResource1: "${test_resource.ResourceA.names}",
          },
        },
      },
    });
  });
  test("stacks can be children of other stacks (substack) and they will be synthesized separately", () => {
    // GIVEN
    const app = new App();
    // WHEN
    const parentStack = new MyStack(app, "parent");
    const childStack = new MyStack(parentStack, "child");
    new TerraformResource(parentStack, "MyParentResource", {
      terraformResourceType: "resource_parent",
    });
    new TerraformResource(childStack, "MyChildResource", {
      terraformResourceType: "resource_child",
    });
    // THEN
    expect(toTerraform(parentStack)?.resource).toEqual({
      resource_parent: { MyParentResource: {} },
    });
    expect(toTerraform(childStack)?.resource).toEqual({
      resource_child: { MyChildResource: {} },
    });
  });

  test("grid uuid is inherited from parent stack if available", () => {
    // WHEN
    const root = new App();
    const parent = new MyStack(root, "Prod");
    const stack = new MyStack(parent, "Stack");
    // THEN
    expect(stack.gridUUID).toEqual("gProdStack2490AAA8");
  });
  test("generated grid uuid will not exceed 36 characters", () => {
    // WHEN
    const root = new App();
    const app = new Construct(root, "ProdLongStack" + "z".repeat(36));
    const stack = new MyStack(app, "TooLongWhenCombinedWithOtherStack");
    // THEN
    expect(stack.gridUUID.length).toEqual(36);
    expect(stack.gridUUID).toEqual("gProdLongStackWithOtherStackB8885317");
  });
  test("stack validation is performed on explicit grid uuid", () => {
    // GIVEN
    const app = new App();
    // THEN
    expect(
      () => new MyStack(app, "boom", { gridUUID: "invalid:stack:name" }),
    ).toThrow(/GridUUID must match the regular expression/);
  });
  test("Stack.of(stack) returns the correct stack", () => {
    const stack = new MyStack();
    expect(MyStack.of(stack)).toBe(stack);
    const parent = new Construct(stack, "Parent");
    const construct = new Construct(parent, "Construct");
    expect(MyStack.of(construct)).toBe(stack);
  });
  test("Stack.of() throws when there is no parent Stack", () => {
    const root = new Construct(undefined as any, "Root");
    const construct = new Construct(root, "Construct");
    expect(() => MyStack.of(construct)).toThrow(
      /No stack could be identified for the construct at path/,
    );
  });
  test("Stack.of() works for substacks", () => {
    // GIVEN
    const app = new App();
    // WHEN
    const parentStack = new MyStack(app, "ParentStack");
    const parentResource = new TerraformResource(
      parentStack,
      "ParentResource",
      { terraformResourceType: "parent_resource" },
    );
    // we will define a substack under the /resource/... just for giggles.
    const childStack = new MyStack(parentResource, "ChildStack");
    const childResource = new TerraformResource(childStack, "ChildResource", {
      terraformResourceType: "child_resource",
    });
    // THEN
    expect(MyStack.of(parentStack)).toBe(parentStack);
    expect(MyStack.of(parentResource)).toBe(parentStack);
    expect(MyStack.of(childStack)).toBe(childStack);
    expect(MyStack.of(childResource)).toBe(childStack);
  });

  describe("TerraformDependencyAspect", () => {
    let app: App;
    let stack: MyStack;

    beforeEach(() => {
      app = Testing.app();
      stack = new MyStack(app, "TestStack", {});
    });

    test("maps Construct dependencies to TerraformResource.dependsOn", () => {
      // GIVEN
      const simpleResource = new TerraformResource(stack, "SimpleResource", {
        terraformResourceType,
      });
      // a construct which is composed of nested resources
      const compositeResource = new CompositeResource(
        stack,
        "CompositeResource",
      );
      // a construct which adds nested resources during prepareStack
      const preSynthResource = new PreSynthResource(stack, "PreSynthResource");
      // a construct with 2 layers of nesting
      const deeplyNestedResource = new DeeplyNestedResource(
        stack,
        "DeeplyNestedResource",
      );

      // Dependables
      const directDependency = new TerraformResource(
        stack,
        "DirectDependency",
        {
          terraformResourceType,
        },
      );
      const compositeDependency = new CompositeResource(
        stack,
        "CompositeDependency",
      );
      const presynthDependency = new PreSynthResource(
        stack,
        "PreSynthDependency",
      );

      // WHEN
      const expectedDependencies = new Array<string>();
      const resources = [
        simpleResource,
        compositeResource,
        preSynthResource,
        deeplyNestedResource,
      ];

      // Directly add dependencies to resources
      addDependencies(resources, directDependency);
      expectedDependencies.push(`${terraformResourceType}.DirectDependency`);

      // Add composite dependencies
      addDependencies(resources, compositeDependency);
      expectedDependencies.push(
        `${terraformResourceType}.CompositeDependency_NestedResource1_B2D8F1D4`,
        `${terraformResourceType}.CompositeDependency_NestedResource2_2E41AE93`,
      );

      // Add pre-synth dependencies
      addDependencies(resources, presynthDependency);
      expectedDependencies.push(
        `${terraformResourceType}.PreSynthDependency_NestedResource1_49A1A305`,
      );

      // THEN
      Template.fromStack(stack).toMatchObject({
        resource: {
          [terraformResourceType]: {
            // direct resource depends on direct as well as nested resources
            // (including those added during prepareStack)
            SimpleResource: {
              depends_on: expectedDependencies,
            },
            // nested resources have the same dependencies through composite parent inheritance
            CompositeResource_NestedResource1_E176FFE6: {
              depends_on: expectedDependencies,
            },
            CompositeResource_NestedResource2_5A4D5ED7: {
              depends_on: expectedDependencies,
            },
            // pre-synth resources have the same dependencies through parent inheritance
            PreSynthResource_NestedResource1_A8EF732B: {
              depends_on: expectedDependencies,
            },
            // deeply nested resources have the same dependencies through parent inheritance
            DeeplyNestedResource_NestedCompositeResource1_NestedResource1_8B6D9004:
              {
                depends_on: expectedDependencies,
              },
            DeeplyNestedResource_NestedCompositeResource1_NestedResource2_42F5D27C:
              {
                depends_on: expectedDependencies,
              },
            DeeplyNestedResource_NestedPreSynthResource1_NestedResource1_8C8BB53A:
              {
                depends_on: expectedDependencies,
              },
          },
        },
      });
    });

    test("does not propagate nested dependency to siblings", () => {
      // GIVEN
      const resourceA = new TerraformResource(stack, "ResourceA", {
        terraformResourceType,
      });

      class CompositeWithNestedDependencyResource extends TerraformElement {
        constructor(scope: Construct, id: string) {
          super(scope, id);
          const nested1 = new TerraformResource(this, "NestedResource1", {
            terraformResourceType,
          });
          // nested Resource 1 should depend on resourceA
          nested1.node.addDependency(resourceA);
          // nested Resource 2 should not depend on resourceA
          new TerraformResource(this, "NestedResource2", {
            terraformResourceType,
          });
        }
      }
      // WHEN
      new CompositeWithNestedDependencyResource(stack, "ResourceB");

      // THEN
      Template.fromStack(stack).toMatchObject({
        resource: {
          test_resource: {
            ResourceB_NestedResource1_0872214E: {
              depends_on: ["test_resource.ResourceA"],
            },
            ResourceB_NestedResource2_477F69A1: expect.not.objectContaining({
              depends_on: expect.anything(),
            }),
          },
        },
      });
    });

    // TODO: Should throw circular dependency error during synth because TF sure will...
    test.skip("throws on circular dependencies", () => {
      // GIVEN
      const resourceA = new TerraformResource(stack, "ResourceA", {
        terraformResourceType,
      });
      const resourceB = new TerraformResource(stack, "ResourceB", {
        terraformResourceType,
      });

      // WHEN
      // Create circular dependency
      resourceA.node.addDependency(resourceB);
      expect(() => {
        resourceB.node.addDependency(resourceA);
      }).toThrow(/circular dependency/);

      // // THEN
      // Template.fromStack(stack, { debug: true }).toMatchObject({
      //   resource: {
      //     [terraformResourceType]: {
      //       ResourceA: {
      //         depends_on: [`${terraformResourceType}.ResourceB`],
      //       },
      //       ResourceB: {
      //         depends_on: [`${terraformResourceType}.ResourceA`],
      //       },
      //     },
      //   },
      // });
    });
  });
});

class MyStack extends StackBase {}
class CompositeResource extends TerraformElement {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new TerraformResource(this, "NestedResource1", {
      terraformResourceType,
    });
    new TerraformResource(this, "NestedResource2", {
      terraformResourceType,
    });
  }
}

// TODO: Ideally we should use IResolvable.resolve and use the IResolveContext.preparing flag
// ref: https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-iam/lib/policy-document.ts#L48
class PreSynthResource extends TerraformElement {
  // additional resource added during prepareStack!
  public toTerraform(): any {
    const id = "NestedResource1";
    if (!this.node.tryFindChild(id)) {
      new TerraformResource(this, id, {
        terraformResourceType,
      });
    }
    return {};
  }
}
class DeeplyNestedResource extends TerraformElement {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new CompositeResource(this, "NestedCompositeResource1");
    new PreSynthResource(this, "NestedPreSynthResource1");
  }
}
// Helper function to add dependencies to multiple resources
function addDependencies(resources: any[], dependency: any) {
  resources.forEach((resource) => resource.node.addDependency(dependency));
}

function removeMetadataRecursively(x: any) {
  for (const key of Object.keys(x ?? {})) {
    if (key === "//") {
      // remove metadata comment
      delete x[key];
    } else if (typeof x[key] === "object") {
      removeMetadataRecursively(x[key]);
    }
  }
}

function toTerraform(stack: StackBase): any {
  const synthesizedTemplate = stack.toTerraform();
  removeMetadataRecursively(synthesizedTemplate);
  return synthesizedTemplate;
}
