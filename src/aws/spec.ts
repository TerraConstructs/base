import {
  dataAwsAvailabilityZones,
  dataAwsCallerIdentity,
  dataAwsPartition,
  dataAwsRegion,
  dataAwsServicePrincipal,
  provider,
} from "@cdktf/provider-aws";
import {
  TerraformStack,
  TerraformIterator,
  Token,
  Fn,
  ResourceTerraformIterator,
} from "cdktf";
import { snakeCase } from "change-case";
import { Construct, IConstruct } from "constructs";
import { Arn, ArnComponents, ArnFormat } from "./arn";
import { AwsProviderConfig } from "./provider-config.generated";
import { SKIP_DEPENDENCY_PROPAGATION } from "../private/terraform-dependables-aspect";
import { SpecBaseProps, SpecBase, ISpec } from "../spec-base";

const AWS_SPEC_SYMBOL = Symbol.for("@envtio/base/lib/aws.AwsSpec");

export interface AwsSpecProps extends SpecBaseProps {
  /**
   * The AWS Provider configuration (without the alias field)
   */
  readonly providerConfig: AwsProviderConfig;
}

export interface IAwsSpec extends ISpec {
  /**
   * The AWS Region for the beacon
   */
  readonly region: string;
  /**
   * The AWS Account for the beacon
   */
  readonly account: string;
  /**
   * The AWS Partition for the beacon
   */
  readonly partition: string;

  /**
   * The service Principal Id for a specific service
   *
   * @param serviceName The service name to get the service principal ID for
   * @param region The region to get the service principal ID for
   */
  servicePrincipalName(serviceName: string, region?: string): string;
  // /**
  //  * Produce the Token's value at resolution time
  //  */
  // resolve<T>(obj: T): T;
}

interface AwsLookup {
  awsProvider: provider.AwsProvider;
  dataAwsRegion?: dataAwsRegion.DataAwsRegion;
  dataAwsCallerIdentity?: dataAwsCallerIdentity.DataAwsCallerIdentity;
  dataAwsPartition?: dataAwsPartition.DataAwsPartition;
  dataAwsAvailabilityZones?: dataAwsAvailabilityZones.DataAwsAvailabilityZones;
  // AWS Service Principals by region and by service
  dataAwsServicePrincipals: Record<
    string,
    Record<string, dataAwsServicePrincipal.DataAwsServicePrincipal>
  >;
}

/**
 * A Terraform stack constrained to a single AWS Account/Region to simulate CFN behavior.
 */
export class AwsSpec extends SpecBase implements IAwsSpec {
  // ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/stack.ts#L204

  /**
   * Return whether the given object is a Stack.
   *
   * attribute detection since as 'instanceof' potentially fails across Library releases.
   */
  public static isAwsSpec(x: any): x is AwsSpec {
    return x !== null && typeof x === "object" && AWS_SPEC_SYMBOL in x;
  }

  // ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/stack.ts#L212

  /**
   * Looks up the first stack scope in which `construct` is defined. Fails if there is no stack up the tree or the stack is not an AwsSpec.
   * @param construct The construct to start the search from.
   */
  public static ofAwsBeacon(construct: IConstruct): AwsSpec {
    const s = TerraformStack.of(construct);
    if (AwsSpec.isAwsSpec(s)) {
      return s;
    }
    throw new Error(
      `Resource '${construct.constructor?.name}' at '${construct.node.path}' should be created in the scope of an AwsSpec, but no AwsSpec found`,
    );
  }

  private readonly lookup: AwsLookup;
  private regionalAwsProviders: { [region: string]: provider.AwsProvider } = {};

