// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling/lib/auto-scaling-group.ts

import { autoscalingGroup, autoscalingNotification } from "@cdktn/provider-aws";
import { Annotations, Aspects, Lazy, Token } from "cdktn";
import { Construct } from "constructs";
import { AutoScalingGroupRequireImdsv2Aspect } from "./aspects";
import { BasicLifecycleHookProps, LifecycleHook } from "./lifecycle-hook";
import { BasicScheduledActionProps, ScheduledAction } from "./scheduled-action";
import { BasicStepScalingPolicyProps, StepScalingPolicy } from "./step-scaling-policy";
import {
  BaseTargetTrackingProps,
  PredefinedMetric,
  TargetTrackingScalingPolicy,
} from "./target-tracking-scaling-policy";
import { TerminationPolicy } from "./termination-policy";
import { WarmPool, WarmPoolOptions } from "./warm-pool";
import { Duration } from "../../../duration";
import { UnscopedValidationError, ValidationError } from "../../../errors";
import { withResolved } from "../../../token";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import { Tags } from "../../aws-tags";
import * as cloudwatch from "../../cloudwatch";
import * as iam from "../../iam";
import * as sns from "../../notify";
import {
  ApplicationTargetGroup,
  IApplicationLoadBalancerTarget,
  IApplicationTargetGroup,
} from "../alb/application-target-group";
import { Connections, IConnectable } from "../connections";
import { InstanceType } from "../instance-types";
import { IKeyPair } from "../key-pair";
import { ILaunchTemplate, LaunchTemplate } from "../launch-template";
import { LoadBalancerTargetProps } from "../lb-shared/base-target-group";
import { TargetType } from "../lb-shared/enums";
import { parseTargetGroupFullName } from "../lb-shared/util";
import { ILoadBalancerTarget, LoadBalancer } from "../load-balancer";
import { IMachineImage, OperatingSystemType } from "../machine-image/common";
import {
  INetworkLoadBalancerTarget,
  INetworkTargetGroup,
} from "../nlb/network-target-group";
import { ISecurityGroup, SecurityGroup } from "../security-group";
import { UserData } from "../user-data";
import { BlockDevice } from "../volume";
import { IVpc, SubnetSelection } from "../vpc";

/**
 * Name tag constant
 */
const NAME_TAG: string = "Name";

/**
 * The monitoring mode for instances launched in an autoscaling group
 */
export enum Monitoring {
  /**
   * Generates metrics every 5 minutes
   */
  BASIC,

  /**
   * Generates metrics every minute
   */
  DETAILED,
}

/**
 * Basic properties of an AutoScalingGroup, except the exact machines to run and where they should run
 *
 * Constructs that want to create AutoScalingGroups can inherit
 * this interface and specialize the essential parts in various ways.
 *
 * Terraform deviation: CloudFormation's `AWS::AutoScaling::AutoScalingGroup` supports a
 * `CreationPolicy`/`UpdatePolicy` attribute pair (surfaced on this construct via the deprecated
 * `updateType`/`rollingUpdateConfiguration`/`resourceSignalCount`/`resourceSignalTimeout`/
 * `replacingUpdateMinSuccessfulInstancesPercent` properties and their `Signals`/`UpdatePolicy`
 * replacements) plus a CloudFormation-Init integration (`init`/`initOptions`). Both are
 * CloudFormation-template concepts with no Terraform resource attribute or provider behavior to
 * back them - `aws_autoscaling_group` has no creation/update-policy or init equivalent - so none
 * of that surface is ported here.
 */
export interface CommonAutoScalingGroupProps {
  /**
   * Minimum number of instances in the fleet
   *
   * @default 1
   */
  readonly minCapacity?: number;

  /**
   * Maximum number of instances in the fleet
   *
   * @default desiredCapacity
   */
  readonly maxCapacity?: number;

  /**
   * Initial amount of instances in the fleet
   *
   * If this is set to a number, every deployment will reset the amount of
   * instances to this number. It is recommended to leave this value blank.
   *
   * @default minCapacity, and leave unchanged during deployment
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-as-group.html#cfn-as-group-desiredcapacity
   */
  readonly desiredCapacity?: number;

  /**
   * Name of SSH keypair to grant access to instances
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * You can either specify `keyPair` or `keyName`, not both.
   *
   * @default - No SSH access will be possible.
   * @deprecated - Use `keyPair` instead
   */
  readonly keyName?: string;

  /**
   * The SSH keypair to grant access to the instance.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified.
   *
   * You can either specify `keyPair` or `keyName`, not both.
   *
   * @default - No SSH access will be possible.
   */
  readonly keyPair?: IKeyPair;

  /**
   * Where to place instances within the VPC
   *
   * @default - All Private subnets.
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * SNS topic to send notifications about fleet changes
   *
   * @default - No fleet change notifications will be sent.
   * @deprecated use `notifications`
   */
  readonly notificationsTopic?: sns.ITopic;

  /**
   * Configure autoscaling group to send notifications about fleet changes to an SNS topic(s)
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-as-group.html#cfn-as-group-notificationconfigurations
   * @default - No fleet change notifications will be sent.
   */
  readonly notifications?: NotificationConfiguration[];

  /**
   * Whether the instances can initiate connections to anywhere by default
   *
   * @default true
   */
  readonly allowAllOutbound?: boolean;

  /**
   * Default scaling cooldown for this AutoScalingGroup
   *
   * @default Duration.minutes(5)
   */
  readonly cooldown?: Duration;

  /**
   * Whether instances in the Auto Scaling Group should have public
   * IP addresses associated with them.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @default - Use subnet setting.
   */
  readonly associatePublicIpAddress?: boolean;

  /**
   * The maximum hourly price (in USD) to be paid for any Spot Instance launched to fulfill the request. Spot Instances are
   * launched when the price you specify exceeds the current Spot market price.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @default none
   */
  readonly spotPrice?: string;

  /**
   * Configuration for health checks
   *
   * @default - HealthCheck.ec2 with no grace period
   * @deprecated Use `healthChecks` instead
   */
  readonly healthCheck?: HealthCheck;

  /**
   * Configuration for EC2 or additional health checks
   *
   * Even when using `HealthChecks.withAdditionalChecks()`, the EC2 type is implicitly included.
   *
   * @default - EC2 type with no grace period
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html
   */
  readonly healthChecks?: HealthChecks;

  /**
   * Specifies how block devices are exposed to the instance. You can specify virtual devices and EBS volumes.
   *
   * Each instance that is launched has an associated root device volume,
   * either an Amazon EBS volume or an instance store volume.
   * You can use block device mappings to specify additional EBS volumes or
   * instance store volumes to attach to an instance when it is launched.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/block-device-mapping-concepts.html
   *
   * @default - Uses the block device mapping of the AMI
   */
  readonly blockDevices?: BlockDevice[];

  /**
   * The maximum amount of time that an instance can be in service. The maximum duration applies
   * to all current and future instances in the group. As an instance approaches its maximum duration,
   * it is terminated and replaced, and cannot be used again.
   *
   * You must specify a value of at least 86,400 seconds (one day). To clear a previously set value,
   * leave this property undefined.
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-max-instance-lifetime.html
   *
   * @default none
   */
  readonly maxInstanceLifetime?: Duration;

  /**
   * Controls whether instances in this group are launched with detailed or basic monitoring.
   *
   * When detailed monitoring is enabled, Amazon CloudWatch generates metrics every minute and your account
   * is charged a fee. When you disable detailed monitoring, CloudWatch generates metrics every 5 minutes.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @see https://docs.aws.amazon.com/autoscaling/latest/userguide/as-instance-monitoring.html#enable-as-instance-metrics
   *
   * @default - Monitoring.DETAILED
   */
  readonly instanceMonitoring?: Monitoring;

  /**
   * Enable monitoring for group metrics, these metrics describe the group rather than any of its instances.
   * To report all group metrics use `GroupMetrics.all()`
   * Group metrics are reported in a granularity of 1 minute at no additional charge.
   * @default - no group metrics will be reported
   *
   */
  readonly groupMetrics?: GroupMetrics[];

  /**
   * Whether newly-launched instances are protected from termination by Amazon
   * EC2 Auto Scaling when scaling in.
   *
   * By default, Auto Scaling can terminate an instance at any time after launch
   * when scaling in an Auto Scaling Group, subject to the group's termination
   * policy. However, you may wish to protect newly-launched instances from
   * being scaled in if they are going to run critical applications that should
   * not be prematurely terminated.
   *
   * This flag must be enabled if the Auto Scaling Group will be associated with
   * an ECS Capacity Provider with managed termination protection.
   *
   * @default false
   */
  readonly newInstancesProtectedFromScaleIn?: boolean;

  /**
   * The name of the Auto Scaling group. This name must be unique per Region per account.
   * @default - Auto generated
   */
  readonly autoScalingGroupName?: string;

  /**
   * A policy or a list of policies that are used to select the instances to
   * terminate. The policies are executed in the order that you list them.
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-instance-termination.html
   *
   * @default - `TerminationPolicy.DEFAULT`
   */
  readonly terminationPolicies?: TerminationPolicy[];

