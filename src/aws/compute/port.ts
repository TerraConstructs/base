// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/port.ts

import { Token } from "cdktf";

/**
 * Protocol for use in Connection Rules
 *
 * https://www.iana.org/assignments/protocol-numbers/protocol-numbers.xhtml
 */
export enum Protocol {
  ALL = "-1",
  HOPOPT = "0",
  ICMP = "icmp",
  IGMP = "2",
  GGP = "3",
  IPV4 = "4",
  ST = "5",
  TCP = "tcp",
  CBT = "7",
  EGP = "8",
  IGP = "9",
  BBN_RCC_MON = "10",
  NVP_II = "11",
  PUP = "12",
  EMCON = "14",
  XNET = "15",
  CHAOS = "16",
  UDP = "udp",
  MUX = "18",
  DCN_MEAS = "19",
  HMP = "20",
  PRM = "21",
  XNS_IDP = "22",
  TRUNK_1 = "23",
  TRUNK_2 = "24",
  LEAF_1 = "25",
  LEAF_2 = "26",
  RDP = "27",
  IRTP = "28",
  ISO_TP4 = "29",
  NETBLT = "30",
  MFE_NSP = "31",
  MERIT_INP = "32",
  DCCP = "33",
  THREEPC = "34",
  IDPR = "35",
  XTP = "36",
  DDP = "37",
  IDPR_CMTP = "38",
  TPPLUSPLUS = "39",
  IL = "40",
  IPV6 = "41",
  SDRP = "42",
  IPV6_ROUTE = "43",
  IPV6_FRAG = "44",
  IDRP = "45",
  RSVP = "46",
  GRE = "47",
  DSR = "48",
  BNA = "49",
  ESP = "50",
  AH = "51",
  I_NLSP = "52",
  SWIPE = "53",
  NARP = "54",
  MOBILE = "55",
  TLSP = "56",
  SKIP = "57",
  ICMPV6 = "icmpv6",
  IPV6_NONXT = "59",
  IPV6_OPTS = "60",
  CFTP = "62",
  ANY_LOCAL = "63",
  SAT_EXPAK = "64",
  KRYPTOLAN = "65",
  RVD = "66",
  IPPC = "67",
  ANY_DFS = "68",
  SAT_MON = "69",
  VISA = "70",
  IPCV = "71",
  CPNX = "72",
  CPHB = "73",
  WSN = "74",
  PVP = "75",
  BR_SAT_MON = "76",
  SUN_ND = "77",
  WB_MON = "78",
  WB_EXPAK = "79",
  ISO_IP = "80",
  VMTP = "81",
  SECURE_VMTP = "82",
  VINES = "83",
  TTP = "84",
  IPTM = "84_",
  NSFNET_IGP = "85",
  DGP = "86",
  TCF = "87",
  EIGRP = "88",
  OSPFIGP = "89",
  SPRITE_RPC = "90",
  LARP = "91",
  MTP = "92",
  AX_25 = "93",
  IPIP = "94",
  MICP = "95",
  SCC_SP = "96",
  ETHERIP = "97",
  ENCAP = "98",
  ANY_ENC = "99",
  GMTP = "100",
  IFMP = "101",
  PNNI = "102",
  PIM = "103",
  ARIS = "104",
  SCPS = "105",
  QNX = "106",
  A_N = "107",
  IPCOMP = "108",
  SNP = "109",
  COMPAQ_PEER = "110",
  IPX_IN_IP = "111",
  VRRP = "112",
  PGM = "113",
  ANY_0_HOP = "114",
  L2_T_P = "115",
  DDX = "116",
  IATP = "117",
  STP = "118",
  SRP = "119",
  UTI = "120",
  SMP = "121",
  SM = "122",
  PTP = "123",
  ISIS_IPV4 = "124",
  FIRE = "125",
  CRTP = "126",
  CRUDP = "127",
  SSCOPMCE = "128",
  IPLT = "129",
  SPS = "130",
  PIPE = "131",
  SCTP = "132",
  FC = "133",
  RSVP_E2E_IGNORE = "134",
  MOBILITY_HEADER = "135",
  UDPLITE = "136",
  MPLS_IN_IP = "137",
  MANET = "138",
  HIP = "139",
  SHIM6 = "140",
  WESP = "141",
  ROHC = "142",
  ETHERNET = "143",
  EXPERIMENT_1 = "253",
  EXPERIMENT_2 = "254",
  RESERVED = "255",
}

