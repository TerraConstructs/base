import { TerraformAsset, AssetType, Fn } from "cdktf";
import {
  Construct,
  // Node
} from "constructs";
import { IRestApi } from "./restapi"; // Assuming IRestApi is in the same directory structure as in CDK
import { AssetOptions } from "../storage/assets";
// import * as s3 from "../storage";
// import { UnscopedValidationError, ValidationError } from '../../core'; // TODO: Import from core/lib/errors if available
// import * as cxapi from '../../core'; // TODO: Import from core if cxapi is needed and available

/**
 * Represents an OpenAPI definition asset.
 */
export abstract class ApiDefinition {
  // // s3location not supported by Terraform Provider AWS
  // /**
  //  * Creates an API definition from a specification file in an S3 bucket
  //  */
  // public static fromBucket(
  //   bucket: s3.IBucket,
  //   key: string,
  //   objectVersion?: string,
  // ): S3ApiDefinition {
  //   return new S3ApiDefinition(bucket, key, objectVersion);
  // }

  /**
   * Create an API definition from an inline object. The inline object must follow the
   * schema of OpenAPI 2.0 or OpenAPI 3.0
   *
   * @example
   *
   *   ApiDefinition.fromInline({
   *     openapi: '3.0.2',
   *     paths: {
   *       '/pets': {
   *         get: {
   *           'responses': {
   *             200: {
   *               content: {
   *                 'application/json': {
   *                   schema: {
   *                     $ref: '#/components/schemas/Empty',
   *                   },
   *                 },
   *               },
   *             },
   *           },
   *           'x-amazon-apigateway-integration': {
   *             responses: {
   *               default: {
   *                 statusCode: '200',
   *               },
   *             },
   *             requestTemplates: {
   *               'application/json': '{"statusCode": 200}',
   *             },
   *             passthroughBehavior: 'when_no_match',
   *             type: 'mock',
   *           },
   *         },
   *       },
   *     },
   *     components: {
   *       schemas: {
   *         Empty: {
   *           title: 'Empty Schema',
   *           type: 'object',
   *         },
   *       },
   *     },
   *   });
   */
  public static fromInline(definition: any): InlineApiDefinition {
    return new InlineApiDefinition(definition);
  }

  /**
   * Loads the API specification from a local disk asset.
   */
  public static fromAsset(
    file: string,
    options?: AssetOptions,
  ): AssetApiDefinition {
    return new AssetApiDefinition(file, options);
  }

  /**
   * Called when the specification is initialized to allow this object to bind
   * to the stack, add resources and have fun.
   *
   * @param scope The binding scope. Don't be smart about trying to down-cast or
   * assume it's initialized. You may just use it as a construct scope.
   */
  public abstract bind(scope: Construct): ApiDefinitionConfig;

  /**
   * Called after the TF RestApi resource has been created to allow the Api
   * Definition to bind to it.
   *
   * Originally required to allow assets to add metadata for tooling like
   * SAM CLI to be able to find their origins.
   */
  public bindAfterCreate(_scope: Construct, _restApi: IRestApi): void {
    return;
  }
}

// /**
//  * S3 location of the API definition file
//  */
// export interface ApiDefinitionS3Location {
//   /** The S3 bucket */
//   readonly bucket: string;
//   /** The S3 key */
//   readonly key: string;
//   /**
//    * An optional version
//    * @default - latest version
//    */
//   readonly version?: string;
// }

/**
 * Post-Binding Configuration for a construct
 */
export interface ApiDefinitionConfig {
  // /**
  //  * The location of the specification in S3 (mutually exclusive with `inlineDefinition`).
  //  *
  //  * @default - API definition is not an S3 location
  //  */
  // readonly s3Location?: ApiDefinitionS3Location;

  /**
   * Inline specification (mutually exclusive with `s3Location`).
   *
   * @default - API definition is not defined inline
   */
  readonly inlineDefinition?: any;
}