  /**
   * A lambda function Arn that can be used as a custom termination policy to select the instances
   * to terminate. This property must be specified if the TerminationPolicy.CUSTOM_LAMBDA_FUNCTION
   * is used.
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/lambda-custom-termination-policy.html
   *
   * @default - No lambda function Arn will be supplied
   */
  readonly terminationPolicyCustomLambdaFunctionArn?: string;

  /**
   * The amount of time, in seconds, until a newly launched instance can contribute to the Amazon CloudWatch metrics.
   * This delay lets an instance finish initializing before Amazon EC2 Auto Scaling aggregates instance metrics,
   * resulting in more reliable usage data. Set this value equal to the amount of time that it takes for resource
   * consumption to become stable after an instance reaches the InService state.
   *
   * To optimize the performance of scaling policies that scale continuously, such as target tracking and
   * step scaling policies, we strongly recommend that you enable the default instance warmup, even if its value is set to 0 seconds
   *
   * Default instance warmup will not be added if no value is specified
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-default-instance-warmup.html
   *
   * @default None
   */
  readonly defaultInstanceWarmup?: Duration;

  /**
   * Indicates whether Capacity Rebalancing is enabled. When you turn on Capacity Rebalancing, Amazon EC2 Auto Scaling
   * attempts to launch a Spot Instance whenever Amazon EC2 notifies that a Spot Instance is at an elevated risk of
   * interruption. After launching a new instance, it then terminates an old instance.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-as-group.html#cfn-as-group-capacityrebalance
   *
   * @default false
   *
   */
  readonly capacityRebalance?: boolean;

  /**
   * Add SSM session permissions to the instance role
   *
   * Setting this to `true` adds the necessary permissions to connect
   * to the instance using SSM Session Manager. You can do this
   * from the AWS Console.
   *
   * NOTE: Setting this flag to `true` may not be enough by itself.
   * You must also use an AMI that comes with the SSM Agent, or install
   * the SSM Agent yourself. See
   * [Working with SSM Agent](https://docs.aws.amazon.com/systems-manager/latest/userguide/ssm-agent.html)
   * in the SSM Developer Guide.
   *
   * @default false
   */
  readonly ssmSessionPermissions?: boolean;

  /**
   * The strategy for distributing instances across Availability Zones.
   * @default None
   */
  readonly azCapacityDistributionStrategy?: CapacityDistributionStrategy;
}

/**
 * MixedInstancesPolicy allows you to configure a group that diversifies across On-Demand Instances
 * and Spot Instances of multiple instance types. For more information, see Auto Scaling groups with
 * multiple instance types and purchase options in the Amazon EC2 Auto Scaling User Guide:
 *
 * https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-purchase-options.html
 */
export interface MixedInstancesPolicy {
  /**
   * InstancesDistribution to use.
   *
   * @default - The value for each property in it uses a default value.
   */
  readonly instancesDistribution?: InstancesDistribution;

  /**
   * Launch template to use.
   */
  readonly launchTemplate: ILaunchTemplate;

  /**
   * Launch template overrides.
   *
   * The maximum number of instance types that can be associated with an Auto Scaling group is 40.
   *
   * The maximum number of distinct launch templates you can define for an Auto Scaling group is 20.
   *
   * @default - Do not provide any overrides
   */
  readonly launchTemplateOverrides?: LaunchTemplateOverrides[];
}

/**
 * Indicates how to allocate instance types to fulfill On-Demand capacity.
 */
export enum OnDemandAllocationStrategy {
  /**
   * This strategy uses the order of instance types in the LaunchTemplateOverrides to define the launch
   * priority of each instance type. The first instance type in the array is prioritized higher than the
   * last. If all your On-Demand capacity cannot be fulfilled using your highest priority instance, then
   * the Auto Scaling group launches the remaining capacity using the second priority instance type, and
   * so on.
   */
  PRIORITIZED = "prioritized",

  /**
   * This strategy uses the lowest-price instance types in each Availability Zone based on the current
   * On-Demand instance price.
   *
   * To meet your desired capacity, you might receive On-Demand Instances of more than one instance type
   * in each Availability Zone. This depends on how much capacity you request.
   */
  LOWEST_PRICE = "lowest-price",
}

/**
 * Indicates how to allocate instance types to fulfill Spot capacity.
 */
export enum SpotAllocationStrategy {
  /**
   * The Auto Scaling group launches instances using the Spot pools with the lowest price, and evenly
   * allocates your instances across the number of Spot pools that you specify.
   */
  LOWEST_PRICE = "lowest-price",

  /**
   * The Auto Scaling group launches instances using Spot pools that are optimally chosen based on the
   * available Spot capacity.
   *
   * Recommended.
   */
  CAPACITY_OPTIMIZED = "capacity-optimized",

  /**
   * When you use this strategy, you need to set the order of instance types in the list of launch template
   * overrides from highest to lowest priority (from first to last in the list). Amazon EC2 Auto Scaling
   * honors the instance type priorities on a best-effort basis but optimizes for capacity first.
   */
  CAPACITY_OPTIMIZED_PRIORITIZED = "capacity-optimized-prioritized",

  /**
   * The price and capacity optimized allocation strategy looks at both price and
   * capacity to select the Spot Instance pools that are the least likely to be
   * interrupted and have the lowest possible price.
   */
  PRICE_CAPACITY_OPTIMIZED = "price-capacity-optimized",
}

/**
 * InstancesDistribution is a subproperty of MixedInstancesPolicy that describes an instances distribution
 * for an Auto Scaling group. The instances distribution specifies the distribution of On-Demand Instances
 * and Spot Instances, the maximum price to pay for Spot Instances, and how the Auto Scaling group allocates
 * instance types to fulfill On-Demand and Spot capacities.
 *
 * For more information and example configurations, see Auto Scaling groups with multiple instance types
 * and purchase options in the Amazon EC2 Auto Scaling User Guide:
 *
 * https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-purchase-options.html
 */
export interface InstancesDistribution {
  /**
   * Indicates how to allocate instance types to fulfill On-Demand capacity. The only valid value is prioritized,
   * which is also the default value.
   *
   * @default OnDemandAllocationStrategy.PRIORITIZED
   */
  readonly onDemandAllocationStrategy?: OnDemandAllocationStrategy;

  /**
   * The minimum amount of the Auto Scaling group's capacity that must be fulfilled by On-Demand Instances. This
   * base portion is provisioned first as your group scales. Defaults to 0 if not specified. If you specify weights
   * for the instance types in the overrides, set the value of OnDemandBaseCapacity in terms of the number of
   * capacity units, and not the number of instances.
   *
   * @default 0
   */
  readonly onDemandBaseCapacity?: number;

  /**
   * Controls the percentages of On-Demand Instances and Spot Instances for your additional capacity beyond
   * OnDemandBaseCapacity. Expressed as a number (for example, 20 specifies 20% On-Demand Instances, 80% Spot Instances).
   * Defaults to 100 if not specified. If set to 100, only On-Demand Instances are provisioned.
   *
   * @default 100
   */
  readonly onDemandPercentageAboveBaseCapacity?: number;

  /**
   * If the allocation strategy is lowest-price, the Auto Scaling group launches instances using the Spot pools with the
   * lowest price, and evenly allocates your instances across the number of Spot pools that you specify. Defaults to
   * lowest-price if not specified.
   *
   * If the allocation strategy is capacity-optimized (recommended), the Auto Scaling group launches instances using Spot
   * pools that are optimally chosen based on the available Spot capacity. Alternatively, you can use capacity-optimized-prioritized
   * and set the order of instance types in the list of launch template overrides from highest to lowest priority
   * (from first to last in the list). Amazon EC2 Auto Scaling honors the instance type priorities on a best-effort basis but
   * optimizes for capacity first.
   *
   * @default SpotAllocationStrategy.LOWEST_PRICE
   */
  readonly spotAllocationStrategy?: SpotAllocationStrategy;

  /**
   * The number of Spot Instance pools to use to allocate your Spot capacity. The Spot pools are determined from the different instance
   * types in the overrides. Valid only when the Spot allocation strategy is lowest-price. Value must be in the range of 1 to 20.
   * Defaults to 2 if not specified.
   *
   * @default 2
   */
  readonly spotInstancePools?: number;

  /**
   * The maximum price per unit hour that you are willing to pay for a Spot Instance. If you leave the value at its default (empty),
   * Amazon EC2 Auto Scaling uses the On-Demand price as the maximum Spot price. To remove a value that you previously set, include
   * the property but specify an empty string ("") for the value.
   *
   * @default "" - On-Demand price
   */
  readonly spotMaxPrice?: string;
}

/**
 * LaunchTemplateOverrides is a subproperty of LaunchTemplate that describes an override for a launch template.
 */
