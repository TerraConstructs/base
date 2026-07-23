// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/cluster.ts

import {
  ecsCapacityProvider,
  ecsCluster,
  ecsClusterCapacityProviders,
} from "@cdktn/provider-aws";
import { Annotations, Token } from "cdktn";
import { Construct } from "constructs";
import { BottleRocketImage, EcsOptimizedAmi } from "./amis";
import { ClusterGrants } from "./cluster-grants";
import { InstanceDrainHook } from "./drain-hook/instance-drain-hook";
import { ECSMetrics, MetricWithDims } from "./ecs-canned-metrics.generated";
import { Duration } from "../../../duration";
import { ValidationError } from "../../../errors";
import { Size } from "../../../size";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import { AwsStack } from "../../aws-stack";
import * as cloudwatch from "../../cloudwatch";
import * as edge from "../../edge";
import * as kms from "../../encryption";
import * as iam from "../../iam";
import * as storage from "../../storage";
import * as autoscaling from "../auto-scaling";
import { Connections, IConnectable } from "../connections";
import { InstanceType } from "../instance-types";
import { IMachineImage, OperatingSystemType } from "../machine-image";
import { ISecurityGroup } from "../security-group";
import { ISubnet, IVpc, Vpc } from "../vpc";

const CLUSTER_SYMBOL = Symbol.for("@aws-cdk/aws-ecs/lib/cluster.Cluster");

/**
 * The properties used to define an ECS cluster.
 */
export interface ClusterProps extends AwsConstructProps {
  /**
   * The name for the cluster.
   *
   * @default GridUUID + Stack Unique Name
   */
  readonly clusterName?: string;

  /**
   * The VPC where your ECS instances will be running or your ENIs will be deployed
   *
   * @default - creates a new VPC with two AZs
   */
  readonly vpc?: IVpc;

  /**
   * The service discovery namespace created in this cluster
   *
   * @default - no service discovery namespace created, you can use `addDefaultCloudMapNamespace` to add a
   * default service discovery namespace later.
   */
  readonly defaultCloudMapNamespace?: CloudMapNamespaceOptions;

  /**
   * The ec2 capacity to add to the cluster
   *
   * @default - no EC2 capacity will be added, you can use `addCapacity` to add capacity later.
   */
  readonly capacity?: AddCapacityOptions;

  /**
   * The capacity providers to add to the cluster
   *
   * @default - None. Currently only FARGATE and FARGATE_SPOT are supported.
   * @deprecated Use `ClusterProps.enableFargateCapacityProviders` instead.
   */
  readonly capacityProviders?: string[];

  /**
   * Whether to enable Fargate Capacity Providers
   *
   * @default false
   */
  readonly enableFargateCapacityProviders?: boolean;

  /**
   * If true CloudWatch Container Insights will be enabled for the cluster
   *
   * @default - Container Insights will be disabled for this cluster.
   * @deprecated See {@link containerInsightsV2}
   */
  readonly containerInsights?: boolean;

  /**
   * The CloudWatch Container Insights configuration for the cluster
   *  @default {@link ContainerInsights.DISABLED} This may be overridden by ECS account level settings.
   */
  readonly containerInsightsV2?: ContainerInsights;

  /**
   * The execute command configuration for the cluster
   *
   * @default - no configuration will be provided.
   */
  readonly executeCommandConfiguration?: ExecuteCommandConfiguration;

  /**
   * Encryption configuration for ECS Managed storage
   *
   * @default - no encryption will be applied.
   */
  readonly managedStorageConfiguration?: ManagedStorageConfiguration;
}

/**
 * The machine image type
 */
export enum MachineImageType {
  /**
   * Amazon ECS-optimized Amazon Linux 2 AMI
   */
  AMAZON_LINUX_2,
  /**
   * Bottlerocket AMI
   */
  BOTTLEROCKET,
}

/**
 * A regional grouping of one or more container instances on which you can run tasks and services.
 *
 * @resource aws_ecs_cluster
 */
export class Cluster extends AwsConstructBase implements ICluster {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.ecs.Cluster";

  /**
   * Return whether the given object is a Cluster
   */
  public static isCluster(x: any): x is Cluster {
    return x !== null && typeof x === "object" && CLUSTER_SYMBOL in x;
  }

  /**
   * Import an existing cluster to the stack from its attributes.
   */
  public static fromClusterAttributes(
    scope: Construct,
    id: string,
    attrs: ClusterAttributes,
  ): ICluster {
    return new ImportedCluster(scope, id, attrs);
  }

  /**
   * Import an existing cluster to the stack from the cluster ARN.
   * This does not provide access to the vpc, hasEc2Capacity, or connections -
   * use the `fromClusterAttributes` method to access those properties.
   */
  public static fromClusterArn(
    scope: Construct,
    id: string,
    clusterArn: string,
  ): ICluster {
    const stack = AwsStack.ofAwsConstruct(scope);
    const arn = stack.splitArn(clusterArn, ArnFormat.SLASH_RESOURCE_NAME);
    const clusterName = arn.resourceName;

    if (!clusterName) {
      throw new ValidationError(
        `Missing required Cluster Name from Cluster ARN: ${clusterArn}`,
        scope,
      );
    }

    const errorSuffix =
      "is not available for a Cluster imported using fromClusterArn(), please use fromClusterAttributes() instead.";

    class Import extends AwsConstructBase implements ICluster {
      public readonly clusterArn = clusterArn;
      public readonly clusterName = clusterName!;
      get hasEc2Capacity(): boolean {
        throw new ValidationError(`hasEc2Capacity ${errorSuffix}`, this);
      }
      get connections(): Connections {
        throw new ValidationError(`connections ${errorSuffix}`, this);
      }
      get vpc(): IVpc {
        throw new ValidationError(`vpc ${errorSuffix}`, this);
      }
      public get outputs(): Record<string, any> {
        return {
          arn: this.clusterArn,
          name: this.clusterName,
        };
      }
    }

    return new Import(scope, id, {
      environmentFromArn: clusterArn,
    });
  }

  /**
   * Manage the allowed network connections for the cluster with Security Groups.
   */
  public readonly connections: Connections = new Connections();

  /**
   * The VPC associated with the cluster.
   */
  public readonly vpc: IVpc;

  /**
   * The Amazon Resource Name (ARN) that identifies the cluster.
   */
  public readonly clusterArn: string;

  /**
   * The name of the cluster.
   */
  public readonly clusterName: string;

  /**
   * Collection of grant methods for a Cluster
   */
  public readonly grants = ClusterGrants.fromCluster(this);

  /**
   * The underlying `aws_ecs_cluster` Terraform resource.
   */
  public readonly resource: ecsCluster.EcsCluster;

  /**
   * The names of both ASG and Fargate capacity providers associated with the cluster.
   */
  private _capacityProviderNames: string[] = [];

  /**
   * The names of cluster scoped capacity providers.
   */
  private _clusterScopedCapacityProviderNames: string[] = [];

  /**
   * The cluster default capacity provider strategy. This takes the form of a list of CapacityProviderStrategy objects.
   */
  private _defaultCapacityProviderStrategy: CapacityProviderStrategy[] = [];

  /**
   * The AWS Cloud Map namespace to associate with the cluster.
   */
  private _defaultCloudMapNamespace?: edge.cloudmap.INamespace;

  /**
   * Specifies whether the cluster has EC2 instance capacity.
   */
  private _hasEc2Capacity: boolean = false;

  /**
   * The autoscaling group for added Ec2 capacity
   */
  private _autoscalingGroup?: autoscaling.IAutoScalingGroup;

  /**
   * The execute command configuration for the cluster
   */
  private _executeCommandConfiguration?: ExecuteCommandConfiguration;

  /**
   * The configuration for ECS managed Storage
   * @private
   */
  private _managedStorageConfiguration?: ManagedStorageConfiguration;

  public get outputs(): Record<string, any> {
    return {
      arn: this.clusterArn,
      name: this.clusterName,
    };
  }

