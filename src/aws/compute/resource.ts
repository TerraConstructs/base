import { apiGatewayResource } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { Cors, CorsOptions } from "./cors";
import { Integration } from "./integration";
import { MockIntegration } from "./integrations";
import { Method, MethodOptions, AuthorizationType } from "./method";
import { IRestApi, RestApi } from "./restapi";
import { Duration } from "../../duration";
// import { Fn } from "../../terra-func";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../aws-construct";

export interface IResource extends IAwsConstruct {
  /**
   * The parent of this resource or undefined for the root resource.
   */
  readonly parentResource?: IResource;

  /**
   * The rest API that this resource is part of.
   *
   * @deprecated - Throws an error if this Resource is not associated with an instance of `RestApi`. Use `api` instead.
   */
  readonly restApi: RestApi; // Assuming RestApi is a concrete class here as in CDK

  /**
   * The rest API that this resource is part of.
   */
  readonly api: IRestApi;

  /**
   * The ID of the resource.
   * @attribute
   */
  readonly resourceId: string;

  /**
   * The full path of this resource.
   */
  readonly path: string;

  /**
   * An integration to use as a default for all methods created within this
   * API unless an integration is specified.
   */
  readonly defaultIntegration?: Integration;

  /**
   * Method options to use as a default for all methods created within this
   * API unless custom options are specified.
   */
  readonly defaultMethodOptions?: MethodOptions;

  /**
   * Default options for CORS preflight OPTIONS method.
   */
  readonly defaultCorsPreflightOptions?: CorsOptions;

  /**
   * Gets or create all resources leading up to the specified path.
   *
   * - Path may only start with "/" if this method is called on the root resource.
   * - All resources are created using default options.
   *
   * @param path The relative path
   * @returns a new or existing resource.
   */
  resourceForPath(path: string): Resource;

  /**
   * Defines a new child resource where this resource is the parent.
   * @param pathPart The path part for the child resource
   * @param options Resource options
   * @returns A Resource object
   */
  addResource(pathPart: string, options?: ResourceOptions): Resource;

  /**
   * Retrieves a child resource by path part.
   *
   * @param pathPart The path part of the child resource
   * @returns the child resource or undefined if not found
   */
  getResource(pathPart: string): IResource | undefined;

  /**
   * Adds a greedy proxy resource ("{proxy+}") and an ANY method to this route.
   * @param options Default integration and method options.
   */
  addProxy(options?: ProxyResourceOptions): ProxyResource;

  /**
   * Defines a new method for this resource.
   * @param httpMethod The HTTP method
   * @param target The target backend integration for this method
   * @param options Method options, such as authentication.
   *
   * @returns The newly created `Method` object.
   */
  addMethod(
    httpMethod: string,
    target?: Integration,
    options?: MethodOptions,
  ): Method;

  /**
   * Adds an OPTIONS method to this resource which responds to Cross-Origin
   * Resource Sharing (CORS) preflight requests.
   *
   * @param options CORS options
   * @returns a `Method` object
   */
  addCorsPreflight(options: CorsOptions): Method;
}

export interface ResourceOptions {
  /**
   * An integration to use as a default for all methods created within this
   * API unless an integration is specified.
   *
   * @default - Inherited from parent.
   */
  readonly defaultIntegration?: Integration;

  /**
   * Method options to use as a default for all methods created within this
   * API unless custom options are specified.
   *
   * @default - Inherited from parent.
   */
  readonly defaultMethodOptions?: MethodOptions;

  /**
   * Adds a CORS preflight OPTIONS method to this resource and all child
   * resources.
   *
   * You can add CORS at the resource-level using `addCorsPreflight`.
   *
   * @default - CORS is disabled
   */
  readonly defaultCorsPreflightOptions?: CorsOptions;
}

export interface ResourceProps extends ResourceOptions, AwsConstructProps {
  /**
   * The parent resource of this resource. You can either pass another
   * `Resource` object or a `RestApi` object here.
   */
  readonly parent: IResource;

  /**
   * A path name for the resource.
   */
  readonly pathPart: string;
}