export interface LaunchTemplateOverrides {
  /**
   * The instance requirements. Amazon EC2 Auto Scaling uses your specified requirements to identify instance types.
   * Then, it uses your On-Demand and Spot allocation strategies to launch instances from these instance types.
   *
   * You can specify up to four separate sets of instance requirements per Auto Scaling group.
   * This is useful for provisioning instances from different Amazon Machine Images (AMIs) in the same Auto Scaling group.
   * To do this, create the AMIs and create a new launch template for each AMI.
   * Then, create a compatible set of instance requirements for each launch template.
   *
   * You must specify one of instanceRequirements or instanceType.
   *
   * Terraform deviation: typed against the `aws_autoscaling_group` provider resource's
   * `instance_requirements` nested block (rather than the CloudFormation
   * `InstanceRequirementsProperty` type) - the shapes are field-for-field equivalent.
   *
   * @default - Do not override instance type
   */
  readonly instanceRequirements?: autoscalingGroup.AutoscalingGroupMixedInstancesPolicyLaunchTemplateOverrideInstanceRequirements;

  /**
   * The instance type, such as m3.xlarge. You must use an instance type that is supported in your requested Region
   * and Availability Zones.
   *
   * You must specify one of instanceRequirements or instanceType.
   *
   * @default - Do not override instance type
   */
  readonly instanceType?: InstanceType;

  /**
   * Provides the launch template to be used when launching the instance type. For example, some instance types might
   * require a launch template with a different AMI. If not provided, Amazon EC2 Auto Scaling uses the launch template
   * that's defined for your mixed instances policy.
   *
   * @default - Do not override launch template
   */
  readonly launchTemplate?: ILaunchTemplate;

  /**
   * The number of capacity units provided by the specified instance type in terms of virtual CPUs, memory, storage,
   * throughput, or other relative performance characteristic. When a Spot or On-Demand Instance is provisioned, the
   * capacity units count toward the desired capacity. Amazon EC2 Auto Scaling provisions instances until the desired
   * capacity is totally fulfilled, even if this results in an overage. Value must be in the range of 1 to 999.
   *
   * For example, If there are 2 units remaining to fulfill capacity, and Amazon EC2 Auto Scaling can only provision
   * an instance with a WeightedCapacity of 5 units, the instance is provisioned, and the desired capacity is exceeded
   * by 3 units.
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-weighting.html
   *
   * @default - Do not provide weight
   */
  readonly weightedCapacity?: number;
}

/**
 * Properties of a Fleet
 */
export interface AutoScalingGroupProps
  extends CommonAutoScalingGroupProps,
    AwsConstructProps {
  /**
   * VPC to launch these instances in.
   */
  readonly vpc: IVpc;

  /**
   * Launch template to use.
   *
   * Launch configuration related settings and MixedInstancesPolicy must not be specified when a
   * launch template is specified.
   *
   * @default - Do not provide any launch template
   */
  readonly launchTemplate?: ILaunchTemplate;

  /**
   * Mixed Instances Policy to use.
   *
   * Launch configuration related settings and Launch Template  must not be specified when a
   * MixedInstancesPolicy is specified.
   *
   * @default - Do not provide any MixedInstancesPolicy
   */
  readonly mixedInstancesPolicy?: MixedInstancesPolicy;

  /**
   * Type of instance to launch
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @default - Do not provide any instance type
   */
  readonly instanceType?: InstanceType;

  /**
   * AMI to launch
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @default - Do not provide any machine image
   */
  readonly machineImage?: IMachineImage;

  /**
   * Security group to launch the instances in.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @default - A SecurityGroup will be created if none is specified.
   */
  readonly securityGroup?: ISecurityGroup;

  /**
   * Specific UserData to use
   *
   * The UserData may still be mutated after creation.
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @default - A UserData object appropriate for the MachineImage's
   * Operating System is created.
   */
  readonly userData?: UserData;

  /**
   * An IAM role to associate with the instance profile assigned to this Auto Scaling Group.
   *
   * The role must be assumable by the service principal `ec2.amazonaws.com`:
   *
   * `launchTemplate` and `mixedInstancesPolicy` must not be specified when this property is specified
   *
   * @example
   *
   *    const role = new iam.Role(this, 'MyRole', {
   *      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
   *    });
   *
   * @default A role will automatically be created, it can be accessed via the `role` property
   */
  readonly role?: iam.IRole;

  /**
   * Whether IMDSv2 should be required on launched instances.
   *
   * @default false
   */
  readonly requireImdsv2?: boolean;

  /**
   * Specifies the upper threshold as a percentage of the desired capacity of the Auto Scaling group.
   * It represents the maximum percentage of the group that can be in service and healthy, or pending,
   * to support your workload when replacing instances.
   *
   * Value range is 0 to 100. Both or neither of `minHealthyPercentage` and `maxHealthyPercentage` must
   * be specified, and the difference between them cannot be greater than 100. A large range increases
   * the number of instances that can be replaced at the same time.
   *
   * Terraform deviation: CloudFormation lets you set both values to `-1` to clear a previously set
   * instance maintenance policy. Terraform has no equivalent notion of "clearing" a value that was
   * set on a prior deployment - the `instance_maintenance_policy` block is simply omitted when both
   * values are `-1`.
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-instance-maintenance-policy.html
   *
   * @default - No instance maintenance policy.
   */
  readonly maxHealthyPercentage?: number;

  /**
   * Specifies the lower threshold as a percentage of the desired capacity of the Auto Scaling group.
   * It represents the minimum percentage of the group to keep in service, healthy, and ready to use
   * to support your workload when replacing instances.
   *
   * Value range is 0 to 100. Both or neither of `minHealthyPercentage` and `maxHealthyPercentage` must
   * be specified, and the difference between them cannot be greater than 100. A large range increases
   * the number of instances that can be replaced at the same time.
   *
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-instance-maintenance-policy.html
   *
   * @default - No instance maintenance policy.
   */
  readonly minHealthyPercentage?: number;
}

/**
 * A set of group metrics
 */
export class GroupMetrics {
  /**
   * Report all group metrics.
   */
  public static all(): GroupMetrics {
    return new GroupMetrics();
  }

  /**
   * @internal
   */
  public _metrics = new Set<GroupMetric>();

  constructor(...metrics: GroupMetric[]) {
    metrics?.forEach((metric) => this._metrics.add(metric));
  }
}

/**
 * Group metrics that an Auto Scaling group sends to Amazon CloudWatch.
 */
export class GroupMetric {
  /**
   * The minimum size of the Auto Scaling group
   */
  public static readonly MIN_SIZE = new GroupMetric("GroupMinSize");

  /**
   * The maximum size of the Auto Scaling group
   */
  public static readonly MAX_SIZE = new GroupMetric("GroupMaxSize");

  /**
   * The number of instances that the Auto Scaling group attempts to maintain
   */
  public static readonly DESIRED_CAPACITY = new GroupMetric(
    "GroupDesiredCapacity",
  );

  /**
   * The number of instances that are running as part of the Auto Scaling group
   * This metric does not include instances that are pending or terminating
   */
  public static readonly IN_SERVICE_INSTANCES = new GroupMetric(
    "GroupInServiceInstances",
  );

  /**
   * The number of instances that are pending
   * A pending instance is not yet in service, this metric does not include instances that are in service or terminating
   */
  public static readonly PENDING_INSTANCES = new GroupMetric(
    "GroupPendingInstances",
  );

  /**
   * The number of instances that are in a Standby state
   * Instances in this state are still running but are not actively in service
   */
  public static readonly STANDBY_INSTANCES = new GroupMetric(
    "GroupStandbyInstances",
  );

  /**
   * The number of instances that are in the process of terminating
   * This metric does not include instances that are in service or pending
   */
  public static readonly TERMINATING_INSTANCES = new GroupMetric(
    "GroupTerminatingInstances",
  );

  /**
   * The total number of instances in the Auto Scaling group
   * This metric identifies the number of instances that are in service, pending, and terminating
   */
  public static readonly TOTAL_INSTANCES = new GroupMetric(
    "GroupTotalInstances",
  );

