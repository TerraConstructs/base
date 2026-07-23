// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/placement.ts

import { BuiltInAttributes } from "./ec2/ec2-service";
import { UnscopedValidationError } from "../../../errors";

/**
 * Instance resource used for bin packing
 */
export enum BinPackResource {
  /**
   * Fill up hosts' CPU allocations first
   */
  CPU = "CPU",

  /**
   * Fill up hosts' memory allocations first
   */
  MEMORY = "MEMORY",
}

/**
 * JSON representation of a placement strategy, mirroring the shape of the
 * `aws_ecs_service` `ordered_placement_strategy` block (and the CloudFormation
 * `AWS::ECS::Service.PlacementStrategy` property, which has the same shape).
 */
export interface PlacementStrategyConfig {
  /**
   * The field to apply the placement strategy against.
   *
   * @default - no field
   */
  readonly field?: string;

  /**
   * The type of placement strategy.
   */
  readonly type: string;
}

/**
 * The placement strategies to use for tasks in the service. For more information, see
 * [Amazon ECS Task Placement Strategies](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-placement-strategies.html).
 *
 * Tasks will preferentially be placed on instances that match these rules.
 */
export class PlacementStrategy {
  /**
   * Places tasks evenly across all container instances in the cluster.
   */
  public static spreadAcrossInstances() {
    return new PlacementStrategy([
      { type: "spread", field: BuiltInAttributes.INSTANCE_ID },
    ]);
  }

  /**
   * Places tasks evenly based on the specified value.
   *
   * You can use one of the built-in attributes found on `BuiltInAttributes`
   * or supply your own custom instance attributes. If more than one attribute
   * is supplied, spreading is done in order.
   *
   * @default attributes instanceId
   */
  public static spreadAcross(...fields: string[]) {
    if (fields.length === 0) {
      throw new UnscopedValidationError(
        "spreadAcross: give at least one field to spread by",
      );
    }
    return new PlacementStrategy(
      fields.map((field) => ({ type: "spread", field })),
    );
  }

  /**
   * Places tasks on container instances with the least available amount of CPU capacity.
   *
   * This minimizes the number of instances in use.
   */
  public static packedByCpu() {
    return PlacementStrategy.packedBy(BinPackResource.CPU);
  }

  /**
   * Places tasks on container instances with the least available amount of memory capacity.
   *
   * This minimizes the number of instances in use.
   */
  public static packedByMemory() {
    return PlacementStrategy.packedBy(BinPackResource.MEMORY);
  }

  /**
   * Places tasks on the container instances with the least available capacity of the specified resource.
   */
  public static packedBy(resource: BinPackResource) {
    return new PlacementStrategy([{ type: "binpack", field: resource }]);
  }

  /**
   * Places tasks randomly.
   */
  public static randomly() {
    return new PlacementStrategy([{ type: "random" }]);
  }

  /**
   * Constructs a new instance of the PlacementStrategy class.
   */
  private constructor(private readonly json: PlacementStrategyConfig[]) {}

  /**
   * Return the placement JSON
   */
  public toJson(): PlacementStrategyConfig[] {
    return this.json;
  }
}

/**
 * JSON representation of a placement constraint, mirroring the shape of the
 * `aws_ecs_service` `placement_constraints` block (and the CloudFormation
 * `AWS::ECS::Service.PlacementConstraint` property, which has the same shape).
 */
export interface PlacementConstraintConfig {
  /**
   * A cluster query language expression to apply to the constraint.
   *
   * @default - no expression
   */
  readonly expression?: string;

  /**
   * The type of constraint.
   */
  readonly type: string;
}

/**
 * The placement constraints to use for tasks in the service. For more information, see
 * [Amazon ECS Task Placement Constraints](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-placement-constraints.html).
 *
 * Tasks will only be placed on instances that match these rules.
 */
export class PlacementConstraint {
  /**
   * Use distinctInstance to ensure that each task in a particular group is running on a different container instance.
   */
  public static distinctInstances() {
    return new PlacementConstraint([{ type: "distinctInstance" }]);
  }

  /**
   * Use memberOf to restrict the selection to a group of valid candidates specified by a query expression.
   *
   * Multiple expressions can be specified. For more information, see
   * [Cluster Query Language](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cluster-query-language.html).
   *
   * You can specify multiple expressions in one call. The tasks will only be placed on instances matching all expressions.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cluster-query-language.html
   */
  public static memberOf(...expressions: string[]) {
    return new PlacementConstraint(
      expressions.map((expression) => ({ type: "memberOf", expression })),
    );
  }

  /**
   * Constructs a new instance of the PlacementConstraint class.
   */
  private constructor(private readonly json: PlacementConstraintConfig[]) {}

  /**
   * Return the placement JSON
   */
  public toJson(): PlacementConstraintConfig[] {
    return this.json;
  }
}