export abstract class ResourceBase
  extends AwsConstructBase
  implements IResource
{
  public abstract readonly parentResource?: IResource;
  /**
   * @deprecated -  Throws an error if this Resource is not associated with an instance of `RestApi`. Use `api` instead.
   */
  public abstract get restApi(): RestApi;
  public abstract readonly api: IRestApi;
  public abstract readonly resourceId: string;
  public abstract readonly path: string;
  public abstract readonly defaultIntegration?: Integration;
  public abstract readonly defaultMethodOptions?: MethodOptions;
  public abstract readonly defaultCorsPreflightOptions?: CorsOptions;

  private readonly children: { [pathPart: string]: Resource } = {};

  constructor(scope: Construct, id: string, props?: AwsConstructProps) {
    super(scope, id, props);
  }

  public addResource(pathPart: string, options?: ResourceOptions): Resource {
    return new Resource(this, pathPart, {
      parent: this,
      pathPart,
      ...options,
    });
  }

  public addMethod(
    httpMethod: string,
    integration?: Integration,
    options?: MethodOptions,
  ): Method {
    return new Method(this, httpMethod, {
      resource: this,
      httpMethod,
      integration,
      options,
    });
  }

  public addProxy(options?: ProxyResourceOptions): ProxyResource {
    return new ProxyResource(this, "{proxy+}", { parent: this, ...options });
  }

  public addCorsPreflight(options: CorsOptions): Method {
    const headers: { [name: string]: string } = {};

    const allowHeaders = options.allowHeaders || Cors.DEFAULT_HEADERS;
    headers["Access-Control-Allow-Headers"] = `'${allowHeaders.join(",")}'`;

    if (options.allowOrigins.length === 0) {
      throw new Error("allowOrigins must contain at least one origin");
    }

    if (options.allowOrigins.includes("*") && options.allowOrigins.length > 1) {
      throw new Error(
        `Invalid "allowOrigins" - cannot mix "*" with specific origins: ${options.allowOrigins.join(
          ",",
        )}`,
      );
    }

    const initialOrigin = options.allowOrigins[0];
    headers["Access-Control-Allow-Origin"] = `'${initialOrigin}'`;

    if (initialOrigin !== "*") {
      headers.Vary = "'Origin'";
    }

    let allowMethods = options.allowMethods || Cors.ALL_METHODS;

    if (allowMethods.includes("ANY")) {
      if (allowMethods.length > 1) {
        throw new Error(
          `ANY cannot be used with any other method. Received: ${allowMethods.join(
            ",",
          )}`,
        );
      }
      allowMethods = Cors.ALL_METHODS;
    }

    headers["Access-Control-Allow-Methods"] = `'${allowMethods.join(",")}'`;

    if (options.allowCredentials) {
      headers["Access-Control-Allow-Credentials"] = "'true'";
    }

    let maxAgeSeconds: number | undefined;

    if (options.maxAge && options.disableCache) {
      throw new Error(
        'The options "maxAge" and "disableCache" are mutually exclusive',
      );
    }

    if (options.maxAge instanceof Duration) {
      maxAgeSeconds = options.maxAge.toSeconds();
    }

    if (options.disableCache) {
      maxAgeSeconds = -1;
    }

    if (maxAgeSeconds !== undefined) {
      headers["Access-Control-Max-Age"] = `'${maxAgeSeconds}'`;
    }

    if (options.exposeHeaders) {
      headers["Access-Control-Expose-Headers"] = `'${options.exposeHeaders.join(
        ",",
      )}'`;
    }

    const statusCode = options.statusCode ?? 204;

    const integrationResponseParams: { [p: string]: string } = {};
    const methodResponseParams: { [p: string]: boolean } = {};

    for (const [name, value] of Object.entries(headers)) {
      const key = `method.response.header.${name}`;
      integrationResponseParams[key] = value;
      methodResponseParams[key] = true;
    }

    return this.addMethod(
      "OPTIONS",
      new MockIntegration({
        requestTemplates: { "application/json": "{ statusCode: 200 }" },
        integrationResponses: [
          {
            statusCode: `${statusCode}`,
            responseParameters: integrationResponseParams,
            responseTemplates: renderResponseTemplate(),
          },
        ],
      }),
      {
        // Assuming Authorizer has a static NONE or similar concept
        authorizer: {
          authorizerId: "", // Representing no authorizer
          authorizationType: AuthorizationType.NONE,
        },
        apiKeyRequired: false,
        authorizationType: AuthorizationType.NONE,
        methodResponses: [
          {
            statusCode: `${statusCode}`,
            responseParameters: methodResponseParams,
          },
        ],
      },
    );

    function renderResponseTemplate() {
      const origins = options.allowOrigins.slice(1);

      if (origins.length === 0) {
        return undefined;
      }

      const template = new Array<string>();

      template.push(
        '#set($origin = $input.params().header.get("Origin"))',
        '#if($origin == "")',
        '  #set($origin = $input.params().header.get("origin"))',
        "#end",
      );

      const condition = origins.map((o) => `$origin == "${o}"`).join(" || ");

      template.push(`#if(${condition})`);
      template.push(
        "  #set($context.responseOverride.header.Access-Control-Allow-Origin = $origin)",
      );
      template.push("#end");

      return {
        "application/json": template.join("\n"),
      };
    }
  }

  public getResource(pathPart: string): IResource | undefined {
    return this.children[pathPart];
  }

  /**
   * @internal
   */
  public _trackChild(pathPart: string, resource: Resource) {
    this.children[pathPart] = resource;
  }

  public resourceForPath(path: string): Resource {
    if (!path) {
      // This cast is safe because `this` conforms to `Resource` if path is empty.
      return this as unknown as Resource;
    }

    if (path.startsWith("/")) {
      if (this.path !== "/") {
        throw new Error(
          `Path may start with "/" only for the root resource, but we are at: ${this.path}`,
        );
      }
      return this.resourceForPath(path.slice(1));
    }

    const parts = path.split("/");
    const next = parts.shift();
    if (!next || next === "") {
      throw new Error("resourceForPath cannot be called with an empty path");
    }

    let resource = this.getResource(next) as Resource | undefined;
    if (!resource) {
      resource = this.addResource(next);
    }

    return resource.resourceForPath(parts.join("/"));
  }

  /**
   * @deprecated - Throws error in some use cases that have been enabled since this deprecation notice. Use `RestApi.urlForPath()` instead.
   */
  public get url(): string {
    return this.restApi.urlForPath(this.path);
  }

  // Base AwsConstruct output, can be overridden by derived classes
  public get outputs(): Record<string, any> {
    return {
      resourceId: this.resourceId,
      path: this.path,
    };
  }
}