  /**
   * The name of the group metric
   */
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

/**
 * Every group metric name Auto Scaling supports, used to expand `GroupMetrics.all()` into
 * Terraform's flat `enabled_metrics` list.
 *
 * Terraform deviation: CloudFormation's `MetricsCollection.Metrics` treats an omitted/empty
 * list as "report every group metric" - `aws_autoscaling_group`'s `enabled_metrics` has no such
 * sentinel, so `GroupMetrics.all()` must be expanded to this explicit, exhaustive list.
 */
const ALL_GROUP_METRIC_NAMES: string[] = [
  GroupMetric.MIN_SIZE.name,
  GroupMetric.MAX_SIZE.name,
  GroupMetric.DESIRED_CAPACITY.name,
  GroupMetric.IN_SERVICE_INSTANCES.name,
  GroupMetric.PENDING_INSTANCES.name,
  GroupMetric.STANDBY_INSTANCES.name,
  GroupMetric.TERMINATING_INSTANCES.name,
  GroupMetric.TOTAL_INSTANCES.name,
];

/**
 * The strategies for when launches fail in an Availability Zone.
 */
export enum CapacityDistributionStrategy {
  /**
   * If launches fail in an Availability Zone, Auto Scaling will continue to attempt to launch in the unhealthy zone to preserve a balanced distribution.
   */
  BALANCED_ONLY = "balanced-only",
  /**
   * If launches fail in an Availability Zone, Auto Scaling will attempt to launch in another healthy Availability Zone instead.
   */
  BALANCED_BEST_EFFORT = "balanced-best-effort",
}

abstract class AutoScalingGroupBase
  extends AwsConstructBase
  implements IAutoScalingGroup
{
  public abstract autoScalingGroupName: string;
  public abstract autoScalingGroupArn: string;
  public abstract readonly osType: OperatingSystemType;
  protected albTargetGroup?: ApplicationTargetGroup;
  public readonly grantPrincipal: iam.IPrincipal = new iam.UnknownPrincipal({
    resource: this,
  });
  protected hasCalledScaleOnRequestCount: boolean = false;

  /**
   * Send a message to either an SQS queue or SNS topic when instances launch or terminate
   */
  public addLifecycleHook(
    id: string,
    props: BasicLifecycleHookProps,
  ): LifecycleHook {
    return new LifecycleHook(this, `LifecycleHook${id}`, {
      autoScalingGroup: this,
      ...props,
    });
  }

  /**
   * Add a pool of pre-initialized EC2 instances that sits alongside an Auto Scaling group
   */
  public addWarmPool(options?: WarmPoolOptions): WarmPool {
    return new WarmPool(this, "WarmPool", {
      autoScalingGroup: this,
      ...options,
    });
  }

  /**
   * Scale out or in based on time
   */
  public scaleOnSchedule(
    id: string,
    props: BasicScheduledActionProps,
  ): ScheduledAction {
    return new ScheduledAction(this, `ScheduledAction${id}`, {
      autoScalingGroup: this,
      ...props,
    });
  }

  /**
   * Scale out or in to achieve a target CPU utilization
   */
  public scaleOnCpuUtilization(
    id: string,
    props: CpuUtilizationScalingProps,
  ): TargetTrackingScalingPolicy {
    return new TargetTrackingScalingPolicy(this, `ScalingPolicy${id}`, {
      autoScalingGroup: this,
      predefinedMetric: PredefinedMetric.ASG_AVERAGE_CPU_UTILIZATION,
      targetValue: props.targetUtilizationPercent,
      ...props,
    });
  }

  /**
   * Scale out or in to achieve a target network ingress rate
   */
  public scaleOnIncomingBytes(
    id: string,
    props: NetworkUtilizationScalingProps,
  ): TargetTrackingScalingPolicy {
    return new TargetTrackingScalingPolicy(this, `ScalingPolicy${id}`, {
      autoScalingGroup: this,
      predefinedMetric: PredefinedMetric.ASG_AVERAGE_NETWORK_IN,
      targetValue: props.targetBytesPerSecond,
      ...props,
    });
  }

  /**
   * Scale out or in to achieve a target network egress rate
   */
  public scaleOnOutgoingBytes(
    id: string,
    props: NetworkUtilizationScalingProps,
  ): TargetTrackingScalingPolicy {
    return new TargetTrackingScalingPolicy(this, `ScalingPolicy${id}`, {
      autoScalingGroup: this,
      predefinedMetric: PredefinedMetric.ASG_AVERAGE_NETWORK_OUT,
      targetValue: props.targetBytesPerSecond,
      ...props,
    });
  }

  /**
   * Scale out or in to achieve a target request handling rate
   *
   * The AutoScalingGroup must have been attached to an Application Load Balancer
   * in order to be able to call this.
   */
  public scaleOnRequestCount(
    id: string,
    props: RequestCountScalingProps,
  ): TargetTrackingScalingPolicy {
    if (this.albTargetGroup === undefined) {
      throw new ValidationError(
        "Attach the AutoScalingGroup to a non-imported Application Load Balancer before calling scaleOnRequestCount()",
        this,
      );
    }

    const resourceLabel = `${this.albTargetGroup.firstLoadBalancerFullName}/${parseTargetGroupFullName(this.albTargetGroup.targetGroupArn)}`;

    if (
      (props.targetRequestsPerMinute === undefined) ===
      (props.targetRequestsPerSecond === undefined)
    ) {
      throw new ValidationError(
        "Specify exactly one of 'targetRequestsPerMinute' or 'targetRequestsPerSecond'",
        this,
      );
    }

    let rpm: number;
    if (props.targetRequestsPerSecond !== undefined) {
      if (Token.isUnresolved(props.targetRequestsPerSecond)) {
        throw new ValidationError(
          "'targetRequestsPerSecond' cannot be an unresolved value; use 'targetRequestsPerMinute' instead.",
          this,
        );
      }
      rpm = props.targetRequestsPerSecond * 60;
    } else {
      rpm = props.targetRequestsPerMinute!;
    }

    const policy = new TargetTrackingScalingPolicy(this, `ScalingPolicy${id}`, {
      autoScalingGroup: this,
      predefinedMetric: PredefinedMetric.ALB_REQUEST_COUNT_PER_TARGET,
      targetValue: rpm,
      resourceLabel,
      ...props,
    });

    policy.node.addDependency(this.albTargetGroup.loadBalancerAttached);
    this.hasCalledScaleOnRequestCount = true;
    return policy;
  }

  /**
   * Scale out or in in order to keep a metric around a target value
   */
  public scaleToTrackMetric(
    id: string,
    props: MetricTargetTrackingProps,
  ): TargetTrackingScalingPolicy {
    return new TargetTrackingScalingPolicy(this, `ScalingPolicy${id}`, {
      autoScalingGroup: this,
      customMetric: props.metric,
      ...props,
    });
  }

  /**
   * Scale out or in, in response to a metric
   */
  public scaleOnMetric(
    id: string,
    props: BasicStepScalingPolicyProps,
  ): StepScalingPolicy {
    return new StepScalingPolicy(this, id, { ...props, autoScalingGroup: this });
  }

  public addUserData(..._commands: string[]): void {
    // do nothing
  }
}

/**
 * A Fleet represents a managed set of EC2 instances
 *
 * The Fleet models a number of AutoScalingGroups, a launch template, a
 * security group and an instance role.
 *
 * It allows adding arbitrary commands to the startup scripts of the instances
 * in the fleet.
 *
 * The ASG spans the availability zones specified by vpcSubnets, falling back to
 * the Vpc default strategy if not specified.
 */
export class AutoScalingGroup
  extends AutoScalingGroupBase
  implements
    ILoadBalancerTarget,
    IConnectable,
    IApplicationLoadBalancerTarget,
    INetworkLoadBalancerTarget
{
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.autoscaling.AutoScalingGroup";

  public static fromAutoScalingGroupName(
    scope: Construct,
    id: string,
    autoScalingGroupName: string,
  ): IAutoScalingGroup {
    class Import extends AutoScalingGroupBase {
      public autoScalingGroupName = autoScalingGroupName;
      public autoScalingGroupArn = this.stack.formatArn({
        service: "autoscaling",
        resource: "autoScalingGroup:*:autoScalingGroupName",
        resourceName: this.autoScalingGroupName,
      });
      public readonly osType = OperatingSystemType.UNKNOWN;

      public get outputs(): Record<string, any> {
        return {
          autoScalingGroupName: this.autoScalingGroupName,
          autoScalingGroupArn: this.autoScalingGroupArn,
        };
      }
    }

    return new Import(scope, id);
  }

  /**
   * The type of OS instances of this fleet are running.
   */
  public readonly osType: OperatingSystemType;

  /**
   * The principal to grant permissions to
   */
  public readonly grantPrincipal: iam.IPrincipal;

  /**
   * Name of the AutoScalingGroup
   */
  public readonly autoScalingGroupName: string;

  /**
   * Arn of the AutoScalingGroup
   */
  public readonly autoScalingGroupArn: string;

  /**
   * The maximum spot price configured for the autoscaling group. `undefined`
   * indicates that this group uses on-demand capacity.
   */
  public readonly spotPrice?: string;

  /**
   * The maximum amount of time that an instance can be in service.
   */
  public readonly maxInstanceLifetime?: Duration;

  /**
   * The underlying `aws_autoscaling_group` resource (maps `CfnAutoScalingGroup`).
   */
  public readonly resource: autoscalingGroup.AutoscalingGroup;

  private readonly securityGroup?: ISecurityGroup;
  private readonly loadBalancerNames: string[] = [];
  private readonly targetGroupArns: string[] = [];
  private readonly groupMetrics: GroupMetrics[] = [];
  private readonly notifications: NotificationConfiguration[] = [];
  private readonly launchTemplate?: LaunchTemplate;
  private readonly _connections?: Connections;
  private readonly _userData?: UserData;
  private readonly _role?: iam.IRole;

  protected newInstancesProtectedFromScaleIn?: boolean;

  public get outputs(): Record<string, any> {
    return {
      autoScalingGroupName: this.autoScalingGroupName,
      autoScalingGroupArn: this.autoScalingGroupArn,
    };
  }

  constructor(scope: Construct, id: string, props: AutoScalingGroupProps) {
    super(scope, id, props);

    this.newInstancesProtectedFromScaleIn = props.newInstancesProtectedFromScaleIn;

    if (props.groupMetrics) {
      this.groupMetrics.push(...props.groupMetrics);
    }

    let launchTemplateFromConfig: LaunchTemplate | undefined = undefined;
    if (props.launchTemplate || props.mixedInstancesPolicy) {
      this.verifyNoLaunchConfigPropIsGiven(props);

      const bareLaunchTemplate = props.launchTemplate;
      const mixedInstancesPolicy = props.mixedInstancesPolicy;

      if (bareLaunchTemplate && mixedInstancesPolicy) {
        throw new ValidationError(
          "Setting 'mixedInstancesPolicy' must not be set when 'launchTemplate' is set",
          this,
        );
      }

      if (bareLaunchTemplate && bareLaunchTemplate instanceof LaunchTemplate) {
        if (!bareLaunchTemplate.instanceType) {
          throw new ValidationError(
            "Setting 'launchTemplate' requires its 'instanceType' to be set",
            this,
          );
        }

        if (!bareLaunchTemplate.imageId) {
          throw new ValidationError(
            "Setting 'launchTemplate' requires its 'machineImage' to be set",
            this,
          );
        }

        this.launchTemplate = bareLaunchTemplate;
      }

      if (
        mixedInstancesPolicy &&
        mixedInstancesPolicy.launchTemplate instanceof LaunchTemplate
      ) {
        if (!mixedInstancesPolicy.launchTemplate.imageId) {
          throw new ValidationError(
            "Setting 'mixedInstancesPolicy.launchTemplate' requires its 'machineImage' to be set",
            this,
          );
        }

        this.launchTemplate = mixedInstancesPolicy.launchTemplate;
      }

      this._role = this.launchTemplate?.role;
      this.grantPrincipal =
        this._role || new iam.UnknownPrincipal({ resource: this });

      this.osType = this.launchTemplate?.osType ?? OperatingSystemType.UNKNOWN;
    } else {
      if (!props.machineImage) {
        throw new ValidationError(
          "Setting 'machineImage' is required when 'launchTemplate' and 'mixedInstancesPolicy' is not set",
          this,
        );
      }
      if (!props.instanceType) {
        throw new ValidationError(
          "Setting 'instanceType' is required when 'launchTemplate' and 'mixedInstancesPolicy' is not set",
          this,
        );
      }

      if (props.keyName && props.keyPair) {
        throw new ValidationError(
          "Cannot specify both of 'keyName' and 'keyPair'; prefer 'keyPair'",
          this,
        );
      }

      Tags.of(this).add(NAME_TAG, this.node.path);

      this.securityGroup =
        props.securityGroup ||
        new SecurityGroup(this, "InstanceSecurityGroup", {
          vpc: props.vpc,
          allowAllOutbound: props.allowAllOutbound !== false,
        });

      this._role =
        props.role ||
        new iam.Role(this, "InstanceRole", {
          assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
        });
      this.grantPrincipal = this._role;

      // Terraform deviation: `aws_autoscaling_group` only supports `launch_template`/
      // `mixed_instances_policy` - there is no `launch_configuration`-shaped inline block
      // the way CloudFormation's `LaunchConfigurationName` is (that path maps to the
      // separate, deprecated `aws_launch_configuration` resource). A `LaunchTemplate` is
      // therefore always synthesized here from these launch-configuration-style props
      // (this mirrors the CDK `AUTOSCALING_GENERATE_LAUNCH_TEMPLATE` feature-flag behavior,
      // which is unconditionally the default in this port). Passing `role` (rather than
      // pre-building an instance profile) lets `LaunchTemplate` create the IAM instance
      // profile for us.
      launchTemplateFromConfig = new LaunchTemplate(this, "LaunchTemplate", {
        machineImage: props.machineImage,
        instanceType: props.instanceType,
        detailedMonitoring:
          props.instanceMonitoring !== undefined &&
          props.instanceMonitoring === Monitoring.DETAILED,
        securityGroup: this.securityGroup,
        userData: props.userData,
        associatePublicIpAddress: props.associatePublicIpAddress,
        spotOptions:
          props.spotPrice !== undefined
            ? { maxPrice: parseFloat(props.spotPrice) }
            : undefined,
        blockDevices: props.blockDevices,
        role: this._role,
        keyPair: props.keyPair,
        ...(props.keyName ? { keyName: props.keyName } : {}),
      });

      this.osType = launchTemplateFromConfig.osType!;
      this.launchTemplate = launchTemplateFromConfig;
    }

    if (props.ssmSessionPermissions && this._role) {
      this._role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          this,
          "AmazonSSMManagedInstanceCore",
          "AmazonSSMManagedInstanceCore",
        ),
      );
    }

