import { cloudwatchEventConnection } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import {
  IAwsConstruct,
  AwsConstructProps,
  AwsConstructBase,
} from "../aws-construct";
import { AwsStack } from "../aws-stack";

/**
 * An API Destination Connection
 *
 * A connection defines the authorization type and credentials to use for authorization with an API destination HTTP endpoint.
 */
export interface ConnectionProps extends AwsConstructProps {
  /**
   * The name of the connection.
   *
   * Maximum of 64 characters consisting of numbers, lower/upper case letters, .,-,_.
   *
   * @default - A name is automatically generated
   */
  readonly connectionName?: string;

  /**
   * The name of the connection.
   *
   * Maximum of 512 characters.
   *
   * @default - none
   */
  readonly description?: string;

  /**
   * The authorization type for the connection.
   */
  readonly authorization: Authorization;

  /**
   * Additional string parameters to add to the invocation bodies
   *
   * @default - No additional parameters
   */
  readonly bodyParameters?: Record<string, HttpParameter>;

  /**
   * Additional string parameters to add to the invocation headers
   *
   * @default - No additional parameters
   */
  readonly headerParameters?: Record<string, HttpParameter>;

  /**
   * Additional string parameters to add to the invocation query strings
   *
   * @default - No additional parameters
   */
  readonly queryStringParameters?: Record<string, HttpParameter>;
}

/**
 * Authorization type for an API Destination Connection
 */
export abstract class Authorization {
  /**
   * Use API key authorization
   *
   * API key authorization has two components: an API key name and an API key value.
   * What these are depends on the target of your connection.
   */
  public static apiKey(apiKeyName: string, apiKeyValue: string): Authorization {
    return new (class extends Authorization {
      public _bind() {
        let authParameters: cloudwatchEventConnection.CloudwatchEventConnectionAuthParameters =
          {
            apiKey: {
              key: apiKeyName,
              value: apiKeyValue, // TODO: Flag as sensitive?
            },
          };
        return {
          authorizationType: AuthorizationType.API_KEY,
          authParameters,
        };
      }
    })();
  }

  /**
   * Use username and password authorization
   */
  public static basic(username: string, password: string): Authorization {
    return new (class extends Authorization {
      public _bind() {
        let authParameters: cloudwatchEventConnection.CloudwatchEventConnectionAuthParameters =
          {
            basic: {
              username: username,
              password: password, // TODO: Flag as sensitive?
            },
          };
        return {
          authorizationType: AuthorizationType.BASIC,
          authParameters,
        };
      }
    })();
  }

  /**
   * Use OAuth authorization
   */
  public static oauth(props: OAuthAuthorizationProps): Authorization {
    if (
      ![HttpMethod.POST, HttpMethod.GET, HttpMethod.PUT].includes(
        props.httpMethod,
      )
    ) {
      throw new Error("httpMethod must be one of GET, POST, PUT");
    }

    return new (class extends Authorization {
      public _bind() {
        let authParameters: cloudwatchEventConnection.CloudwatchEventConnectionAuthParameters =
          {
            oauth: {
              authorizationEndpoint: props.authorizationEndpoint,
              clientParameters: {
                clientId: props.clientId,
                clientSecret: props.clientSecret, // TODO: Flag as sensitive?
              },
              httpMethod: props.httpMethod,
              oauthHttpParameters: {
                body: renderHttpParameters(props.bodyParameters),
                header: renderHttpParameters(props.headerParameters),
                queryString: renderHttpParameters(props.queryStringParameters),
              },
            },
          };
        return {
          authorizationType: AuthorizationType.OAUTH_CLIENT_CREDENTIALS,
          authParameters,
        };
      }
    })();
  }

  /**
   * Bind the authorization to the construct and return the authorization properties
   *
   * @internal
   */
  public abstract _bind(): AuthorizationBindResult;
}

/**
 * Properties for `Authorization.oauth()`
 */
export interface OAuthAuthorizationProps {
  /**
   * The URL to the authorization endpoint
   */
  readonly authorizationEndpoint: string;

  /**
   * The method to use for the authorization request.
   *
   * (Can only choose POST, GET or PUT).
   */
  readonly httpMethod: HttpMethod;