  /**
   * Cache these tokens for reliable comparisons.
   *
   * Every call for the same Token will produce a new unique string, no
   * attempt is made to deduplicate. Token objects should cache the
   * value themselves, if required.
   *
   * dataSource.getSTringattribute -> Token.asString -> tokenMap.registerString
   * ref:
   * - https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/terraform-data-source.ts#L68
   * - https://github.com/hashicorp/terraform-cdk/blob/v0.20.10/packages/cdktf/lib/tokens/private/token-map.ts#L50-L66
   */
  private _accountIdToken: string | undefined;
  private _paritionToken: string | undefined;
  private _urlSuffixToken: string | undefined;

  constructor(scope: Construct, id: string, props: AwsSpecProps) {
    super(scope, id, props);
    this.lookup = {
      awsProvider: new provider.AwsProvider(
        this,
        "defaultAwsProvider",
        props.providerConfig,
      ),
      dataAwsServicePrincipals: {},
    };
    // these should never depend on anything (HACK to avoid cycles)
    Object.defineProperty(this, AWS_SPEC_SYMBOL, { value: true });
  }

  public get provider(): provider.AwsProvider {
    return this.lookup.awsProvider;
  }

  /**
   * Get the Region of the AWS Stack
   */
  public get region(): string {
    if (this.lookup.awsProvider.region) {
      return this.lookup.awsProvider.region;
    }
    if (!this.lookup.dataAwsRegion) {
      const region = new dataAwsRegion.DataAwsRegion(this, "Region", {
        provider: this.lookup.awsProvider,
      });
      // these should never depend on anything (HACK to avoid cycles)
      Object.defineProperty(region, SKIP_DEPENDENCY_PROPAGATION, {
        value: true,
      });
      this.lookup.dataAwsRegion = region;
    }
    return this.lookup.dataAwsRegion.name;
  }

  private get dataAwsCallerIdentity(): dataAwsCallerIdentity.DataAwsCallerIdentity {
    if (!this.lookup.dataAwsCallerIdentity) {
      const identity = new dataAwsCallerIdentity.DataAwsCallerIdentity(
        this,
        "CallerIdentity",
        {
          provider: this.lookup.awsProvider,
        },
      );
      // these should never depend on anything (HACK to avoid cycles)
      Object.defineProperty(identity, SKIP_DEPENDENCY_PROPAGATION, {
        value: true,
      });
      this.lookup.dataAwsCallerIdentity = identity;
    }
    return this.lookup.dataAwsCallerIdentity;
  }

  private get dataAwsAvailabilityZones(): dataAwsAvailabilityZones.DataAwsAvailabilityZones {
    if (!this.lookup.dataAwsAvailabilityZones) {
      const azs = new dataAwsAvailabilityZones.DataAwsAvailabilityZones(
        this,
        "AvailabilityZones",
        {
          provider: this.lookup.awsProvider,
        },
      );
      // these should never depend on anything (HACK to avoid cycles)
      Object.defineProperty(azs, SKIP_DEPENDENCY_PROPAGATION, { value: true });
      this.lookup.dataAwsAvailabilityZones = azs;
    }
    return this.lookup.dataAwsAvailabilityZones;
  }

  private get dataAwsPartition(): dataAwsPartition.DataAwsPartition {
    if (!this.lookup.dataAwsPartition) {
      const partition = new dataAwsPartition.DataAwsPartition(
        this,
        "Partitition",
        {
          provider: this.lookup.awsProvider,
        },
      );
      // these should never depend on anything (HACK to avoid cycles)
      Object.defineProperty(partition, SKIP_DEPENDENCY_PROPAGATION, {
        value: true,
      });
      this.lookup.dataAwsPartition = partition;
    }
    return this.lookup.dataAwsPartition;
  }

  private getRegionalAwsProvider(region: string): provider.AwsProvider {
    if (!this.regionalAwsProviders[region]) {
      this.regionalAwsProviders[region] = new provider.AwsProvider(
        this,
        `aws_${toTerraformIdentifier(region)}`,
        {
          region,
          alias: toTerraformIdentifier(region),
        },
      );
    }
    return this.regionalAwsProviders[region];
  }