    // desiredCapacity just reflects what the user has supplied.
    const desiredCapacity = props.desiredCapacity;
    const minCapacity = props.minCapacity ?? 1;
    const maxCapacity =
      props.maxCapacity ??
      desiredCapacity ??
      (Token.isUnresolved(minCapacity) ? minCapacity : Math.max(minCapacity, 1));

    withResolved(minCapacity, maxCapacity, (min, max) => {
      if (min > max) {
        throw new ValidationError(
          `minCapacity (${min}) should be <= maxCapacity (${max})`,
          this,
        );
      }
    });
    withResolved(desiredCapacity, minCapacity, (desired, min) => {
      if (desired === undefined) {
        return;
      }
      if (desired < min) {
        throw new ValidationError(
          `Should have minCapacity (${min}) <= desiredCapacity (${desired})`,
          this,
        );
      }
    });
    withResolved(desiredCapacity, maxCapacity, (desired, max) => {
      if (desired === undefined) {
        return;
      }
      if (max < desired) {
        throw new ValidationError(
          `Should have desiredCapacity (${desired}) <= maxCapacity (${max})`,
          this,
        );
      }
    });

    if (desiredCapacity !== undefined) {
      Annotations.of(this).addWarning(
        "desiredCapacity has been configured. Be aware this will reset the size of your AutoScalingGroup on every deployment. See https://github.com/aws/aws-cdk/issues/5215",
      );
    }

    this.maxInstanceLifetime = props.maxInstanceLifetime;
    // See https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-max-instance-lifetime.html for details on max instance lifetime.
    if (
      this.maxInstanceLifetime &&
      !this.maxInstanceLifetime.isUnresolved() &&
      this.maxInstanceLifetime.toSeconds() !== 0 &&
      (this.maxInstanceLifetime.toSeconds() < 86400 ||
        this.maxInstanceLifetime.toSeconds() > 31536000)
    ) {
      throw new ValidationError(
        "maxInstanceLifetime must be between 1 and 365 days (inclusive)",
        this,
      );
    }

    if (props.notificationsTopic && props.notifications) {
      throw new ValidationError(
        "Cannot set 'notificationsTopic' and 'notifications', 'notificationsTopic' is deprecated use 'notifications' instead",
        this,
      );
    }

    if (props.notificationsTopic) {
      this.notifications = [
        {
          topic: props.notificationsTopic,
        },
      ];
    }

    if (props.notifications) {
      this.notifications = props.notifications.map((nc) => ({
        topic: nc.topic,
        scalingEvents: nc.scalingEvents ?? ScalingEvents.ALL,
      }));
    }

    const { subnetIds, hasPublic } = props.vpc.selectSubnets(props.vpcSubnets);

    const terminationPolicies: string[] = [];
    if (props.terminationPolicies) {
      props.terminationPolicies.forEach((terminationPolicy, index) => {
        if (terminationPolicy === TerminationPolicy.CUSTOM_LAMBDA_FUNCTION) {
          if (index !== 0) {
            throw new ValidationError(
              "TerminationPolicy.CUSTOM_LAMBDA_FUNCTION must be specified first in the termination policies",
              this,
            );
          }

          if (!props.terminationPolicyCustomLambdaFunctionArn) {
            throw new ValidationError(
              "terminationPolicyCustomLambdaFunctionArn property must be specified if the TerminationPolicy.CUSTOM_LAMBDA_FUNCTION is used",
              this,
            );
          }

          terminationPolicies.push(props.terminationPolicyCustomLambdaFunctionArn);
        } else {
          terminationPolicies.push(terminationPolicy);
        }
      });
    }

    const { healthCheckType, healthCheckGracePeriod } = this.renderHealthChecks(
      props.healthChecks,
      props.healthCheck,
    );

    if (!hasPublic && props.associatePublicIpAddress) {
      throw new ValidationError(
        "To set 'associatePublicIpAddress: true' you must select Public subnets (vpcSubnets: { subnetType: SubnetType.PUBLIC })",
        this,
      );
    }

    // gridUUID physical naming (HARD REPO INVARIANT): AutoScalingGroupName -> name/name_prefix.
    const namePrefix = this.stack.uniqueResourceNamePrefix(this, {
      prefix: props.autoScalingGroupName ?? this.gridUUID + "-",
      allowedSpecialCharacters: "_-",
      maxLength: 255,
    });

    const { metricsGranularity, enabledMetrics } = this.renderGroupMetrics();