/**
 * Properties to create a port range
 */
export interface PortProps {
  /**
   * The protocol for the range
   */
  readonly protocol: Protocol;

  /**
   * The starting port for the range
   *
   * @default - Not included in the rule
   */
  readonly fromPort?: number;

  /**
   * The ending port for the range
   *
   * @default - Not included in the rule
   */
  readonly toPort?: number;

  /**
   * String representation for this object
   */
  readonly stringRepresentation: string;
}

/**
 * Interface for classes that provide the connection-specification parts of a security group rule
 */
export class Port {
  /** Well-known SSH port (TCP 22) */
  public static readonly SSH = Port.tcp(22);
  /** Well-known SMTP port (TCP 25) */
  public static readonly SMTP = Port.tcp(25);
  /** Well-known DNS port (UDP 53) */
  public static readonly DNS_UDP = Port.udp(53);
  /** Well-known DNS port (TCP 53) */
  public static readonly DNS_TCP = Port.tcp(53);
  /** Well-known HTTP port (TCP 80) */
  public static readonly HTTP = Port.tcp(80);
  /** Well-known POP3 port (TCP 110) */
  public static readonly POP3 = Port.tcp(110);
  /** Well-known IMAP port (TCP 143) */
  public static readonly IMAP = Port.tcp(143);
  /** Well-known LDAP port (TCP 389) */
  public static readonly LDAP = Port.tcp(389);
  /** Well-known HTTPS port (TCP 443) */
  public static readonly HTTPS = Port.tcp(443);
  /** Well-known SMB port (TCP 445) */
  public static readonly SMB = Port.tcp(445);
  /** Well-known IMAPS port (TCP 993) */
  public static readonly IMAPS = Port.tcp(993);
  /** Well-known POP3S port (TCP 995) */
  public static readonly POP3S = Port.tcp(995);
  /** Well-known Microsoft SQL Server port (TCP 1433) */
  public static readonly MSSQL = Port.tcp(1433);
  /** Well-known NFS port (TCP 2049) */
  public static readonly NFS = Port.tcp(2049);
  /** Well-known MySQL and Aurora port (TCP 3306) */
  public static readonly MYSQL_AURORA = Port.tcp(3306);
  /** Well-known Microsoft Remote Desktop Protocol port (TCP 3389) */
  public static readonly RDP = Port.tcp(3389);
  /** Well-known PostgreSQL port (TCP 5432) */
  public static readonly POSTGRES = Port.tcp(5432);

  /**
   * A single TCP port
   */
  public static tcp(port: number): Port {
    return new Port({
      protocol: Protocol.TCP,
      fromPort: port,
      toPort: port,
      stringRepresentation: renderPort(port),
    });
  }

  /**
   * A TCP port range
   */
  public static tcpRange(startPort: number, endPort: number) {
    return new Port({
      protocol: Protocol.TCP,
      fromPort: startPort,
      toPort: endPort,
      stringRepresentation: `${renderPort(startPort)}-${renderPort(endPort)}`,
    });
  }

  /**
   * Any TCP traffic
   */
  public static allTcp() {
    return new Port({
      protocol: Protocol.TCP,
      fromPort: 0,
      toPort: 65535,
      stringRepresentation: "ALL PORTS",
    });
  }

  /**
   * A single UDP port
   */
  public static udp(port: number): Port {
    return new Port({
      protocol: Protocol.UDP,
      fromPort: port,
      toPort: port,
      stringRepresentation: `UDP ${renderPort(port)}`,
    });
  }

