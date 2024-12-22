import { iamOpenidConnectProvider } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { Arn } from "../arn";
import { IAwsBeacon, AwsBeaconBase, AwsBeaconProps } from "../beacon";

export interface OpenIdConnectProviderOutputs {
  /**
   * The Amazon Resource Name (ARN) of the IAM OpenID Connect provider.
   * @stability stable
   */
  readonly arn: string;
  /**
   * The issuer for OIDC Provider
   * @stability stable
   */
  readonly issuer: string;
}

/**
 * Represents an IAM OpenID Connect provider.
 *
 */
export interface IOpenIdConnectProvider extends IAwsBeacon {
  // strongly typed outputs
  readonly openIdConnectProviderOutputs: OpenIdConnectProviderOutputs;

  /**
   * The Amazon Resource Name (ARN) of the IAM OpenID Connect provider.
   */
  readonly openIdConnectProviderArn: string;

  /**
   * The issuer for OIDC Provider
   */
  readonly openIdConnectProviderIssuer: string;
}

/**
 * Initialization properties for `OpenIdConnectProvider`.
 */
export interface OpenIdConnectProviderProps extends AwsBeaconProps {
  /**
   * The URL of the identity provider. The URL must begin with https:// and
   * should correspond to the iss claim in the provider's OpenID Connect ID
   * tokens. Per the OIDC standard, path components are allowed but query
   * parameters are not. Typically the URL consists of only a hostname, like
   * https://server.example.org or https://example.com.
   *
   * You cannot register the same provider multiple times in a single AWS
   * account. If you try to submit a URL that has already been used for an
   * OpenID Connect provider in the AWS account, you will get an error.
   */
  readonly url: string;

  /**
   * A list of client IDs (also known as audiences). When a mobile or web app
   * registers with an OpenID Connect provider, they establish a value that
   * identifies the application. (This is the value that's sent as the client_id
   * parameter on OAuth requests.)
   *
   * You can register multiple client IDs with the same provider. For example,
   * you might have multiple applications that use the same OIDC provider. You
   * cannot register more than 100 client IDs with a single IAM OIDC provider.
   *
   * Client IDs are up to 255 characters long.
   */
  readonly clientIds: string[];

  /**
   * A list of server certificate thumbprints for the OpenID Connect (OIDC)
   * identity provider's server certificates.
   *
   * AWS secures communication with OIDC identity providers (IdPs) using our
   * library of trusted root certificate authorities (CAs) to verify the
   * JSON Web Key Set (JWKS) endpoint's TLS certificate.
   *
   * If your OIDC IdP relies on a certificate that is not signed by one of
   * these trusted CAs, only then we secure communication using the
   * thumbprints set in the IdP's configuration.
   *
   * AWS will fall back to thumbprint verification if we are unable to retrieve
   * the TLS certificate or if TLS v1.3 is required.
   *
   * See [AWS OIDC Docs](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html#manage-oidc-provider-console)
   */
  readonly thumbprints?: string[];
}

/**
 * IAM OIDC identity providers are entities in IAM that describe an external
 * identity provider (IdP) service that supports the OpenID Connect (OIDC)
 * standard, such as Google or Salesforce. You use an IAM OIDC identity provider
 * when you want to establish trust between an OIDC-compatible IdP and your AWS
 * account. This is useful when creating a mobile app or web application that
 * requires access to AWS resources, but you don't want to create custom sign-in
 * code or manage your own user identities.
 *
 * @see http://openid.net/connect
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html
 *
 * @resource AWS::CloudFormation::CustomResource
 */
export class OpenIdConnectProvider
  extends AwsBeaconBase
  implements IOpenIdConnectProvider
{
  /**
   * Imports an Open ID connect provider from an ARN.
   * @param scope The definition scope
   * @param id ID of the construct
   * @param openIdConnectProviderArn the ARN to import
   */
  public static fromOpenIdConnectProviderArn(
    scope: Construct,
    id: string,
    openIdConnectProviderArn: string,
  ): IOpenIdConnectProvider {
    const resourceName = Arn.extractResourceName(
      openIdConnectProviderArn,
      "oidc-provider",
    );

    class Import extends AwsBeaconBase implements IOpenIdConnectProvider {
      public readonly openIdConnectProviderArn = openIdConnectProviderArn;
      public readonly openIdConnectProviderIssuer = resourceName;
      public readonly openIdConnectProviderOutputs = {
        arn: openIdConnectProviderArn,
        issuer: resourceName,
      };
      public get outputs() {
        return this.openIdConnectProviderOutputs;
      }
    }

    return new Import(scope, id, {});
  }
  public readonly openIdConnectProviderOutputs: OpenIdConnectProviderOutputs;
  public get outputs(): Record<string, any> {
    return this.openIdConnectProviderOutputs;
  }
  public readonly resource: iamOpenidConnectProvider.IamOpenidConnectProvider;

  /**
   * The Amazon Resource Name (ARN) of the IAM OpenID Connect provider.
   */
  public readonly openIdConnectProviderArn: string;

  public readonly openIdConnectProviderIssuer: string;

  /**
   * The thumbprints configured for this provider.
   */
  public readonly openIdConnectProviderthumbprints: string[];

  /**
   * Defines an OpenID Connect provider.
   * @param scope The definition scope
   * @param id Construct ID
   * @param props Initialization properties
   */
  public constructor(
    scope: Construct,
    id: string,
    props: OpenIdConnectProviderProps,
  ) {
    super(scope, id, props);
    // thumbprints is still required for terraform-provider-aws, use dummy ...
    // https://github.com/hashicorp/terraform-provider-aws/issues/35112
    let thumbprintList = props.thumbprints ?? [
      "afafafafafafafafafafafafafafafafafafafaf",
    ];
    // TODO: this may cause unexpected errors if thumbprints are not provided

    this.resource = new iamOpenidConnectProvider.IamOpenidConnectProvider(
      this,
      "Resource",
      {
        url: props.url,
        clientIdList: props.clientIds,
        thumbprintList,
      },
    );
    this.openIdConnectProviderArn = this.resource.arn;
    this.openIdConnectProviderIssuer = Arn.extractResourceName(
      this.openIdConnectProviderArn,
      "oidc-provider",
    );
    this.openIdConnectProviderthumbprints = this.resource.thumbprintList;
    this.openIdConnectProviderOutputs = {
      arn: this.openIdConnectProviderArn,
      issuer: this.openIdConnectProviderIssuer,
    };
  }
}
