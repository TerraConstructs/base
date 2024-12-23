import {
  acmCertificate,
  acmCertificateValidation,
  // route53Record,
} from "@cdktf/provider-aws";
import {
  Token,
  // TerraformIterator,
  // TerraformLocal,
  // Fn
} from "cdktf";
import { Construct } from "constructs";
import { IDnsZone, RecordSet, RecordTarget, RecordType } from ".";
import { Duration } from "../../duration";
import {
  AwsConstructBase,
  IAwsConstruct,
  AwsConstructProps,
} from "../aws-construct";

export interface CertificateOutputs {
  /**
   * Status of the certificate.
   */
  readonly status: string;

  /**
   * The ARN of the certificate.
   */
  readonly arn: string;

  /**
   * Set of domain validation objects which can be used to complete certificate validation.
   * Can have more than one element, e.g., if SANs are defined.
   *
   * Only set if DNS-validation was used.
   */
  readonly domainValidationOptions?: acmCertificate.AcmCertificateDomainValidationOptionsList;
}

// NOTE: The reason some properties are repeated in outputs is
// because outputs and the resource interface serve a different purpose.
// The outputs are a mechanism to expose the properties in the grid
// through the stack state while the resource interface is used
// while building composite beacons (L3) build out of base (L2) beacons.

export interface ICertificate extends IAwsConstruct {
  /** Strongly typed outputs */
  readonly certificateOutputs: CertificateOutputs;
  /**
   * Domain name of the certificate.
   */
  readonly domainName: string;
  /**
   * The ARN of the certificate.
   */
  readonly certificateArn: string;
}

export interface PublicCertificateProps extends AwsConstructProps {
  /**
   * Domain name of the certificate.
   *
   * Changing this property will force a new resource.
   */
  readonly domainName: string;
  /**
   * SANs for the domain.
   *
   * Changing this property will force a new resource.
   */
  readonly subjectAlternativeNames?: string[];
  /**
   * Specifies the algorithm of the public and private key pair that your Amazon issued
   * certificate uses to encrypt data.
   * See [ACM Certificate characteristics][acm-certificate-algorithms] for more details.
   *
   * @default RSA_2048
   *
   * [acm-certificate-algorithms]: https://docs.aws.amazon.com/acm/latest/userguide/acm-certificate-characteristics.html#algorithms
   */
  readonly keyAlgorithm?: string;
  /**
   * Validation configuration for the certificate.
   */
  readonly validation?: CertificateValidationOption;
}

export interface CertificateValidationOption {
  /**
   * How to validate this certificate
   *
   * To validate ownership by adding appropriate DNS records
   *
   * @default ValidationMethod.EMAIL
   *
   * @see https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html
   */
  readonly method: ValidationMethod;
  /**
   * Hosted zone to use for DNS validation
   *
   * @default - use email validation
   */
  readonly hostedZone?: IDnsZone;
  /**
   * A map of hosted zones to use for DNS validation
   *
   * @default - use `hostedZone`
   */
  readonly hostedZones?: { [domainName: string]: IDnsZone };

  /**
   * Validation domains to use for email validation
   *
   * @default - Apex domain
   */
  readonly validationDomains?: { [domainName: string]: string };
}

/**
 * Amazon issued certificate
 */