/**
 * Attributes that can be specified when importing a Resource
 */
export interface ResourceAttributes {
  /**
   * The ID of the resource.
   */
  readonly resourceId: string;

  /**
   * The rest API that this resource is part of.
   */
  readonly restApi: IRestApi;

  /**
   * The full path of this resource.
   */
  readonly path: string;
}

export class Resource extends ResourceBase {
  /**
   * Import an existing resource
   */
  public static fromResourceAttributes(
    scope: Construct,
    id: string,
    attrs: ResourceAttributes,
  ): IResource {
    class Import extends ResourceBase {
      public readonly api = attrs.restApi;
      public readonly resourceId = attrs.resourceId;
      public readonly path = attrs.path;
      public readonly defaultIntegration?: Integration = undefined;
      public readonly defaultMethodOptions?: MethodOptions = undefined;
      public readonly defaultCorsPreflightOptions?: CorsOptions = undefined;
      public readonly parentResource?: IResource = undefined; // Imported resources don't have a parent in the same construct tree

      public get restApi(): RestApi {
        if (this.api instanceof RestApi) {
          return this.api;
        }
        throw new Error(
          "restApi is not available for this imported resource or it's not an instance of RestApi.",
        );
      }
    }

    return new Import(scope, id);
  }

  public readonly parentResource?: IResource;
  public readonly api: IRestApi;
  public readonly resourceId: string;
  public readonly path: string;

  public readonly defaultIntegration?: Integration;
  public readonly defaultMethodOptions?: MethodOptions;
  public readonly defaultCorsPreflightOptions?: CorsOptions;

  private readonly _resource: apiGatewayResource.ApiGatewayResource;

  constructor(scope: Construct, id: string, props: ResourceProps) {
    super(scope, id, props);

    validateResourcePathPart(props.pathPart, this);

    this.parentResource = props.parent;

    if (props.parent instanceof ResourceBase) {
      props.parent._trackChild(props.pathPart, this);
    }

    const resourceProps: apiGatewayResource.ApiGatewayResourceConfig = {
      restApiId: props.parent.api.restApiId,
      parentId: props.parent.resourceId,
      pathPart: props.pathPart,
    };
    this._resource = new apiGatewayResource.ApiGatewayResource(
      this,
      "Resource",
      resourceProps,
    );

    this.resourceId = this._resource.id;
    this.api = props.parent.api;

    let currentPath = props.parent.path;
    if (currentPath !== "/") {
      // Ensure trailing slash for parent unless it's the root
      if (!currentPath.endsWith("/")) {
        currentPath += "/";
      }
      this.path = currentPath + props.pathPart;
    } else {
      this.path = currentPath + props.pathPart;
    }

    const deployment = props.parent.api.latestDeployment;
    if (deployment) {
      deployment.node.addDependency(this._resource);
      // CDKTF handles deployment updates based on resource changes implicitly or via explicit triggers.
      // Fn.sha1(Fn.jsonencode()) causes nested Tokens and Resolver errors?
      deployment.addToTriggers({ resource: resourceProps });
      // The addToLogicalId part is CDK/CFN specific for logical ID stability.
      // deployment.addToLogicalId({ resource: resourceProps });
    }

    this.defaultIntegration =
      props.defaultIntegration || props.parent.defaultIntegration;
    this.defaultMethodOptions = {
      ...props.parent.defaultMethodOptions,
      ...props.defaultMethodOptions,
    };
    this.defaultCorsPreflightOptions =
      props.defaultCorsPreflightOptions ||
      props.parent.defaultCorsPreflightOptions;

    if (this.defaultCorsPreflightOptions) {
      this.addCorsPreflight(this.defaultCorsPreflightOptions);
    }
  }

