// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-elasticloadbalancing/lib/load-balancer.ts

import { elb as tfElb, loadBalancerListenerPolicy } from "@cdktf/provider-aws";
import { Lazy } from "cdktf";
import { Construct } from "constructs";
import { Connections, IConnectable } from "./connections";
import { Instance } from "./instance";
import { Peer } from "./peer";
import { Port } from "./port";
import { SecurityGroup, ISecurityGroup } from "./security-group";
import { IVpc, SelectedSubnets, SubnetSelection, SubnetType } from "./vpc";
import { Duration } from "../../duration";
import { AwsConstructBase } from "../aws-construct";

/**
 * Construction properties for a LoadBalancer
 */
export interface LoadBalancerProps {
  /**
   * VPC network of the fleet instances
   */
  readonly vpc: IVpc;

  /**
   * Whether this is an internet-facing Load Balancer
   *
   * This controls whether the LB has a public IP address assigned. It does
   * not open up the Load Balancer's security groups to public internet access.
   *
   * @default false
   */
  readonly internetFacing?: boolean;

  /**
   * What listeners to set up for the load balancer.
   *
   * Can also be added by .addListener()
   *
   * @default -
   */
  readonly listeners?: LoadBalancerListener[];

  /**
   * What targets to load balance to.
   *
   * Can also be added by .addTarget()
   *
   * @default - None.
   */
  readonly targets?: ILoadBalancerTarget[];

  /**
   * Health check settings for the load balancing targets.
   *
   * Not required but recommended.
   *
   * @default - None.
   */
  readonly healthCheck?: ElbHealthCheck;

  /**
   * Whether cross zone load balancing is enabled
   *
   * This controls whether the load balancer evenly distributes requests
   * across each availability zone
   *
   * @default true
   */
  readonly crossZone?: boolean;

  /**
   * Which subnets to deploy the load balancer
   *
   * Can be used to define a specific set of subnets to deploy the load balancer to.
   * Useful multiple public or private subnets are covering the same availability zone.
   *
   * @default - Public subnets if internetFacing, Private subnets otherwise
   */
  readonly subnetSelection?: SubnetSelection;

  /**
   * Enable Loadbalancer access logs
   * Can be used to avoid manual work as aws console
   * Required S3 bucket name , enabled flag
   * Can add interval for pushing log
   * Can set bucket prefix in order to provide folder name inside bucket
   * @default - disabled
   */
  readonly accessLoggingPolicy?: tfElb.ElbAccessLogs;
}

/**
 * Describe the health check to a load balancer
 */
export interface ElbHealthCheck {
  /**
   * What port number to health check on
   */
  readonly port: number;

  /**
   * What protocol to use for health checking
   *
   * The protocol is automatically determined from the port if it's not supplied.
   *
   * @default Automatic
   */
  readonly protocol?: LoadBalancingProtocol;

  /**
   * What path to use for HTTP or HTTPS health check (must return 200)
   *
   * For SSL and TCP health checks, accepting connections is enough to be considered
   * healthy.
   *
   * @default "/"
   */
  readonly path?: string;

  /**
   * After how many successful checks is an instance considered healthy
   *
   * @default 2
   */
  readonly healthyThreshold?: number;

  /**
   * After how many unsuccessful checks is an instance considered unhealthy
   *
   * @default 5
   */
  readonly unhealthyThreshold?: number;

  /**
   * Number of seconds between health checks
   *
   * @default Duration.seconds(30)
   */
  readonly interval?: Duration;

  /**
   * Health check timeout
   *
   * @default Duration.seconds(5)
   */
  readonly timeout?: Duration;
}

/**
 * Interface that is going to be implemented by constructs that you can load balance to
 */
export interface ILoadBalancerTarget extends IConnectable {
  /**
   * Attach load-balanced target to a classic ELB
   * @param loadBalancer [disable-awslint:ref-via-interface] The load balancer to attach the target to
   */
  attachToClassicLB(loadBalancer: LoadBalancer): void;
}

/**
 * Add a backend to the load balancer
 */
export interface LoadBalancerListener {
  /**
   * External listening port
   */
  readonly externalPort: number;