  /**
   * Constructs a new instance of the Cluster class.
   */
  constructor(scope: Construct, id: string, props: ClusterProps = {}) {
    super(scope, id, props);

    if (props.containerInsights !== undefined && props.containerInsightsV2) {
      throw new ValidationError(
        "You cannot set both containerInsights and containerInsightsV2",
        this,
      );
    }

    /**
     * clusterSettings needs to be undefined if containerInsights is not explicitly set in order to allow any
     * containerInsights settings on the account to apply.  See:
     * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ecs-cluster-clustersettings.html#cfn-ecs-cluster-clustersettings-value
     */
    let clusterSettings: ecsCluster.EcsClusterSetting[] | undefined;
    if (props.containerInsights !== undefined) {
      clusterSettings = [
        {
          name: "containerInsights",
          value: props.containerInsights
            ? ContainerInsights.ENABLED
            : ContainerInsights.DISABLED,
        },
      ];
    } else if (props.containerInsightsV2 !== undefined) {
      clusterSettings = [
        {
          name: "containerInsights",
          value: props.containerInsightsV2,
        },
      ];
    }

    this._capacityProviderNames = props.capacityProviders ?? [];
    if (props.enableFargateCapacityProviders) {
      this.enableFargateCapacityProviders();
    }

    if (props.executeCommandConfiguration) {
      if (
        (props.executeCommandConfiguration.logging ===
          ExecuteCommandLogging.OVERRIDE) !==
        (props.executeCommandConfiguration.logConfiguration !== undefined)
      ) {
        throw new ValidationError(
          "Execute command log configuration must only be specified when logging is OVERRIDE.",
          this,
        );
      }
      this._executeCommandConfiguration = props.executeCommandConfiguration;
    }

    this._managedStorageConfiguration = props.managedStorageConfiguration;

    // HARD REPO INVARIANT 1 (naming): `aws_ecs_cluster` supports `name` only (no
    // `name_prefix`), so fall back to the stack-scoped exact-form unique name.
    const clusterName =
      props.clusterName ?? this.stack.uniqueResourceName(this);

    this.resource = new ecsCluster.EcsCluster(this, "Resource", {
      name: clusterName,
      setting: clusterSettings,
      configuration: this.renderClusterConfiguration(),
    });

    this.clusterArn = this.resource.arn;
    this.clusterName = this.resource.name;

    this.vpc = props.vpc || new Vpc(this, "Vpc", { maxAzs: 2 });

    this._defaultCloudMapNamespace =
      props.defaultCloudMapNamespace !== undefined
        ? this.addDefaultCloudMapNamespace(props.defaultCloudMapNamespace)
        : undefined;

    this._autoscalingGroup =
      props.capacity !== undefined
        ? this.addCapacity("DefaultAutoScalingGroup", props.capacity)
        : undefined;

    // TERRACONSTRUCTS DEVIATION: upstream passes the raw (possibly-undefined)
    // `props.clusterName` here because with CloudFormation the physical name may not be
    // known until deploy time when omitted. In this repo the Terraform cluster name is
    // always resolved synchronously above (`clusterName`), so the tighter, always-known
    // name is used for the IAM condition instead.
    this.updateKeyPolicyForEphemeralStorageConfiguration(this.clusterName);

    // TERRACONSTRUCTS DEVIATION: upstream creates the `CfnClusterCapacityProviderAssociations`
    // resource via a mutating `Aspect` (`MaybeCreateCapacityProviderAssociations`) that visits
    // the construct tree during CFN synthesis, since `addAsgCapacityProvider()` /
    // `enableFargateCapacityProviders()` / `addDefaultCapacityProviderStrategy()` are imperative
    // APIs that accumulate onto this construct after `super()` has already run, and the
    // underlying `aws_ecs_cluster_capacity_providers` Terraform resource is a SINGLE resource
    // per cluster (not appendable). See `toTerraform()` below, which mirrors the
    // `iam/policy.ts` idiom instead of an Aspect.
  }

