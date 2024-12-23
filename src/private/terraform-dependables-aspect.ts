import {
  TerraformResource,
  IAspect,
  ITerraformDependable,
  TerraformDataSource,
  dependable,
} from "cdktf";
import { IConstruct } from "constructs";

export const SKIP_DEPENDENCY_PROPAGATION = Symbol.for(
  "terraconstructs/lib/skip_dependency_propagation",
);

/**
 * Aspect that maps construct-level dependencies to the CDKTF dependsOn
 * array of terraform datasources and resources.
 *
 * This Aspect propagates dependencies assigned from parent scopes all the way down
 * to each child resource.
 *
 * ref:
 * - https://github.com/hashicorp/terraform-cdk/issues/2727#issuecomment-1473321075
 * - https://github.com/hashicorp/terraform-cdk/issues/785
 * - https://github.com/winglang/wing/issues/3225
 */
export class TerraformDependencyAspect implements IAspect {
  // TODO: Ideally this is handled upstream in CDKTF

  // Cache for resources defined within a construct's subtree
  private resourceCache = new Map<IConstruct, Set<ITerraformDependable>>();

  // Cache for accumulated dependencies of a construct
  private dependencyCache = new Map<IConstruct, Set<ITerraformDependable>>();

  // This method is called on every Construct within the specified scope (resources, data sources, etc.).
  visit(c: IConstruct) {
    // TODO: There seems to be a bug, this is temp fix...
    if (SKIP_DEPENDENCY_PROPAGATION in c) {
      // use Object.prototype.hasOwnProperty.call(c, SKIP_DEPENDENCY_PROPAGATION) instead?
      return;
    }

    // get dependencies from parent or init new set
    let dependencies: Set<ITerraformDependable> | undefined;
    if (c.node.scope) {
      const parentDependencies = this.dependencyCache.get(c.node.scope);
      dependencies = new Set(parentDependencies);
    }
    if (!dependencies) {
      dependencies = new Set<ITerraformDependable>();
    }

    // add all L1 resources of any construct dependencies
    for (const dep of c.node.dependencies) {
      const tfDependables = getTerraformDependables(dep, this.resourceCache);
      for (const tfDependable of tfDependables) {
        dependencies.add(tfDependable);
      }
    }

    // map to dependsOn
    if (dependencies.size > 0 && isL1Resource(c)) {
      if (!c.dependsOn) {
        c.dependsOn = [];
      }
      for (const dep of dependencies) {
        if (dep !== c && !c.dependsOn.includes(dependable(dep))) {
          c.dependsOn.push(dependable(dep));
        }
      }
    }

    // cache dependencies for this construct
    this.dependencyCache.set(c, dependencies);
  }
}

/**
 * Type guard to check if an object is a CDKTF L1 Resource
 * (TerraformResource or TerraformDataSource)
 */
function isL1Resource(x: any): x is TerraformResource | TerraformDataSource {
  return (
    TerraformResource.isTerraformResource(x) ||
    TerraformDataSource.isTerraformDataSource(x)
  );
}

/**
 * Collects all L1 resources defined within a construct's subtree.
 */
function getTerraformDependables(
  c: IConstruct,
  cache: Map<IConstruct, Set<ITerraformDependable>>,
): Set<ITerraformDependable> {
  let resources = cache.get(c);
  if (resources) {
    return resources;
  }
  resources = new Set<ITerraformDependable>();
  if (isL1Resource(c)) {
    resources.add(c);
  }

  // Visit children
  for (const child of c.node.children) {
    const childResources = getTerraformDependables(child, cache);
    for (const res of childResources) {
      resources.add(res);
    }
  }

  cache.set(c, resources);
  return resources;
}
