/**
 * Capacity modes for DynamoDB.
 */
export enum CapacityMode {
  /**
   * Fixed capacity mode.
   * In this mode, you specify the number of read and write capacity units per second.
   */
  FIXED = "FIXED",

  /**
   * Autoscaled capacity mode.
   * In this mode, capacity is dynamically adjusted based on utilization.
   */
  AUTOSCALED = "AUTOSCALED",
}

/**
 * Options used to configure autoscaled capacity for DynamoDB.
 */
export interface AutoscaledCapacityOptions {
  /**
   * The maximum allowable capacity units.
   */
  readonly maxCapacity: number;

  /**
   * The minimum allowable capacity units.
   *
   * @default 1
   */
  readonly minCapacity?: number;

  /**
   * The ratio of consumed capacity units to provisioned capacity units.
   *
   * Note: Target utilization percent cannot be less than 20 and cannot be greater
   * than 90.
   *
   * @default 70
   */
  readonly targetUtilizationPercent?: number;

  /**
   * If you want to switch a table's billing mode from on-demand to provisioned or
   * from provisioned to on-demand, you must specify a value for this property for
   * each autoscaled resource.
   *
   * @default no seed capacity
   */
  readonly seedCapacity?: number;
}

// Interfaces mirroring CfnGlobalTable structures for capacity settings
// These would be consumed by a TerraConstruct GlobalTable or Table construct

export interface TargetTrackingScalingPolicyConfigurationProperty {
  readonly disableScaleIn?: boolean;
  readonly scaleInCooldown?: number;
  readonly scaleOutCooldown?: number;
  readonly targetValue: number;
}

export interface CapacityAutoScalingSettingsProperty {
  readonly maxCapacity: number;
  readonly minCapacity: number;
  readonly seedCapacity?: number;
  readonly targetTrackingScalingPolicyConfiguration: TargetTrackingScalingPolicyConfigurationProperty;
}

export interface ReadProvisionedThroughputSettingsProperty {
  readonly readCapacityAutoScalingSettings?: CapacityAutoScalingSettingsProperty;
  readonly readCapacityUnits?: number;
}

export interface WriteProvisionedThroughputSettingsProperty {
  readonly writeCapacityAutoScalingSettings?: CapacityAutoScalingSettingsProperty;
  // Note: CfnGlobalTable does not allow fixed writeCapacityUnits for the main table's write settings.
  // It must be autoscaled. Individual replicas might have different configurations if managed separately.
}

/**
 * Represents the amount of read and write operations supported by a DynamoDB table.
 */
export abstract class Capacity {
  /**
   * Provisioned throughput capacity is configured with fixed capacity units.
   *
   * Note: You cannot configure write capacity using fixed capacity mode for Global Tables as per CfnGlobalTable behavior.
   *
   * @param iops the number of I/O operations per second.
   */
  public static fixed(iops: number): Capacity {
    return new (class extends Capacity {
      public _renderReadCapacity(): ReadProvisionedThroughputSettingsProperty {
        return {
          readCapacityUnits: iops,
        } satisfies ReadProvisionedThroughputSettingsProperty;
      }

      public _renderWriteCapacity(): WriteProvisionedThroughputSettingsProperty {
        // This aligns with CfnGlobalTable behavior where top-level write capacity is autoscaled.
        // For a standard DynamoDB table, fixed write capacity would be valid.
        // If this Capacity class is intended for standard tables too, this might need adjustment
        // or a different rendering path based on context.
        throw new Error(
          `You cannot configure 'writeCapacity' with ${CapacityMode.FIXED} capacity mode for a Global Table's primary write settings.`,
        );
      }
    })(CapacityMode.FIXED);
  }

  /**
   * Dynamically adjusts provisioned throughput capacity on your behalf in response to actual
   * traffic patterns.
   *
   * @param options options used to configure autoscaled capacity mode.
   */
  public static autoscaled(options: AutoscaledCapacityOptions): Capacity {
    return new (class extends Capacity {
      public constructor(mode: CapacityMode) {
        super(mode);

        if ((options.minCapacity ?? 1) > options.maxCapacity) {
          throw new Error(
            "`minCapacity` must be less than or equal to `maxCapacity`",
          );
        }

        if (
          options.targetUtilizationPercent !== undefined &&
          (options.targetUtilizationPercent < 20 ||
            options.targetUtilizationPercent > 90)
        ) {
          throw new Error(
            "`targetUtilizationPercent` cannot be less than 20 or greater than 90",
          );
        }

        if (options.seedCapacity !== undefined && options.seedCapacity < 1) {
          throw new Error(
            `'seedCapacity' cannot be less than 1 - received ${options.seedCapacity}`,
          );
        }
      }

      public _renderReadCapacity(): ReadProvisionedThroughputSettingsProperty {
        return {
          readCapacityAutoScalingSettings: this.renderAutoscaledCapacity(),
        } satisfies ReadProvisionedThroughputSettingsProperty;
      }

      public _renderWriteCapacity(): WriteProvisionedThroughputSettingsProperty {
        return {
          writeCapacityAutoScalingSettings: this.renderAutoscaledCapacity(),
        } satisfies WriteProvisionedThroughputSettingsProperty;
      }

      private renderAutoscaledCapacity(): CapacityAutoScalingSettingsProperty {
        return {
          minCapacity: options.minCapacity ?? 1,
          maxCapacity: options.maxCapacity,
          seedCapacity: options.seedCapacity,
          targetTrackingScalingPolicyConfiguration: {
            targetValue: options.targetUtilizationPercent ?? 70,
            // disableScaleIn, scaleInCooldown, scaleOutCooldown are not in AutoscaledCapacityOptions
            // but are part of TargetTrackingScalingPolicyConfigurationProperty.
            // They would need to be added to AutoscaledCapacityOptions if control over them is needed.
          },
        };
      }
    })(CapacityMode.AUTOSCALED);
  }

  private constructor(public readonly mode: CapacityMode) {}

  /**
   * @internal
   */
  public abstract _renderReadCapacity(): ReadProvisionedThroughputSettingsProperty;

  /**
   * @internal
   */
  public abstract _renderWriteCapacity(): WriteProvisionedThroughputSettingsProperty;
}
