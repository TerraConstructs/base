// import * as cdk from '../../core';
import { Construct } from "constructs";
import * as lambda from ".";
import { LambdaIntegration, LambdaIntegrationOptions } from "./integrations";
import { Method } from "./method";
import { ProxyResource, Resource } from "./resource";
import { RestApi, RestApiProps } from "./restapi";
// import {
//   UnscopedValidationError,
//   ValidationError,
// } from "../../core/lib/errors";

export interface LambdaRestApiProps extends RestApiProps {
  /**
   * The default Lambda function that handles all requests from this API.
   *
   * This handler will be used as a the default integration for all methods in
   * this API, unless specified otherwise in `addMethod`.
   */
  readonly handler: lambda.IFunction;

  /**
   * Specific Lambda integration options.
   *
   * @default see defaults defined in `LambdaIntegrationOptions`.
   */
  readonly integrationOptions?: LambdaIntegrationOptions;

  /**
   * If true, route all requests to the Lambda Function
   *
   * If set to false, you will need to explicitly define the API model using
   * `addResource` and `addMethod` (or `addProxy`).
   *
   * @default true
   */
  readonly proxy?: boolean;

  /**
   * @deprecated the `LambdaRestApiProps` now extends `RestApiProps`, so all
   * options are just available here. Note that the options specified in
   * `options` will be overridden by any props specified at the root level.
   *
   * @default - no options.
   */
  readonly options?: RestApiProps;
}

/**
 * Defines an API Gateway REST API with AWS Lambda proxy integration.
 *
 * Use the `proxy` property to define a greedy proxy ("{proxy+}") and "ANY"
 * method from the specified path. If not defined, you will need to explicity
 * add resources and methods to the API.
 */
export class LambdaRestApi extends RestApi {
  constructor(scope: Construct, id: string, props: LambdaRestApiProps) {
    if (props.options?.defaultIntegration || props.defaultIntegration) {
      // throw new ValidationError(
      throw new Error(
        'Cannot specify "defaultIntegration" since Lambda integration is automatically defined',
        // scope,
      );
    }

    super(scope, id, {
      defaultIntegration: new LambdaIntegration(
        props.handler,
        props.integrationOptions,
      ),
      ...props.options, // deprecated, but we still support
      ...props,
    });

    if (props.proxy !== false) {
      this.root.addProxy();

      // Make sure users cannot call any other resource adding function
      this.root.addResource = addResourceThrows;
      this.root.addMethod = addMethodThrows;
      this.root.addProxy = addProxyThrows;
    }

    this.node.addValidation({
      validate() {
        for (const value of Object.values(
          props.deployOptions?.variables ?? {},
        )) {
          // Checks that variable Stage values match regex
          const regexp = /[A-Za-z0-9-._~:/?#&=,]+/;
          if (value.match(regexp) === null) {
            return [
              "Stage variable value " + value + " does not match the regex.",
            ];
          }
        }
        return [];
      },
    });
  }
}

function addResourceThrows(): Resource {
  // throw new UnscopedValidationError(
  throw new Error(
    "Cannot call 'addResource' on a proxying LambdaRestApi; set 'proxy' to false",
  );
}

function addMethodThrows(): Method {
  // throw new UnscopedValidationError(
  throw new Error(
    "Cannot call 'addMethod' on a proxying LambdaRestApi; set 'proxy' to false",
  );
}

function addProxyThrows(): ProxyResource {
  // throw new UnscopedValidationError(
  throw new Error(
    "Cannot call 'addProxy' on a proxying LambdaRestApi; set 'proxy' to false",
  );
}