// // Not supported by Terraform Provider
// /**
//  * OpenAPI specification from an S3 archive.
//  */
// export class S3ApiDefinition extends ApiDefinition {
//   private bucketName: string;

//   constructor(
//     bucket: s3.IBucket,
//     private key: string,
//     private objectVersion?: string,
//   ) {
//     super();

//     if (!bucket.bucketName) {
//       // TODO: Use specific error type from core/lib/errors if available (e.g., ValidationError)
//       throw new Error("bucketName is undefined for the provided bucket");
//     }

//     this.bucketName = bucket.bucketName;
//   }

//   public bind(_scope: Construct): ApiDefinitionConfig {
//     return {
//       s3Location: {
//         bucket: this.bucketName,
//         key: this.key,
//         version: this.objectVersion,
//       },
//     };
//   }
// }

/**
 * OpenAPI specification from an inline JSON object.
 */
export class InlineApiDefinition extends ApiDefinition {
  constructor(private definition: any) {
    super();

    if (typeof definition !== "object") {
      // TODO: Use specific error type from core/lib/errors if available (e.g., UnscopedValidationError)
      throw new Error("definition should be of type object");
    }

    if (Object.keys(definition).length === 0) {
      // TODO: Use specific error type from core/lib/errors if available (e.g., UnscopedValidationError)
      throw new Error("JSON definition cannot be empty");
    }
  }

  public bind(_scope: Construct): ApiDefinitionConfig {
    return {
      inlineDefinition: this.definition,
    };
  }
}

/**
 * OpenAPI specification from a local file.
 */
export class AssetApiDefinition extends ApiDefinition {
  private asset?: TerraformAsset;

  constructor(
    private readonly path: string,
    private readonly options: AssetOptions = {},
  ) {
    super();
  }

  public bind(scope: Construct): ApiDefinitionConfig {
    // If the same AssetAPIDefinition is used multiple times, retain only the first instantiation.
    if (this.asset === undefined) {
      this.asset = new TerraformAsset(scope, "APIDefinition", {
        path: this.path,
        ...this.options,
      });
    }

    if (
      this.asset.type === AssetType.DIRECTORY ||
      this.asset.type === AssetType.ARCHIVE
    ) {
      // TODO: Use specific error type from core/lib/errors if available (e.g., ValidationError)
      throw new Error(
        `Asset cannot be a .zip file or a directory (${this.path})`,
      );
    }

    return {
      inlineDefinition: Fn.file(this.asset.path),
    };
  }

  public bindAfterCreate(_scope: Construct, _restApi: IRestApi): void {
    // TODO: Implement ContextProvider lookup for cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT if asset metadata is needed.
    // The original CDK code uses context to check if asset metadata should be added.
    // Example from CDK:
    // if (!_scope.node.tryGetContext(cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT)) {
    //   return; // not enabled
    // }

    if (!this.asset) {
      // TODO: Use specific error type from core/lib/errors if available (e.g., ValidationError)
      throw new Error("bindAfterCreate() must be called after bind()");
    }

    // TODO: Implement asset metadata binding if required by TerraConstructs.
    // The original CDK code adds metadata to the CfnRestApi resource using `addMetadata`.
    // Terraform resources (like ApiGatewayRestApi) do not have a direct equivalent of CfnResource.addMetadata.
    // This functionality might be handled differently (e.g., via tags or specific resource attributes if supported by the provider for this purpose)
    // or might not be applicable in the TerraConstructs context.
    // Example from CDK:
    // const child = Node.of(_restApi).defaultChild as CfnRestApi; // This is CDK-specific to get L1
    // child.addMetadata(cxapi.ASSET_RESOURCE_METADATA_PATH_KEY, this.asset.assetPath);
    // child.addMetadata(cxapi.ASSET_RESOURCE_METADATA_PROPERTY_KEY, 'BodyS3Location');

    return; // Current implementation does nothing as metadata addition is context/CFN specific.
  }
}