  /**
   * The RestApi associated with this Resource
   * @deprecated - Throws an error if this Resource is not associated with an instance of `RestApi`. Use `api` instead.
   */
  public get restApi(): RestApi {
    if (this.api instanceof RestApi) {
      return this.api;
    }
    throw new Error(
      "The 'api' property is not an instance of RestApi. The 'restApi' getter is deprecated and requires a concrete RestApi instance.",
    );
  }
}

export interface ProxyResourceOptions extends ResourceOptions {
  /**
   * Adds an "ANY" method to this resource. If set to `false`, you will have to explicitly
   * add methods to this resource after it's created.
   *
   * @default true
   */
  readonly anyMethod?: boolean;
}

export interface ProxyResourceProps extends ProxyResourceOptions {
  /**
   * The parent resource of this resource. You can either pass another
   * `Resource` object or a `RestApi` object here.
   */
  readonly parent: IResource;
}

/**
 * Defines a {proxy+} greedy resource and an ANY method on a route.
 * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-set-up-simple-proxy.html
 */
export class ProxyResource extends Resource {
  /**
   * If `props.anyMethod` is `true`, this will be the reference to the 'ANY'
   * method associated with this proxy resource.
   */
  public readonly anyMethod?: Method;

  constructor(scope: Construct, id: string, props: ProxyResourceProps) {
    super(scope, id, {
      parent: props.parent,
      pathPart: "{proxy+}",
      defaultIntegration: props.defaultIntegration,
      defaultMethodOptions: props.defaultMethodOptions,
    });

    const anyMethodEnabled = props.anyMethod ?? true;
    if (anyMethodEnabled) {
      this.anyMethod = this.addMethod("ANY");
    }
  }

  public addMethod(
    httpMethod: string,
    integration?: Integration,
    options?: MethodOptions,
  ): Method {
    if (this.parentResource && this.parentResource.path === "/") {
      // Check if the method already exists on the parent to avoid duplication
      const existingMethod = this.parentResource.node
        .findAll()
        .find(
          (child) => child instanceof Method && child.httpMethod === httpMethod,
        );
      if (!existingMethod) {
        this.parentResource.addMethod(httpMethod, integration, options);
      }
    }
    return super.addMethod(httpMethod, integration, options);
  }
}

function validateResourcePathPart(part: string, scope: Construct) {
  // strip {} which indicate this is a parameter
  let validatedPart = part;
  if (validatedPart.startsWith("{") && validatedPart.endsWith("}")) {
    validatedPart = validatedPart.slice(1, -1);

    // proxy resources are allowed to end with a '+'
    // if (validatedPart.endsWith("+$")) {
    if (validatedPart.endsWith("+")) {
      validatedPart = validatedPart.slice(0, -1);
    }
  }

  // REVERTED - CDK allows '$' but Terraform provider for aws_api_gateway_resource path_part
  //            does not seem to explicitly list it.
  // REVERTED - The regex /^[a-zA-Z0-9_.-]*$/ is often used for such identifiers.
  // if (!/^[a-zA-Z0-9:._-]+$/.test(validatedPart)) {
  if (!/^[a-zA-Z0-9:\.\_\-\$]+$/.test(validatedPart)) {
    // Adjusted to match CDK's broader allowance, but this might need refinement based on actual provider constraints.
    throw new Error(
      `Resource's path part can only contain alphanumeric characters, hyphens, underscores, periods, colons, an optional trailing '+'
      and curly braces at the beginning and the end:. Path part: ${part} (${scope.node.path})`,
    );
  }
}