    this.resource = new autoscalingGroup.AutoscalingGroup(this, "Resource", {
      namePrefix,
      availabilityZoneDistribution: props.azCapacityDistributionStrategy
        ? { capacityDistributionStrategy: props.azCapacityDistributionStrategy }
        : undefined,
      defaultCooldown: props.cooldown?.toSeconds(),
      minSize: minCapacity,
      maxSize: maxCapacity,
      desiredCapacity,
      loadBalancers: Lazy.listValue(
        { produce: () => this.loadBalancerNames },
        { omitEmpty: true },
      ),
      targetGroupArns: Lazy.listValue(
        { produce: () => this.targetGroupArns },
        { omitEmpty: true },
      ),
      metricsGranularity,
      enabledMetrics,
      vpcZoneIdentifier: subnetIds,
      healthCheckType,
      healthCheckGracePeriod,
      maxInstanceLifetime: this.maxInstanceLifetime
        ? this.maxInstanceLifetime.toSeconds()
        : undefined,
      protectFromScaleIn: Lazy.anyValue({
        produce: () => this.newInstancesProtectedFromScaleIn,
      }),
      terminationPolicies:
        terminationPolicies.length === 0 ? undefined : terminationPolicies,
      defaultInstanceWarmup: props.defaultInstanceWarmup?.toSeconds(),
      capacityRebalance: props.capacityRebalance,
      instanceMaintenancePolicy: this.renderInstanceMaintenancePolicy(
        props.minHealthyPercentage,
        props.maxHealthyPercentage,
      ),
      ...this.getLaunchSettings(
        props.launchTemplate ?? launchTemplateFromConfig,
        props.mixedInstancesPolicy,
      ),
    });

    this.autoScalingGroupName = this.resource.name;
    // Terraform deviation: `aws_autoscaling_group` exposes `arn` as a real computed
    // attribute, so there's no need to hand-format it the way CloudFormation's
    // `AutoScalingGroupARN` (which has no direct Fn::GetAtt-free equivalent) requires.
    this.autoScalingGroupArn = this.resource.arn;
    this.node.defaultChild = this.resource;

    this.createNotifications();

    this.spotPrice = props.spotPrice;

    if (props.requireImdsv2) {
      Aspects.of(this).add(new AutoScalingGroupRequireImdsv2Aspect());
    }