  /**
   * Get the Account of the AWS Stack
   */
  public get account(): string {
    if (!this._accountIdToken) {
      this._accountIdToken = this.dataAwsCallerIdentity.accountId;
    }
    return this._accountIdToken;
  }

  /**
   * Get the Partition of the AWS Stack
   */
  public get partition() {
    if (!this._paritionToken) {
      this._paritionToken = this.dataAwsPartition.partition;
    }
    return this._paritionToken;
  }

  /**
   * Base DNS domain name for the current partition (e.g., amazonaws.com in AWS Commercial, amazonaws.com.cn in AWS China).
   */
  public get urlSuffix() {
    if (!this._urlSuffixToken) {
      this._urlSuffixToken = this.dataAwsPartition.dnsSuffix;
    }
    return this._urlSuffixToken;
  }

  /**
   * Return the service principal name based on the region it's used in.
   *
   * Some service principal names used to be different for different partitions,
   * and some were not.
   *
   * These days all service principal names are standardized, and they are all
   * of the form `<servicename>.amazonaws.com`.
   *
   * To avoid breaking changes, handling is provided for services added with the formats below,
   * however, no additional handling will be added for new regions or partitions.
   *   - s3
   *   - s3.amazonaws.com
   *   - s3.amazonaws.com.cn
   *   - s3.c2s.ic.gov
   *   - s3.sc2s.sgov.gov
   *
   * @param service The service name to get the service principal ID for
   * @param region The region to get the service principal ID for
   */
  public servicePrincipalName(service: string, region?: string): string {
    const DEFAULT_REGION_KEY = "default_region";
    if (!region) {
      region = DEFAULT_REGION_KEY;
    }

    if (Token.isUnresolved(region)) {
      throw new Error(
        "Cannot determine the service principal ID because the region is a token. " +
          "You must specify the region explicitly.",
      );
    }

    // if full service name is provided, extract just the service name
    // for supported cases (as required by Terraform aws_service_principal Data Source)
    const match = service.match(
      /^([^.]+)(?:(?:\.amazonaws\.com(?:\.cn)?)|(?:\.c2s\.ic\.gov)|(?:\.sc2s\.sgov\.gov))?$/,
    );
    const serviceName = match ? match[1] : service;
    if (!this.lookup.dataAwsServicePrincipals[region]) {
      this.lookup.dataAwsServicePrincipals[region] = {};
    }
    if (!this.lookup.dataAwsServicePrincipals[region][serviceName]) {
      const svcp = new dataAwsServicePrincipal.DataAwsServicePrincipal(
        this,
        `aws_svcp_${toTerraformIdentifier(region)}_${serviceName}}`,
        {
          serviceName,
          provider:
            region === DEFAULT_REGION_KEY
              ? undefined
              : this.getRegionalAwsProvider(region),
        },
      );
      // these should never depend on anything (HACK to avoid cycles)
      Object.defineProperty(svcp, SKIP_DEPENDENCY_PROPAGATION, { value: true });
      this.lookup.dataAwsServicePrincipals[region][serviceName] = svcp;
    }
    return this.lookup.dataAwsServicePrincipals[region][serviceName].name;
  }

  /**
   * Creates an ARN from components.
   *
   * If `partition`, `region` or `account` are not specified, the stack's
   * partition, region and account will be used.
   *
   * If any component is the empty string, an empty string will be inserted
   * into the generated ARN at the location that component corresponds to.
   *
   * The ARN will be formatted as follows:
   *
   *   arn:{partition}:{service}:{region}:{account}:{resource}{sep}{resource-name}
   *
   * The required ARN pieces that are omitted will be taken from the stack that
   * the 'scope' is attached to. If all ARN pieces are supplied, the supplied scope
   * can be 'undefined'.
   */
  public formatArn(components: ArnComponents): string {
    return Arn.format(components, this);
  }

