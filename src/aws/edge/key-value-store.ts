import * as fs from "fs";
import {
  cloudfrontKeyValueStore,
  cloudfrontkeyvaluestoreKey,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import {
  AwsConstructBase,
  IAwsConstruct,
  AwsConstructProps,
} from "../aws-construct";

export interface IStoreData {
  /**
   * The method called when given StoreData is added
   * (for the first time) to a KeyValueStore.
   */
  render(
    keyValueStoreArn: string,
  ): cloudfrontkeyvaluestoreKey.CloudfrontkeyvaluestoreKeyConfig[];
}

/**
 * The initial data to set for the key value store.
 *
 * This is work around for lack of support for import_source
 * @link https://github.com/hashicorp/terraform-provider-aws/issues/36524
 */
export abstract class KeyValuePairs implements IStoreData {
  /**
   * Key Value pairs stored in a local file.
   *
   * The key-value pairs have the following limits:
   *
   * - File size – 5 MB
   * - Key size – 512 characters
   * - Value size – 1024 characters
   *
   * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create-s3-kvp.html
   *
   * @param filePath the path to the local file
   */
  public static fromPath(filePath: string): KeyValuePairs {
    return new FileKeyValuePairs(filePath);
  }

  /**
   * Key Value pairs inline with Construct props.
   *
   * @param data the contents of the KeyValueStore
   */
  public static fromInline(data: Record<string, any>): KeyValuePairs {
    return new InlineKeyValuePairs(data);
  }

  // TODO: support TerraformResourceLifecycle on the key value entries?
  protected data: Record<string, any> = {};
  /**
   * Called internally by the KeyValueStore to render the store data.
   */
  public render(
    keyValueStoreArn: string,
  ): cloudfrontkeyvaluestoreKey.CloudfrontkeyvaluestoreKeyConfig[] {
    return Object.entries(this.data).map(([key, valueAny]) => {
      const value =
        typeof valueAny === "string" ? valueAny : JSON.stringify(valueAny);
      return {
        key, //TODO: validate key string limit (512 characters)?
        value, //TODO: validate value string limit (1024 characters)?
        keyValueStoreArn,
      };
    });
  }
}

/**
 * inline Key Value pairs.
 */
export class InlineKeyValuePairs extends KeyValuePairs {
  /**
   * @param data the contents of the KeyValueStore
   */
  constructor(data: Record<string, any>) {
    super();
    this.data = data;
  }
}

/**
 * Key Value pairs stored in a local file.
 */
export class FileKeyValuePairs extends KeyValuePairs {
  /**
   * @param filePath the path to the local file
   */
  constructor(filePath: string) {
    super();
    const stats = fs.statSync(filePath);
    if (stats.size > 5 * 1024 * 1024) {
      throw new Error(
        `The file size of ${filePath} should not exceed 5MB. Received: ${stats.size}`,
      );
    }
    const content = fs.readFileSync(filePath, "utf8");
    let parsedData: any;
    try {
      parsedData = JSON.parse(content);
    } catch (error: any) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }

    if (!this.isRecordOfStringAny(parsedData)) {
      throw new Error(
        `The ${filePath} contents does not match the required type Record<string, any>`,
      );
    }
    this.data = parsedData;
  }
  private isRecordOfStringAny(obj: any): obj is Record<string, any> {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj);
  }
}

/**
 * The properties to create a Key Value Store.
 */
export interface KeyValueStoreProps extends AwsConstructProps {
  /**
   * The unique name of the Key Value Store.
   *
   * @default A generated name
   */
  readonly nameSuffix: string;

  /**
   * A comment for the Key Value Store
   *
   * @default No comment will be specified
   */
  readonly comment?: string;

  /**
   * The Key Value store data.
   *
   * This will populate the initial items in the Key Value Store. The
   * source data must be in a valid JSON format.
   *
   * The key-value pairs have the following limits:
   *
   * - File size – 5 MB
   * - Key size – 512 characters
   * - Value size – 1024 characters
   *
   * @default No data will be imported to the store
   */
  readonly data?: IStoreData;
}

/**
 * CloudFront Key Value Store outputs for a stack.
 */
export interface KeyValueStoreOutputs {
  /**
   * The ARN of the Key Value Store.
   *
   * @attribute
   */
  readonly arn: string;

  /**
   * The Unique ID of the Key Value Store.
   *
   * @attribute
   */
  readonly id: string;
}

/**
 * A CloudFront Key Value Store.
 */
export interface IKeyValueStore extends IAwsConstruct {
  /** Strongly typed outputs
   *
   * @attribute
   */
  readonly keyValueStoreOutputs: KeyValueStoreOutputs;

  /**
   * The ARN of the Key Value Store.
   *
   * @attribute
   */
  readonly arn: string;

  /**
   * The Unique ID of the Key Value Store.
   *
   * @attribute
   */
  readonly id: string;

  /**
   * The status of the Key Value Store.
   *
   * @attribute
   */
  readonly status: string;
}

/**
 * A CloudFront Key Value Store.
 *
 * You can store any of the following formats:
 *
 * - String
 * - Byte-encoded string
 * - JSON
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html
 *
 * @resource aws_cloudfront_key_value_store
 */
export class KeyValueStore extends AwsConstructBase implements IKeyValueStore {
  // TODO: Add static fromLookup?
  public readonly resource: cloudfrontKeyValueStore.CloudfrontKeyValueStore;

  private readonly _outputs: KeyValueStoreOutputs;
  public get keyValueStoreOutputs(): KeyValueStoreOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.keyValueStoreOutputs;
  }
  readonly arn: string;
  readonly id: string;
  readonly status: string;

  constructor(scope: Construct, id: string, props: KeyValueStoreProps) {
    super(scope, id, props);

    const { nameSuffix } = props;
    // TODO: consider using the `this.stack.makeUniqueResourceName` function?
    let name = this.gridUUID;
    if (nameSuffix) {
      name = `${name}-${nameSuffix}`;
    }
    if (name.length > 64) {
      throw new Error(
        `The name of the Key Value Store must be less than 64 characters. Received: ${name}`,
      );
    }

    this.resource = new cloudfrontKeyValueStore.CloudfrontKeyValueStore(
      this,
      "Resource",
      {
        name,
        comment: props?.comment,
      },
    );

    if (props.data) {
      // TODO: support TerraformResourceLifecycle on the key value entries?
      const data = props.data.render(this.resource.arn);
      for (let i = 0; i < data.length; i++) {
        new cloudfrontkeyvaluestoreKey.CloudfrontkeyvaluestoreKey(
          this,
          `Key-${i}`,
          data[i],
        );
      }
    }

    this.arn = this.resource.arn;
    this.id = this.resource.id;
    this.status = this.resource.etag;
    this._outputs = {
      arn: this.arn,
      id: this.id,
    };
  }
}