  /**
   * What public protocol to use for load balancing
   *
   * Either 'tcp', 'ssl', 'http' or 'https'.
   *
   * May be omitted if the external port is either 80 or 443.
   */
  readonly externalProtocol?: LoadBalancingProtocol;

  /**
   * Instance listening port
   *
   * Same as the externalPort if not specified.
   *
   * @default externalPort
   */
  readonly internalPort?: number;

  /**
   * What public protocol to use for load balancing
   *
   * Either 'tcp', 'ssl', 'http' or 'https'.
   *
   * May be omitted if the internal port is either 80 or 443.
   *
   * The instance protocol is 'tcp' if the front-end protocol
   * is 'tcp' or 'ssl', the instance protocol is 'http' if the
   * front-end protocol is 'https'.
   */
  readonly internalProtocol?: LoadBalancingProtocol;

  /**
   * SSL policy names
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/elb-security-policy-table.html
   */
  readonly policyNames?: string[];

  /**
   * the ARN of the SSL certificate
   *
   * @default - none
   */
  readonly sslCertificateArn?: string;

  /**
   * Allow connections to the load balancer from the given set of connection peers
   *
   * By default, connections will be allowed from anywhere. Set this to an empty list
   * to deny connections, or supply a custom list of peers to allow connections from
   * (IP ranges or security groups).
   *
   * @default Anywhere
   */
  readonly allowConnectionsFrom?: IConnectable[];
}

export enum LoadBalancingProtocol {
  TCP = "tcp",
  SSL = "ssl",
  HTTP = "http",
  HTTPS = "https",
}

export interface LoadBalancerOutputs {
  /**
   * The name of the ELB
   * @attribute
   */
  readonly loadBalancerName: string;
  /**
   * The canonical hosted zone ID of the ELB (to be used in a Route 53 Alias record)
   *
   * @attribute
   */
  readonly loadBalancerCanonicalHostedZoneNameId: string;
  /**
   * The DNS name of the ELB
   *
   * @attribute
   */
  readonly loadBalancerDnsName: string;
  /**
   * The ID of the security group that you can use as part of your inbound rules
   * for your load balancer's back-end application instances.
   *
   * Only available on ELBs launched in a VPC.
   *
   * @attribute
   */
  readonly loadBalancerSourceSecurityGroupId: string;
}

/**
 * A load balancer with a single listener
 *
 * Routes to a fleet of of instances in a VPC.
 */
export class LoadBalancer extends AwsConstructBase implements IConnectable {
  /**
   * Control all connections from and to this load balancer
   */
  public readonly connections: Connections;
  public get loadBalancerOutputs(): LoadBalancerOutputs {
    return {
      loadBalancerName: this.loadBalancerName,
      loadBalancerCanonicalHostedZoneNameId:
        this.loadBalancerCanonicalHostedZoneNameId,
      loadBalancerDnsName: this.loadBalancerDnsName,
      loadBalancerSourceSecurityGroupId: this.loadBalancerSourceSecurityGroupId,
    };
  }
  public get outputs(): Record<string, any> {
    return this.loadBalancerOutputs;
  }

  /**
   * An object controlling specifically the connections for each listener added to this load balancer
   */
  public readonly listenerPorts: ListenerPort[] = [];

  private readonly elb: tfElb.Elb;
  private readonly securityGroup: SecurityGroup;
  private readonly listeners: tfElb.ElbListener[] = [];

  private readonly instancePorts: number[] = [];
  private readonly targets: ILoadBalancerTarget[] = [];
  private readonly instanceIds: string[] = [];