  /**
   * Given an ARN, parses it and returns components.
   *
   * IF THE ARN IS A CONCRETE STRING...
   *
   * ...it will be parsed and validated. The separator (`sep`) will be set to '/'
   * if the 6th component includes a '/', in which case, `resource` will be set
   * to the value before the '/' and `resourceName` will be the rest. In case
   * there is no '/', `resource` will be set to the 6th components and
   * `resourceName` will be set to the rest of the string.
   *
   * IF THE ARN IS A TOKEN...
   *
   * ...it cannot be validated, since we don't have the actual value yet at the
   * time of this function call. You will have to supply `sepIfToken` and
   * whether or not ARNs of the expected format usually have resource names
   * in order to parse it properly. The resulting `ArnComponents` object will
   * contain tokens for the subexpressions of the ARN, not string literals.
   *
   * If the resource name could possibly contain the separator char, the actual
   * resource name cannot be properly parsed. This only occurs if the separator
   * char is '/', and happens for example for S3 object ARNs, IAM Role ARNs,
   * IAM OIDC Provider ARNs, etc. To properly extract the resource name from a
   * Tokenized ARN, you must know the resource type and call
   * `Arn.extractResourceName`.
   *
   * @param arn The ARN string to parse
   * @param sepIfToken The separator used to separate resource from resourceName
   * @param hasName Whether there is a name component in the ARN at all. For
   * example, SNS Topics ARNs have the 'resource' component contain the topic
   * name, and no 'resourceName' component.
   *
   * @returns an ArnComponents object which allows access to the various
   * components of the ARN.
   *
   * @returns an ArnComponents object which allows access to the various
   *      components of the ARN.
   *
   * @deprecated use splitArn instead
   */
  public parseArn(
    arn: string,
    sepIfToken: string = "/",
    hasName: boolean = true,
  ): ArnComponents {
    return Arn.parse(arn, sepIfToken, hasName);
  }

  /**
   * Splits the provided ARN into its components.
   * Works both if 'arn' is a string like 'arn:aws:s3:::bucket',
   * and a Token representing a dynamic CloudFormation expression
   * (in which case the returned components will also be dynamic CloudFormation expressions,
   * encoded as Tokens).
   *
   * @param arn the ARN to split into its components
   * @param arnFormat the expected format of 'arn' - depends on what format the service 'arn' represents uses
   */
  public splitArn(arn: string, arnFormat: ArnFormat): ArnComponents {
    return Arn.split(arn, arnFormat);
  }

  /**
   * Returns iterator for all AZs that are available in the AWS environment
   * (account/region) associated with this stack (default or aliased provider).
   *
   * this will return a cdktf iterator
   *
   * https://developer.hashicorp.com/terraform/cdktf/concepts/iterators#define-iterators
   *
   * To specify a different strategy for selecting availability zones override this method.
   */
  public get availabilityZoneIterator(): ResourceTerraformIterator {
    const azs = this.dataAwsAvailabilityZones;
    return TerraformIterator.fromDataSources(azs);
  }

  /**
   * Returns a Token as List of AZ names that are available in the stack's
   * AWS environment (account/region).
   *
   * The list is slized by `maxCount` which defaults to 2.
   *
   * Note: Must use `Fn.element` to access the AZ names.
   *
   * @param maxCount the maximum number of AZs to return
   */
  public availabilityZones(maxCount: number = 2): string[] {
    const azs = this.dataAwsAvailabilityZones;
    return Token.asList(Fn.slice(azs.names, 0, maxCount));
  }

  // /**
  //  * Resolve a tokenized value in the context of the current stack.
  //  */
  // public resolve<T>(obj: T): T {
  //   // ref: https://github.com/hashicorp/terraform-cdk/blob/v0.20.7/packages/cdktf/lib/terraform-stack.ts#L151
  //   // ref: https://github.com/aws/aws-cdk/blob/v2.150.0/packages/aws-cdk-lib/core/lib/stack.ts#L572
  //   return resolve(this, obj);
  // }
}

function toTerraformIdentifier(identifier: string) {
  return snakeCase(identifier).replace(/-/g, "_");
}
