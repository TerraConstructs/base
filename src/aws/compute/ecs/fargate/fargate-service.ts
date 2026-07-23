// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/fargate/fargate-service.ts

import { Token } from "cdktn";
import { Construct } from "constructs";
import { ValidationError } from "../../../../errors";
import { AwsConstructBase } from "../../../aws-construct";
import { LoadBalancer } from "../../load-balancer";
import { ISecurityGroup } from "../../security-group";
import { SubnetSelection } from "../../vpc";
import { AvailabilityZoneRebalancing } from "../availability-zone-rebalancing";
import {
  BaseService,
  BaseServiceOptions,
  DeploymentControllerType,
  IBaseService,
  IService,
  LaunchType,
} from "../base/base-service";
import {
  fromServiceAttributes,
  extractServiceNameFromArn,
} from "../base/from-service-attributes";
import { TaskDefinition } from "../base/task-definition";
import { ICluster } from "../cluster";

/**
 * The properties for defining a service using the Fargate launch type.
 */
export interface FargateServiceProps extends BaseServiceOptions {
  /**
   * The task definition to use for tasks in the service.
   *
   * [disable-awslint:ref-via-interface]
   */
  readonly taskDefinition: TaskDefinition;

  /**
   * Specifies whether the task's elastic network interface receives a public IP address.
   *
   * If true, each task will receive a public IP address.
   *
   * @default false
   */
  readonly assignPublicIp?: boolean;

  /**
   * The subnets to associate with the service.
   *
   * @default - Public subnets if `assignPublicIp` is set, otherwise the first available one of Private, Isolated, Public, in that order.
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * The security groups to associate with the service. If you do not specify a security group, a new security group is created.
   *
   * @default - A new security group is created.
   * @deprecated use securityGroups instead.
   */
  readonly securityGroup?: ISecurityGroup;

  /**
   * The security groups to associate with the service. If you do not specify a security group, a new security group is created.
   *
   * @default - A new security group is created.
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * The platform version on which to run your service.
   *
   * If one is not specified, the LATEST platform version is used by default. For more information, see
   * [AWS Fargate Platform Versions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform_versions.html)
   * in the Amazon Elastic Container Service Developer Guide.
   *
   * @default Latest
   */
  readonly platformVersion?: FargatePlatformVersion;

  /**
   * Whether to use Availability Zone rebalancing for the service.
   *
   * If enabled, `maxHealthyPercent` must be greater than 100, and the service must not be a target
   * of a Classic Load Balancer.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-rebalancing.html
   * @default AvailabilityZoneRebalancing.ENABLED
   */
  readonly availabilityZoneRebalancing?: AvailabilityZoneRebalancing;
}

/**
 * The interface for a service using the Fargate launch type on an ECS cluster.
 */
export interface IFargateService extends IService {}

/**
 * The properties to import from the service using the Fargate launch type.
 */
export interface FargateServiceAttributes {
  /**
   * The cluster that hosts the service.
   */
  readonly cluster: ICluster;

  /**
   * The service ARN.
   *
   * @default - either this, or `serviceName`, is required
   */
  readonly serviceArn?: string;

  /**
   * The name of the service.
   *
   * @default - either this, or `serviceArn`, is required
   */
  readonly serviceName?: string;
}

/**
 * This creates a service using the Fargate launch type on an ECS cluster.
 *
 * Can also be used with Managed Instances compatible task definitions when using
 * capacity provider strategies.
 *
 * @resource AWS::ECS::Service
 */
export class FargateService extends BaseService implements IFargateService {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.ecs.FargateService";

  /**
   * Imports from the specified service ARN.
   */
  public static fromFargateServiceArn(
    scope: Construct,
    id: string,
    fargateServiceArn: string,
  ): IFargateService {
    class Import extends AwsConstructBase implements IFargateService {
      public readonly serviceArn = fargateServiceArn;
      public readonly serviceName = extractServiceNameFromArn(
        this,
        fargateServiceArn,
      );
      public get outputs(): Record<string, any> {
        return {
          arn: this.serviceArn,
          name: this.serviceName,
        };
      }
    }
    return new Import(scope, id, {
      environmentFromArn: fargateServiceArn,
    });
  }

  /**
   * Imports from the specified service attributes.
   */
  public static fromFargateServiceAttributes(
    scope: Construct,
    id: string,
    attrs: FargateServiceAttributes,
  ): IBaseService {
    return fromServiceAttributes(scope, id, attrs);
  }

  private readonly availabilityZoneRebalancingEnabled: boolean;

