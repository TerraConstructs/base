// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-apigateway/lib/stepfunctions-api.ts

import { sfnStateMachine } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { RestApi, RestApiProps } from ".";
import * as sfn from ".";
import { RequestContext } from "./integrations";
import * as iam from "../iam";
import { StepFunctionsIntegration } from "./integrations/stepfunctions";
// TODO: Adopt UnscopedValidationError
// - https://github.com/aws/aws-cdk/pull/33382/
// - https://github.com/aws/aws-cdk/pull/33045
// import { ValidationError } from "../../core/lib/errors";

/**
 * Properties for StepFunctionsRestApi
 *
 */
export interface StepFunctionsRestApiProps extends RestApiProps {
  /**
   * The default State Machine that handles all requests from this API.
   *
   * This stateMachine will be used as a the default integration for all methods in
   * this API, unless specified otherwise in `addMethod`.
   */
  readonly stateMachine: sfn.IStateMachine;

  /**
   * Which details of the incoming request must be passed onto the underlying state machine,
   * such as, account id, user identity, request id, etc. The execution input will include a new key `requestContext`:
   *
   * {
   *   "body": {},
   *   "requestContext": {
   *       "key": "value"
   *   }
   * }
   *
   * @default - all parameters within request context will be set as false
   */
  readonly requestContext?: RequestContext;

  /**
   * Check if querystring is to be included inside the execution input. The execution input will include a new key `queryString`:
   *
   * {
   *   "body": {},
   *   "querystring": {
   *     "key": "value"
   *   }
   * }
   *
   * @default true
   */
  readonly querystring?: boolean;

  /**
   * Check if path is to be included inside the execution input. The execution input will include a new key `path`:
   *
   * {
   *   "body": {},
   *   "path": {
   *     "resourceName": "resourceValue"
   *   }
   * }
   *
   * @default true
   */
  readonly path?: boolean;

  /**
   * Check if header is to be included inside the execution input. The execution input will include a new key `headers`:
   *
   * {
   *   "body": {},
   *   "headers": {
   *      "header1": "value",
   *      "header2": "value"
   *   }
   * }
   * @default false
   */
  readonly headers?: boolean;

  /**
   * If the whole authorizer object, including custom context values should be in the execution input. The execution input will include a new key `authorizer`:
   *
   * {
   *   "body": {},
   *   "authorizer": {
   *     "key": "value"
   *   }
   * }
   *
   * @default false
   */
  readonly authorizer?: boolean;

  /**
   * An IAM role that API Gateway will assume to start the execution of the
   * state machine.
   *
   * @default - a new role is created
   */
  readonly role?: iam.IRole;

  /**
   * Whether to add default response models with 200, 400, and 500 status codes to the method.
   *
   * @default true
   */
  readonly useDefaultMethodResponses?: boolean;
}

/**
 * Defines an API Gateway REST API with a Synchrounous Express State Machine as a proxy integration.
 */
export class StepFunctionsRestApi extends RestApi {
  constructor(scope: Construct, id: string, props: StepFunctionsRestApiProps) {
    if (props.defaultIntegration) {
      // throw new ValidationError(
      throw new Error(
        `Cannot specify "defaultIntegration" since Step Functions integration is automatically defined. (${scope.node.path})`,
        // scope,
      );
    }

    if (
      (props.stateMachine.node.defaultChild as sfnStateMachine.SfnStateMachine)
        .typeInput !== sfn.StateMachineType.EXPRESS
    ) {
      // throw new ValidationError(
      throw new Error(
        `State Machine must be of type "EXPRESS". Please use StateMachineType.EXPRESS as the stateMachineType. (${scope.node.path})`,
        // scope,
      );
    }

    const stepfunctionsIntegration = StepFunctionsIntegration.startExecution(
      props.stateMachine,
      {
        credentialsRole: props.role,
        requestContext: props.requestContext,
        path: props.path ?? true,
        querystring: props.querystring ?? true,
        headers: props.headers,
        authorizer: props.authorizer,
        useDefaultMethodResponses: props.useDefaultMethodResponses,
      },
    );

    super(scope, id, props);

    this.root.addMethod("ANY", stepfunctionsIntegration);
  }
}