  /**
   * A UDP port range
   */
  public static udpRange(startPort: number, endPort: number) {
    return new Port({
      protocol: Protocol.UDP,
      fromPort: startPort,
      toPort: endPort,
      stringRepresentation: `UDP ${renderPort(startPort)}-${renderPort(
        endPort,
      )}`,
    });
  }

  /**
   * Any UDP traffic
   */
  public static allUdp() {
    return new Port({
      protocol: Protocol.UDP,
      fromPort: 0,
      toPort: 65535,
      stringRepresentation: "UDP ALL PORTS",
    });
  }

  /**
   * A specific combination of ICMP type and code
   *
   * @see https://www.iana.org/assignments/icmp-parameters/icmp-parameters.xhtml
   */
  public static icmpTypeAndCode(type: number, code: number) {
    return new Port({
      protocol: Protocol.ICMP,
      fromPort: type,
      toPort: code,
      stringRepresentation: `ICMP Type ${type} Code ${code}`,
    });
  }

  /**
   * All codes for a single ICMP type
   */
  public static icmpType(type: number): Port {
    return new Port({
      protocol: Protocol.ICMP,
      fromPort: type,
      toPort: -1,
      stringRepresentation: `ICMP Type ${type}`,
    });
  }

  /**
   * ICMP ping (echo) traffic
   */
  public static icmpPing() {
    return Port.icmpType(8);
  }

  /**
   * All ICMP traffic
   */
  public static allIcmp() {
    return new Port({
      protocol: Protocol.ICMP,
      fromPort: -1,
      toPort: -1,
      stringRepresentation: "ALL ICMP",
    });
  }

  /**
   * All ICMPv6 traffic
   */
  public static allIcmpV6() {
    return new Port({
      protocol: Protocol.ICMPV6,
      fromPort: -1,
      toPort: -1,
      stringRepresentation: "ALL ICMPv6",
    });
  }

  /**
   * All traffic
   */
  public static allTraffic() {
    /**
     * The IP protocol name or number. Use -1 to specify all protocols.
     *
     * Note that if ip_protocol is set to -1, it translates to all protocols,
     * all port ranges, and from_port and to_port values should not be defined.
     */
    return new Port({
      protocol: Protocol.ALL,
      // fromPort: -1,
      // toPort: -1,
      stringRepresentation: "ALL TRAFFIC",
    });
  }

  /**
   * A single ESP port
   */
  public static esp(): Port {
    return new Port({
      protocol: Protocol.ESP,
      fromPort: 50,
      toPort: 50,
      stringRepresentation: "ESP 50",
    });
  }

  /**
   * A single AH port
   */
  public static ah(): Port {
    return new Port({
      protocol: Protocol.AH,
      fromPort: 51,
      toPort: 51,
      stringRepresentation: "AH 51",
    });
  }

  /**
   * Whether the rule containing this port range can be inlined into a securitygroup or not.
   */
  public readonly canInlineRule: boolean;

  constructor(private readonly props: PortProps) {
    this.canInlineRule =
      !Token.isUnresolved(props.fromPort) && !Token.isUnresolved(props.toPort);
  }

  /**
   * Produce the ingress/egress rule JSON for the given connection
   */
  public toRuleJson(): any {
    // JSII does not allow enum types to have same value. So to support the enum, the enum with same value has to be mapped later.
    const PROTOCOL_MAP: Partial<Record<Protocol, string>> = {
      [Protocol.IPTM]: "84",
    };
    return {
      // tf provider ingress and egress rule use `ipProtocol`
      ipProtocol: PROTOCOL_MAP[this.props.protocol] ?? this.props.protocol,
      // tf provider direct rule and generic rule use `protocol`
      protocol: PROTOCOL_MAP[this.props.protocol] ?? this.props.protocol,
      fromPort: this.props.fromPort,
      toPort: this.props.toPort,
    };
  }

  public toString(): string {
    return this.props.stringRepresentation;
  }
}

function renderPort(port: number) {
  return Token.isUnresolved(port) ? "{IndirectPort}" : port.toString();
}