  constructor(scope: Construct, id: string, props: LoadBalancerProps) {
    super(scope, id);

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: false,
    });
    this.connections = new Connections({
      securityGroups: [this.securityGroup],
    });
    // Depending on whether the ELB has public or internal IPs, pick the right backend subnets
    const selectedSubnets: SelectedSubnets = loadBalancerSubnets(props);

    this.elb = new tfElb.Elb(this, "Resource", {
      securityGroups: [this.securityGroup.securityGroupId],
      subnets: selectedSubnets.subnetIds,
      listener: Lazy.anyValue({ produce: () => this.listeners }),
      instances: Lazy.listValue(
        { produce: () => this.instanceIds },
        { omitEmpty: true },
      ),
      internal: !props.internetFacing,
      healthCheck: props.healthCheck && healthCheckToJSON(props.healthCheck),
      crossZoneLoadBalancing: props.crossZone ?? true,
    });
    if (props.internetFacing) {
      this.elb.node.addDependency(
        selectedSubnets.internetConnectivityEstablished,
      );
    }

    if (props.accessLoggingPolicy !== undefined) {
      this.elb.putAccessLogs(props.accessLoggingPolicy);
    }

    ifUndefined(props.listeners, []).forEach((b) => this.addListener(b));
    ifUndefined(props.targets, []).forEach((t) => this.addTarget(t));
  }

  /**
   * Add a backend to the load balancer
   *
   * @returns A ListenerPort object that controls connections to the listener port
   */
  public addListener(listener: LoadBalancerListener): ListenerPort {
    const protocol = ifUndefinedLazy(listener.externalProtocol, () =>
      wellKnownProtocol(listener.externalPort),
    );
    const instancePort = listener.internalPort || listener.externalPort;
    const instanceProtocol = ifUndefined(
      listener.internalProtocol,
      ifUndefined(
        tryWellKnownProtocol(instancePort),
        isHttpProtocol(protocol)
          ? LoadBalancingProtocol.HTTP
          : LoadBalancingProtocol.TCP,
      ),
    );

    this.listeners.push({
      lbPort: listener.externalPort,
      lbProtocol: protocol,
      instancePort: instancePort,
      instanceProtocol,
      sslCertificateId: listener.sslCertificateArn,
    });

    // create a listener policy if there are any policy names
    if (listener.policyNames && listener.policyNames.length > 0) {
      new loadBalancerListenerPolicy.LoadBalancerListenerPolicy(
        this,
        `${listener.externalPort}Policy`,
        {
          loadBalancerName: this.elb.name,
          loadBalancerPort: listener.externalPort,
          policyNames: listener.policyNames,
        },
      );
    }

    const port = new ListenerPort(
      this.securityGroup,
      Port.tcp(listener.externalPort),
    );

    // Allow connections on the public port for all supplied peers (default: everyone)
    ifUndefined(listener.allowConnectionsFrom, [Peer.anyIpv4()]).forEach(
      (peer) => {
        port.connections.allowDefaultPortFrom(
          peer,
          `Default rule allow on ${listener.externalPort}`,
        );
      },
    );

    this.newInstancePort(instancePort);

    // Keep track using array so user can get to them even if they were all supplied in the constructor
    this.listenerPorts.push(port);

    return port;
  }

  public addTarget(target: ILoadBalancerTarget) {
    target.attachToClassicLB(this);

    this.newTarget(target);
  }

  /**
   * The name of the ELB
   * @attribute
   */
  public get loadBalancerName() {
    return this.elb.name;
  }

  /**
   * The canonical hosted zone ID of the ELB (to be used in a Route 53 Alias record)
   *
   * @attribute
   */
  public get loadBalancerCanonicalHostedZoneNameId() {
    return this.elb.zoneId;
  }

  /**
   * The DNS name of the ELB
   *
   * @attribute
   */
  public get loadBalancerDnsName() {
    return this.elb.dnsName;
  }

  /**
   * The ID of the security group that you can use as part of your inbound rules
   * for your load balancer's back-end application instances.
   *
   * Only available on ELBs launched in a VPC.
   *
   * @attribute
   */
  public get loadBalancerSourceSecurityGroupId() {
    return this.elb.sourceSecurityGroupId;
  }

  /**
   * Allow connections to all existing targets on new instance port
   */
  private newInstancePort(instancePort: number) {
    this.targets.forEach((t) => this.allowTargetConnection(instancePort, t));

    // Keep track of port for future targets
    this.instancePorts.push(instancePort);
  }

  /**
   * Allow connections to target on all existing instance ports
   */
  private newTarget(target: ILoadBalancerTarget) {
    this.instancePorts.forEach((p) => this.allowTargetConnection(p, target));

    // Keep track of target for future listeners.
    this.targets.push(target);
  }

  /**
   * Allow connections for a single (port, target) pair
   */
  private allowTargetConnection(
    instancePort: number,
    target: ILoadBalancerTarget,
  ) {
    this.connections.allowTo(
      target,
      Port.tcp(instancePort),
      `Port ${instancePort} LB to fleet`,
    );
  }

  /**
   * Add instance to the load balancer.
   * @internal
   */
  public _addInstanceId(instanceId: string) {
    this.instanceIds.push(instanceId);
  }
}