  /**
   * Constructs a new instance of the FargateService class.
   */
  constructor(scope: Construct, id: string, props: FargateServiceProps) {
    if (
      !props.taskDefinition.isFargateCompatible &&
      !props.taskDefinition.isManagedInstancesCompatible
    ) {
      throw new ValidationError(
        "Supplied TaskDefinition is not configured for compatibility with Fargate or Managed Instances",
        scope,
      );
    }

    if (
      props.securityGroup !== undefined &&
      props.securityGroups !== undefined
    ) {
      throw new ValidationError(
        "Only one of SecurityGroup or SecurityGroups can be populated.",
        scope,
      );
    }

    if (
      props.availabilityZoneRebalancing ===
        AvailabilityZoneRebalancing.ENABLED &&
      !Token.isUnresolved(props.maxHealthyPercent) &&
      props.maxHealthyPercent === 100
    ) {
      throw new ValidationError(
        "AvailabilityZoneRebalancing.ENABLED requires maxHealthyPercent > 100",
        scope,
      );
    }

    // Platform versions not supporting referencesSecretJsonField, ephemeralStorageGiB, or pidMode on a task definition
    const unsupportedPlatformVersions = [
      FargatePlatformVersion.VERSION1_0,
      FargatePlatformVersion.VERSION1_1,
      FargatePlatformVersion.VERSION1_2,
      FargatePlatformVersion.VERSION1_3,
    ];
    const isUnsupportedPlatformVersion =
      props.platformVersion &&
      unsupportedPlatformVersions.includes(props.platformVersion);

    if (
      props.taskDefinition.ephemeralStorageGiB &&
      isUnsupportedPlatformVersion
    ) {
      throw new ValidationError(
        `The ephemeralStorageGiB feature requires platform version ${FargatePlatformVersion.VERSION1_4} or later, got ${props.platformVersion}.`,
        scope,
      );
    }

    if (props.taskDefinition.pidMode && isUnsupportedPlatformVersion) {
      throw new ValidationError(
        `The pidMode feature requires platform version ${FargatePlatformVersion.VERSION1_4} or later, got ${props.platformVersion}.`,
        scope,
      );
    }

    super(
      scope,
      id,
      {
        ...props,
        desiredCount: props.desiredCount,
        launchType: LaunchType.FARGATE,
        capacityProviderStrategies: props.capacityProviderStrategies,
        enableECSManagedTags: props.enableECSManagedTags,
      },
      {
        cluster: props.cluster.clusterName,
        taskDefinition:
          props.deploymentController?.type === DeploymentControllerType.EXTERNAL
            ? undefined
            : props.taskDefinition.taskDefinitionArn,
        platformVersion: props.platformVersion,
        availabilityZoneRebalancing: props.availabilityZoneRebalancing,
      },
      props.taskDefinition,
    );

    this.availabilityZoneRebalancingEnabled =
      props.availabilityZoneRebalancing === AvailabilityZoneRebalancing.ENABLED;

    let securityGroups;
    if (props.securityGroup !== undefined) {
      securityGroups = [props.securityGroup];
    } else if (props.securityGroups !== undefined) {
      securityGroups = props.securityGroups;
    }

    if (
      !props.deploymentController ||
      props.deploymentController.type !== DeploymentControllerType.EXTERNAL
    ) {
      this.configureAwsVpcNetworkingWithSecurityGroups(
        props.cluster.vpc,
        props.assignPublicIp,
        props.vpcSubnets,
        securityGroups,
      );
    }

    this.node.addValidation({
      validate: () =>
        this.taskDefinition.referencesSecretJsonField &&
        isUnsupportedPlatformVersion
          ? [
              `The task definition of this service uses at least one container that references a secret JSON field. This feature requires platform version ${FargatePlatformVersion.VERSION1_4} or later.`,
            ]
          : [],
    });

    this.node.addValidation({
      validate: () =>
        !this.taskDefinition.defaultContainer
          ? ["A TaskDefinition must have at least one essential container"]
          : [],
    });
  }

  /**
   * Registers the service as a target of a Classic Load Balancer (CLB).
   *
   * Don't call this. Call `loadBalancer.addTarget()` instead.
   *
   * @override
   */
  public attachToClassicLB(loadBalancer: LoadBalancer): void {
    if (this.availabilityZoneRebalancingEnabled) {
      throw new ValidationError(
        "AvailabilityZoneRebalancing.ENABLED disallows using the service as a target of a Classic Load Balancer",
        this,
      );
    }
    super.attachToClassicLB(loadBalancer);
  }
}

/**
 * The platform version on which to run your service.
 *
 * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/platform_versions.html
 */
export enum FargatePlatformVersion {
  /**
   * The latest, recommended platform version.
   */
  LATEST = "LATEST",

  /**
   * Version 1.4.0
   *
   * Supports EFS endpoints, CAP_SYS_PTRACE Linux capability,
   * network performance metrics in CloudWatch Container Insights,
   * consolidated 20 GB ephemeral volume.
   */
  VERSION1_4 = "1.4.0",

  /**
   * Version 1.3.0
   *
   * Supports secrets, task recycling.
   */
  VERSION1_3 = "1.3.0",

  /**
   * Version 1.2.0
   *
   * Supports private registries.
   */
  VERSION1_2 = "1.2.0",

  /**
   * Version 1.1.0
   *
   * Supports task metadata, health checks, service discovery.
   */
  VERSION1_1 = "1.1.0",

  /**
   * Initial release
   *
   * Based on Amazon Linux 2017.09.
   */
  VERSION1_0 = "1.0.0",
}
