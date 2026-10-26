// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/core/lib/custom-resource-provider/custom-resource-provider-base.ts

import * as fs from "fs";
import * as path from "path";
import {
  cloudwatchLogGroup,
  iamRole,
  iamRolePolicy,
  lambdaFunction,
} from "@cdktn/provider-aws";
import { dependable } from "cdktn";
import { Construct } from "constructs";
import { AwsStack } from "./aws-stack";
import { CustomResourceProviderOptions } from "./custom-resource-provider-shared";
import { AssetStaging } from "../asset-staging";
import { FileAssetPackaging } from "../assets";
import { Duration } from "../duration";
import { ValidationError } from "../errors";
import { FileSystem } from "../fs";
import { Size } from "../size";

const ENTRYPOINT_FILENAME = "__entrypoint__";
// TERRACONSTRUCTS DEVIATION: upstream bundles `nodejs-entrypoint.js` via
// `@aws-cdk/custom-resource-handlers` build output. TerraConstructs ships the vendored (pre-transpiled) wrapper next to this
// module: `src/aws/custom-resource-handlers/...` is copied verbatim into
// `lib/aws/custom-resource-handlers/...` by the compile task.
const ENTRYPOINT_NODEJS_SOURCE = path.join(
  __dirname,
  "custom-resource-handlers",
  "core",
  "nodejs-entrypoint-handler",
  "index.js",
);

/**
 * Initialization properties for `CustomResourceProviderBase`
 */
export interface CustomResourceProviderBaseProps
  extends CustomResourceProviderOptions {
  /**
   * A local file system directory with the provider's code. The code will be
   * bundled into a zip asset and wired to the provider's AWS Lambda function.
   */
  readonly codeDirectory: string;

  /**
   * The AWS Lambda runtime and version name to use for the provider.
   */
  readonly runtimeName: string;
}

/**
 * Base class for creating a custom resource provider
 *
 * Differences from AWS CDK:
 *
 * - The provider is built from raw `aws_iam_role`, `aws_iam_role_policy`,
 *   `aws_cloudwatch_log_group` and `aws_lambda_function` resources.
 * - The function's log group (`/aws/lambda/<function name>`) is created
 *   explicitly and the role may only `logs:CreateLogStream` and
 *   `logs:PutLogEvents` on it. The role does NOT get the
 *   `AWSLambdaBasicExecutionRole` managed policy (which grants
 *   `logs:CreateLogGroup` on `*`), so log lines delivered late, after
 *   `terraform destroy` removed the log group, cannot re-create it.
 * - Pre-created roles (`@aws-cdk/core:customizeRoles`) and inline code
 *   (`@aws-cdk/core:inlineCustomResourceIfPossible`) are not supported: the
 *   code is always shipped as a zip file asset, so `codeHash` is always
 *   defined.
 */
export abstract class CustomResourceProviderBase extends Construct {
  /**
   * The hash of the lambda code backing this provider. Can be used to trigger updates
   * on code changes, even when the properties of a custom resource remain unchanged.
   */
  public get codeHash(): string {
    return this._codeHash;
  }

  /**
   * The ARN of the provider's AWS Lambda function which should be used as the `serviceToken` when defining a custom
   * resource.
   */
  public get serviceToken(): string {
    return this.handler.arn;
  }

  /**
   * The ARN of the provider's AWS Lambda function role.
   */
  public get roleArn(): string {
    return this.role.arn;
  }

  private readonly _codeHash: string;
  private readonly policyStatements: any[] = [];
  private readonly role: iamRole.IamRole;
  private readonly handler: lambdaFunction.LambdaFunction;
  private inlinePolicy?: iamRolePolicy.IamRolePolicy;

  protected constructor(
    scope: Construct,
    id: string,
    props: CustomResourceProviderBaseProps,
  ) {
    super(scope, id);

    const stack = AwsStack.ofAwsConstruct(scope);

    // verify we have an index file there
    if (!fs.existsSync(path.join(props.codeDirectory, "index.js"))) {
      throw new ValidationError(
        `cannot find ${props.codeDirectory}/index.js`,
        this,
      );
    }

    const { code, codeHandler, codeHash } = this.createCodeProp(props, stack);
    this._codeHash = codeHash;

    // TERRACONSTRUCTS DEVIATION: upstream renders a raw `AWS::IAM::Role` with
    // `ManagedPolicyArns: [AWSLambdaBasicExecutionRole]` and optional inline
    // `Policies`, and has a pre-created role branch (`customizeRoles`); here the
    // role is an `aws_iam_role` and policies are separate `aws_iam_role_policy`
    // resources.
    const assumeRolePolicyDoc = [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
      },
    ];