  /**
   * The client ID to use for OAuth authorization for the connection.
   */
  readonly clientId: string;

  /**
   * The client secret associated with the client ID to use for OAuth authorization for the connection.
   */
  readonly clientSecret: string;

  /**
   * Additional string parameters to add to the OAuth request body
   *
   * @default - No additional parameters
   */
  readonly bodyParameters?: Record<string, HttpParameter>;

  /**
   * Additional string parameters to add to the OAuth request header
   *
   * @default - No additional parameters
   */
  readonly headerParameters?: Record<string, HttpParameter>;

  /**
   * Additional string parameters to add to the OAuth request query string
   *
   * @default - No additional parameters
   */
  readonly queryStringParameters?: Record<string, HttpParameter>;
}

/**
 * An additional HTTP parameter to send along with the OAuth request
 */
export abstract class HttpParameter {
  /**
   * Make an OAuthParameter from a string value
   *
   * The value is not treated as a secret.
   */
  public static fromString(value: string): HttpParameter {
    return new (class extends HttpParameter {
      public _render(name: string) {
        return {
          key: name,
          value,
          isValueSecret: false,
        };
      }
    })();
  }

  /**
   * Make an OAuthParameter from a secret
   */
  public static fromSecret(value: string): HttpParameter {
    return new (class extends HttpParameter {
      public _render(name: string) {
        return {
          key: name,
          value, // TODO: Flag as secret
          isValueSecret: true,
        };
      }
    })();
  }

  /**
   * Render the paramter value
   *
   * @internal
   */
  public abstract _render(name: string): any;
}

/**
 * Result of the 'bind' operation of the 'Authorization' class
 *
 * @internal
 */
export interface AuthorizationBindResult {
  /**
   * The authorization type
   */
  readonly authorizationType: AuthorizationType;

  /**
   * The authorization parameters (depends on the type)
   */
  readonly authParameters: any;
}

/**
 * Outputs to register with the Grid
 */
export interface ConnectionOutputs {
  /**
   * The name of the connection.
   */
  readonly name: string;

  /**
   * The ARN of this connection resource
   */
  readonly arn: string;

  /**
   * The Amazon Resource Name (ARN) of the secret created from the authorization parameters specified for the connection.
   */
  readonly secretArn?: string;
}

/**
 * Interface for EventBus Connections
 */
export interface IConnection extends IAwsConstruct {
  /**
   * The Name for the connection.
   * @attribute
   */
  readonly connectionName: string;

  /**
   * The ARN of the connection created.
   * @attribute
   */
  readonly connectionArn: string;

  /**
   * The ARN for the secret created for the connection.
   * @attribute
   */
  readonly connectionSecretArn: string;
}

/**
 * Interface with properties necessary to import a reusable Connection
 */
export interface ConnectionAttributes {
  /**
   * The Name for the connection.
   */
  readonly connectionName: string;

  /**
   * The ARN of the connection created.
   */
  readonly connectionArn: string;

  /**
   * The ARN for the secret created for the connection.
   */
  readonly connectionSecretArn: string;
}

/**
 * Define an EventBridge Connection
 *
 * @resource aws_cloudwatch_event_connection
 */
export class Connection extends AwsConstructBase implements IConnection {
  /**
   * Import an existing connection resource
   * @param scope Parent construct
   * @param id Construct ID
   * @param connectionArn ARN of imported connection
   */
  public static fromEventBusArn(
    scope: Construct,
    id: string,
    connectionArn: string,
    connectionSecretArn: string,
  ): IConnection {
    const parts = AwsStack.ofAwsConstruct(scope).parseArn(connectionArn);

    return new ImportedConnection(scope, id, {
      connectionArn: connectionArn,
      connectionName: parts.resourceName || "",
      connectionSecretArn: connectionSecretArn,
    });
  }

  /**
   * Import an existing connection resource
   * @param scope Parent construct
   * @param id Construct ID
   * @param attrs Imported connection properties
   */
  public static fromConnectionAttributes(
    scope: Construct,
    id: string,
    attrs: ConnectionAttributes,
  ): IConnection {
    return new ImportedConnection(scope, id, attrs);
  }

