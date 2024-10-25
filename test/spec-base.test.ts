import { App, Testing, TerraformResource, TerraformElement } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { SpecBase } from "../src";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const terraformResourceType = "test_resource";

describe("SpecBase", () => {
  let app: App;
  let spec: MySpec;

  beforeEach(() => {
    app = Testing.app();
    spec = new MySpec(app, "TestSpec", {
      environmentName,
      gridUUID,
      gridBackendConfig,
    });
  });

  describe("TerraformDependencyAspect", () => {
    test("maps Construct dependencies to TerraformResource.dependsOn", () => {
      // GIVEN
      const simpleResource = new TerraformResource(spec, "SimpleResource", {
        terraformResourceType,
      });
      // a construct which is composed of nested resources
      const compositeResource = new CompositeResource(
        spec,
        "CompositeResource",
      );
      // a construct which adds nested resources during prepareStack
      const preSynthResource = new PreSynthResource(spec, "PreSynthResource");
      // a construct with 2 layers of nesting
      const deeplyNestedResource = new DeeplyNestedResource(
        spec,
        "DeeplyNestedResource",
      );

      // Dependables
      const directDependency = new TerraformResource(spec, "DirectDependency", {
        terraformResourceType,
      });
      const compositeDependency = new CompositeResource(
        spec,
        "CompositeDependency",
      );
      const presynthDependency = new PreSynthResource(
        spec,
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
      spec.prepareStack(); // required to add pre-synth resources
      const synthesized = Testing.synth(spec);
      // expect(synthesized).toMatchSnapshot();
      const template = JSON.parse(synthesized);
      expect(template).toMatchObject({
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
      const resourceA = new TerraformResource(spec, "ResourceA", {
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
      new CompositeWithNestedDependencyResource(spec, "ResourceB");

      // THEN
      const synthesized = Testing.synth(spec);
      // expect(synthesized).toMatchSnapshot();
      const template = JSON.parse(synthesized);
      expect(template).toMatchObject({
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
      const resourceA = new TerraformResource(spec, "ResourceA", {
        terraformResourceType,
      });
      const resourceB = new TerraformResource(spec, "ResourceB", {
        terraformResourceType,
      });

      // WHEN
      // Create circular dependency
      resourceA.node.addDependency(resourceB);
      expect(() => {
        resourceB.node.addDependency(resourceA);
      }).toThrow(/circular dependency/);

      // // THEN
      // spec.prepareStack();
      // const synthesized = Testing.synth(spec);
      // expect(synthesized).toMatchSnapshot();
      // const template = JSON.parse(synthesized);
      // expect(template).toMatchObject({
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

class MySpec extends SpecBase {}
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