    this.role = new iamRole.IamRole(this, "Role", {
      namePrefix: stack.uniqueResourceNamePrefix(this.node, {
        prefix: stack.gridUUID + "-",
        allowedSpecialCharacters: "_+=,.@-",
        maxLength: 64,
      }),
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: assumeRolePolicyDoc,
      }),
    });

    const functionName = stack.uniqueResourceName(this.node, {
      prefix: stack.gridUUID + "-",
      allowedSpecialCharacters: "-_",
      maxLength: 64,
    });

    // TERRACONSTRUCTS DEVIATION: explicit log group with scoped write access
    // instead of the AWSLambdaBasicExecutionRole managed policy (see class doc).
    const logGroup = new cloudwatchLogGroup.CloudwatchLogGroup(
      this,
      "LogGroup",
      {
        name: `/aws/lambda/${functionName}`,
      },
    );
    const logsPolicy = new iamRolePolicy.IamRolePolicy(this, "LogsPolicy", {
      name: "Logs",
      role: this.role.name,
      policy: stack.toJsonString({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: `${logGroup.arn}:*`,
          },
        ],
      }),
    });

    if (props.policyStatements) {
      for (const statement of props.policyStatements) {
        this.addToRolePolicy(statement);
      }
    }

    const timeout = props.timeout ?? Duration.minutes(15);
    const memory = props.memorySize ?? Size.mebibytes(128);

    // TERRACONSTRUCTS DEVIATION: upstream uses `AWS::Lambda::Function` with
    // `Code: {S3Bucket, S3Key}` (or inline `ZipFile`); Terraform has no inline
    // code mode, and needs explicit `dependsOn` for role, log group and policies.
    this.handler = new lambdaFunction.LambdaFunction(this, "Handler", {
      functionName,
      s3Bucket: code.s3Bucket,
      s3Key: code.s3Key,
      timeout: timeout.toSeconds(),
      memorySize: memory.toMebibytes(),
      handler: codeHandler,
      role: this.role.arn,
      runtime: props.runtimeName,
      environment: this.renderEnvironmentVariables(props.environment),
      description: props.description ?? undefined,
      loggingConfig: {
        logFormat: "Text",
        logGroup: logGroup.name,
      },
      dependsOn: [
        this.role,
        logGroup,
        logsPolicy,
        ...(this.inlinePolicy ? [this.inlinePolicy] : []),
      ],
    });
  }

  /**
   * Add an IAM policy statement to the inline policy of the
   * provider's lambda function's role.
   *
   * **Please note**: this is a direct IAM JSON policy blob, *not* a `iam.PolicyStatement`
   * object like you will see in the rest of the CDK.
   *
   *
   * @example
   * declare const myProvider: CustomResourceProvider;
   *
   * myProvider.addToRolePolicy({
   *   Effect: 'Allow',
   *   Action: 's3:GetObject',
   *   Resource: '*',
   * });
   */
  public addToRolePolicy(statement: any): void {
    this.policyStatements.push(statement);
    if (!this.inlinePolicy) {
      this.inlinePolicy = this.createInlinePolicy();
      // TERRACONSTRUCTS DEVIATION: Terraform has no lazily rendered role
      // `Policies`; statements added after the handler exists: make sure the handler
      // still waits for (and on destroy outlives) its permissions.
      if (this.handler) {
        this.handler.dependsOn = [
          ...(this.handler.dependsOn ?? []),
          dependable(this.inlinePolicy),
        ];
      }
    }
  }

  /**
   * Upstream renders `Policies: [{ PolicyName: 'Inline', ... }]` on the role
   * only when there are statements. The Terraform equivalent is an
   * `aws_iam_role_policy` named `Inline`, created on the first statement and
   * rendered lazily so later `addToRolePolicy` calls are included.
   */
  private createInlinePolicy(): iamRolePolicy.IamRolePolicy {
    const stack = AwsStack.ofAwsConstruct(this);
    return new iamRolePolicy.IamRolePolicy(this, "InlinePolicy", {
      name: "Inline",
      role: this.role.name,
      policy: stack.toJsonString({
        Version: "2012-10-17",
        Statement: this.policyStatements,
      }),
    });
  }

  private renderEnvironmentVariables(env?: {
    [key: string]: string;
  }): lambdaFunction.LambdaFunctionEnvironment | undefined {
    if (!env || Object.keys(env).length === 0) {
      return undefined;
    }

    env = { ...env }; // Copy

    // Always use regional endpoints
    env.AWS_STS_REGIONAL_ENDPOINTS = "regional";

    // Sort environment so the hash of the function used to create
    // `currentVersion` is not affected by key order (this is how lambda does
    // it)
    const variables: { [key: string]: string } = {};
    const keys = Object.keys(env).sort();

    for (const key of keys) {
      variables[key] = env[key];
    }

    return { variables };
  }

  /**
   * Stages the provider code (plus the entrypoint wrapper) as a zip file asset
   * and returns its S3 location.
   */
  private createCodeProp(
    props: CustomResourceProviderBaseProps,
    stack: AwsStack,
  ): {
    code: { s3Bucket: string; s3Key: string };
    codeHandler: string;
    codeHash: string;
  } {
    let codeHandler = "index.handler";
    const stagingDirectory = FileSystem.mkdtemp("cdk-custom-resource");
    fs.cpSync(props.codeDirectory, stagingDirectory, {
      recursive: true,
      filter: (src) => !src.endsWith(".ts"),
    });

    if (props.useCfnResponseWrapper ?? true) {
      fs.copyFileSync(
        ENTRYPOINT_NODEJS_SOURCE,
        path.join(stagingDirectory, `${ENTRYPOINT_FILENAME}.js`),
      );
      codeHandler = `${ENTRYPOINT_FILENAME}.handler`;
    }

    // AssetStaging copies the source into the stack's staging directory
    // synchronously, so the temporary directory can be removed right after.
    // TERRACONSTRUCTS DEVIATION: upstream uses `stack.synthesizer.addFileAsset`
    // and `AssetStaging` with a `tryGetContext`-driven inline-code option; here
    // the zip is staged and registered through `stack.addFileAsset` with
    // `deployTime: true`.
    const staging = new AssetStaging(this, "Staging", {
      sourcePath: stagingDirectory,
    });

    const assetFileName = staging.relativeStagedPath(stack);

    const asset = stack.addFileAsset({
      fileName: assetFileName,
      sourceHash: staging.assetHash,
      packaging: FileAssetPackaging.ZIP_DIRECTORY,
      deployTime: true,
    });

    fs.rmSync(stagingDirectory, { recursive: true, force: true });

    return {
      code: {
        s3Bucket: asset.bucketName,
        s3Key: asset.objectKey,
      },
      codeHandler,
      codeHash: staging.assetHash,
    };
  }
}