  public readonly resource: cloudwatchEventConnection.CloudwatchEventConnection;

  public readonly connectionOutputs: ConnectionOutputs;
  public get outputs(): Record<string, any> {
    return this.connectionOutputs;
  }

  /**
   * The Name for the connection.
   * @attribute
   */
  public readonly connectionName: string;

  /**
   * The ARN of the connection created.
   * @attribute
   */
  public readonly connectionArn: string;

  /**
   * The ARN for the secret created for the connection.
   * @attribute
   */
  public readonly connectionSecretArn: string;

  constructor(scope: Construct, id: string, props: ConnectionProps) {
    super(scope, id, props);

    /**
     * Maximum of 64 characters consisting of numbers, lower/upper case letters, .,-,_.
     */
    const connectionName =
      props.connectionName ??
      this.stack.uniqueResourceName(this, {
        maxLength: 64,
        allowedSpecialCharacters: ".-_",
      });

    const authBind = props.authorization._bind();

    const invocationHttpParameters:
      | cloudwatchEventConnection.CloudwatchEventConnectionAuthParametersInvocationHttpParameters
      | undefined =
      !!props.headerParameters ||
      !!props.queryStringParameters ||
      !!props.bodyParameters
        ? {
            body: renderHttpParameters(props.bodyParameters),
            header: renderHttpParameters(props.headerParameters),
            queryString: renderHttpParameters(props.queryStringParameters),
          }
        : undefined;

    this.resource = new cloudwatchEventConnection.CloudwatchEventConnection(
      this,
      "Resource",
      {
        authorizationType: authBind.authorizationType,
        authParameters: {
          ...authBind.authParameters,
          invocationHttpParameters: invocationHttpParameters,
        },
        description: props.description,
        name: connectionName,
      },
    );

    this.connectionName = this.resource.name;
    this.connectionArn = this.resource.arn;
    this.connectionSecretArn = this.resource.secretArn;
    this.connectionOutputs = {
      name: this.connectionName,
      arn: this.connectionArn,
      secretArn: this.connectionSecretArn,
    };
  }
}

class ImportedConnection extends AwsConstructBase {
  public readonly connectionArn: string;
  public readonly connectionName: string;
  public readonly connectionSecretArn: string;
  public get connectionOutputs(): ConnectionOutputs {
    return {
      name: this.connectionName,
      arn: this.connectionArn,
      secretArn: this.connectionSecretArn,
    };
  }
  public get outputs(): Record<string, any> {
    return this.connectionOutputs;
  }
  constructor(scope: Construct, id: string, attrs: ConnectionAttributes) {
    const arnParts = AwsStack.ofAwsConstruct(scope).parseArn(
      attrs.connectionArn,
    );
    super(scope, id, {
      account: arnParts.account,
      region: arnParts.region,
    });

    this.connectionArn = attrs.connectionArn;
    this.connectionName = attrs.connectionName;
    this.connectionSecretArn = attrs.connectionSecretArn;
  }
}

/**
 * Supported HTTP operations.
 */
export enum HttpMethod {
  /** POST */
  POST = "POST",
  /** GET */
  GET = "GET",
  /** HEAD */
  HEAD = "HEAD",
  /** OPTIONS */
  OPTIONS = "OPTIONS",
  /** PUT */
  PUT = "PUT",
  /** PATCH */
  PATCH = "PATCH",
  /** DELETE */
  DELETE = "DELETE",
}

/**
 * Supported Authorization Types.
 */
enum AuthorizationType {
  /** API_KEY */
  API_KEY = "API_KEY",
  /** BASIC */
  BASIC = "BASIC",
  /** OAUTH_CLIENT_CREDENTIALS */
  OAUTH_CLIENT_CREDENTIALS = "OAUTH_CLIENT_CREDENTIALS",
}

function renderHttpParameters<T>(
  ps?: Record<string, HttpParameter>,
): T[] | undefined {
  if (!ps || Object.keys(ps).length === 0) {
    return undefined;
  }

  return Object.entries(ps).map(([name, p]) => p._render(name));
}
