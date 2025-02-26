// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/vpc-endpoint.ts

import { vpcEndpoint } from "@cdktf/provider-aws";
import {
  // TODO: Use Grid as contextProvider
  // ContextProvider,
  // Token,
  Lazy,
} from "cdktf";
import { Construct } from "constructs";
import { Connections, IConnectable } from "./connections";
import { Peer } from "./peer";
import { Port } from "./port";
import { ISecurityGroup, SecurityGroup } from "./security-group";
import { allRouteTableIds, flatten } from "./util";
import { ISubnet, IVpc, SubnetSelection } from "./vpc";
import {
  IAwsConstruct,
  AwsConstructBase,
  AwsConstructProps,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as iam from "../iam";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface VpcEndpointOutputs {
  /**
   * The VPC endpoint identifier.
   * @attribute
   */
  readonly vpcEndpointId: string;
}

/**
 * A VPC endpoint.
 */
export interface IVpcEndpoint extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly vpcEndpointOutputs: VpcEndpointOutputs;

  /**
   * The VPC endpoint identifier.
   * @attribute
   */
  readonly vpcEndpointId: string;
}

export abstract class VpcEndpoint
  extends AwsConstructBase
  implements IVpcEndpoint
{
  public abstract readonly vpcEndpointId: string;
  public get vpcEndpointOutputs(): VpcEndpointOutputs {
    return {
      vpcEndpointId: this.vpcEndpointId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.vpcEndpointOutputs;
  }

  protected policyDocument?: iam.PolicyDocument;

  /**
   * Adds a statement to the policy document of the VPC endpoint. The statement
   * must have a Principal.
   *
   * Not all interface VPC endpoints support policy. For more information
   * see https://docs.aws.amazon.com/vpc/latest/userguide/vpce-interface.html
   *
   * @param statement the IAM statement to add
   */
  public addToPolicy(statement: iam.PolicyStatement) {
    if (!statement.hasPrincipal) {
      throw new Error("Statement must have a `Principal`.");
    }

    if (!this.policyDocument) {
      this.policyDocument = new iam.PolicyDocument(this, "Policy");
    }

    this.policyDocument.addStatements(statement);
  }
}

/**
 * A gateway VPC endpoint.
 */
export interface IGatewayVpcEndpoint extends IVpcEndpoint {}

/**
 * The type of VPC endpoint.
 */
export enum VpcEndpointType {
  /**
   * Interface
   *
   * An interface endpoint is an elastic network interface with a private IP
   * address that serves as an entry point for traffic destined to a supported
   * service.
   */
  INTERFACE = "Interface",

  /**
   * Gateway
   *
   * A gateway endpoint is a gateway that is a target for a specified route in
   * your route table, used for traffic destined to a supported AWS service.
   */
  GATEWAY = "Gateway",

  // TODO: Add GatewayLoadBalancer?
  // - https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/vpc_endpoint#vpc_endpoint_type-1
  // - https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-vpcendpoint.html#cfn-ec2-vpcendpoint-vpcendpointtype
}

/**
 * A service for a gateway VPC endpoint.
 */
export interface IGatewayVpcEndpointService {
  /**
   * The name of the service.
   */
  readonly name: string;
}

/**
 * An AWS service for a gateway VPC endpoint.
 */
export class GatewayVpcEndpointAwsService
  implements IGatewayVpcEndpointService
{
  // https://github.com/aws/aws-cdk/blob/v2.179.0/packages/aws-cdk-lib/aws-ec2/lib/vpc-endpoint.ts#L93
  public static readonly DYNAMODB = new GatewayVpcEndpointAwsService('dynamodb'); // prettier-ignore
  public static readonly S3 = new GatewayVpcEndpointAwsService('s3'); // prettier-ignore
  public static readonly S3_EXPRESS = new GatewayVpcEndpointAwsService('s3express'); // prettier-ignore

  /**
   * The name of the service.
   */
  public readonly name: string;

  /**
   * The short name of the service. e.g. ecs
   */
  public readonly shortName: string;

  constructor(name: string, prefix?: string) {
    // Aws.Region - implemented as a lazy value
    const regionPrefix =
      Lazy.stringValue({
        produce: (context) => AwsStack.ofAwsConstruct(context.scope).region,
      }) + ".";
    this.shortName = name;
    this.name = `${prefix || "com.amazonaws"}.${regionPrefix}${name}`;
  }
}

/**
 * Options to add a gateway endpoint to a VPC.
 */
export interface GatewayVpcEndpointOptions {
  /**
   * The service to use for this gateway VPC endpoint.
   */
  readonly service: IGatewayVpcEndpointService;

  /**
   * Where to add endpoint routing.
   *
   * By default, this endpoint will be routable from all subnets in the VPC.
   * Specify a list of subnet selection objects here to be more specific.
   *
   * @default - All subnets in the VPC
   * @example
   *
   * declare const vpc: compute.Vpc;
   *
   * vpc.addGatewayEndpoint('DynamoDbEndpoint', {
   *   service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
   *   // Add only to ISOLATED subnets
   *   subnets: [
   *     { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
   *   ]
   * });
   *
   *
   */
  readonly subnets?: SubnetSelection[];
}

/**
 * Construction properties for a GatewayVpcEndpoint.
 */
export interface GatewayVpcEndpointProps
  extends GatewayVpcEndpointOptions,
    AwsConstructProps {
  /**
   * The VPC network in which the gateway endpoint will be used.
   */
  readonly vpc: IVpc;
}

/**
 * A gateway VPC endpoint.
 * @resource aws_vpc_endpoint
 */
export class GatewayVpcEndpoint
  extends VpcEndpoint
  implements IGatewayVpcEndpoint
{
  public static fromGatewayVpcEndpointId(
    scope: Construct,
    id: string,
    gatewayVpcEndpointId: string,
  ): IGatewayVpcEndpoint {
    class Import extends VpcEndpoint {
      public vpcEndpointId = gatewayVpcEndpointId;
    }

    return new Import(scope, id);
  }

  /**
   * The gateway VPC endpoint identifier.
   */
  public readonly vpcEndpointId: string;

  // /**
  //  * The date and time the gateway VPC endpoint was created.
  //  * @attribute
  //  */
  // public readonly vpcEndpointCreationTimestamp: string;

  /**
   * @attribute
   */
  public readonly vpcEndpointNetworkInterfaceIds: string[];

  /**
   * @attribute
   */
  public readonly vpcEndpointDnsEntries: vpcEndpoint.VpcEndpointDnsEntryList;

  constructor(scope: Construct, id: string, props: GatewayVpcEndpointProps) {
    super(scope, id, props);

    const subnets: ISubnet[] = props.subnets
      ? flatten(props.subnets.map((s) => props.vpc.selectSubnets(s).subnets))
      : [
          ...props.vpc.privateSubnets,
          ...props.vpc.publicSubnets,
          ...props.vpc.isolatedSubnets,
        ];
    const routeTableIds = allRouteTableIds(subnets);

    if (routeTableIds.length === 0) {
      throw new Error(
        "Can't add a gateway endpoint to VPC; route table IDs are not available",
      );
    }

    const endpoint = new vpcEndpoint.VpcEndpoint(this, "Resource", {
      policy: this.policyDocument?.json,
      routeTableIds,
      serviceName: props.service.name,
      vpcEndpointType: VpcEndpointType.GATEWAY,
      vpcId: props.vpc.vpcId,
    });

    this.vpcEndpointId = endpoint.id;
    // this.vpcEndpointCreationTimestamp = endpoint.attrCreationTimestamp;
    this.vpcEndpointDnsEntries = endpoint.dnsEntry;
    this.vpcEndpointNetworkInterfaceIds = endpoint.networkInterfaceIds;
  }
}

/**
 * A service for an interface VPC endpoint.
 */
export interface IInterfaceVpcEndpointService {
  /**
   * The name of the service.
   */
  readonly name: string;

  /**
   * The port of the service.
   */
  readonly port: number;

  /**
   * Whether Private DNS is supported by default.
   */
  readonly privateDnsDefault?: boolean;
}

/**
 * A custom-hosted service for an interface VPC endpoint.
 */
export class InterfaceVpcEndpointService
  implements IInterfaceVpcEndpointService
{
  /**
   * The name of the service.
   */
  public readonly name: string;

  /**
   * The port of the service.
   */
  public readonly port: number;

  /**
   * Whether Private DNS is supported by default.
   */
  public readonly privateDnsDefault?: boolean = false;

  constructor(name: string, port?: number) {
    this.name = name;
    this.port = port || 443;
  }
}

/**
 * Optional properties for the InterfaceVpcEndpointAwsService class
 */
export interface InterfaceVpcEndpointAwsServiceProps {
  /**
   * If true, the service is a global endpoint and
   * its name will not be prefixed with the stack's region.
   *
   * @default false
   */
  readonly global?: boolean;
}

/**
 * An AWS service for an interface VPC endpoint.
 */
export class InterfaceVpcEndpointAwsService
  implements IInterfaceVpcEndpointService
{
  // TODO: Switch to biome :/
  // see:
  //   - https://github.com/prettier/prettier/issues/5287
  //   - https://github.com/biomejs/biome/issues/4569
  // https://github.com/aws/aws-cdk/blob/v2.179.0/packages/aws-cdk-lib/aws-ec2/lib/vpc-endpoint.ts#L275
  public static readonly ACCESS_ANALYZER = new InterfaceVpcEndpointAwsService('access-analyzer'); // prettier-ignore
  public static readonly ACCOUNT_MANAGEMENT = new InterfaceVpcEndpointAwsService('account'); // prettier-ignore
  public static readonly AIRFLOW_API = new InterfaceVpcEndpointAwsService('airflow.api'); // prettier-ignore
  public static readonly AIRFLOW_API_FIPS = new InterfaceVpcEndpointAwsService('airflow.api-fips'); // prettier-ignore
  public static readonly AIRFLOW_ENV = new InterfaceVpcEndpointAwsService('airflow.env'); // prettier-ignore
  public static readonly AIRFLOW_ENV_FIPS = new InterfaceVpcEndpointAwsService('airflow.env-fips'); // prettier-ignore
  public static readonly AIRFLOW_OPS = new InterfaceVpcEndpointAwsService('airflow.ops'); // prettier-ignore
  public static readonly APIGATEWAY = new InterfaceVpcEndpointAwsService('execute-api'); // prettier-ignore
  /** @deprecated - Use InterfaceVpcEndpointAwsService.APP_MESH_ENVOY_MANAGEMENT instead. */
  public static readonly APP_MESH = new InterfaceVpcEndpointAwsService('appmesh-envoy-management'); // prettier-ignore
  public static readonly APP_MESH_ENVOY_MANAGEMENT = new InterfaceVpcEndpointAwsService('appmesh-envoy-management'); // prettier-ignore
  public static readonly APP_MESH_OPS = new InterfaceVpcEndpointAwsService('appmesh'); // prettier-ignore
  public static readonly APP_RUNNER = new InterfaceVpcEndpointAwsService('apprunner'); // prettier-ignore
  public static readonly APP_RUNNER_REQUESTS = new InterfaceVpcEndpointAwsService('apprunner.requests'); // prettier-ignore
  public static readonly APP_SYNC = new InterfaceVpcEndpointAwsService('appsync-api'); // prettier-ignore
  public static readonly APPCONFIG = new InterfaceVpcEndpointAwsService('appconfig'); // prettier-ignore
  public static readonly APPCONFIGDATA = new InterfaceVpcEndpointAwsService('appconfigdata'); // prettier-ignore
  public static readonly APPLICATION_AUTOSCALING = new InterfaceVpcEndpointAwsService('application-autoscaling'); // prettier-ignore
  public static readonly APPLICATION_DISCOVERY_ARSENAL = new InterfaceVpcEndpointAwsService('arsenal-discovery'); // prettier-ignore
  public static readonly APPLICATION_DISCOVERY_SERVICE = new InterfaceVpcEndpointAwsService('discovery'); // prettier-ignore
  public static readonly APPLICATION_MIGRATION_SERVICE = new InterfaceVpcEndpointAwsService('mgn'); // prettier-ignore
  public static readonly APPSTREAM_API = new InterfaceVpcEndpointAwsService('appstream.api'); // prettier-ignore
  public static readonly APPSTREAM_STREAMING = new InterfaceVpcEndpointAwsService('appstream.streaming'); // prettier-ignore
  public static readonly ATHENA = new InterfaceVpcEndpointAwsService('athena'); // prettier-ignore
  public static readonly AUDIT_MANAGER = new InterfaceVpcEndpointAwsService('auditmanager'); // prettier-ignore
  public static readonly AUTOSCALING = new InterfaceVpcEndpointAwsService('autoscaling'); // prettier-ignore
  public static readonly AUTOSCALING_PLANS = new InterfaceVpcEndpointAwsService('autoscaling-plans'); // prettier-ignore
  public static readonly B2B_DATA_INTERCHANGE = new InterfaceVpcEndpointAwsService('b2bi'); // prettier-ignore
  public static readonly BACKUP = new InterfaceVpcEndpointAwsService('backup'); // prettier-ignore
  public static readonly BACKUP_GATEWAY = new InterfaceVpcEndpointAwsService('backup-gateway'); // prettier-ignore
  public static readonly BATCH = new InterfaceVpcEndpointAwsService('batch'); // prettier-ignore
  public static readonly BEDROCK = new InterfaceVpcEndpointAwsService('bedrock'); // prettier-ignore
  public static readonly BEDROCK_AGENT = new InterfaceVpcEndpointAwsService('bedrock-agent'); // prettier-ignore
  public static readonly BEDROCK_AGENT_RUNTIME = new InterfaceVpcEndpointAwsService('bedrock-agent-runtime'); // prettier-ignore
  public static readonly BEDROCK_RUNTIME = new InterfaceVpcEndpointAwsService('bedrock-runtime'); // prettier-ignore
  public static readonly BILLING = new InterfaceVpcEndpointAwsService('billing'); // prettier-ignore
  public static readonly BILLING_AND_COST_MANAGEMENT_FREETIER = new InterfaceVpcEndpointAwsService('freetier', 'aws.api'); // prettier-ignore
  public static readonly BILLING_AND_COST_MANAGEMENT_TAX = new InterfaceVpcEndpointAwsService('tax'); // prettier-ignore
  public static readonly BILLING_CONDUCTOR = new InterfaceVpcEndpointAwsService('billingconductor'); // prettier-ignore
  public static readonly BRAKET = new InterfaceVpcEndpointAwsService('braket'); // prettier-ignore
  public static readonly CLEAN_ROOMS = new InterfaceVpcEndpointAwsService('cleanrooms'); // prettier-ignore
  public static readonly CLEAN_ROOMS_ML = new InterfaceVpcEndpointAwsService('cleanrooms-ml'); // prettier-ignore
  public static readonly CLOUD_CONTROL_API = new InterfaceVpcEndpointAwsService('cloudcontrolapi'); // prettier-ignore
  public static readonly CLOUD_CONTROL_API_FIPS = new InterfaceVpcEndpointAwsService('cloudcontrolapi-fips'); // prettier-ignore
  public static readonly CLOUD_DIRECTORY = new InterfaceVpcEndpointAwsService('clouddirectory'); // prettier-ignore
  public static readonly CLOUD_MAP_DATA_SERVICE_DISCOVERY = new InterfaceVpcEndpointAwsService('data-servicediscovery'); // prettier-ignore
  public static readonly CLOUD_MAP_DATA_SERVICE_DISCOVERY_FIPS = new InterfaceVpcEndpointAwsService('data-servicediscovery-fips'); // prettier-ignore
  public static readonly CLOUD_MAP_SERVICE_DISCOVERY = new InterfaceVpcEndpointAwsService('servicediscovery'); // prettier-ignore
  public static readonly CLOUD_MAP_SERVICE_DISCOVERY_FIPS = new InterfaceVpcEndpointAwsService('servicediscovery-fips'); // prettier-ignore
  public static readonly CLOUDFORMATION = new InterfaceVpcEndpointAwsService('cloudformation'); // prettier-ignore
  public static readonly CLOUDHSM = new InterfaceVpcEndpointAwsService('cloudhsmv2'); // prettier-ignore
  public static readonly CLOUDTRAIL = new InterfaceVpcEndpointAwsService('cloudtrail'); // prettier-ignore
  /** @deprecated Use InterfaceVpcEndpointAwsService.Q_DEVELOPER_CODE_WHISPERER instead.*/
  public static readonly CODEWHISPERER = new InterfaceVpcEndpointAwsService('codewhisperer'); // prettier-ignore
  /** @deprecated - Use InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING instead. */
  public static readonly CLOUDWATCH = new InterfaceVpcEndpointAwsService('monitoring'); // prettier-ignore
  public static readonly CLOUDWATCH_APPLICATION_INSIGHTS = new InterfaceVpcEndpointAwsService('applicationinsights'); // prettier-ignore
  public static readonly CLOUDWATCH_APPLICATION_SIGNALS = new InterfaceVpcEndpointAwsService('application-signals'); // prettier-ignore
  /** @deprecated - Use InterfaceVpcEndpointAwsService.EVENTBRIDGE instead. */
  public static readonly CLOUDWATCH_EVENTS = new InterfaceVpcEndpointAwsService('events'); // prettier-ignore
  public static readonly CLOUDWATCH_EVIDENTLY = new InterfaceVpcEndpointAwsService('evidently'); // prettier-ignore
  public static readonly CLOUDWATCH_EVIDENTLY_DATAPLANE = new InterfaceVpcEndpointAwsService('evidently-dataplane'); // prettier-ignore
  public static readonly CLOUDWATCH_LOGS = new InterfaceVpcEndpointAwsService('logs'); // prettier-ignore
  public static readonly CLOUDWATCH_MONITORING = new InterfaceVpcEndpointAwsService('monitoring'); // prettier-ignore
  public static readonly CLOUDWATCH_NETWORK_MONITOR = new InterfaceVpcEndpointAwsService('networkmonitor'); // prettier-ignore
  public static readonly CLOUDWATCH_RUM = new InterfaceVpcEndpointAwsService('rum'); // prettier-ignore
  public static readonly CLOUDWATCH_RUM_DATAPLANE = new InterfaceVpcEndpointAwsService('rum-dataplane'); // prettier-ignore
  public static readonly CLOUDWATCH_SYNTHETICS = new InterfaceVpcEndpointAwsService('synthetics'); // prettier-ignore
  public static readonly CLOUDWATCH_SYNTHETICS_FIPS = new InterfaceVpcEndpointAwsService('synthetics-fips'); // prettier-ignore
  public static readonly CODEARTIFACT_API = new InterfaceVpcEndpointAwsService('codeartifact.api'); // prettier-ignore
  public static readonly CODEARTIFACT_REPOSITORIES = new InterfaceVpcEndpointAwsService('codeartifact.repositories'); // prettier-ignore
  public static readonly CODEBUILD = new InterfaceVpcEndpointAwsService('codebuild'); // prettier-ignore
  public static readonly CODEBUILD_FIPS = new InterfaceVpcEndpointAwsService('codebuild-fips'); // prettier-ignore
  public static readonly CODECATALYST = new InterfaceVpcEndpointAwsService('codecatalyst', 'aws.api.global', undefined, { global: true }); // prettier-ignore
  public static readonly CODECATALYST_GIT = new InterfaceVpcEndpointAwsService('codecatalyst.git'); // prettier-ignore
  public static readonly CODECATALYST_PACKAGES = new InterfaceVpcEndpointAwsService('codecatalyst.packages'); // prettier-ignore
  public static readonly CODECOMMIT = new InterfaceVpcEndpointAwsService('codecommit'); // prettier-ignore
  public static readonly CODECOMMIT_FIPS = new InterfaceVpcEndpointAwsService('codecommit-fips'); // prettier-ignore
  public static readonly CODEDEPLOY = new InterfaceVpcEndpointAwsService('codedeploy'); // prettier-ignore
  public static readonly CODEDEPLOY_COMMANDS_SECURE = new InterfaceVpcEndpointAwsService('codedeploy-commands-secure'); // prettier-ignore
  public static readonly CODEGURU_PROFILER = new InterfaceVpcEndpointAwsService('codeguru-profiler'); // prettier-ignore
  public static readonly CODEGURU_REVIEWER = new InterfaceVpcEndpointAwsService('codeguru-reviewer'); // prettier-ignore
  public static readonly CODEPIPELINE = new InterfaceVpcEndpointAwsService('codepipeline'); // prettier-ignore
  public static readonly CODESTAR_CONNECTIONS = new InterfaceVpcEndpointAwsService('codestar-connections.api'); // prettier-ignore
  public static readonly CODE_CONNECTIONS = new InterfaceVpcEndpointAwsService('codeconnections.api'); // prettier-ignore
  public static readonly COMPREHEND = new InterfaceVpcEndpointAwsService('comprehend'); // prettier-ignore
  public static readonly COMPREHEND_MEDICAL = new InterfaceVpcEndpointAwsService('comprehendmedical'); // prettier-ignore
  public static readonly COMPUTE_OPTIMIZER = new InterfaceVpcEndpointAwsService('compute-optimizer'); // prettier-ignore
  public static readonly CONFIG = new InterfaceVpcEndpointAwsService('config'); // prettier-ignore
  public static readonly CONNECT_APP_INTEGRATIONS = new InterfaceVpcEndpointAwsService('app-integrations'); // prettier-ignore
  public static readonly CONNECT_CASES = new InterfaceVpcEndpointAwsService('cases'); // prettier-ignore
  public static readonly CONNECT_CONNECT_CAMPAIGNS = new InterfaceVpcEndpointAwsService('connect-campaigns'); // prettier-ignore
  public static readonly CONNECT_PROFILE = new InterfaceVpcEndpointAwsService('profile'); // prettier-ignore
  public static readonly CONNECT_VOICEID = new InterfaceVpcEndpointAwsService('voiceid'); // prettier-ignore
  public static readonly CONNECT_WISDOM = new InterfaceVpcEndpointAwsService('wisdom'); // prettier-ignore
  public static readonly CONTROL_CATALOG = new InterfaceVpcEndpointAwsService('controlcatalog'); // prettier-ignore
  public static readonly COST_EXPLORER = new InterfaceVpcEndpointAwsService('ce'); // prettier-ignore
  public static readonly COST_OPTIMIZATION_HUB = new InterfaceVpcEndpointAwsService('cost-optimization-hub'); // prettier-ignore
  public static readonly DATA_EXCHANGE = new InterfaceVpcEndpointAwsService('dataexchange'); // prettier-ignore
  public static readonly DATA_EXPORTS = new InterfaceVpcEndpointAwsService('bcm-data-exports', 'aws.api'); // prettier-ignore
  public static readonly DATASYNC = new InterfaceVpcEndpointAwsService('datasync'); // prettier-ignore
  public static readonly DATAZONE = new InterfaceVpcEndpointAwsService('datazone'); // prettier-ignore
  public static readonly DATABASE_MIGRATION_SERVICE = new InterfaceVpcEndpointAwsService('dms'); // prettier-ignore
  public static readonly DATABASE_MIGRATION_SERVICE_FIPS = new InterfaceVpcEndpointAwsService('dms-fips'); // prettier-ignore
  public static readonly DEADLINE_CLOUD_MANAGEMENT = new InterfaceVpcEndpointAwsService('deadline.management'); // prettier-ignore
  public static readonly DEADLINE_CLOUD_SCHEDULING = new InterfaceVpcEndpointAwsService('deadline.scheduling'); // prettier-ignore
  public static readonly DEVOPS_GURU = new InterfaceVpcEndpointAwsService('devops-guru'); // prettier-ignore
  public static readonly DIRECTORY_SERVICE = new InterfaceVpcEndpointAwsService('ds'); // prettier-ignore
  public static readonly DIRECTORY_SERVICE_DATA = new InterfaceVpcEndpointAwsService('ds-data'); // prettier-ignore
  public static readonly DYNAMODB = new InterfaceVpcEndpointAwsService('dynamodb'); // prettier-ignore
  public static readonly DYNAMODB_FIPS = new InterfaceVpcEndpointAwsService('dynamodb-fips'); // prettier-ignore
  public static readonly EBS_DIRECT = new InterfaceVpcEndpointAwsService('ebs'); // prettier-ignore
  public static readonly EC2 = new InterfaceVpcEndpointAwsService('ec2'); // prettier-ignore
  public static readonly EC2_MESSAGES = new InterfaceVpcEndpointAwsService('ec2messages'); // prettier-ignore
  public static readonly ECR = new InterfaceVpcEndpointAwsService('ecr.api'); // prettier-ignore
  public static readonly ECR_DOCKER = new InterfaceVpcEndpointAwsService('ecr.dkr'); // prettier-ignore
  public static readonly ECS = new InterfaceVpcEndpointAwsService('ecs'); // prettier-ignore
  public static readonly ECS_AGENT = new InterfaceVpcEndpointAwsService('ecs-agent'); // prettier-ignore
  public static readonly ECS_TELEMETRY = new InterfaceVpcEndpointAwsService('ecs-telemetry'); // prettier-ignore
  public static readonly EKS = new InterfaceVpcEndpointAwsService('eks'); // prettier-ignore
  public static readonly EKS_AUTH = new InterfaceVpcEndpointAwsService('eks-auth'); // prettier-ignore
  public static readonly ELASTIC_BEANSTALK = new InterfaceVpcEndpointAwsService('elasticbeanstalk'); // prettier-ignore
  public static readonly ELASTIC_BEANSTALK_HEALTH = new InterfaceVpcEndpointAwsService('elasticbeanstalk-health'); // prettier-ignore
  public static readonly ELASTIC_DISASTER_RECOVERY = new InterfaceVpcEndpointAwsService('drs'); // prettier-ignore
  public static readonly ELASTIC_FILESYSTEM = new InterfaceVpcEndpointAwsService('elasticfilesystem'); // prettier-ignore
  public static readonly ELASTIC_FILESYSTEM_FIPS = new InterfaceVpcEndpointAwsService('elasticfilesystem-fips'); // prettier-ignore
  public static readonly ELASTIC_INFERENCE_RUNTIME = new InterfaceVpcEndpointAwsService('elastic-inference.runtime'); // prettier-ignore
  public static readonly ELASTIC_LOAD_BALANCING = new InterfaceVpcEndpointAwsService('elasticloadbalancing'); // prettier-ignore
  public static readonly ELASTICACHE = new InterfaceVpcEndpointAwsService('elasticache'); // prettier-ignore
  public static readonly ELASTICACHE_FIPS = new InterfaceVpcEndpointAwsService('elasticache-fips'); // prettier-ignore
  public static readonly ELEMENTAL_MEDIACONNECT = new InterfaceVpcEndpointAwsService('mediaconnect'); // prettier-ignore
  public static readonly EMAIL_SMTP = new InterfaceVpcEndpointAwsService('email-smtp'); // prettier-ignore
  public static readonly EMR = new InterfaceVpcEndpointAwsService('elasticmapreduce'); // prettier-ignore
  public static readonly EMR_EKS = new InterfaceVpcEndpointAwsService('emr-containers'); // prettier-ignore
  public static readonly EMR_SERVERLESS = new InterfaceVpcEndpointAwsService('emr-serverless'); // prettier-ignore
  public static readonly EMR_SERVERLESS_LIVY = new InterfaceVpcEndpointAwsService('emr-serverless-services.livy'); // prettier-ignore
  public static readonly EMR_WAL = new InterfaceVpcEndpointAwsService('emrwal.prod'); // prettier-ignore
  public static readonly END_USER_MESSAGING_SOCIAL = new InterfaceVpcEndpointAwsService('social-messaging'); // prettier-ignore
  public static readonly ENTITY_RESOLUTION = new InterfaceVpcEndpointAwsService('entityresolution'); // prettier-ignore
  public static readonly EVENTBRIDGE = new InterfaceVpcEndpointAwsService('events'); // prettier-ignore
  public static readonly EVENTBRIDGE_SCHEMA_REGISTRY = new InterfaceVpcEndpointAwsService('schemas'); // prettier-ignore
  public static readonly FAULT_INJECTION_SIMULATOR = new InterfaceVpcEndpointAwsService('fis'); // prettier-ignore
  public static readonly FINSPACE = new InterfaceVpcEndpointAwsService('finspace'); // prettier-ignore
  public static readonly FINSPACE_API = new InterfaceVpcEndpointAwsService('finspace-api'); // prettier-ignore
  public static readonly FORECAST = new InterfaceVpcEndpointAwsService('forecast'); // prettier-ignore
  public static readonly FORECAST_QUERY = new InterfaceVpcEndpointAwsService('forecastquery'); // prettier-ignore
  public static readonly FORECAST_FIPS = new InterfaceVpcEndpointAwsService('forecast-fips'); // prettier-ignore
  public static readonly FORECAST_QUERY_FIPS = new InterfaceVpcEndpointAwsService('forecastquery-fips'); // prettier-ignore
  public static readonly FRAUD_DETECTOR = new InterfaceVpcEndpointAwsService('frauddetector'); // prettier-ignore
  public static readonly FSX = new InterfaceVpcEndpointAwsService('fsx'); // prettier-ignore
  public static readonly FSX_FIPS = new InterfaceVpcEndpointAwsService('fsx-fips'); // prettier-ignore
  public static readonly CODECOMMIT_GIT = new InterfaceVpcEndpointAwsService('git-codecommit'); // prettier-ignore
  public static readonly CODECOMMIT_GIT_FIPS = new InterfaceVpcEndpointAwsService('git-codecommit-fips'); // prettier-ignore
  public static readonly GLUE = new InterfaceVpcEndpointAwsService('glue'); // prettier-ignore
  public static readonly GLUE_DATABREW = new InterfaceVpcEndpointAwsService('databrew'); // prettier-ignore
  public static readonly GLUE_DASHBOARD = new InterfaceVpcEndpointAwsService('glue.dashboard'); // prettier-ignore
  public static readonly GRAFANA = new InterfaceVpcEndpointAwsService('grafana'); // prettier-ignore
  public static readonly GRAFANA_WORKSPACE = new InterfaceVpcEndpointAwsService('grafana-workspace'); // prettier-ignore
  public static readonly GROUNDSTATION = new InterfaceVpcEndpointAwsService('groundstation'); // prettier-ignore
  public static readonly GUARDDUTY = new InterfaceVpcEndpointAwsService('guardduty'); // prettier-ignore
  public static readonly GUARDDUTY_FIPS = new InterfaceVpcEndpointAwsService('guardduty-fips'); // prettier-ignore
  public static readonly GUARDDUTY_DATA = new InterfaceVpcEndpointAwsService('guardduty-data'); // prettier-ignore
  public static readonly GUARDDUTY_DATA_FIPS = new InterfaceVpcEndpointAwsService('guardduty-data-fips'); // prettier-ignore
  public static readonly HEALTH_IMAGING = new InterfaceVpcEndpointAwsService('medical-imaging'); // prettier-ignore
  public static readonly HEALTH_IMAGING_RUNTIME = new InterfaceVpcEndpointAwsService('runtime-medical-imaging'); // prettier-ignore
  public static readonly HEALTH_IMAGING_DICOM = new InterfaceVpcEndpointAwsService('dicom-medical-imaging'); // prettier-ignore
  public static readonly HEALTHLAKE = new InterfaceVpcEndpointAwsService('healthlake'); // prettier-ignore
  public static readonly IAM = new InterfaceVpcEndpointAwsService('iam', 'com.amazonaws', undefined, { global: true }); // prettier-ignore
  public static readonly IAM_IDENTITY_CENTER = new InterfaceVpcEndpointAwsService('identitystore'); // prettier-ignore
  public static readonly IAM_ROLES_ANYWHERE = new InterfaceVpcEndpointAwsService('rolesanywhere'); // prettier-ignore
  public static readonly IMAGE_BUILDER = new InterfaceVpcEndpointAwsService('imagebuilder'); // prettier-ignore
  public static readonly INSPECTOR = new InterfaceVpcEndpointAwsService('inspector2'); // prettier-ignore
  public static readonly INSPECTOR_SCAN = new InterfaceVpcEndpointAwsService('inspector-scan'); // prettier-ignore
  public static readonly INTERNET_MONITOR = new InterfaceVpcEndpointAwsService('internetmonitor'); // prettier-ignore
  public static readonly INTERNET_MONITOR_FIPS = new InterfaceVpcEndpointAwsService('internetmonitor-fips'); // prettier-ignore
  public static readonly INVOICING = new InterfaceVpcEndpointAwsService('invoicing'); // prettier-ignore
  public static readonly IOT_CORE = new InterfaceVpcEndpointAwsService('iot.data'); // prettier-ignore
  public static readonly IOT_CORE_CREDENTIALS = new InterfaceVpcEndpointAwsService('iot.credentials'); // prettier-ignore
  public static readonly IOT_CORE_DEVICE_ADVISOR = new InterfaceVpcEndpointAwsService('deviceadvisor.iot'); // prettier-ignore
  public static readonly IOT_CORE_FLEETHUB_API = new InterfaceVpcEndpointAwsService('iot.fleethub.api'); // prettier-ignore
  public static readonly IOT_CORE_FOR_LORAWAN = new InterfaceVpcEndpointAwsService('iotwireless.api'); // prettier-ignore
  public static readonly IOT_FLEETWISE = new InterfaceVpcEndpointAwsService('iotfleetwise'); // prettier-ignore
  public static readonly IOT_LORAWAN_CUPS = new InterfaceVpcEndpointAwsService('lorawan.cups'); // prettier-ignore
  public static readonly IOT_LORAWAN_LNS = new InterfaceVpcEndpointAwsService('lorawan.lns'); // prettier-ignore
  public static readonly IOT_GREENGRASS = new InterfaceVpcEndpointAwsService('greengrass'); // prettier-ignore
  public static readonly IOT_ROBORUNNER = new InterfaceVpcEndpointAwsService('iotroborunner'); // prettier-ignore
  public static readonly IOT_SITEWISE_API = new InterfaceVpcEndpointAwsService('iotsitewise.api'); // prettier-ignore
  public static readonly IOT_SITEWISE_DATA = new InterfaceVpcEndpointAwsService('iotsitewise.data'); // prettier-ignore
  public static readonly IOT_TWINMAKER_API = new InterfaceVpcEndpointAwsService('iottwinmaker.api'); // prettier-ignore
  public static readonly IOT_TWINMAKER_DATA = new InterfaceVpcEndpointAwsService('iottwinmaker.data'); // prettier-ignore
  public static readonly KAFKA = new InterfaceVpcEndpointAwsService('kafka'); // prettier-ignore
  public static readonly KAFKA_FIPS = new InterfaceVpcEndpointAwsService('kafka-fips'); // prettier-ignore
  public static readonly KAFKA_CONNECT = new InterfaceVpcEndpointAwsService('kafkaconnect'); // prettier-ignore
  public static readonly KENDRA = new InterfaceVpcEndpointAwsService('kendra'); // prettier-ignore
  public static readonly KENDRA_RANKING = new InterfaceVpcEndpointAwsService('kendra-ranking', 'aws.api'); // prettier-ignore
  public static readonly KEYSPACES = new InterfaceVpcEndpointAwsService('cassandra', '', 9142); // prettier-ignore
  public static readonly KEYSPACES_FIPS = new InterfaceVpcEndpointAwsService('cassandra-fips', '', 9142); // prettier-ignore
  public static readonly KINESIS_STREAMS = new InterfaceVpcEndpointAwsService('kinesis-streams'); // prettier-ignore
  public static readonly KINESIS_STREAMS_FIPS = new InterfaceVpcEndpointAwsService('kinesis-streams-fips'); // prettier-ignore
  public static readonly KINESIS_FIREHOSE = new InterfaceVpcEndpointAwsService('kinesis-firehose'); // prettier-ignore
  public static readonly KMS = new InterfaceVpcEndpointAwsService('kms'); // prettier-ignore
  public static readonly KMS_FIPS = new InterfaceVpcEndpointAwsService('kms-fips'); // prettier-ignore
  public static readonly LAKE_FORMATION = new InterfaceVpcEndpointAwsService('lakeformation'); // prettier-ignore
  public static readonly LAUNCH_WIZARD = new InterfaceVpcEndpointAwsService('launchwizard'); // prettier-ignore
  public static readonly LAMBDA = new InterfaceVpcEndpointAwsService('lambda'); // prettier-ignore
  public static readonly LEX_MODELS = new InterfaceVpcEndpointAwsService('models-v2-lex'); // prettier-ignore
  public static readonly LEX_RUNTIME = new InterfaceVpcEndpointAwsService('runtime-v2-lex'); // prettier-ignore
  public static readonly LICENSE_MANAGER = new InterfaceVpcEndpointAwsService('license-manager'); // prettier-ignore
  public static readonly LICENSE_MANAGER_FIPS = new InterfaceVpcEndpointAwsService('license-manager-fips'); // prettier-ignore
  public static readonly LICENSE_MANAGER_LINUX_SUBSCRIPTIONS = new InterfaceVpcEndpointAwsService('license-manager-linux-subscriptions'); // prettier-ignore
  public static readonly LICENSE_MANAGER_LINUX_SUBSCRIPTIONS_FIPS = new InterfaceVpcEndpointAwsService('license-manager-linux-subscriptions-fips'); // prettier-ignore
  public static readonly LICENSE_MANAGER_USER_SUBSCRIPTIONS = new InterfaceVpcEndpointAwsService('license-manager-user-subscriptions'); // prettier-ignore
  public static readonly LOOKOUT_EQUIPMENT = new InterfaceVpcEndpointAwsService('lookoutequipment'); // prettier-ignore
  public static readonly LOOKOUT_METRICS = new InterfaceVpcEndpointAwsService('lookoutmetrics'); // prettier-ignore
  public static readonly LOOKOUT_VISION = new InterfaceVpcEndpointAwsService('lookoutvision'); // prettier-ignore
  public static readonly MAINFRAME_MODERNIZATION = new InterfaceVpcEndpointAwsService('m2'); // prettier-ignore
  public static readonly MAINFRAME_MODERNIZATION_APP_TEST = new InterfaceVpcEndpointAwsService('apptest'); // prettier-ignore
  public static readonly MACIE = new InterfaceVpcEndpointAwsService('macie2'); // prettier-ignore
  public static readonly MANAGEMENT_CONSOLE = new InterfaceVpcEndpointAwsService('console'); // prettier-ignore
  public static readonly MANAGEMENT_CONSOLE_SIGNIN = new InterfaceVpcEndpointAwsService('signin'); // prettier-ignore
  public static readonly MANAGED_BLOCKCHAIN_QUERY = new InterfaceVpcEndpointAwsService('managedblockchain-query'); // prettier-ignore
  public static readonly MANAGED_BLOCKCHAIN_BITCOIN_MAINNET = new InterfaceVpcEndpointAwsService('managedblockchain.bitcoin.mainnet'); // prettier-ignore
  public static readonly MANAGED_BLOCKCHAIN_BITCOIN_TESTNET = new InterfaceVpcEndpointAwsService('managedblockchain.bitcoin.testnet'); // prettier-ignore
  public static readonly MEMORY_DB = new InterfaceVpcEndpointAwsService('memory-db'); // prettier-ignore
  public static readonly MEMORY_DB_FIPS = new InterfaceVpcEndpointAwsService('memorydb-fips'); // prettier-ignore
  public static readonly MIGRATIONHUB_ORCHESTRATOR = new InterfaceVpcEndpointAwsService('migrationhub-orchestrator'); // prettier-ignore
  public static readonly MIGRATIONHUB_REFACTOR_SPACES = new InterfaceVpcEndpointAwsService('refactor-spaces'); // prettier-ignore
  public static readonly MIGRATIONHUB_STRATEGY = new InterfaceVpcEndpointAwsService('migrationhub-strategy'); // prettier-ignore
  public static readonly MQ = new InterfaceVpcEndpointAwsService('mq'); // prettier-ignore
  public static readonly NEPTUNE_ANALYTICS = new InterfaceVpcEndpointAwsService('neptune-graph'); // prettier-ignore
  public static readonly NEPTUNE_ANALYTICS_DATA = new InterfaceVpcEndpointAwsService('neptune-graph-data'); // prettier-ignore
  public static readonly NEPTUNE_ANALYTICS_FIPS = new InterfaceVpcEndpointAwsService('neptune-graph-fips'); // prettier-ignore
  public static readonly NETWORK_FIREWALL = new InterfaceVpcEndpointAwsService('network-firewall'); // prettier-ignore
  public static readonly NETWORK_FIREWALL_FIPS = new InterfaceVpcEndpointAwsService('network-firewall-fips'); // prettier-ignore
  public static readonly NETWORK_FLOW_MONITOR = new InterfaceVpcEndpointAwsService('networkflowmonitor'); // prettier-ignore
  public static readonly NETWORK_FLOW_MONITOR_REPORTS = new InterfaceVpcEndpointAwsService('networkflowmonitorreports'); // prettier-ignore
  public static readonly NIMBLE_STUDIO = new InterfaceVpcEndpointAwsService('nimble'); // prettier-ignore
  public static readonly OBSERVABILITY_ADMIN = new InterfaceVpcEndpointAwsService('observabilityadmin'); // prettier-ignore
  public static readonly OUTPOSTS = new InterfaceVpcEndpointAwsService('outposts'); // prettier-ignore
  public static readonly ORGANIZATIONS = new InterfaceVpcEndpointAwsService('organizations'); // prettier-ignore
  public static readonly ORGANIZATIONS_FIPS = new InterfaceVpcEndpointAwsService('organizations-fips'); // prettier-ignore
  public static readonly OMICS_ANALYTICS = new InterfaceVpcEndpointAwsService('analytics-omics'); // prettier-ignore
  public static readonly OMICS_CONTROL_STORAGE = new InterfaceVpcEndpointAwsService('control-storage-omics'); // prettier-ignore
  public static readonly OMICS_STORAGE = new InterfaceVpcEndpointAwsService('storage-omics'); // prettier-ignore
  public static readonly OMICS_TAGS = new InterfaceVpcEndpointAwsService('tags-omics'); // prettier-ignore
  public static readonly OMICS_WORKFLOWS = new InterfaceVpcEndpointAwsService('workflows-omics'); // prettier-ignore
  public static readonly PANORAMA = new InterfaceVpcEndpointAwsService('panorama'); // prettier-ignore
  public static readonly PARALLEL_COMPUTING_SERVICE = new InterfaceVpcEndpointAwsService('pcs'); // prettier-ignore
  public static readonly PARALLEL_COMPUTING_SERVICE_FIPS = new InterfaceVpcEndpointAwsService('pcs-fips'); // prettier-ignore
  public static readonly PAYMENT_CRYPTOGRAPHY_CONTROLPLANE = new InterfaceVpcEndpointAwsService('payment-cryptography.controlplane'); // prettier-ignore
  public static readonly PAYMENT_CRYPTOGRAPHY_DATAPLANE = new InterfaceVpcEndpointAwsService('payment-cryptography.dataplane'); // prettier-ignore
  public static readonly PERSONALIZE = new InterfaceVpcEndpointAwsService('personalize'); // prettier-ignore
  public static readonly PERSONALIZE_EVENTS = new InterfaceVpcEndpointAwsService('personalize-events'); // prettier-ignore
  public static readonly PERSONALIZE_RUNTIME = new InterfaceVpcEndpointAwsService('personalize-runtime'); // prettier-ignore
  public static readonly PINPOINT_V1 = new InterfaceVpcEndpointAwsService('pinpoint'); // prettier-ignore
  /** @deprecated - Use InterfaceVpcEndpointAwsService.PINPOINT_SMS_VOICE_V2 instead. */
  public static readonly PINPOINT = new InterfaceVpcEndpointAwsService('pinpoint-sms-voice-v2'); // prettier-ignore
  public static readonly PINPOINT_SMS_VOICE_V2 = new InterfaceVpcEndpointAwsService('pinpoint-sms-voice-v2'); // prettier-ignore
  public static readonly PIPES = new InterfaceVpcEndpointAwsService('pipes'); // prettier-ignore
  public static readonly PIPES_DATA = new InterfaceVpcEndpointAwsService('pipes-data'); // prettier-ignore
  public static readonly PIPES_FIPS = new InterfaceVpcEndpointAwsService('pipes-fips'); // prettier-ignore
  public static readonly PRICE_LIST = new InterfaceVpcEndpointAwsService('pricing.api'); // prettier-ignore
  public static readonly PRICING_CALCULATOR = new InterfaceVpcEndpointAwsService('bcm-pricing-calculator'); // prettier-ignore
  public static readonly POLLY = new InterfaceVpcEndpointAwsService('polly'); // prettier-ignore
  public static readonly PRIVATE_5G = new InterfaceVpcEndpointAwsService('private-networks'); // prettier-ignore
  public static readonly PRIVATE_CERTIFICATE_AUTHORITY = new InterfaceVpcEndpointAwsService('acm-pca'); // prettier-ignore
  public static readonly PRIVATE_CERTIFICATE_AUTHORITY_CONNECTOR_AD = new InterfaceVpcEndpointAwsService('pca-connector-ad'); // prettier-ignore
  public static readonly PRIVATE_CERTIFICATE_AUTHORITY_CONNECTOR_SCEP = new InterfaceVpcEndpointAwsService('pca-connector-scep'); // prettier-ignore
  public static readonly PROMETHEUS = new InterfaceVpcEndpointAwsService('aps'); // prettier-ignore
  public static readonly PROMETHEUS_WORKSPACES = new InterfaceVpcEndpointAwsService('aps-workspaces'); // prettier-ignore
  public static readonly PROTON = new InterfaceVpcEndpointAwsService('proton'); // prettier-ignore
  public static readonly Q_BUSSINESS = new InterfaceVpcEndpointAwsService('qbusiness', 'aws.api'); // prettier-ignore
  public static readonly Q_DEVELOPER = new InterfaceVpcEndpointAwsService('q'); // prettier-ignore
  public static readonly Q_DEVELOPER_CODE_WHISPERER = new InterfaceVpcEndpointAwsService('codewhisperer'); // prettier-ignore
  public static readonly Q_DEVELOPER_QAPPS = new InterfaceVpcEndpointAwsService('qapps'); // prettier-ignore
  public static readonly Q_USER_SUBSCRIPTIONS = new InterfaceVpcEndpointAwsService('service.user-subscriptions'); // prettier-ignore
  public static readonly QLDB = new InterfaceVpcEndpointAwsService('qldb.session'); // prettier-ignore
  public static readonly QUICKSIGHT_WEBSITE = new InterfaceVpcEndpointAwsService('quicksight-website'); // prettier-ignore
  public static readonly RDS = new InterfaceVpcEndpointAwsService('rds'); // prettier-ignore
  public static readonly RDS_DATA = new InterfaceVpcEndpointAwsService('rds-data'); // prettier-ignore
  public static readonly RDS_PERFORMANCE_INSIGHTS = new InterfaceVpcEndpointAwsService('pi'); // prettier-ignore
  public static readonly RDS_PERFORMANCE_INSIGHTS_FIPS = new InterfaceVpcEndpointAwsService('pi-fips'); // prettier-ignore
  public static readonly REDSHIFT = new InterfaceVpcEndpointAwsService('redshift'); // prettier-ignore
  public static readonly REDSHIFT_FIPS = new InterfaceVpcEndpointAwsService('redshift-fips'); // prettier-ignore
  public static readonly REDSHIFT_DATA = new InterfaceVpcEndpointAwsService('redshift-data'); // prettier-ignore
  public static readonly REDSHIFT_DATA_FIPS = new InterfaceVpcEndpointAwsService('redshift-data-fips'); // prettier-ignore
  public static readonly REDSHIFT_SERVERLESS = new InterfaceVpcEndpointAwsService('redshift-serverless'); // prettier-ignore
  public static readonly REDSHIFT_SERVERLESS_FIPS = new InterfaceVpcEndpointAwsService('redshift-serverless-fips'); // prettier-ignore
  public static readonly REKOGNITION = new InterfaceVpcEndpointAwsService('rekognition'); // prettier-ignore
  public static readonly REKOGNITION_FIPS = new InterfaceVpcEndpointAwsService('rekognition-fips'); // prettier-ignore
  public static readonly REKOGNITION_STREAMING = new InterfaceVpcEndpointAwsService('streaming-rekognition'); // prettier-ignore
  public static readonly REKOGNITION_STREAMING_FIPS = new InterfaceVpcEndpointAwsService('streaming-rekognition-fips'); // prettier-ignore
  public static readonly REPOST_SPACE = new InterfaceVpcEndpointAwsService('repostspace'); // prettier-ignore
  public static readonly RESOURCE_ACCESS_MANAGER = new InterfaceVpcEndpointAwsService('ram'); // prettier-ignore
  public static readonly RESOURCE_GROUPS = new InterfaceVpcEndpointAwsService('resource-groups'); // prettier-ignore
  public static readonly RESOURCE_GROUPS_FIPS = new InterfaceVpcEndpointAwsService('resource-groups-fips'); // prettier-ignore
  public static readonly ROBOMAKER = new InterfaceVpcEndpointAwsService('robomaker'); // prettier-ignore
  public static readonly RECYCLE_BIN = new InterfaceVpcEndpointAwsService('rbin'); // prettier-ignore
  public static readonly S3 = new InterfaceVpcEndpointAwsService('s3'); // prettier-ignore
  public static readonly S3_OUTPOSTS = new InterfaceVpcEndpointAwsService('s3-outposts'); // prettier-ignore
  public static readonly S3_MULTI_REGION_ACCESS_POINTS = new InterfaceVpcEndpointAwsService('s3-global.accesspoint', 'com.amazonaws', undefined, { global: true }); // prettier-ignore
  public static readonly S3_TABLES = new InterfaceVpcEndpointAwsService('s3tables'); // prettier-ignore
  public static readonly SAVINGS_PLANS = new InterfaceVpcEndpointAwsService('savingsplans', 'com.amazonaws', undefined, { global: true }); // prettier-ignore
  public static readonly SAGEMAKER_API = new InterfaceVpcEndpointAwsService('sagemaker.api'); // prettier-ignore
  public static readonly SAGEMAKER_API_FIPS = new InterfaceVpcEndpointAwsService('sagemaker.api-fips'); // prettier-ignore
  public static readonly SAGEMAKER_DATA_SCIENCE_ASSISTANT = new InterfaceVpcEndpointAwsService('sagemaker-data-science-assistant'); // prettier-ignore
  public static readonly SAGEMAKER_EXPERIMENTS = new InterfaceVpcEndpointAwsService('experiments', 'aws.sagemaker'); // prettier-ignore
  public static readonly SAGEMAKER_FEATURESTORE_RUNTIME = new InterfaceVpcEndpointAwsService('sagemaker.featurestore-runtime'); // prettier-ignore
  public static readonly SAGEMAKER_GEOSPATIAL = new InterfaceVpcEndpointAwsService('sagemaker-geospatial'); // prettier-ignore
  public static readonly SAGEMAKER_METRICS = new InterfaceVpcEndpointAwsService('sagemaker.metrics'); // prettier-ignore
  public static readonly SAGEMAKER_NOTEBOOK = new InterfaceVpcEndpointAwsService('notebook', 'aws.sagemaker'); // prettier-ignore
  public static readonly SAGEMAKER_PARTNER_APP = new InterfaceVpcEndpointAwsService('partner-app', 'aws.sagemaker'); // prettier-ignore
  public static readonly SAGEMAKER_RUNTIME = new InterfaceVpcEndpointAwsService('sagemaker.runtime'); // prettier-ignore
  public static readonly SAGEMAKER_RUNTIME_FIPS = new InterfaceVpcEndpointAwsService('sagemaker.runtime-fips'); // prettier-ignore
  public static readonly SAGEMAKER_STUDIO = new InterfaceVpcEndpointAwsService('studio', 'aws.sagemaker'); // prettier-ignore
  public static readonly SECRETS_MANAGER = new InterfaceVpcEndpointAwsService('secretsmanager'); // prettier-ignore
  public static readonly SECURITYHUB = new InterfaceVpcEndpointAwsService('securityhub'); // prettier-ignore
  public static readonly SERVICE_CATALOG = new InterfaceVpcEndpointAwsService('servicecatalog'); // prettier-ignore
  public static readonly SERVICE_CATALOG_APPREGISTRY = new InterfaceVpcEndpointAwsService('servicecatalog-appregistry'); // prettier-ignore
  public static readonly SERVER_MIGRATION_SERVICE = new InterfaceVpcEndpointAwsService('sms'); // prettier-ignore
  public static readonly SERVER_MIGRATION_SERVICE_FIPS = new InterfaceVpcEndpointAwsService('sms-fips'); // prettier-ignore
  public static readonly SERVER_MIGRATION_SERVICE_AWSCONNECTOR = new InterfaceVpcEndpointAwsService('awsconnector'); // prettier-ignore
  public static readonly SERVERLESS_APPLICATION_REPOSITORY = new InterfaceVpcEndpointAwsService('serverlessrepo'); // prettier-ignore
  /** @deprecated - Use InterfaceVpcEndpointAwsService.EMAIL_SMTP instead. */
  public static readonly SES = new InterfaceVpcEndpointAwsService('email-smtp'); // prettier-ignore
  public static readonly SIMSPACE_WEAVER = new InterfaceVpcEndpointAwsService('simspaceweaver'); // prettier-ignore
  public static readonly SNOW_DEVICE_MANAGEMENT = new InterfaceVpcEndpointAwsService('snow-device-management'); // prettier-ignore
  public static readonly SNS = new InterfaceVpcEndpointAwsService('sns'); // prettier-ignore
  public static readonly SQS = new InterfaceVpcEndpointAwsService('sqs'); // prettier-ignore
  public static readonly SSM = new InterfaceVpcEndpointAwsService('ssm'); // prettier-ignore
  public static readonly SSM_FIPS = new InterfaceVpcEndpointAwsService('ssm-fips'); // prettier-ignore
  public static readonly SSM_MESSAGES = new InterfaceVpcEndpointAwsService('ssmmessages'); // prettier-ignore
  public static readonly SSM_CONTACTS = new InterfaceVpcEndpointAwsService('ssm-contacts'); // prettier-ignore
  public static readonly SSM_INCIDENTS = new InterfaceVpcEndpointAwsService('ssm-incidents'); // prettier-ignore
  public static readonly SSM_QUICK_SETUP = new InterfaceVpcEndpointAwsService('ssm-quicksetup'); // prettier-ignore
  public static readonly STEP_FUNCTIONS = new InterfaceVpcEndpointAwsService('states'); // prettier-ignore
  public static readonly STEP_FUNCTIONS_SYNC = new InterfaceVpcEndpointAwsService('sync-states'); // prettier-ignore
  public static readonly STORAGE_GATEWAY = new InterfaceVpcEndpointAwsService('storagegateway'); // prettier-ignore
  public static readonly STS = new InterfaceVpcEndpointAwsService('sts'); // prettier-ignore
  public static readonly SUPPLY_CHAIN = new InterfaceVpcEndpointAwsService('scn'); // prettier-ignore
  public static readonly SWF = new InterfaceVpcEndpointAwsService('swf'); // prettier-ignore
  public static readonly SWF_FIPS = new InterfaceVpcEndpointAwsService('swf-fips'); // prettier-ignore
  public static readonly TAGGING = new InterfaceVpcEndpointAwsService('tagging'); // prettier-ignore
  public static readonly TELCO_NETWORK_BUILDER = new InterfaceVpcEndpointAwsService('tnb'); // prettier-ignore
  public static readonly TEXTRACT = new InterfaceVpcEndpointAwsService('textract'); // prettier-ignore
  public static readonly TEXTRACT_FIPS = new InterfaceVpcEndpointAwsService('textract-fips'); // prettier-ignore
  public static readonly TIMESTREAM_INFLUXDB = new InterfaceVpcEndpointAwsService('timestream-influxdb'); // prettier-ignore
  public static readonly TIMESTREAM_INFLUXDB_FIPS = new InterfaceVpcEndpointAwsService('timestream-influxdb-fips'); // prettier-ignore
  public static readonly TRANSCRIBE = new InterfaceVpcEndpointAwsService('transcribe'); // prettier-ignore
  public static readonly TRANSCRIBE_STREAMING = new InterfaceVpcEndpointAwsService('transcribestreaming'); // prettier-ignore
  public static readonly TRANSFER = new InterfaceVpcEndpointAwsService('transfer'); // prettier-ignore
  public static readonly TRANSFER_SERVER = new InterfaceVpcEndpointAwsService('transfer.server'); // prettier-ignore
  public static readonly TRANSLATE = new InterfaceVpcEndpointAwsService('translate'); // prettier-ignore
  public static readonly TRUSTED_ADVISOR = new InterfaceVpcEndpointAwsService('trustedadvisor'); // prettier-ignore
  public static readonly WELL_ARCHITECTED_TOOL = new InterfaceVpcEndpointAwsService('wellarchitected'); // prettier-ignore
  public static readonly WORKMAIL = new InterfaceVpcEndpointAwsService('workmail'); // prettier-ignore
  public static readonly WORKSPACES = new InterfaceVpcEndpointAwsService('workspaces'); // prettier-ignore
  public static readonly WORKSPACES_THIN_CLIENT = new InterfaceVpcEndpointAwsService('thinclient.api'); // prettier-ignore
  public static readonly WORKSPACES_WEB = new InterfaceVpcEndpointAwsService('workspaces-web'); // prettier-ignore
  public static readonly WORKSPACES_WEB_FIPS = new InterfaceVpcEndpointAwsService('workspaces-web-fips'); // prettier-ignore
  public static readonly XRAY = new InterfaceVpcEndpointAwsService('xray'); // prettier-ignore
  public static readonly VERIFIED_PERMISSIONS = new InterfaceVpcEndpointAwsService('verifiedpermissions'); // prettier-ignore
  public static readonly VPC_LATTICE = new InterfaceVpcEndpointAwsService('vpc-lattice'); // prettier-ignore

  /**
   * The name of the service. e.g. com.amazonaws.us-east-1.ecs
   */
  public readonly name: string;

  /**
   * The short name of the service. e.g. ecs
   */
  public readonly shortName: string;

  /**
   * The port of the service.
   */
  public readonly port: number;

  /**
   * Whether Private DNS is supported by default.
   */
  public readonly privateDnsDefault?: boolean = true;

  constructor(
    name: string,
    prefix?: string,
    port?: number,
    props?: InterfaceVpcEndpointAwsServiceProps,
  ) {
    const regionPrefix = props?.global
      ? ""
      : Lazy.stringValue({
          produce: (context) => AwsStack.ofAwsConstruct(context.scope).region,
        }) + ".";
    const defaultEndpointPrefix = Lazy.stringValue({
      produce: (context) => {
        const regionName = AwsStack.ofAwsConstruct(context.scope).region;
        return this.getDefaultEndpointPrefix(name, regionName);
      },
    });
    const defaultEndpointSuffix = Lazy.stringValue({
      produce: (context) => {
        const regionName = AwsStack.ofAwsConstruct(context.scope).region;
        return this.getDefaultEndpointSuffix(name, regionName);
      },
    });

    this.name = `${prefix || defaultEndpointPrefix}.${regionPrefix}${name}${defaultEndpointSuffix}`;
    this.shortName = name;
    this.port = port || 443;
  }

  /**
   * Get the endpoint prefix for the service in the specified region
   * because the prefix for some of the services in cn-north-1 and cn-northwest-1 are different
   *
   * For future maintenance， the vpc endpoint services could be fetched using AWS CLI Commmand:
   * aws ec2 describe-vpc-endpoint-services
   */
  private getDefaultEndpointPrefix(name: string, region: string) {
    const VPC_ENDPOINT_SERVICE_EXCEPTIONS: { [region: string]: string[] } = {
      "cn-north-1": [
        "application-autoscaling",
        "appmesh-envoy-management",
        "athena",
        "autoscaling",
        "awsconnector",
        "backup",
        "batch",
        "cassandra",
        "cloudcontrolapi",
        "cloudformation",
        "codedeploy-commands-secure",
        "databrew",
        "dms",
        "ebs",
        "ec2",
        "ecr.api",
        "ecr.dkr",
        "eks",
        "elasticache",
        "elasticbeanstalk",
        "elasticfilesystem",
        "elasticfilesystem-fips",
        "emr-containers",
        "execute-api",
        "fsx",
        "imagebuilder",
        "iot.data",
        "iotsitewise.api",
        "iotsitewise.data",
        "kinesis-streams",
        "lambda",
        "license-manager",
        "monitoring",
        "rds",
        "redshift",
        "redshift-data",
        "s3",
        "sagemaker.api",
        "sagemaker.featurestore-runtime",
        "sagemaker.runtime",
        "securityhub",
        "servicecatalog",
        "sms",
        "sqs",
        "states",
        "sts",
        "sync-states",
        "synthetics",
        "transcribe",
        "transcribestreaming",
        "transfer",
        "xray",
      ],
      "cn-northwest-1": [
        "account",
        "application-autoscaling",
        "appmesh-envoy-management",
        "athena",
        "autoscaling",
        "awsconnector",
        "backup",
        "batch",
        "cassandra",
        "cloudcontrolapi",
        "cloudformation",
        "codedeploy-commands-secure",
        "databrew",
        "dms",
        "ebs",
        "ec2",
        "ecr.api",
        "ecr.dkr",
        "eks",
        "elasticache",
        "elasticbeanstalk",
        "elasticfilesystem",
        "elasticfilesystem-fips",
        "emr-containers",
        "execute-api",
        "fsx",
        "imagebuilder",
        "iot.data",
        "kinesis-streams",
        "lambda",
        "license-manager",
        "monitoring",
        "polly",
        "rds",
        "redshift",
        "redshift-data",
        "s3",
        "sagemaker.api",
        "sagemaker.featurestore-runtime",
        "sagemaker.runtime",
        "securityhub",
        "servicecatalog",
        "sms",
        "sqs",
        "states",
        "sts",
        "sync-states",
        "synthetics",
        "transcribe",
        "transcribestreaming",
        "transfer",
        "workspaces",
        "xray",
      ],
    };
    if (VPC_ENDPOINT_SERVICE_EXCEPTIONS[region]?.includes(name)) {
      return "cn.com.amazonaws";
    } else {
      return "com.amazonaws";
    }
  }

  /**
   * Get the endpoint suffix for the service in the specified region.
   * In cn-north-1 and cn-northwest-1, the vpc endpoint of transcribe is:
   *   cn.com.amazonaws.cn-north-1.transcribe.cn
   *   cn.com.amazonaws.cn-northwest-1.transcribe.cn
   * so suffix '.cn' should be return in these scenarios.
   *
   * For future maintenance， the vpc endpoint services could be fetched using AWS CLI Commmand:
   * aws ec2 describe-vpc-endpoint-services
   */
  private getDefaultEndpointSuffix(name: string, region: string) {
    const VPC_ENDPOINT_SERVICE_EXCEPTIONS: { [region: string]: string[] } = {
      "cn-north-1": ["transcribe"],
      "cn-northwest-1": ["transcribe"],
    };
    return VPC_ENDPOINT_SERVICE_EXCEPTIONS[region]?.includes(name) ? ".cn" : "";
  }
}

/**
 * Options to add an interface endpoint to a VPC.
 */
export interface InterfaceVpcEndpointOptions {
  /**
   * The service to use for this interface VPC endpoint.
   */
  readonly service: IInterfaceVpcEndpointService;

  /**
   * Whether to associate a private hosted zone with the specified VPC. This
   * allows you to make requests to the service using its default DNS hostname.
   *
   * @default set by the instance of IInterfaceVpcEndpointService, or true if
   * not defined by the instance of IInterfaceVpcEndpointService
   */
  readonly privateDnsEnabled?: boolean;

  /**
   * The subnets in which to create an endpoint network interface. At most one
   * per availability zone.
   *
   * @default - private subnets
   */
  readonly subnets?: SubnetSelection;

  /**
   * The security groups to associate with this interface VPC endpoint.
   *
   * @default - a new security group is created
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * Whether to automatically allow VPC traffic to the endpoint
   *
   * If enabled, all traffic to the endpoint from within the VPC will be
   * automatically allowed. This is done based on the VPC's CIDR range.
   *
   * @default true
   */
  readonly open?: boolean;

  // TODO: Implement ContextProvider to validate AZs
  // /**
  //  * Limit to only those availability zones where the endpoint service can be created
  //  *
  //  * Setting this to 'true' requires a lookup to be performed at synthesis time. Account
  //  * and region must be set on the containing stack for this to work.
  //  *
  //  * @default false
  //  */
  // readonly lookupSupportedAzs?: boolean;
}

/**
 * Construction properties for an InterfaceVpcEndpoint.
 */
export interface InterfaceVpcEndpointProps extends InterfaceVpcEndpointOptions {
  /**
   * The VPC network in which the interface endpoint will be used.
   */
  readonly vpc: IVpc;
}

/**
 * An interface VPC endpoint.
 */
export interface IInterfaceVpcEndpoint extends IVpcEndpoint, IConnectable {}

/**
 * A interface VPC endpoint.
 * @resource AWS::EC2::VPCEndpoint
 */
export class InterfaceVpcEndpoint
  extends VpcEndpoint
  implements IInterfaceVpcEndpoint
{
  /**
   * Imports an existing interface VPC endpoint.
   */
  public static fromInterfaceVpcEndpointAttributes(
    scope: Construct,
    id: string,
    attrs: InterfaceVpcEndpointAttributes,
  ): IInterfaceVpcEndpoint {
    const securityGroups = attrs.securityGroupId
      ? [
          SecurityGroup.fromSecurityGroupId(
            scope,
            "SecurityGroup",
            attrs.securityGroupId,
          ),
        ]
      : attrs.securityGroups;

    class Import extends AwsConstructBase implements IInterfaceVpcEndpoint {
      public get vpcEndpointOutputs(): VpcEndpointOutputs {
        return {
          vpcEndpointId: this.vpcEndpointId,
        };
      }
      public get outputs(): Record<string, any> {
        return this.vpcEndpointOutputs;
      }
      public readonly vpcEndpointId = attrs.vpcEndpointId;
      public readonly connections = new Connections({
        defaultPort: Port.tcp(attrs.port),
        securityGroups,
      });
    }

    return new Import(scope, id);
  }

  /**
   * The interface VPC endpoint identifier.
   */
  public readonly vpcEndpointId: string;

  // TF Provider does not provide this attribute
  // /**
  //  * The date and time the interface VPC endpoint was created.
  //  * @attribute
  //  */
  // public readonly vpcEndpointCreationTimestamp: string;

  /**
   * The DNS entries for the interface VPC endpoint.
   * Each entry is a combination of the hosted zone ID and the DNS name.
   * The entries are ordered as follows: regional public DNS, zonal public DNS, private DNS, and wildcard DNS.
   * This order is not enforced for AWS Marketplace services.
   *
   * The following is an example. In the first entry, the hosted zone ID is Z1HUB23UULQXV
   * and the DNS name is vpce-01abc23456de78f9g-12abccd3.ec2.us-east-1.vpce.amazonaws.com.
   *
   * [
   *  { hostedZoneId: "Z1HUB23UULQXV", "dnsName": "vpce-01abc23456de78f9g-12abccd3.ec2.us-east-1.vpce.amazonaws.com" },
   *  { hostedZoneId: "Z1HUB23UULQXV, "dnsName": "vpce-01abc23456de78f9g-12abccd3-us-east-1a.ec2.us-east-1.vpce.amazonaws.com" },
   *  { hostedZoneId: "Z1C12344VYDITB0, "dnsName": "ec2.us-east-1.amazonaws.com" }
   * ]
   *
   * If you update the PrivateDnsEnabled or SubnetIds properties, the DNS entries in the list will change.
   * @attribute
   */
  public readonly vpcEndpointDnsEntries: vpcEndpoint.VpcEndpointDnsEntryList;

  /**
   * One or more network interfaces for the interface VPC endpoint.
   * @attribute
   */
  public readonly vpcEndpointNetworkInterfaceIds: string[];

  /**
   * The identifier of the first security group associated with this interface
   * VPC endpoint.
   *
   * @deprecated use the `connections` object
   */
  public readonly securityGroupId: string;

  /**
   * Access to network connections.
   */
  public readonly connections: Connections;

  public resource: vpcEndpoint.VpcEndpoint;

  constructor(scope: Construct, id: string, props: InterfaceVpcEndpointProps) {
    super(scope, id);

    const securityGroups = props.securityGroups || [
      new SecurityGroup(this, "SecurityGroup", {
        vpc: props.vpc,
      }),
    ];

    this.securityGroupId = securityGroups[0].securityGroupId;
    this.connections = new Connections({
      defaultPort: Port.tcp(props.service.port),
      securityGroups,
    });

    if (props.open !== false) {
      this.connections.allowDefaultPortFrom(Peer.ipv4(props.vpc.vpcCidrBlock));
    }

    // Determine which subnets to place the endpoint in
    const subnetIds = this.endpointSubnets(props);

    this.resource = new vpcEndpoint.VpcEndpoint(this, "Resource", {
      privateDnsEnabled:
        props.privateDnsEnabled ?? props.service.privateDnsDefault ?? true,
      policy: this.policyDocument?.json,
      securityGroupIds: securityGroups.map((s) => s.securityGroupId),
      serviceName: props.service.name,
      vpcEndpointType: VpcEndpointType.INTERFACE,
      subnetIds,
      vpcId: props.vpc.vpcId,
    });

    this.vpcEndpointId = this.resource.id;
    // this.vpcEndpointCreationTimestamp = this.resource.creationTimestamp;
    this.vpcEndpointDnsEntries = this.resource.dnsEntry;
    this.vpcEndpointNetworkInterfaceIds = this.resource.networkInterfaceIds;
  }

  /**
   * Determine which subnets to place the endpoint in. This is in its own function
   * because there's a lot of code.
   */
  private endpointSubnets(props: InterfaceVpcEndpointProps) {
    // const lookupSupportedAzs = props.lookupSupportedAzs ?? false;
    const subnetSelection = props.vpc.selectSubnets({
      ...props.subnets,
      onePerAz: true,
    });

    // Sanity check the subnet count
    if (
      !subnetSelection.isPendingLookup &&
      subnetSelection.subnets.length == 0
    ) {
      throw new Error("Cannot create a VPC Endpoint with no subnets");
    }

    // TODO: Implement ContextProvider to validate AZs
    // If we aren't going to lookup supported AZs we'll exit early, returning the subnetIds from the provided subnet selection
    // if (!lookupSupportedAzs) {
    return subnetSelection.subnetIds;
    // }

    // // Some service names, such as AWS service name references, use Tokens to automatically fill in the region
    // // If it is an InterfaceVpcEndpointAwsService, then the reference will be resolvable since it only references the region
    // const isAwsService =
    //   Token.isUnresolved(props.service.name) &&
    //   props.service instanceof InterfaceVpcEndpointAwsService;

    // // Determine what service name gets pass to the context provider
    // // If it is an AWS service it will have a REGION token
    // const lookupServiceName = isAwsService
    //   ? AwsStack.ofAwsConstruct(this).resolve(props.service.name)
    //   : props.service.name;

    // // Check that the lookup will work
    // this.validateCanLookupSupportedAzs(subnets, lookupServiceName);

    // // Do the actual lookup for AZs
    // const availableAZs = this.availableAvailabilityZones(lookupServiceName);
    // const filteredSubnets = subnets.filter((s) =>
    //   availableAZs.includes(s.availabilityZone),
    // );

    // // Throw an error if the lookup filtered out all subnets
    // // VpcEndpoints must be created with at least one AZ
    // if (filteredSubnets.length == 0) {
    //   throw new Error(
    //     `lookupSupportedAzs returned ${availableAZs} but subnets have AZs ${subnets.map((s) => s.availabilityZone)}`,
    //   );
    // }
    // return filteredSubnets.map((s) => s.subnetId);
  }

  // /**
  //  * Sanity checking when looking up AZs for an endpoint service, to make sure it won't fail
  //  */
  // private validateCanLookupSupportedAzs(
  //   subnets: ISubnet[],
  //   serviceName: string,
  // ) {
  //   // Having any of these be true will cause the AZ lookup to fail at synthesis time
  //   const agnosticAcct = Token.isUnresolved(this.env.account);
  //   const agnosticRegion = Token.isUnresolved(this.env.region);
  //   const agnosticService = Token.isUnresolved(serviceName);

  //   // Having subnets with Token AZs can cause the endpoint to be created with no subnets, failing at deployment time
  //   const agnosticSubnets = subnets.some((s) =>
  //     Token.isUnresolved(s.availabilityZone),
  //   );
  //   const agnosticSubnetList = Token.isUnresolved(
  //     subnets.map((s) => s.availabilityZone),
  //   );

  //   // Context provider cannot make an AWS call without an account/region
  //   if (agnosticAcct || agnosticRegion) {
  //     throw new Error(
  //       "Cannot look up VPC endpoint availability zones if account/region are not specified",
  //     );
  //   }

  //   // The AWS call will fail if there is a Token in the service name
  //   if (agnosticService) {
  //     throw new Error(
  //       `Cannot lookup AZs for a service name with a Token: ${serviceName}`,
  //     );
  //   }

  //   // The AWS call return strings for AZs, like us-east-1a, us-east-1b, etc
  //   // If the subnet AZs are Tokens, a string comparison between the subnet AZs and the AZs from the AWS call
  //   // will not match
  //   if (agnosticSubnets || agnosticSubnetList) {
  //     const agnostic = subnets.filter((s) =>
  //       Token.isUnresolved(s.availabilityZone),
  //     );
  //     throw new Error(
  //       `lookupSupportedAzs cannot filter on subnets with Token AZs: ${agnostic}`,
  //     );
  //   }
  // }

  // // TODO: Implement ContextProvider to validate AZs
  // private availableAvailabilityZones(serviceName: string): string[] {
  //   // Here we check what AZs the endpoint service is available in
  //   // If for whatever reason we can't retrieve the AZs, and no context is set,
  //   // we will fall back to all AZs
  //   const availableAZs = ContextProvider.getValue(this, {
  //     provider:
  //       cxschema.ContextProvider.ENDPOINT_SERVICE_AVAILABILITY_ZONE_PROVIDER,
  //     dummyValue: this.stack.availabilityZones(),
  //     props: { serviceName },
  //   }).value;
  //   if (!Array.isArray(availableAZs)) {
  //     throw new Error(
  //       `Discovered AZs for endpoint service ${serviceName} must be an array`,
  //     );
  //   }
  //   return availableAZs;
  // }
}

/**
 * Construction properties for an ImportedInterfaceVpcEndpoint.
 */
export interface InterfaceVpcEndpointAttributes {
  /**
   * The interface VPC endpoint identifier.
   */
  readonly vpcEndpointId: string;

  /**
   * The identifier of the security group associated with the interface VPC endpoint.
   *
   * @deprecated use `securityGroups` instead
   */
  readonly securityGroupId?: string;

  /**
   * The security groups associated with the interface VPC endpoint.
   *
   * If you wish to manage the network connections associated with this endpoint,
   * you will need to specify its security groups.
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * The port of the service of the interface VPC endpoint.
   */
  readonly port: number;
}