export class PublicCertificate
  extends AwsConstructBase
  implements ICertificate
{
  // TODO: Add static fromLookup?
  resource: acmCertificate.AcmCertificate;

  private readonly _outputs: CertificateOutputs;
  public get certificateOutputs(): CertificateOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.certificateOutputs;
  }
  private readonly _domainName: string;
  public get domainName(): string {
    return this._domainName;
  }
  private readonly _certificateArn: string;
  public get certificateArn(): string {
    return this._certificateArn;
  }

  constructor(scope: Construct, id: string, props: PublicCertificateProps) {
    super(scope, id, props);
    this._domainName = props.domainName;

    // check if domain name is 64 characters or less
    if (!Token.isUnresolved(props.domainName) && props.domainName.length > 64) {
      throw new Error("Domain name must be 64 characters or less");
    }
    let { validation } = props;
    if (!validation) {
      validation = {
        method: ValidationMethod.EMAIL,
        validationDomains: {
          [props.domainName]: props.domainName,
        },
      };
    }

    const allDomainNames = [props.domainName].concat(
      props.subjectAlternativeNames || [],
    );

    const domainValidation = renderDomainValidation(validation, allDomainNames);
    this.resource = new acmCertificate.AcmCertificate(this, "Resource", {
      ...props,
      validationMethod: validation.method,
      validationOption: domainValidation?.Options,
    });

    if (domainValidation && validation.method === ValidationMethod.DNS) {
      const records = new Array<RecordSet>();
      // TODO: Test use case where certificates exist across multiple zones (validation record should allow override)
      const sortedZones = Object.entries(domainValidation.zoneLookup).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      for (const [domainName, zone] of sortedZones) {
        const index = records.length;
        records.push(
          new RecordSet(this, `ValidationRecord-${domainName}`, {
            recordType: this.resource.domainValidationOptions.get(index)
              .resourceRecordType as RecordType,
            recordName:
              this.resource.domainValidationOptions.get(index)
                .resourceRecordName,
            target: RecordTarget.fromValues(
              this.resource.domainValidationOptions.get(index)
                .resourceRecordValue,
            ),
            ttl: Duration.seconds(60),
            zone,
            allowOverwrite: true, // required to prevent cross region wildcard errors
          }),
        );
      }
      new acmCertificateValidation.AcmCertificateValidation(
        this,
        "Validation",
        {
          certificateArn: this.resource.arn,
          validationRecordFqdns: records.map((record) => record.fqdn),
        },
      );
      // // terraform-provider-aws bug, can't use TerraformIterator (`for_each`) here:
      // // https://github.com/hashicorp/terraform-cdk/issues/3713
      // const zoneLookup: TerraformLocal = new TerraformLocal( this, "zoneLookup", domainValidation.zoneLookup);
      // const domainValidationIterator = TerraformIterator.fromComplexList( this.resource.domainValidationOptions, "domain_name");
      // // RecordSet doesn't work with zone = IResolvable
      // // using Route53Record resource directly
      // const records = new route53Record.Route53Record( this, "ValidationRecords", {
      //   forEach: domainValidationIterator,
      //   allowOverwrite: true,
      //   name: domainValidationIterator.getString("resource_record_name"),
      //   records: [
      //     domainValidationIterator.getString("resource_record_value"),
      //   ],
      //   ttl: 60,
      //   type: domainValidationIterator.getString("resource_record_type"),
      //   zoneId: Fn.lookup(zoneLookup, domainValidationIterator.key),
      // });
      // const recordsIterator = TerraformIterator.fromResources(records);
      // new acmCertificateValidation.AcmCertificateValidation( this, "Validation", {
      //   certificateArn: this.resource.arn,
      //   validationRecordFqdns: Token.asList(
      //     recordsIterator.pluckProperty("fqdn"),
      //   ),
      // });
    }

    this._certificateArn = this.resource.arn;
    this._outputs = {
      arn: this.resource.arn,
      status: this.resource.status,
      domainValidationOptions: this.resource.domainValidationOptions,
    };
  }
}

/**
 * Method used to assert ownership of the domain
 */
export enum ValidationMethod {
  /**
   * Send email to a number of email addresses associated with the domain
   *
   * IMPORTANT: if you are creating a certificate as part of your stack, the stack
   * will not complete creating until you read and follow the instructions in the
   * email that you will receive.
   *
   * ACM will send validation emails to the following addresses:
   *
   *  admin@domain.com
   *  administrator@domain.com
   *  hostmaster@domain.com
   *  postmaster@domain.com
   *  webmaster@domain.com
   *
   * For every domain that you register.
   *
   * @see https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-email.html
   */
  EMAIL = "EMAIL",

  /**
   * Validate ownership by adding appropriate DNS records
   *
   * IMPORTANT: If `hostedZone` is not specified, DNS records must be added
   * manually and the stack will not complete creating until the records are
   * added.
   *
   * @see https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html
   */
  DNS = "DNS",
}

interface DomainValidation {
  Options: acmCertificate.AcmCertificateValidationOption[];
  zoneLookup: { [domainName: string]: IDnsZone }; // string };
}

function renderDomainValidation(
  validation: CertificateValidationOption,
  domainNames: string[],
): DomainValidation | undefined {
  const result: DomainValidation = {
    Options: [],
    zoneLookup: {},
  };

  switch (validation.method) {
    case ValidationMethod.DNS:
      for (const domainName of getUniqueDnsDomainNames(domainNames)) {
        const hostedZone =
          validation.hostedZones?.[domainName] ?? validation.hostedZone;
        if (hostedZone) {
          result.Options.push({
            domainName,
            validationDomain: hostedZone.zoneName,
          });
          result.zoneLookup[domainName] = hostedZone; // .zoneId;
        }
      }
      break;
    case ValidationMethod.EMAIL:
      for (const domainName of domainNames) {
        const validationDomain = validation.validationDomains?.[domainName];
        if (!validationDomain) {
          throw new Error(
            "When using email for validation, 'validationDomains' needs to be supplied",
          );
        }
        result.Options.push({
          domainName,
          validationDomain: validationDomain,
        });
      }
      break;
    default:
      throw new Error(`Unknown validation method ${validation.method}`);
  }

  return result.Options.length !== 0 ? result : undefined;
}

/**
 * Removes wildcard domains (*.example.com) where the base domain (example.com) is present.
 * This is because the DNS validation treats them as the same thing, and the Route53 records
 * resources would be duplicated causing apply-time errors.
 */
function getUniqueDnsDomainNames(domainNames: string[]) {
  return domainNames.filter((domain) => {
    return (
      Token.isUnresolved(domain) ||
      !domain.startsWith("*.") ||
      !domainNames.includes(domain.replace("*.", ""))
    );
  });
}