/**
 * An EC2 instance that is the target for load balancing
 */
export class ElbInstanceTarget implements ILoadBalancerTarget {
  readonly connections: Connections;
  /**
   * Create a new Instance target.
   *
   * @param instance Instance to register to.
   */
  constructor(public readonly instance: Instance) {
    this.connections = instance.connections;
  }

  public attachToClassicLB(loadBalancer: LoadBalancer): void {
    loadBalancer._addInstanceId(this.instance.instanceId);
  }
}

/**
 * Reference to a listener's port just created.
 *
 * This implements IConnectable with a default port (the port that an ELB
 * listener was just created on) for a given security group so that it can be
 * conveniently used just like any Connectable. E.g:
 *
 *    const listener = elb.addListener(...);
 *
 *    listener.connections.allowDefaultPortFromAnyIPv4();
 *    // or
 *    instance.connections.allowToDefaultPort(listener);
 */
export class ListenerPort implements IConnectable {
  public readonly connections: Connections;

  constructor(securityGroup: ISecurityGroup, defaultPort: Port) {
    this.connections = new Connections({
      securityGroups: [securityGroup],
      defaultPort,
    });
  }
}

function wellKnownProtocol(port: number): LoadBalancingProtocol {
  const proto = tryWellKnownProtocol(port);
  if (!proto) {
    throw new Error(`Please supply protocol to go with port ${port}`);
  }
  return proto;
}

function tryWellKnownProtocol(port: number): LoadBalancingProtocol | undefined {
  if (port === 80) {
    return LoadBalancingProtocol.HTTP;
  }
  if (port === 443) {
    return LoadBalancingProtocol.HTTPS;
  }
  return undefined;
}

function isHttpProtocol(proto: LoadBalancingProtocol): boolean {
  return (
    proto === LoadBalancingProtocol.HTTPS ||
    proto === LoadBalancingProtocol.HTTP
  );
}

function ifUndefined<T>(x: T | undefined, def: T): T {
  return x != null ? x : def;
}

function ifUndefinedLazy<T>(x: T | undefined, def: () => T): T {
  return x != null ? x : def();
}

/**
 * Turn health check parameters into a parameter blob for the LB
 */
function healthCheckToJSON(healthCheck: ElbHealthCheck): tfElb.ElbHealthCheck {
  const protocol = ifUndefined(
    healthCheck.protocol,
    ifUndefined(
      tryWellKnownProtocol(healthCheck.port),
      LoadBalancingProtocol.TCP,
    ),
  );

  const path =
    protocol === LoadBalancingProtocol.HTTP ||
    protocol === LoadBalancingProtocol.HTTPS
      ? ifUndefined(healthCheck.path, "/")
      : "";

  const target = `${protocol.toUpperCase()}:${healthCheck.port}${path}`;

  return {
    healthyThreshold: ifUndefined(healthCheck.healthyThreshold, 2),
    interval: (healthCheck.interval || Duration.seconds(30)).toSeconds(),
    target,
    timeout: (healthCheck.timeout || Duration.seconds(5)).toSeconds(),
    unhealthyThreshold: ifUndefined(healthCheck.unhealthyThreshold, 5),
  };
}

function loadBalancerSubnets(props: LoadBalancerProps): SelectedSubnets {
  if (props.subnetSelection !== undefined) {
    return props.vpc.selectSubnets(props.subnetSelection);
  } else if (props.internetFacing) {
    return props.vpc.selectSubnets({
      subnetType: SubnetType.PUBLIC,
    });
  } else {
    return props.vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
    });
  }
}