  /**
   * Applies policy to the target key for encryption.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-create-storage-key.html
   */
  private updateKeyPolicyForEphemeralStorageConfiguration(
    clusterName?: string,
  ) {
    const key =
      this._managedStorageConfiguration?.fargateEphemeralStorageKmsKey;
    if (!key) return;
    const clusterConditions: iam.Condition[] = [
      {
        test: "StringEquals",
        variable: "kms:EncryptionContext:aws:ecs:clusterAccount",
        values: [this.stack.account],
      },
      ...(clusterName
        ? [
            {
              test: "StringEquals",
              variable: "kms:EncryptionContext:aws:ecs:clusterName",
              values: [clusterName],
            },
          ]
        : []),
    ];

    key.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "Allow generate data key access for Fargate tasks.",
        principals: [new iam.ServicePrincipal("fargate.amazonaws.com")],
        resources: ["*"],
        actions: ["kms:GenerateDataKeyWithoutPlaintext"],
        condition: clusterConditions,
      }),
    );
    key.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "Allow grant creation permission for Fargate tasks.",
        principals: [new iam.ServicePrincipal("fargate.amazonaws.com")],
        resources: ["*"],
        actions: ["kms:CreateGrant"],
        condition: [
          ...clusterConditions,
          {
            test: "ForAllValues:StringEquals",
            variable: "kms:GrantOperations",
            values: ["Decrypt"],
          },
        ],
      }),
    );
  }

  /**
   * Enable the Fargate capacity providers for this cluster.
   */
  public enableFargateCapacityProviders() {
    for (const provider of ["FARGATE", "FARGATE_SPOT"]) {
      if (!this._capacityProviderNames.includes(provider)) {
        this._capacityProviderNames.push(provider);
      }
    }
  }

  /**
   * Add default capacity provider strategy for this cluster.
   *
   * @param defaultCapacityProviderStrategy cluster default capacity provider strategy. This takes the form of a list of CapacityProviderStrategy objects.
   *
   * For example
   * [
   *   {
   *     capacityProvider: 'FARGATE',
   *     base: 10,
   *     weight: 50
   *   }
   * ]
   */
  public addDefaultCapacityProviderStrategy(
    defaultCapacityProviderStrategy: CapacityProviderStrategy[],
  ) {
    if (this._defaultCapacityProviderStrategy.length > 0) {
      throw new ValidationError(
        "Cluster default capacity provider strategy is already set.",
        this,
      );
    }

    if (
      defaultCapacityProviderStrategy.some((dcp) =>
        dcp.capacityProvider.includes("FARGATE"),
      ) &&
      defaultCapacityProviderStrategy.some(
        (dcp) => !dcp.capacityProvider.includes("FARGATE"),
      )
    ) {
      throw new ValidationError(
        "A capacity provider strategy cannot contain a mix of capacity providers using Auto Scaling groups and Fargate providers. Specify one or the other and try again.",
        this,
      );
    }

    defaultCapacityProviderStrategy.forEach((dcp) => {
      if (
        !this._capacityProviderNames.includes(dcp.capacityProvider) &&
        !this._clusterScopedCapacityProviderNames.includes(dcp.capacityProvider)
      ) {
        throw new ValidationError(
          `Capacity provider ${dcp.capacityProvider} must be added to the cluster with addAsgCapacityProvider() or addManagedInstancesCapacityProvider() before it can be used in a default capacity provider strategy.`,
          this,
        );
      }
    });

    const defaultCapacityProvidersWithBase =
      defaultCapacityProviderStrategy.filter((dcp) => !!dcp.base);
    if (defaultCapacityProvidersWithBase.length > 1) {
      throw new ValidationError(
        "Only 1 capacity provider in a capacity provider strategy can have a nonzero base.",
        this,
      );
    }
    this._defaultCapacityProviderStrategy = defaultCapacityProviderStrategy;
  }

  private renderClusterConfiguration():
    | ecsCluster.EcsClusterConfiguration
    | undefined {
    if (
      !this._executeCommandConfiguration &&
      !this._managedStorageConfiguration
    )
      return undefined;
    return {
      executeCommandConfiguration: this._executeCommandConfiguration && {
        kmsKeyId: this._executeCommandConfiguration.kmsKey?.keyArn,
        logConfiguration:
          this._executeCommandConfiguration.logConfiguration &&
          this.renderExecuteCommandLogConfiguration(),
        logging: this._executeCommandConfiguration.logging,
      },
      managedStorageConfiguration: this._managedStorageConfiguration && {
        fargateEphemeralStorageKmsKeyId:
          this._managedStorageConfiguration.fargateEphemeralStorageKmsKey
            ?.keyId,
        kmsKeyId: this._managedStorageConfiguration.kmsKey?.keyId,
      },
    };
  }

  private renderExecuteCommandLogConfiguration(): ecsCluster.EcsClusterConfigurationExecuteCommandConfigurationLogConfiguration {
    const logConfiguration =
      this._executeCommandConfiguration?.logConfiguration;
    if (logConfiguration?.s3EncryptionEnabled && !logConfiguration?.s3Bucket) {
      throw new ValidationError(
        "You must specify an S3 bucket name in the execute command log configuration to enable S3 encryption.",
        this,
      );
    }
    if (
      logConfiguration?.cloudWatchEncryptionEnabled &&
      !logConfiguration?.cloudWatchLogGroup
    ) {
      throw new ValidationError(
        "You must specify a CloudWatch log group in the execute command log configuration to enable CloudWatch encryption.",
        this,
      );
    }
    return {
      cloudWatchEncryptionEnabled:
        logConfiguration?.cloudWatchEncryptionEnabled,
      cloudWatchLogGroupName:
        logConfiguration?.cloudWatchLogGroup?.logGroupName,
      s3BucketName: logConfiguration?.s3Bucket?.bucketName,
      // TERRACONSTRUCTS DEVIATION: Cfn's `s3EncryptionEnabled` is renamed
      // `s3BucketEncryptionEnabled` on the `aws_ecs_cluster` Terraform resource.
      s3BucketEncryptionEnabled: logConfiguration?.s3EncryptionEnabled,
      s3KeyPrefix: logConfiguration?.s3KeyPrefix,
    };
  }

  /**
   * Add an AWS Cloud Map DNS namespace for this cluster.
   * NOTE: HttpNamespaces are supported only for use cases involving Service Connect. For use cases involving both Service-
   * Discovery and Service Connect, customers should manage the HttpNamespace outside of the Cluster.addDefaultCloudMapNamespace method.
   */
  public addDefaultCloudMapNamespace(
    options: CloudMapNamespaceOptions,
  ): edge.cloudmap.INamespace {
    if (this._defaultCloudMapNamespace !== undefined) {
      throw new ValidationError("Can only add default namespace once.", this);
    }

    const namespaceType =
      options.type !== undefined
        ? options.type
        : edge.cloudmap.NamespaceType.DNS_PRIVATE;

    let sdNamespace;
    switch (namespaceType) {
      case edge.cloudmap.NamespaceType.DNS_PRIVATE:
        sdNamespace = new edge.cloudmap.PrivateDnsNamespace(
          this,
          "DefaultServiceDiscoveryNamespace",
          {
            name: options.name,
            vpc: this.vpc,
          },
        );
        break;
      case edge.cloudmap.NamespaceType.DNS_PUBLIC:
        sdNamespace = new edge.cloudmap.PublicDnsNamespace(
          this,
          "DefaultServiceDiscoveryNamespace",
          {
            name: options.name,
          },
        );
        break;
      case edge.cloudmap.NamespaceType.HTTP:
        sdNamespace = new edge.cloudmap.HttpNamespace(
          this,
          "DefaultServiceDiscoveryNamespace",
          {
            name: options.name,
          },
        );
        break;
      default:
        throw new ValidationError(
          `Namespace type ${namespaceType} is not supported.`,
          this,
        );
    }

    this._defaultCloudMapNamespace = sdNamespace;
    if (options.useForServiceConnect) {
      this.resource.putServiceConnectDefaults({
        namespace: sdNamespace.namespaceArn,
      });
    }

    return sdNamespace;
  }

  /**
   * Getter for _defaultCapacityProviderStrategy. This is necessary to correctly create Capacity Provider Associations.
   */
  public get defaultCapacityProviderStrategy() {
    return this._defaultCapacityProviderStrategy;
  }

  /**
   * Getter for _capacityProviderNames added to cluster
   */
  public get capacityProviderNames() {
    return this._capacityProviderNames;
  }

  /**
   * Getter for _clusterScopedCapacityProviderNames
   * @attribute
   */
  public get clusterScopedCapacityProviderNames() {
    return this._clusterScopedCapacityProviderNames;
  }

  /**
   * Getter for namespace added to cluster
   */
  public get defaultCloudMapNamespace(): edge.cloudmap.INamespace | undefined {
    return this._defaultCloudMapNamespace;
  }

  /**
   * It is highly recommended to use `Cluster.addAsgCapacityProvider` instead of this method.
   *
   * This method adds compute capacity to a cluster by creating an AutoScalingGroup with the specified options.
   *
   * Returns the AutoScalingGroup so you can add autoscaling settings to it.
   */
  public addCapacity(
    id: string,
    options: AddCapacityOptions,
  ): autoscaling.AutoScalingGroup {
    // Do 2-way defaulting here: if the machineImageType is BOTTLEROCKET, pick the right AMI.
    // Otherwise, determine the machineImageType from the given AMI.
    const machineImage =
      options.machineImage ??
      (options.machineImageType === MachineImageType.BOTTLEROCKET
        ? new BottleRocketImage({
            architecture: options.instanceType.architecture,
          })
        : new EcsOptimizedAmi());

    const machineImageType =
      options.machineImageType ??
      (BottleRocketImage.isBottleRocketImage(machineImage)
        ? MachineImageType.BOTTLEROCKET
        : MachineImageType.AMAZON_LINUX_2);

    // TERRACONSTRUCTS DEVIATION: upstream additionally threads `updateType`/`updatePolicy`
    // into the created AutoScalingGroup here (CloudFormation `UpdatePolicy`/`CreationPolicy`).
    // This repo's `autoscaling.CommonAutoScalingGroupProps` has no update-policy surface --
    // `aws_autoscaling_group` has no equivalent Terraform attribute -- so that plumbing is
    // omitted (see `auto-scaling-group.ts` `CommonAutoScalingGroupProps` doc comment).
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, id, {
      vpc: this.vpc,
      machineImage,
      ...options,
    });

    this.addAutoScalingGroup(autoScalingGroup, {
      machineImageType: machineImageType,
      ...options,
    });

    return autoScalingGroup;
  }

  /**
   * This method adds an Auto Scaling Group Capacity Provider to a cluster.
   *
   * @param provider the capacity provider to add to this cluster.
   */
  public addAsgCapacityProvider(
    provider: AsgCapacityProvider,
    options: AddAutoScalingGroupCapacityOptions = {},
  ) {
    // Don't add the same capacity provider more than once.
    if (this._capacityProviderNames.includes(provider.capacityProviderName)) {
      return;
    }
    this._hasEc2Capacity = true;
    this.configureAutoScalingGroup(provider.autoScalingGroup, {
      ...options,
      machineImageType: provider.machineImageType,
      // Don't enable the instance-draining lifecycle hook if managed termination protection or managed draining is enabled
      taskDrainTime:
        provider.enableManagedTerminationProtection ||
        provider.enableManagedDraining
          ? Duration.seconds(0)
          : options.taskDrainTime,
    });

    this._capacityProviderNames.push(provider.capacityProviderName);
  }

  /**
   * This method adds a Managed Instances Capacity Provider to a cluster.
   *
   * @param provider the capacity provider to add to this cluster.
   */
  public addManagedInstancesCapacityProvider(
    provider: ManagedInstancesCapacityProvider,
  ) {
    // Don't add the same capacity provider more than once.
    if (
      this._clusterScopedCapacityProviderNames.includes(
        provider.capacityProviderName,
      )
    ) {
      return;
    }
    // Set the cluster name on the capacity provider
    provider.bind(this);
    this._clusterScopedCapacityProviderNames.push(
      provider.capacityProviderName,
    );
  }

  /**
   * This method adds compute capacity to a cluster using the specified AutoScalingGroup.
   *
   * @deprecated Use `Cluster.addAsgCapacityProvider` instead.
   * @param autoScalingGroup the ASG to add to this cluster.
   * [disable-awslint:ref-via-interface] is needed in order to install the ECS
   * agent by updating the ASGs user data.
   */
  public addAutoScalingGroup(
    autoScalingGroup: autoscaling.AutoScalingGroup,
    options: AddAutoScalingGroupCapacityOptions = {},
  ) {
    this._hasEc2Capacity = true;
    this.connections.connections.addSecurityGroup(
      ...autoScalingGroup.connections.securityGroups,
    );
    this.configureAutoScalingGroup(autoScalingGroup, options);
  }

  private configureAutoScalingGroup(
    autoScalingGroup: autoscaling.AutoScalingGroup,
    options: AddAutoScalingGroupCapacityOptions = {},
  ) {
    // mutating the original options may cause unexpected behavioral change, hence, creating a clone here to avoid mutation
    const optionsClone: AddAutoScalingGroupCapacityOptions = {
      ...options,
      machineImageType:
        options.machineImageType ?? MachineImageType.AMAZON_LINUX_2,
    };

    if (!(autoScalingGroup instanceof autoscaling.AutoScalingGroup)) {
      throw new ValidationError(
        "Cannot configure the AutoScalingGroup because it is an imported resource.",
        this,
      );
    }

    if (autoScalingGroup.osType === OperatingSystemType.WINDOWS) {
      this.configureWindowsAutoScalingGroup(autoScalingGroup, optionsClone);
    } else {
      // Tie instances to cluster
      switch (optionsClone.machineImageType) {
        // Bottlerocket AMI
        case MachineImageType.BOTTLEROCKET: {
          autoScalingGroup.addUserData(
            // Connect to the cluster
            // Source: https://github.com/bottlerocket-os/bottlerocket/blob/develop/QUICKSTART-ECS.md#connecting-to-your-cluster
            "[settings.ecs]",
            `cluster = "${this.clusterName}"`,
          );
          // Enabling SSM
          // Source: https://github.com/bottlerocket-os/bottlerocket/blob/develop/QUICKSTART-ECS.md#enabling-ssm
          autoScalingGroup.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              this,
              "AmazonSSMManagedInstanceCore",
              "AmazonSSMManagedInstanceCore",
            ),
          );
          // required managed policy
          autoScalingGroup.role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              this,
              "AmazonEC2ContainerServiceforEC2Role",
              "service-role/AmazonEC2ContainerServiceforEC2Role",
            ),
          );

          break;
        }
        case MachineImageType.AMAZON_LINUX_2: {
          autoScalingGroup.addUserData(
            `echo ECS_CLUSTER=${this.clusterName} >> /etc/ecs/ecs.config`,
          );
          if (autoScalingGroup.spotPrice && optionsClone.spotInstanceDraining) {
            autoScalingGroup.addUserData(
              "echo ECS_ENABLE_SPOT_INSTANCE_DRAINING=true >> /etc/ecs/ecs.config",
            );
          }
          break;
        }
        default: {
          Annotations.of(this).addWarning(
            `Unknown ECS Image type: ${optionsClone.machineImageType}.`,
          );
          break;
        }
      }
    }

    // ECS instances must be able to do these things
    // Source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/instance_IAM_role.html
    // But, scoped down to minimal permissions required.
    //  Notes:
    //   - 'ecs:CreateCluster' removed. The cluster already exists.
    autoScalingGroup.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecs:DeregisterContainerInstance",
          "ecs:RegisterContainerInstance",
          "ecs:Submit*",
        ],
        resources: [this.clusterArn],
      }),
    );
    autoScalingGroup.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          // These act on a cluster instance, and the instance doesn't exist until the service starts.
          // Thus, scope to the cluster using a condition.
          // See: https://docs.aws.amazon.com/IAM/latest/UserGuide/list_amazonelasticcontainerservice.html
          "ecs:Poll",
          "ecs:StartTelemetrySession",
        ],
        resources: ["*"],
        condition: [
          {
            test: "ArnEquals",
            variable: "ecs:cluster",
            values: [this.clusterArn],
          },
        ],
      }),
    );
    autoScalingGroup.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          // These do not support resource constraints, and must be resource '*'
          "ecs:DiscoverPollEndpoint",
          "ecr:GetAuthorizationToken",
          // Preserved for backwards compatibility.
          // Users are able to enable cloudwatch agent using CDK. Existing
          // customers might be installing CW agent as part of user-data so if we
          // remove these permissions we will break that customer use cases.
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      }),
    );

    // 0 disables, otherwise forward to underlying implementation which picks the sane default
    if (!options.taskDrainTime || options.taskDrainTime.toSeconds() !== 0) {
      new InstanceDrainHook(autoScalingGroup, "DrainECSHook", {
        autoScalingGroup,
        cluster: this,
        drainTime: options.taskDrainTime,
        topicEncryptionKey: options.topicEncryptionKey,
      });
    }
  }

  /**
   * This method enables the Fargate or Fargate Spot capacity providers on the cluster.
   *
   * @param provider the capacity provider to add to this cluster.
   * @deprecated Use `enableFargateCapacityProviders` instead.
   * @see `addAsgCapacityProvider` to add an Auto Scaling Group capacity provider to the cluster.
   */
  public addCapacityProvider(provider: string) {
    if (!(provider === "FARGATE" || provider === "FARGATE_SPOT")) {
      throw new ValidationError("CapacityProvider not supported", this);
    }

    if (!this._capacityProviderNames.includes(provider)) {
      this._capacityProviderNames.push(provider);
    }
  }

  /**
   * Returns an ARN that represents all tasks within the cluster that match
   * the task pattern specified. To represent all tasks, specify ``"*"``.
   *
   * @param keyPattern Task id pattern
   */
  public arnForTasks(keyPattern: string): string {
    return this.stack.formatArn({
      service: "ecs",
      resource: "task",
      resourceName: `${this.clusterName}/${keyPattern}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
  }

  /**
   * Grants an ECS Task Protection API permission to the specified grantee.
   * This method provides a streamlined way to assign the 'ecs:UpdateTaskProtection'
   * permission, enabling the grantee to manage task protection in the ECS cluster.
   *
   * @param grantee The entity (e.g., IAM role or user) to grant the permissions to.
   */
  public grantTaskProtection(grantee: iam.IGrantable): iam.Grant {
    return this.grants.taskProtection(grantee);
  }

  private configureWindowsAutoScalingGroup(
    autoScalingGroup: autoscaling.AutoScalingGroup,
    options: AddAutoScalingGroupCapacityOptions = {},
  ) {
    // clear the cache of the agent
    autoScalingGroup.addUserData(
      "Remove-Item -Recurse C:\\ProgramData\\Amazon\\ECS\\Cache",
    );

    // pull the latest ECS Tools
    autoScalingGroup.addUserData("Import-Module ECSTools");

    // set the cluster name environment variable
    autoScalingGroup.addUserData(
      `[Environment]::SetEnvironmentVariable("ECS_CLUSTER", "${this.clusterName}", "Machine")`,
    );
    autoScalingGroup.addUserData(
      '[Environment]::SetEnvironmentVariable("ECS_ENABLE_AWSLOGS_EXECUTIONROLE_OVERRIDE", "true", "Machine")',
    );
    // tslint:disable-next-line: max-line-length
    autoScalingGroup.addUserData(
      '[Environment]::SetEnvironmentVariable("ECS_AVAILABLE_LOGGING_DRIVERS", \'["json-file","awslogs"]\', "Machine")',
    );

    // enable instance draining
    if (autoScalingGroup.spotPrice && options.spotInstanceDraining) {
      autoScalingGroup.addUserData(
        '[Environment]::SetEnvironmentVariable("ECS_ENABLE_SPOT_INSTANCE_DRAINING", "true", "Machine")',
      );
    }

    autoScalingGroup.addUserData(
      `Initialize-ECSAgent -Cluster '${this.clusterName}'`,
    );
  }

  /**
   * Getter for autoscaling group added to cluster
   */
  public get autoscalingGroup(): autoscaling.IAutoScalingGroup | undefined {
    return this._autoscalingGroup;
  }

  /**
   * Whether the cluster has EC2 capacity associated with it
   */
  public get hasEc2Capacity(): boolean {
    return this._hasEc2Capacity;
  }

  /**
   * Getter for execute command configuration associated with the cluster.
   */
  public get executeCommandConfiguration():
    | ExecuteCommandConfiguration
    | undefined {
    return this._executeCommandConfiguration;
  }

  /**
   * This method returns the CloudWatch metric for this clusters CPU reservation.
   *
   * @default average over 5 minutes
   */
  public metricCpuReservation(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ECSMetrics.cpuReservationAverage, props);
  }

  /**
   * This method returns the CloudWatch metric for this clusters CPU utilization.
   *
   * @default average over 5 minutes
   */
  public metricCpuUtilization(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ECSMetrics.cpuUtilizationAverage, props);
  }

  /**
   * This method returns the CloudWatch metric for this clusters memory reservation.
   *
   * @default average over 5 minutes
   */
  public metricMemoryReservation(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ECSMetrics.memoryReservationAverage, props);
  }

  /**
   * This method returns the CloudWatch metric for this clusters memory utilization.
   *
   * @default average over 5 minutes
   */
  public metricMemoryUtilization(
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return this.cannedMetric(ECSMetrics.memoryUtilizationAverage, props);
  }

  /**
   * This method returns the specified CloudWatch metric for this cluster.
   */
  public metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/ECS",
      metricName,
      dimensionsMap: { ClusterName: this.clusterName },
      ...props,
    }).attachTo(this);
  }

  private cannedMetric(
    fn: (dims: {
      ClusterName: string;
    }) => MetricWithDims<{ ClusterName: string }>,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...fn({ ClusterName: this.clusterName }),
      ...props,
    }).attachTo(this);
  }

  /**
   * Adds resource to the terraform JSON output.
   *
   * called by TerraformStack.prepareStack()
   *
   * TERRACONSTRUCTS DEVIATION: mirrors the `iam/policy.ts` `toTerraform()` idiom to lazily
   * materialize the SINGLE `aws_ecs_cluster_capacity_providers` resource merged from every
   * `addAsgCapacityProvider()` / `enableFargateCapacityProviders()` /
   * `addDefaultCapacityProviderStrategy()` call, guarded by `tryFindChild` so re-entrant
   * `prepareStack()` runs stay idempotent. Upstream instead uses a mutating `Aspect`
   * (`MaybeCreateCapacityProviderAssociations`) visited during CFN synthesis -- the effect
   * (create the association resource only if any EC2 capacity providers were registered) is
   * the same.
   */
  public toTerraform(): any {
    if (
      this._capacityProviderNames.length > 0 ||
      this._defaultCapacityProviderStrategy.length > 0
    ) {
      const id = "CapacityProviderAssociations";
      if (!this.node.tryFindChild(id)) {
        new ecsClusterCapacityProviders.EcsClusterCapacityProviders(this, id, {
          clusterName: this.clusterName,
          capacityProviders: this._capacityProviderNames,
          defaultCapacityProviderStrategy:
            this._defaultCapacityProviderStrategy.map((s) => ({
              capacityProvider: s.capacityProvider,
              base: s.base,
              weight: s.weight,
            })),
        });
      }
    }
    return {};
  }
}

Object.defineProperty(Cluster.prototype, CLUSTER_SYMBOL, {
  value: true,
  enumerable: false,
  writable: false,
});

/**
 * A regional grouping of one or more container instances on which you can run tasks and services.
 */
export interface ICluster extends IAwsConstruct {
  /**
   * The name of the cluster.
   * @attribute
   */
  readonly clusterName: string;

  /**
   * The Amazon Resource Name (ARN) that identifies the cluster.
   * @attribute
   */
  readonly clusterArn: string;

  /**
   * The VPC associated with the cluster.
   */
  readonly vpc: IVpc;

  /**
   * Manage the allowed network connections for the cluster with Security Groups.
   */
  readonly connections: Connections;

  /**
   * Specifies whether the cluster has EC2 instance capacity.
   */
  readonly hasEc2Capacity: boolean;

  /**
   * The AWS Cloud Map namespace to associate with the cluster.
   */
  readonly defaultCloudMapNamespace?: edge.cloudmap.INamespace;

  /**
   * The autoscaling group added to the cluster if capacity is associated to the cluster
   */
  readonly autoscalingGroup?: autoscaling.IAutoScalingGroup;

  /**
   * The execute command configuration for the cluster
   */
  readonly executeCommandConfiguration?: ExecuteCommandConfiguration;
}

/**
 * The properties to import from the ECS cluster.
 */
export interface ClusterAttributes {
  /**
   * The name of the cluster.
   */
  readonly clusterName: string;

  /**
   * The Amazon Resource Name (ARN) that identifies the cluster.
   *
   * @default Derived from clusterName
   */
  readonly clusterArn?: string;

  /**
   * The VPC associated with the cluster.
   */
  readonly vpc: IVpc;

  /**
   * The security groups associated with the container instances registered to the cluster.
   *
   * @default - no security groups
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * Specifies whether the cluster has EC2 instance capacity.
   *
   * @default true
   */
  readonly hasEc2Capacity?: boolean;

  /**
   * The AWS Cloud Map namespace to associate with the cluster.
   *
   * @default - No default namespace
   */
  readonly defaultCloudMapNamespace?: edge.cloudmap.INamespace;

  /**
   * Autoscaling group added to the cluster if capacity is added
   *
   * @default - No default autoscaling group
   */
  readonly autoscalingGroup?: autoscaling.IAutoScalingGroup;

  /**
   * The execute command configuration for the cluster
   *
   * @default - none.
   */
  readonly executeCommandConfiguration?: ExecuteCommandConfiguration;
}

/**
 * An Cluster that has been imported
 */
class ImportedCluster extends AwsConstructBase implements ICluster {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.ecs.ImportedCluster";
  /**
   * Name of the cluster
   */
  public readonly clusterName: string;

  /**
   * ARN of the cluster
   */
  public readonly clusterArn: string;

  /**
   * VPC that the cluster instances are running in
   */
  public readonly vpc: IVpc;

  /**
   * Security group of the cluster instances
   */
  public readonly connections = new Connections();

  /**
   * Whether the cluster has EC2 capacity
   */
  public readonly hasEc2Capacity: boolean;

  /**
   * The autoscaling group added to the cluster if capacity is associated to the cluster
   */
  public readonly autoscalingGroup?: autoscaling.IAutoScalingGroup;

  /**
   * Cloudmap namespace created in the cluster
   */
  private _defaultCloudMapNamespace?: edge.cloudmap.INamespace;

  /**
   * The execute command configuration for the cluster
   */
  private _executeCommandConfiguration?: ExecuteCommandConfiguration;

  public get outputs(): Record<string, any> {
    return {
      arn: this.clusterArn,
      name: this.clusterName,
    };
  }

  /**
   * Constructs a new instance of the ImportedCluster class.
   */
  constructor(scope: Construct, id: string, props: ClusterAttributes) {
    super(scope, id);
    this.clusterName = props.clusterName;
    this.vpc = props.vpc;
    this.hasEc2Capacity = props.hasEc2Capacity !== false;
    this._defaultCloudMapNamespace = props.defaultCloudMapNamespace;
    this._executeCommandConfiguration = props.executeCommandConfiguration;
    this.autoscalingGroup = props.autoscalingGroup;

    this.clusterArn =
      props.clusterArn ??
      this.stack.formatArn({
        service: "ecs",
        resource: "cluster",
        resourceName: props.clusterName,
      });

    this.connections = new Connections({
      securityGroups: props.securityGroups,
    });
  }

  public get defaultCloudMapNamespace(): edge.cloudmap.INamespace | undefined {
    return this._defaultCloudMapNamespace;
  }

  public get executeCommandConfiguration():
    | ExecuteCommandConfiguration
    | undefined {
    return this._executeCommandConfiguration;
  }
}

/**
 * The properties for adding an AutoScalingGroup.
 */
export interface AddAutoScalingGroupCapacityOptions {
  /**
   * The time period to wait before force terminating an instance that is draining.
   *
   * This creates a Lambda function that is used by a lifecycle hook for the
   * AutoScalingGroup that will delay instance termination until all ECS tasks
   * have drained from the instance. Set to 0 to disable task draining.
   *
   * Set to 0 to disable task draining.
   *
   * @deprecated The lifecycle draining hook is not configured if using the EC2 Capacity Provider. Enable managed termination protection instead.
   * @default Duration.minutes(5)
   */
  readonly taskDrainTime?: Duration;

  /**
   * Specify whether to enable Automated Draining for Spot Instances running Amazon ECS Services.
   * For more information, see [Using Spot Instances](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-instance-spot.html).
   *
   * @default false
   */
  readonly spotInstanceDraining?: boolean;

  /**
   * If `AddAutoScalingGroupCapacityOptions.taskDrainTime` is non-zero, then the ECS cluster creates an
   * SNS Topic to as part of a system to drain instances of tasks when the instance is being shut down.
   * If this property is provided, then this key will be used to encrypt the contents of that SNS Topic.
   * See [SNS Data Encryption](https://docs.aws.amazon.com/sns/latest/dg/sns-data-encryption.html) for more information.
   *
   * @default The SNS Topic will not be encrypted.
   */
  readonly topicEncryptionKey?: kms.IKey;

  /**
   * What type of machine image this is
   *
   * Depending on the setting, different UserData will automatically be added
   * to the `AutoScalingGroup` to configure it properly for use with ECS.
   *
   * If you create an `AutoScalingGroup` yourself and are adding it via
   * `addAutoScalingGroup()`, you must specify this value. If you are adding an
   * `autoScalingGroup` via `addCapacity`, this value will be determined
   * from the `machineImage` you pass.
   *
   * @default - Automatically determined from `machineImage`, if available, otherwise `MachineImageType.AMAZON_LINUX_2`.
   */
  readonly machineImageType?: MachineImageType;
}

/**
 * The properties for adding instance capacity to an AutoScalingGroup.
 */
export interface AddCapacityOptions
  extends AddAutoScalingGroupCapacityOptions,
    autoscaling.CommonAutoScalingGroupProps {
  /**
   * The EC2 instance type to use when launching instances into the AutoScalingGroup.
   */
  readonly instanceType: InstanceType;

  /**
   * The ECS-optimized AMI variant to use
   *
   * The default is to use an ECS-optimized AMI of Amazon Linux 2 which is
   * automatically updated to the latest version on every deployment. This will
   * replace the instances in the AutoScalingGroup. Make sure you have not disabled
   * task draining, to avoid downtime when the AMI updates.
   *
   * To use an image that does not update on every deployment, pass:
   *
   * ```ts
   * const machineImage = ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.STANDARD, {
   *   cachedInContext: true,
   * });
   * ```
   *
   * For more information, see [Amazon ECS-optimized
   * AMIs](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-optimized_AMI.html).
   *
   * You must define either `machineImage` or `machineImageType`, not both.
   *
   * @default - Automatically updated, ECS-optimized Amazon Linux 2
   */
  readonly machineImage?: IMachineImage;
}

/**
 * The options for creating an AWS Cloud Map namespace.
 */
export interface CloudMapNamespaceOptions {
  /**
   * The name of the namespace, such as example.com.
   */
  readonly name: string;

  /**
   * The type of CloudMap Namespace to create.
   *
   * @default PrivateDns
   */
  readonly type?: edge.cloudmap.NamespaceType;

  /**
   * The VPC to associate the namespace with. This property is required for private DNS namespaces.
   *
   * @default VPC of the cluster for Private DNS Namespace, otherwise none
   */
  readonly vpc?: IVpc;

  /**
   * This property specifies whether to set the provided namespace as the service connect default in the cluster properties.
   *
   * @default false
   */
  readonly useForServiceConnect?: boolean;
}

/**
 * The CloudWatch Container Insights setting
 *
 * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-container-insights.html
 */
export enum ContainerInsights {
  /**
   * Enable CloudWatch Container Insights for the cluster
   */
  ENABLED = "enabled",

  /**
   * Disable CloudWatch Container Insights for the cluster
   */
  DISABLED = "disabled",

  /**
   * Enable CloudWatch Container Insights with enhanced observability for the cluster
   */
  ENHANCED = "enhanced",
}

/**
 * A Capacity Provider strategy to use for the service.
 */
export interface CapacityProviderStrategy {
  /**
   * The name of the capacity provider.
   */
  readonly capacityProvider: string;

  /**
   * The base value designates how many tasks, at a minimum, to run on the specified capacity provider. Only one
   * capacity provider in a capacity provider strategy can have a base defined. If no value is specified, the default
   * value of 0 is used.
   *
   * @default - none
   */
  readonly base?: number;

  /**
   * The weight value designates the relative percentage of the total number of tasks launched that should use the
   * specified
   capacity provider. The weight value is taken into consideration after the base value, if defined, is satisfied.
   *
   * @default - 0
   */
  readonly weight?: number;
}

/**
 * The details of the execute command configuration. For more information, see
 * [ExecuteCommandConfiguration] https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ecs-cluster-executecommandconfiguration.html
 */
export interface ExecuteCommandConfiguration {
  /**
   * The AWS Key Management Service key ID to encrypt the data between the local client and the container.
   *
   * @default - none
   */
  readonly kmsKey?: kms.IKey;

  /**
   * The log configuration for the results of the execute command actions. The logs can be sent to CloudWatch Logs or an Amazon S3 bucket.
   *
   * @default - none
   */
  readonly logConfiguration?: ExecuteCommandLogConfiguration;

  /**
   * The log settings to use for logging the execute command session.
   *
   * @default - none
   */
  readonly logging?: ExecuteCommandLogging;
}

/**
 * The log settings to use to for logging the execute command session. For more information, see
 * [Logging] https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ecs-cluster-executecommandconfiguration.html#cfn-ecs-cluster-executecommandconfiguration-logging
 */
export enum ExecuteCommandLogging {
  /**
   * The execute command session is not logged.
   */
  NONE = "NONE",

  /**
   * The awslogs configuration in the task definition is used. If no logging parameter is specified, it defaults to this value. If no awslogs log driver is configured in the task definition, the output won't be logged.
   */
  DEFAULT = "DEFAULT",

  /**
   * Specify the logging details as a part of logConfiguration.
   */
  OVERRIDE = "OVERRIDE",
}

/**
 * The log configuration for the results of the execute command actions. The logs can be sent to CloudWatch Logs and/ or an Amazon S3 bucket.
 * For more information, see [ExecuteCommandLogConfiguration] https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ecs-cluster-executecommandlogconfiguration.html
 */
export interface ExecuteCommandLogConfiguration {
  /**
   * Whether or not to enable encryption on the CloudWatch logs.
   *
   * @default - encryption will be disabled.
   */
  readonly cloudWatchEncryptionEnabled?: boolean;

  /**
   * The name of the CloudWatch log group to send logs to. The CloudWatch log group must already be created.
   * @default - none
   */
  readonly cloudWatchLogGroup?: cloudwatch.ILogGroup;

  /**
   * The name of the S3 bucket to send logs to. The S3 bucket must already be created.
   *
   * @default - none
   */
  readonly s3Bucket?: storage.IBucket;

  /**
   * Whether or not to enable encryption on the S3 bucket.
   *
   * @default - encryption will be disabled.
   */
  readonly s3EncryptionEnabled?: boolean;

  /**
   * An optional folder in the S3 bucket to place logs in.
   *
   * @default - none
   */
  readonly s3KeyPrefix?: string;
}

/**
 * The options for creating an Auto Scaling Group Capacity Provider.
 */
export interface AsgCapacityProviderProps
  extends AddAutoScalingGroupCapacityOptions {
  /**
   * The name of the capacity provider. If a name is specified,
   * it cannot start with `aws`, `ecs`, or `fargate`. If no name is specified,
   * a default name in the CFNStackName-CFNResourceName-RandomString format is used.
   * If the stack name starts with `aws`, `ecs`, or `fargate`, a unique resource name
   * is generated that starts with `cp-`.
   *
   * @default GridUUID + Stack Unique Name
   */
  readonly capacityProviderName?: string;

  /**
   * The autoscaling group to add as a Capacity Provider.
   *
   * Warning: When passing an imported resource using `AutoScalingGroup.fromAutoScalingGroupName` along with `enableManagedTerminationProtection: true`,
   * the `AsgCapacityProvider` construct will not be able to enforce the option `newInstancesProtectedFromScaleIn` of the `AutoScalingGroup`.
   * In this case the constructor of `AsgCapacityProvider` will throw an exception.
   */
  readonly autoScalingGroup: autoscaling.IAutoScalingGroup;

  /**
   * When enabled the scale-in and scale-out actions of the cluster's Auto Scaling Group will be managed for you.
   * This means your cluster will automatically scale instances based on the load your tasks put on the cluster.
   * For more information, see [Using Managed Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/asg-capacity-providers.html#asg-capacity-providers-managed-scaling) in the ECS Developer Guide.
   *
   * @default true
   */
  readonly enableManagedScaling?: boolean;

  /**
   * When enabled the Auto Scaling Group will only terminate EC2 instances that no longer have running non-daemon
   * tasks.
   *
   * Scale-in protection will be automatically enabled on instances. When all non-daemon tasks are
   * stopped on an instance, ECS initiates the scale-in process and turns off scale-in protection for the
   * instance. The Auto Scaling Group can then terminate the instance. For more information see [Managed termination
   *  protection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cluster-auto-scaling.html#managed-termination-protection)
   * in the ECS Developer Guide.
   *
   * Managed scaling must also be enabled.
   *
   * @default true
   */
  readonly enableManagedTerminationProtection?: boolean;

  /**
   * Managed instance draining facilitates graceful termination of Amazon ECS instances.
   * This allows your service workloads to stop safely and be rescheduled to non-terminating instances.
   * Infrastructure maintenance and updates are preformed without disruptions to workloads.
   * To use managed instance draining, set enableManagedDraining to true.
   *
   * @default true
   */
  readonly enableManagedDraining?: boolean;

  /**
   * Maximum scaling step size. In most cases this should be left alone.
   *
   * @default 1000
   */
  readonly maximumScalingStepSize?: number;

  /**
   * Minimum scaling step size. In most cases this should be left alone.
   *
   * @default 1
   */
  readonly minimumScalingStepSize?: number;

  /**
   * Target capacity percent. In most cases this should be left alone.
   *
   * @default 100
   */
  readonly targetCapacityPercent?: number;

  /**
   * The period of time, in seconds, after a newly launched Amazon EC2 instance
   * can contribute to CloudWatch metrics for Auto Scaling group.
   *
   * Must be between 0 and 10000.
   *
   * @default 300
   */
  readonly instanceWarmupPeriod?: number;
}

/**
 * Kms Keys for encryption ECS managed storage
 */
export interface ManagedStorageConfiguration {
  /**
   * Customer KMS Key used to encrypt ECS Fargate ephemeral Storage.
   * The configured KMS Key's policy will be modified to allow ECS to use the Key to encrypt the ephemeral Storage for this cluster.
   *
   * @see https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-storage-encryption.html
   *
   * @default - Encrypted using AWS-managed key
   */
  readonly fargateEphemeralStorageKmsKey?: kms.IKey;

  /**
   * Customer KMS Key used to encrypt ECS managed Storage.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ecs-cluster-managedstorageconfiguration.html#cfn-ecs-cluster-managedstorageconfiguration-kmskeyid
   *
   * @default - Encrypted using AWS-managed key
   */
  readonly kmsKey?: kms.IKey;
}

/**
 * The monitoring configuration for EC2 instances.
 */
export enum InstanceMonitoring {
  /**
   * Basic monitoring (5-minute intervals)
   */
  BASIC = "BASIC",

  /**
   * Detailed monitoring (1-minute intervals)
   */
  DETAILED = "DETAILED",
}

/**
 * Propagate tags for Managed Instances.
 */
export enum PropagateManagedInstancesTags {
  /**
   * Propagate tags from the capacity provider
   */
  CAPACITY_PROVIDER = "CAPACITY_PROVIDER",

  /**
   * Do not propagate tags
   */
  NONE = "NONE",
}

/**
 * The options for creating a Managed Instances Capacity Provider.
 */
export interface ManagedInstancesCapacityProviderProps {
  /**
   * The name of the capacity provider.
   * If a name is specified, it cannot start with `aws`, `ecs`, or `fargate`.
   * If no name is specified, a default name in the CFNStackName-CFNResourceName-RandomString format is used.
   * If the stack name starts with `aws`, `ecs`, or `fargate`, a unique resource name
   * is generated that starts with `cp-`.
   *
   * @default GridUUID + Stack Unique Name
   */
  readonly capacityProviderName?: string;

  /**
   * The IAM role that ECS uses to manage the infrastructure for the capacity provider.
   * This role is used by ECS to perform actions such as launching and terminating instances,
   * managing Auto Scaling Groups, and other infrastructure operations required for the
   * managed instances capacity provider.
   *
   * @default - A new role will be created with the AmazonECSInfrastructureRolePolicyForManagedInstances managed policy
   */
  readonly infrastructureRole?: iam.IRole;

  /**
   * The EC2 instance profile that will be attached to instances launched by this capacity provider.
   * This instance profile must contain the necessary IAM permissions for ECS container instances
   * to register with the cluster and run tasks. At minimum, it should include permissions for
   * ECS agent communication, ECR image pulling, and CloudWatch logging.
   */
  readonly ec2InstanceProfile: iam.IInstanceProfile;

  /**
   * The VPC subnets where EC2 instances will be launched.
   * This array must be non-empty and should contain subnets from the VPC where you want
   * the managed instances to be deployed.
   */
  readonly subnets: ISubnet[];

  /**
   * The security groups to associate with the launched EC2 instances.
   * These security groups control the network traffic allowed to and from the instances.
   * If not specified, the default security group of the VPC containing the subnets will be used.
   *
   * @default - default security group of the VPC
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * The size of the task volume storage attached to each instance.
   * This storage is used for container images, container logs, and temporary files.
   * Larger storage may be needed for workloads with large container images or
   * applications that generate significant temporary data.
   *
   * @default Size.gibibytes(80)
   */
  readonly taskVolumeStorage?: Size;

  /**
   * The CloudWatch monitoring configuration for the EC2 instances.
   * Determines the granularity of CloudWatch metrics collection for the instances.
   * Detailed monitoring incurs additional costs but provides better observability.
   *
   * @default - no enhanced monitoring (basic monitoring only)
   */
  readonly monitoring?: InstanceMonitoring;

  /**
   * The instance requirements configuration for EC2 instance selection.
   * This allows you to specify detailed requirements for instance selection including
   * vCPU count ranges, memory ranges, CPU manufacturers (Intel, AMD, AWS Graviton),
   * instance generations, network performance requirements, and many other criteria.
   * ECS will automatically select appropriate instance types that meet these requirements.
   *
   * Terraform deviation: typed against the `aws_ecs_capacity_provider` provider resource's
   * `managed_instances_provider.instance_launch_template.instance_requirements` nested block
   * (rather than the CloudFormation `InstanceRequirementsRequestProperty` type, resp. the
   * upstream `aws-ec2` `InstanceRequirementsConfig` L2 shape) -- the shapes are field-for-field
   * equivalent modulo acronym casing (e.g. `vCpuCount` -> `vcpuCount`, `memoryMiB` -> `memoryMib`).
   *
   * @default - no specific instance requirements, ECS will choose appropriate instances
   */
  readonly instanceRequirements?: ecsCapacityProvider.EcsCapacityProviderManagedInstancesProviderInstanceLaunchTemplateInstanceRequirements;

  /**
   * Specifies whether to propagate tags from the capacity provider to the launched instances.
   * When set to CAPACITY_PROVIDER, tags applied to the capacity provider resource will be
   * automatically applied to all EC2 instances launched by this capacity provider.
   *
   * @default PropagateManagedInstancesTags.NONE - no tag propagation
   */
  readonly propagateTags?: PropagateManagedInstancesTags;
}

/**
 * A Managed Instances Capacity Provider. This allows an ECS cluster to use
 * Managed Instances for task placement with managed infrastructure.
 */
export class ManagedInstancesCapacityProvider
  extends Construct
  implements IConnectable
{
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.ecs.ManagedInstancesCapacityProvider";

  /**
   * Capacity provider name
   */
  readonly capacityProviderName: string;

  /**
   * The network connections associated with this resource.
   */
  readonly connections: Connections;

  /**
   * The underlying `aws_ecs_capacity_provider` Terraform resource.
   */
  public readonly resource: ecsCapacityProvider.EcsCapacityProvider;

  constructor(
    scope: Construct,
    id: string,
    props: ManagedInstancesCapacityProviderProps,
  ) {
    super(scope, id);

    if (props.subnets.length === 0) {
      throw new ValidationError(
        "Subnets are required and should be non-empty.",
        this,
      );
    }

    if (props.instanceRequirements) {
      // Validate that allowedInstanceTypes and excludedInstanceTypes are not both specified
      if (
        props.instanceRequirements.allowedInstanceTypes &&
        props.instanceRequirements.allowedInstanceTypes.length > 0 &&
        props.instanceRequirements.excludedInstanceTypes &&
        props.instanceRequirements.excludedInstanceTypes.length > 0
      ) {
        throw new ValidationError(
          "Cannot specify both allowedInstanceTypes and excludedInstanceTypes. Use one or the other.",
          this,
        );
      }

      // Validate that spotMaxPricePercentageOverLowestPrice and onDemandMaxPricePercentageOverLowestPrice are not both specified
      if (
        props.instanceRequirements.spotMaxPricePercentageOverLowestPrice !==
          undefined &&
        props.instanceRequirements.onDemandMaxPricePercentageOverLowestPrice !==
          undefined
      ) {
        throw new ValidationError(
          "Cannot specify both spotMaxPricePercentageOverLowestPrice and onDemandMaxPricePercentageOverLowestPrice. Use one or the other.",
          this,
        );
      }
    }

    // Create or use provided infrastructure role
    const roleId = `${id}Role`;
    const infrastructureRole =
      props.infrastructureRole ??
      new iam.Role(this, roleId, {
        assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            this,
            "AmazonECSInfrastructureRolePolicyForManagedInstances",
            "AmazonECSInfrastructureRolePolicyForManagedInstances",
          ),
        ],
      });

    const stack = AwsStack.ofAwsConstruct(this);

    // Handle capacity provider name generation similar to AsgCapacityProvider
    let capacityProviderName = props.capacityProviderName;
    const capacityProviderNameRegex = /^(?!aws|ecs|fargate).+/gm;
    if (capacityProviderName) {
      if (!capacityProviderNameRegex.test(capacityProviderName)) {
        throw new ValidationError(
          `Invalid Capacity Provider Name: ${capacityProviderName}, If a name is specified, it cannot start with aws, ecs, or fargate.`,
          this,
        );
      }
    } else {
      // TERRACONSTRUCTS DEVIATION: `aws_ecs_capacity_provider`'s `name` is a REQUIRED string
      // on the Terraform provider (unlike CloudFormation, which auto-generates a
      // CFNStackName-CFNResourceName-RandomString physical name when omitted), so a name must
      // always be synthesized here -- not only when the stack name would collide with the
      // reserved `aws|ecs|fargate` prefix rule.
      capacityProviderName = capacityProviderNameRegex.test(stack.node.id)
        ? stack.uniqueResourceName(this.node, {
            maxLength: 255,
            allowedSpecialCharacters: "-_",
          })
        : "cp-" +
          stack.uniqueResourceName(this.node, {
            maxLength: 252,
            allowedSpecialCharacters: "-_",
          });
    }

    // Build the managed instances provider configuration
    const managedInstancesProviderConfig: ecsCapacityProvider.EcsCapacityProviderManagedInstancesProvider =
      {
        infrastructureRoleArn: infrastructureRole.roleArn,
        instanceLaunchTemplate: {
          ec2InstanceProfileArn: props.ec2InstanceProfile.instanceProfileArn,
          networkConfiguration: {
            subnets: props.subnets.map((subnet: ISubnet) => subnet.subnetId),
            ...(props.securityGroups && {
              securityGroups: props.securityGroups.map(
                (sg: ISecurityGroup) => sg.securityGroupId,
              ),
            }),
          },
          ...(props.taskVolumeStorage && {
            storageConfiguration: {
              storageSizeGib: props.taskVolumeStorage.toGibibytes(),
            },
          }),
          ...(props.monitoring && {
            monitoring: props.monitoring,
          }),
          ...(props.instanceRequirements && {
            instanceRequirements: props.instanceRequirements,
          }),
        },
        propagateTags: props.propagateTags,
      };

    // Create the capacity provider
    this.resource = new ecsCapacityProvider.EcsCapacityProvider(this, id, {
      name: capacityProviderName,
      managedInstancesProvider: managedInstancesProviderConfig,
    });

    this.capacityProviderName = this.resource.name;

    this.connections = new Connections({
      securityGroups: props.securityGroups,
    });

    this.node.defaultChild = this.resource;
  }

  /**
   * Associates the capacity provider with the specified cluster.
   * This method is called by the cluster when adding the capacity provider.
   */
  public bind(cluster: ICluster): void {
    this.resource.cluster = cluster.clusterName;
  }
}

/**
 * An Auto Scaling Group Capacity Provider. This allows an ECS cluster to target
 * a specific EC2 Auto Scaling Group for the placement of tasks. Optionally (and
 * recommended), ECS can manage the number of instances in the ASG to fit the
 * tasks, and can ensure that instances are not prematurely terminated while
 * there are still tasks running on them.
 */
export class AsgCapacityProvider extends Construct {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.ecs.AsgCapacityProvider";

  /**
   * Capacity provider name
   * @default Chosen by the Terraform provider
   */
  readonly capacityProviderName: string;

  /**
   * Auto Scaling Group
   */
  readonly autoScalingGroup: autoscaling.AutoScalingGroup;

  /**
   * Auto Scaling Group machineImageType.
   */
  readonly machineImageType: MachineImageType;

  /**
   * Whether managed termination protection is enabled.
   */
  readonly enableManagedTerminationProtection?: boolean;

  /**
   * Whether managed draining is enabled.
   */
  readonly enableManagedDraining?: boolean;

  /**
   * The underlying `aws_ecs_capacity_provider` Terraform resource.
   */
  public readonly resource: ecsCapacityProvider.EcsCapacityProvider;

  constructor(scope: Construct, id: string, props: AsgCapacityProviderProps) {
    super(scope, id);
    let capacityProviderName = props.capacityProviderName;
    this.autoScalingGroup =
      props.autoScalingGroup as autoscaling.AutoScalingGroup;
    this.machineImageType =
      props.machineImageType ?? MachineImageType.AMAZON_LINUX_2;
    this.enableManagedTerminationProtection =
      props.enableManagedTerminationProtection ?? true;
    this.enableManagedDraining = props.enableManagedDraining;

    let managedDraining: string | undefined = undefined;
    if (this.enableManagedDraining != undefined) {
      managedDraining = this.enableManagedDraining ? "ENABLED" : "DISABLED";
    }

    if (
      this.enableManagedTerminationProtection &&
      props.enableManagedScaling === false
    ) {
      throw new ValidationError(
        "Cannot enable Managed Termination Protection on a Capacity Provider when Managed Scaling is disabled. Either enable Managed Scaling or disable Managed Termination Protection.",
        this,
      );
    }
    if (this.enableManagedTerminationProtection) {
      if (this.autoScalingGroup instanceof autoscaling.AutoScalingGroup) {
        this.autoScalingGroup.protectNewInstancesFromScaleIn();
      } else {
        throw new ValidationError(
          "Cannot enable Managed Termination Protection on a Capacity Provider when providing an imported AutoScalingGroup.",
          this,
        );
      }
    }

    const stack = AwsStack.ofAwsConstruct(this);
    const capacityProviderNameRegex = /^(?!aws|ecs|fargate).+/gm;
    if (capacityProviderName) {
      if (!capacityProviderNameRegex.test(capacityProviderName)) {
        throw new ValidationError(
          `Invalid Capacity Provider Name: ${capacityProviderName}, If a name is specified, it cannot start with aws, ecs, or fargate.`,
          this,
        );
      }
    } else {
      // TERRACONSTRUCTS DEVIATION: see `ManagedInstancesCapacityProvider` -- `name` is
      // REQUIRED on the `aws_ecs_capacity_provider` Terraform resource, so a name is always
      // synthesized (not only when the stack name collides with the reserved-word rule).
      capacityProviderName = capacityProviderNameRegex.test(stack.node.id)
        ? stack.uniqueResourceName(this.node, {
            maxLength: 255,
            allowedSpecialCharacters: "-_",
          })
        : "cp-" +
          stack.uniqueResourceName(this.node, {
            maxLength: 252,
            allowedSpecialCharacters: "-_",
          });
    }

    if (
      props.instanceWarmupPeriod &&
      !Token.isUnresolved(props.instanceWarmupPeriod)
    ) {
      if (
        props.instanceWarmupPeriod < 0 ||
        props.instanceWarmupPeriod > 10000
      ) {
        throw new ValidationError(
          `InstanceWarmupPeriod must be between 0 and 10000 inclusive, got: ${props.instanceWarmupPeriod}.`,
          this,
        );
      }
    }

    this.resource = new ecsCapacityProvider.EcsCapacityProvider(this, id, {
      name: capacityProviderName,
      autoScalingGroupProvider: {
        // TERRACONSTRUCTS DEVIATION preserved verbatim from upstream: despite the field name,
        // upstream passes the ASG *name*, not its ARN, to `autoScalingGroupArn`.
        autoScalingGroupArn: this.autoScalingGroup.autoScalingGroupName,
        managedScaling:
          props.enableManagedScaling === false
            ? undefined
            : {
                status: "ENABLED",
                targetCapacity: props.targetCapacityPercent || 100,
                maximumScalingStepSize: props.maximumScalingStepSize,
                minimumScalingStepSize: props.minimumScalingStepSize,
                instanceWarmupPeriod: props.instanceWarmupPeriod,
              },
        managedTerminationProtection: this.enableManagedTerminationProtection
          ? "ENABLED"
          : "DISABLED",
        managedDraining: managedDraining,
      },
    });

    this.capacityProviderName = this.resource.name;
  }
}