    this.node.addValidation({ validate: () => this.validateTargetGroup() });
  }

  /**
   * Add the security group to all instances via the launch template
   * security groups array.
   *
   * @param securityGroup: The security group to add
   */
  public addSecurityGroup(securityGroup: ISecurityGroup): void {
    if (!this.launchTemplate) {
      throw new ValidationError(
        "You cannot add security groups when the Auto Scaling Group is created from an imported Launch Template.",
        this,
      );
    }
    this.launchTemplate.addSecurityGroup(securityGroup);
  }

  /**
   * Attach to a classic load balancer
   */
  public attachToClassicLB(loadBalancer: LoadBalancer): void {
    this.loadBalancerNames.push(loadBalancer.loadBalancerName);
  }

  /**
   * Attach to ELBv2 Application Target Group
   */
  public attachToApplicationTargetGroup(
    targetGroup: IApplicationTargetGroup,
  ): LoadBalancerTargetProps {
    this.targetGroupArns.push(targetGroup.targetGroupArn);
    if (targetGroup instanceof ApplicationTargetGroup) {
      // Copy onto self if it's a concrete type. We need this for autoscaling
      // based on request count, which we cannot do with an imported TargetGroup.
      this.albTargetGroup = targetGroup;
    }

    targetGroup.registerConnectable(this);
    return { targetType: TargetType.INSTANCE };
  }

  /**
   * Attach to ELBv2 Network Target Group
   */
  public attachToNetworkTargetGroup(
    targetGroup: INetworkTargetGroup,
  ): LoadBalancerTargetProps {
    this.targetGroupArns.push(targetGroup.targetGroupArn);
    return { targetType: TargetType.INSTANCE };
  }

  public addUserData(...commands: string[]): void {
    this.userData.addCommands(...commands);
  }

  /**
   * Adds a statement to the IAM role assumed by instances of this fleet.
   */
  public addToRolePolicy(statement: iam.PolicyStatement) {
    this.role.addToPrincipalPolicy(statement);
  }

  /**
   * Ensures newly-launched instances are protected from scale-in.
   */
  public protectNewInstancesFromScaleIn() {
    this.newInstancesProtectedFromScaleIn = true;
  }

  /**
   * Returns `true` if newly-launched instances are protected from scale-in.
   */
  public areNewInstancesProtectedFromScaleIn(): boolean {
    return this.newInstancesProtectedFromScaleIn === true;
  }

  /**
   * The network connections associated with this resource.
   */
  public get connections(): Connections {
    if (this._connections) {
      return this._connections;
    }

    if (this.launchTemplate) {
      return this.launchTemplate.connections;
    }

    throw new ValidationError(
      "AutoScalingGroup can only be used as IConnectable if it is not created from an imported Launch Template.",
      this,
    );
  }

  /**
   * The Base64-encoded user data to make available to the launched EC2 instances.
   *
   * @throws an error if a launch template is given and it does not provide a non-null `userData`
   */
  public get userData(): UserData {
    if (this._userData) {
      return this._userData;
    }

    if (this.launchTemplate?.userData) {
      return this.launchTemplate.userData;
    }

    throw new ValidationError(
      "The provided launch template does not expose its user data.",
      this,
    );
  }

  /**
   * The IAM Role in the instance profile
   *
   * @throws an error if a launch template is given
   */
  public get role(): iam.IRole {
    if (this._role) {
      return this._role;
    }

    throw new ValidationError(
      "The provided launch template does not expose or does not define its role.",
      this,
    );
  }

  private verifyNoLaunchConfigPropIsGiven(props: AutoScalingGroupProps) {
    if (props.machineImage) {
      throw new ValidationError(
        "Setting 'machineImage' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.instanceType) {
      throw new ValidationError(
        "Setting 'instanceType' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.role) {
      throw new ValidationError(
        "Setting 'role' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.userData) {
      throw new ValidationError(
        "Setting 'userData' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.securityGroup) {
      throw new ValidationError(
        "Setting 'securityGroup' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.keyName) {
      throw new ValidationError(
        "Setting 'keyName' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.keyPair) {
      throw new ValidationError(
        "Setting 'keyPair' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.instanceMonitoring) {
      throw new ValidationError(
        "Setting 'instanceMonitoring' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.associatePublicIpAddress !== undefined) {
      throw new ValidationError(
        "Setting 'associatePublicIpAddress' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.spotPrice) {
      throw new ValidationError(
        "Setting 'spotPrice' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.blockDevices) {
      throw new ValidationError(
        "Setting 'blockDevices' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
    if (props.requireImdsv2) {
      throw new ValidationError(
        "Setting 'requireImdsv2' must not be set when 'launchTemplate' or 'mixedInstancesPolicy' is set",
        this,
      );
    }
  }

  /**
   * Create the standalone `aws_autoscaling_notification` resources for `notifications`.
   *
   * Terraform deviation: `aws_autoscaling_group` has no inline notification-configuration
   * block (unlike CloudFormation's `NotificationConfigurations`), so every configured
   * `{topic, scalingEvents}` entry is lifted out into its own standalone
   * `aws_autoscaling_notification` resource. If multiple entries share the same topic, the
   * Auto Scaling `PutNotificationConfiguration` API they both target is itself keyed by
   * topic - whichever resource Terraform applies last wins, exactly as if the same
   * CloudFormation `NotificationConfigurations` entries had been declared twice.
   */
  private createNotifications(): void {
    this.notifications.forEach((notification, index) => {
      new autoscalingNotification.AutoscalingNotification(
        this,
        `Notification${index}`,
        {
          groupNames: [this.resource.name],
          notifications: (notification.scalingEvents ?? ScalingEvents.ALL)
            ._types,
          topicArn: notification.topic.topicArn,
        },
      );
    });
  }

  /**
   * Render `metrics_granularity`/`enabled_metrics` from the configured `groupMetrics`.
   *
   * Terraform deviation: CloudFormation's `MetricsCollection` is an array of
   * `{Granularity, Metrics[]}` entries; `aws_autoscaling_group` only supports a single
   * granularity value shared by all enabled metrics, so multiple `GroupMetrics` entries are
   * collapsed into one `enabled_metrics` list (their granularity is always `1Minute` either
   * way).
   */
  private renderGroupMetrics(): Pick<
    autoscalingGroup.AutoscalingGroupConfig,
    "metricsGranularity" | "enabledMetrics"
  > {
    if (this.groupMetrics.length === 0) {
      return {};
    }

    const enabled = new Set<string>();
    for (const group of this.groupMetrics) {
      const names =
        group._metrics.size !== 0
          ? [...group._metrics].map((m) => m.name)
          : ALL_GROUP_METRIC_NAMES;
      names.forEach((n) => enabled.add(n));
    }

    return {
      metricsGranularity: "1Minute",
      enabledMetrics: [...enabled],
    };
  }

  private getLaunchSettings(
    launchTemplate?: ILaunchTemplate,
    mixedInstancesPolicy?: MixedInstancesPolicy,
  ):
    | Pick<autoscalingGroup.AutoscalingGroupConfig, "launchTemplate">
    | Pick<autoscalingGroup.AutoscalingGroupConfig, "mixedInstancesPolicy"> {
    if (launchTemplate) {
      return {
        launchTemplate: this.convertILaunchTemplateToSpecification(launchTemplate),
      };
    }

    if (mixedInstancesPolicy) {
      let instancesDistribution:
        | autoscalingGroup.AutoscalingGroupMixedInstancesPolicyInstancesDistribution
        | undefined = undefined;
      if (mixedInstancesPolicy.instancesDistribution) {
        const dist = mixedInstancesPolicy.instancesDistribution;
        instancesDistribution = {
          onDemandAllocationStrategy: dist.onDemandAllocationStrategy?.toString(),
          onDemandBaseCapacity: dist.onDemandBaseCapacity,
          onDemandPercentageAboveBaseCapacity:
            dist.onDemandPercentageAboveBaseCapacity,
          spotAllocationStrategy: dist.spotAllocationStrategy?.toString(),
          spotInstancePools: dist.spotInstancePools,
          spotMaxPrice: dist.spotMaxPrice,
        };
      }
      return {
        mixedInstancesPolicy: {
          instancesDistribution,
          launchTemplate: {
            launchTemplateSpecification:
              this.convertILaunchTemplateToMixedInstancesSpecification(
                mixedInstancesPolicy.launchTemplate,
              ),
            ...(mixedInstancesPolicy.launchTemplateOverrides
              ? {
                  override: mixedInstancesPolicy.launchTemplateOverrides.map(
                    (override) => {
                      if (
                        override.weightedCapacity &&
                        Math.floor(override.weightedCapacity) !==
                          override.weightedCapacity
                      ) {
                        throw new ValidationError(
                          "Weight must be an integer",
                          this,
                        );
                      }
                      if (
                        !override.instanceType &&
                        !override.instanceRequirements
                      ) {
                        throw new ValidationError(
                          "You must specify either 'instanceRequirements' or 'instanceType'.",
                          this,
                        );
                      }
                      if (
                        override.instanceType &&
                        override.instanceRequirements
                      ) {
                        throw new ValidationError(
                          "You can specify either 'instanceRequirements' or 'instanceType', not both.",
                          this,
                        );
                      }
                      return {
                        instanceType: override.instanceType?.toString(),
                        launchTemplateSpecification: override.launchTemplate
                          ? this.convertILaunchTemplateToMixedInstancesSpecification(
                              override.launchTemplate,
                            )
                          : undefined,
                        instanceRequirements: override.instanceRequirements,
                        weightedCapacity: override.weightedCapacity?.toString(),
                      };
                    },
                  ),
                }
              : {}),
          },
        },
      };
    }

    throw new ValidationError(
      "Either launchTemplate or mixedInstancesPolicy needs to be specified.",
      this,
    );
  }

  private convertILaunchTemplateToSpecification(
    launchTemplate: ILaunchTemplate,
  ): autoscalingGroup.AutoscalingGroupLaunchTemplate {
    if (launchTemplate.launchTemplateId) {
      return {
        id: launchTemplate.launchTemplateId,
        version: launchTemplate.versionNumber,
      };
    } else {
      return {
        name: launchTemplate.launchTemplateName,
        version: launchTemplate.versionNumber,
      };
    }
  }

  /**
   * Same as `convertILaunchTemplateToSpecification`, but for the nested launch template
   * specification blocks under `mixed_instances_policy` (`launch_template.
   * launch_template_specification` and `launch_template.override[].
   * launch_template_specification`), which use `launch_template_id`/`launch_template_name`
   * rather than the top-level block's `id`/`name`.
   */
  private convertILaunchTemplateToMixedInstancesSpecification(
    launchTemplate: ILaunchTemplate,
  ): autoscalingGroup.AutoscalingGroupMixedInstancesPolicyLaunchTemplateLaunchTemplateSpecification {
    if (launchTemplate.launchTemplateId) {
      return {
        launchTemplateId: launchTemplate.launchTemplateId,
        version: launchTemplate.versionNumber,
      };
    } else {
      return {
        launchTemplateName: launchTemplate.launchTemplateName,
        version: launchTemplate.versionNumber,
      };
    }
  }

  private validateTargetGroup(): string[] {
    const errors = new Array<string>();
    if (this.hasCalledScaleOnRequestCount && this.targetGroupArns.length > 1) {
      errors.push(
        "Cannon use multiple target groups if `scaleOnRequestCount()` is being used.",
      );
    }

    return errors;
  }

  private renderInstanceMaintenancePolicy(
    minHealthyPercentage?: number,
    maxHealthyPercentage?: number,
  ): autoscalingGroup.AutoscalingGroupInstanceMaintenancePolicy | undefined {
    if (minHealthyPercentage === undefined && maxHealthyPercentage === undefined)
      return undefined;
    if (minHealthyPercentage === undefined || maxHealthyPercentage === undefined) {
      throw new ValidationError(
        `Both or neither of minHealthyPercentage and maxHealthyPercentage must be specified, got minHealthyPercentage: ${minHealthyPercentage} and maxHealthyPercentage: ${maxHealthyPercentage}`,
        this,
      );
    }
    if (
      (minHealthyPercentage === -1 || maxHealthyPercentage === -1) &&
      minHealthyPercentage !== maxHealthyPercentage
    ) {
      throw new ValidationError(
        `Both minHealthyPercentage and maxHealthyPercentage must be -1 to clear the previously set value, got minHealthyPercentage: ${minHealthyPercentage} and maxHealthyPercentage: ${maxHealthyPercentage}`,
        this,
      );
    }
    if (minHealthyPercentage === -1 && maxHealthyPercentage === -1) {
      // Terraform deviation: there is no persisted state to "clear" the way there is in
      // CloudFormation - simply omit the instance_maintenance_policy block.
      return undefined;
    }
    if (
      minHealthyPercentage !== -1 &&
      (minHealthyPercentage < 0 || minHealthyPercentage > 100)
    ) {
      throw new ValidationError(
        `minHealthyPercentage must be between 0 and 100, or -1 to clear the previously set value, got ${minHealthyPercentage}`,
        this,
      );
    }
    if (
      maxHealthyPercentage !== -1 &&
      (maxHealthyPercentage < 100 || maxHealthyPercentage > 200)
    ) {
      throw new ValidationError(
        `maxHealthyPercentage must be between 100 and 200, or -1 to clear the previously set value, got ${maxHealthyPercentage}`,
        this,
      );
    }
    if (maxHealthyPercentage - minHealthyPercentage > 100) {
      throw new ValidationError(
        `The difference between minHealthyPercentage and maxHealthyPercentage cannot be greater than 100, got ${maxHealthyPercentage - minHealthyPercentage}`,
        this,
      );
    }
    return {
      minHealthyPercentage,
      maxHealthyPercentage,
    };
  }

  private renderHealthChecks(
    healthChecks?: HealthChecks,
    healthCheck?: HealthCheck,
  ): { healthCheckType?: string; healthCheckGracePeriod?: number } {
    if (healthCheck && healthChecks) {
      throw new ValidationError(
        "Cannot specify both 'healthCheck' and 'healthChecks'. Please use 'healthChecks' only.",
        this,
      );
    }

    let healthCheckType: string | undefined;
    let healthCheckGracePeriod: number | undefined;

    if (healthChecks) {
      healthCheckType = healthChecks.types.join(",");
      healthCheckGracePeriod = healthChecks.gracePeriod?.toSeconds();
    } else if (healthCheck) {
      healthCheckType = healthCheck.type;
      healthCheckGracePeriod = healthCheck.gracePeriod?.toSeconds();
    }

    return { healthCheckType, healthCheckGracePeriod };
  }
}

/**
 * AutoScalingGroup fleet change notifications configurations.
 * You can configure AutoScaling to send an SNS notification whenever your Auto Scaling group scales.
 */
export interface NotificationConfiguration {
  /**
   * SNS topic to send notifications about fleet scaling events
   */
  readonly topic: sns.ITopic;

  /**
   * Which fleet scaling events triggers a notification
   * @default ScalingEvents.ALL
   */
  readonly scalingEvents?: ScalingEvents;
}

/**
 * Fleet scaling events
 */
export enum ScalingEvent {
  /**
   * Notify when an instance was launched
   */
  INSTANCE_LAUNCH = "autoscaling:EC2_INSTANCE_LAUNCH",

  /**
   * Notify when an instance was terminated
   */
  INSTANCE_TERMINATE = "autoscaling:EC2_INSTANCE_TERMINATE",

  /**
   * Notify when an instance failed to terminate
   */
  INSTANCE_TERMINATE_ERROR = "autoscaling:EC2_INSTANCE_TERMINATE_ERROR",

  /**
   * Notify when an instance failed to launch
   */
  INSTANCE_LAUNCH_ERROR = "autoscaling:EC2_INSTANCE_LAUNCH_ERROR",

  /**
   * Send a test notification to the topic
   */
  TEST_NOTIFICATION = "autoscaling:TEST_NOTIFICATION",
}

/**
 * A list of ScalingEvents, you can use one of the predefined lists, such as ScalingEvents.ERRORS
 * or create a custom group by instantiating a `NotificationTypes` object, e.g: `new NotificationTypes(`NotificationType.INSTANCE_LAUNCH`)`.
 */
export class ScalingEvents {
  /**
   * Fleet scaling errors
   */
  public static readonly ERRORS = new ScalingEvents(
    ScalingEvent.INSTANCE_LAUNCH_ERROR,
    ScalingEvent.INSTANCE_TERMINATE_ERROR,
  );

  /**
   * All fleet scaling events
   */
  public static readonly ALL = new ScalingEvents(
    ScalingEvent.INSTANCE_LAUNCH,
    ScalingEvent.INSTANCE_LAUNCH_ERROR,
    ScalingEvent.INSTANCE_TERMINATE,
    ScalingEvent.INSTANCE_TERMINATE_ERROR,
  );

  /**
   * Fleet scaling launch events
   */
  public static readonly LAUNCH_EVENTS = new ScalingEvents(
    ScalingEvent.INSTANCE_LAUNCH,
    ScalingEvent.INSTANCE_LAUNCH_ERROR,
  );

  /**
   * Fleet termination launch events
   */
  public static readonly TERMINATION_EVENTS = new ScalingEvents(
    ScalingEvent.INSTANCE_TERMINATE,
    ScalingEvent.INSTANCE_TERMINATE_ERROR,
  );

  /**
   * @internal
   */
  public readonly _types: ScalingEvent[];

  constructor(...types: ScalingEvent[]) {
    this._types = types;
  }
}

/**
 * EC2 Heath check options
 *
 * @deprecated Use Ec2HealthChecksOptions instead
 */
export interface Ec2HealthCheckOptions {
  /**
   * Specified the time Auto Scaling waits before checking the health status of an EC2 instance that has come into service
   *
   * @default Duration.seconds(0)
   */
  readonly grace?: Duration;
}

/**
 * ELB Heath check options
 *
 * @deprecated Use AdditionalHealthChecksOptions instead
 */
export interface ElbHealthCheckOptions {
  /**
   * Specified the time Auto Scaling waits before checking the health status of an EC2 instance that has come into service
   *
   * This option is required for ELB health checks.
   */
  readonly grace: Duration;
}

/**
 * Health check settings
 *
 * @deprecated Use HealthChecks instead
 */
export class HealthCheck {
  /**
   * Use EC2 for health checks
   *
   * @param options EC2 health check options
   */
  public static ec2(options: Ec2HealthCheckOptions = {}): HealthCheck {
    return new HealthCheck(HealthCheckType.EC2, options.grace);
  }

  /**
   * Use ELB for health checks.
   * It considers the instance unhealthy if it fails either the EC2 status checks or the load balancer health checks.
   *
   * @param options ELB health check options
   */
  public static elb(options: ElbHealthCheckOptions): HealthCheck {
    return new HealthCheck(HealthCheckType.ELB, options.grace);
  }

  private constructor(
    public readonly type: string,
    public readonly gracePeriod?: Duration,
  ) {}
}

/**
 * Heath checks base options
 */
interface HealthChecksBaseOptions {
  /**
   * Specified the time Auto Scaling waits before checking the health status of an EC2 instance that has come into service
   * and marking it unhealthy due to a failed health check.
   *
   * @default Duration.seconds(0)
   * @see https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-check-grace-period.html
   */
  readonly gracePeriod?: Duration;
}

/**
 * EC2 Heath checks options
 */
export interface Ec2HealthChecksOptions extends HealthChecksBaseOptions {}

/**
 * Additional Heath checks options
 */
export interface AdditionalHealthChecksOptions extends HealthChecksBaseOptions {
  /**
   * One or more health check types other than EC2.
   */
  readonly additionalTypes: AdditionalHealthCheckType[];
}

/**
 * Health check settings for multiple types
 */
export class HealthChecks {
  /**
   * Use EC2 only for health checks.
   *
   * @param options EC2 health checks options
   */
  public static ec2(options: Ec2HealthChecksOptions = {}): HealthChecks {
    return new HealthChecks(["EC2"], options.gracePeriod);
  }

  /**
   * Use additional health checks other than EC2.
   *
   * Specify types other than EC2, as EC2 is always enabled.
   * It considers the instance unhealthy if it fails either the EC2 status checks or the additional health checks.
   *
   * @param options Additional health checks options
   */
  public static withAdditionalChecks(
    options: AdditionalHealthChecksOptions,
  ): HealthChecks {
    return new HealthChecks(options.additionalTypes, options.gracePeriod);
  }

  private constructor(
    public readonly types: string[],
    public readonly gracePeriod?: Duration,
  ) {
    if (types.length === 0) {
      throw new UnscopedValidationError(
        "At least one health check type must be specified in 'additionalTypes' for 'healthChecks'",
      );
    }
  }
}

/**
 * @deprecated Use AdditionalHealthCheckType instead
 */
enum HealthCheckType {
  EC2 = "EC2",
  ELB = "ELB",
}

/**
 * Additional Health Check Type
 */
export enum AdditionalHealthCheckType {
  /**
   * ELB Health Check
   */
  ELB = "ELB",
  /**
   * EBS Health Check
   */
  EBS = "EBS",
  /**
   * VPC LATTICE Health Check
   */
  VPC_LATTICE = "VPC_LATTICE",
}

/**
 * An AutoScalingGroup
 */
export interface IAutoScalingGroup extends IAwsConstruct, iam.IGrantable {
  /**
   * The name of the AutoScalingGroup
   * @attribute
   */
  readonly autoScalingGroupName: string;

  /**
   * The arn of the AutoScalingGroup
   * @attribute
   */
  readonly autoScalingGroupArn: string;

  /**
   * The operating system family that the instances in this auto-scaling group belong to.
   * Is 'UNKNOWN' for imported ASGs.
   */
  readonly osType: OperatingSystemType;

  /**
   * Add command to the startup script of fleet instances.
   * The command must be in the scripting language supported by the fleet's OS (i.e. Linux/Windows).
   * Does nothing for imported ASGs.
   */
  addUserData(...commands: string[]): void;

  /**
   * Send a message to either an SQS queue or SNS topic when instances launch or terminate
   */
  addLifecycleHook(id: string, props: BasicLifecycleHookProps): LifecycleHook;

  /**
   * Add a pool of pre-initialized EC2 instances that sits alongside an Auto Scaling group
   */
  addWarmPool(options?: WarmPoolOptions): WarmPool;

  /**
   * Scale out or in based on time
   */
  scaleOnSchedule(id: string, props: BasicScheduledActionProps): ScheduledAction;

  /**
   * Scale out or in to achieve a target CPU utilization
   */
  scaleOnCpuUtilization(
    id: string,
    props: CpuUtilizationScalingProps,
  ): TargetTrackingScalingPolicy;

  /**
   * Scale out or in to achieve a target network ingress rate
   */
  scaleOnIncomingBytes(
    id: string,
    props: NetworkUtilizationScalingProps,
  ): TargetTrackingScalingPolicy;

  /**
   * Scale out or in to achieve a target network egress rate
   */
  scaleOnOutgoingBytes(
    id: string,
    props: NetworkUtilizationScalingProps,
  ): TargetTrackingScalingPolicy;

  /**
   * Scale out or in in order to keep a metric around a target value
   */
  scaleToTrackMetric(
    id: string,
    props: MetricTargetTrackingProps,
  ): TargetTrackingScalingPolicy;

  /**
   * Scale out or in, in response to a metric
   */
  scaleOnMetric(id: string, props: BasicStepScalingPolicyProps): StepScalingPolicy;
}

/**
 * Properties for enabling scaling based on CPU utilization
 */
export interface CpuUtilizationScalingProps extends BaseTargetTrackingProps {
  /**
   * Target average CPU utilization across the task
   */
  readonly targetUtilizationPercent: number;
}

/**
 * Properties for enabling scaling based on network utilization
 */
export interface NetworkUtilizationScalingProps extends BaseTargetTrackingProps {
  /**
   * Target average bytes/seconds on each instance
   */
  readonly targetBytesPerSecond: number;
}

/**
 * Properties for enabling scaling based on request/second
 */
export interface RequestCountScalingProps extends BaseTargetTrackingProps {
  /**
   * Target average requests/seconds on each instance
   *
   * @deprecated Use 'targetRequestsPerMinute' instead
   * @default - Specify exactly one of 'targetRequestsPerMinute' and 'targetRequestsPerSecond'
   */
  readonly targetRequestsPerSecond?: number;

  /**
   * Target average requests/minute on each instance
   * @default - Specify exactly one of 'targetRequestsPerMinute' and 'targetRequestsPerSecond'
   */
  readonly targetRequestsPerMinute?: number;
}

/**
 * Properties for enabling tracking of an arbitrary metric
 */
export interface MetricTargetTrackingProps extends BaseTargetTrackingProps {
  /**
   * Metric to track
   *
   * The metric must represent a utilization, so that if it's higher than the
   * target value, your ASG should scale out, and if it's lower it should
   * scale in.
   */
  readonly metric: cloudwatch.IMetric;

  /**
   * Value to keep the metric around
   */
  readonly targetValue: number;
}
