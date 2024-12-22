import {
  s3Bucket,
  s3BucketAcl,
  s3BucketCorsConfiguration,
  s3BucketOwnershipControls,
  s3BucketPublicAccessBlock,
  s3BucketWebsiteConfiguration,
  s3BucketLifecycleConfiguration,
  s3BucketVersioning,
} from "@cdktf/provider-aws";
import { sleep } from "@cdktf/provider-time";
import { Construct } from "constructs";
import {
  BucketSource,
  BucketSourceProps,
  WebsiteConfig,
  CorsConfig,
  LifecycleConfigurationRule,
  OriginAccessIdentity,
  BucketPolicy,
  BucketNotifications,
  IBucketNotificationDestination,
} from ".";
import { AwsBeaconBase, IAwsBeacon, AwsBeaconProps, AwsSpec } from "..";
import * as iam from "../iam";
import * as perms from "./bucket-perms";

export interface CloudfrontAccessConfig {
  /**
   * Enable Cloudfront access via Origin Access Identity.
   */
  readonly enabled: boolean;
  /**
   * Object key patterns for cloudfront access.
   *
   * @default "*"
   */
  readonly keyPatterns?: string[];
}

export interface BucketProps extends AwsBeaconProps {
  /**
   * The path(s) to static directories or files to upload, relative to the Spec file.
   *
   * @example "./dist"
   * @default - No files are uploaded.
   */
  readonly sources?: string | string[] | AddSourceOptions[];

  // TODO: Add support to pass domain props (for route53 alias?)

  /**
   * Enable public read access for all the files in the bucket.
   *
   * Enable this only if you're not using CDN (CloudFront) to serve files from the bucket.
   * Should only be turned on if you want to host public files directly from the bucket.
   *
   * @default `false`
   */
  readonly public?: boolean;

  /**
   * A name for the bucket.
   *
   * Must be lowercase and between 3 (min) and 63 (max) characters long.
   *
   * The name must not be in the format [bucket_name]--[azid]--x-s3. Use the
   * `aws_s3_directory_bucket` resource to manage S3 Express buckets.
   *
   * A full list of bucket naming rules [may be found here](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html).
   *
   * @default - If omitted, Refer to `namePrefix`.
   */
  readonly bucketName?: string;

  /**
   * Creates a unique name beginning with the specified prefix.
   * Conflicts with `bucketName`.
   *
   * Terraform Prefixes must reserve 26 characters for the terraform generated suffix.
   *
   * @default - If omitted, ET will assign a random, unique name prefixed by GridUUID.
   */
  readonly namePrefix?: string;

  /**
   * Boolean that indicates all objects (including any locked objects)
   * should be deleted from the bucket when the bucket is destroyed
   * so that the bucket can be destroyed without error.
   *
   * These objects are not recoverable. This only deletes objects when
   * the bucket is destroyed, not when setting this parameter to true.
   *
   * Once this parameter is set to true, there must be a successful
   * terraform apply run before a destroy is required to update this
   * value in the resource state.
   *
   * Without a successful terraform apply after this parameter is set,
   * this flag will have no effect. If setting this field in the same
   * operation that would require replacing the bucket or destroying
   * the bucket, this flag will not work.
   *
   * Additionally when importing a bucket, a successful terraform apply
   * is required to set this value in state before it will take effect
   * on a destroy operation.
   *
   * @default false
   */
  readonly forceDestroy?: boolean;

  /**
   * Provides an S3 bucket website configuration resource.
   *
   * Important: Amazon S3 website endpoints do not support HTTPS or access points.
   * If you want to use HTTPS, you can use edge Distribution to serve a static
   * website hosted in a bucket.
   *
   * Use OriginAccessIdentity property to control ingress through edge Distribution.
   *
   * For more information, see [Hosting Websites on S3](https://docs.aws.amazon.com/AmazonS3/latest/dev/WebsiteHosting.html).
   */
  readonly websiteConfig?: WebsiteConfig;

  /**
   * Provides an S3 bucket CORS configuration resource.
   *
   * For more information about CORS, go to
   * [Enabling Cross-Origin Resource Sharing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
   * in the Amazon S3 User Guide.
   */
  readonly corsConfig?: CorsConfig;

  /**
   * One or more Lifecycle rules. Each rule consists of the following:
   *
   *  - Rule id
   *  - Filter identifying objects to which the rule applies
   *  - One or more transition or expiration actions
   *
   * For more information see the Amazon S3 User Guide on [Lifecycle Configuration Elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html).
   */
  readonly lifecycleRules?: LifecycleConfigurationRule[];

  /**
   * Controls versioning on the S3 bucket.
   *
   * Setting this to false will suspend versioning if the associated S3 bucket is versioned.
   *
   * If you are enabling versioning on the bucket for the first time, AWS recommends that you wait for 15 minutes after enabling versioning before issuing write operations (PUT or DELETE) on objects in the bucket.
   * This will cause 15m delay if `path` is configured.
   *
   * @default false
   */
  readonly versioned?: boolean;

  /**
   * Whether this bucket should send notifications to Amazon EventBridge or not.
   *
   * @default false
   */
  readonly eventBridgeEnabled?: boolean;

  /**
   * Enforces SSL for requests. S3.5 of the AWS Foundational Security Best Practices Regarding S3.
   * @see https://docs.aws.amazon.com/config/latest/developerguide/s3-bucket-ssl-requests-only.html
   *
   * @default false
   */
  readonly enforceSSL?: boolean;

  /**
   * Enforces minimum TLS version for requests.
   *
   * Requires `enforceSSL` to be enabled.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html#example-object-tls-version
   *
   * @default No minimum TLS version is enforced.
   */
  readonly minimumTLSVersion?: number;

  /**
   * Enable Cloudfront access via Origin Access Identity.
   *
   * Note: recommended to migrate to OAC in future.
   *
   * @default - no cloudfront access
   */
  readonly cloudfrontAccess?: CloudfrontAccessConfig;

  // TODO: Add flag to register Bucket Source outputs?
}

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface BucketOutputs {
  /**
   * AWS Bucket name
   * @attribute
   */
  readonly name: string;

  /**
   * AWS Bucket arn
   * @attribute
   */
  readonly arn: string;

  /**
   * The URL of the static website.
   * @attribute
   */
  readonly websiteUrl?: string;

  /**
   * The Domain name of the static website.
   * @attribute
   */
  readonly websiteDomainName?: string;

  /**
   * The IPv4 DNS name of the specified bucket.
   * @attribute
   */
  readonly domainName: string;

  /**
   * The regional domain name of the specified bucket.
   * @attribute
   */
  readonly regionalDomainName: string;

  /**
   * Origin Access Identity, if cloudfrontAccess is enabled.
   * @attribute
   */
  readonly originAccessIdentity?: string;
}

/**
 * Imported or created Bucket attributes
 */
export interface IBucket extends IAwsBeacon {
  /** Strongly typed outputs */
  readonly bucketOutputs: BucketOutputs;

  /**
   * AWS Bucket name
   */
  readonly bucketName: string;
  /**
   * AWS Bucket arn
   */
  readonly bucketArn: string;

  /** Whether the bucket has versioning enabled */
  readonly versioned: boolean;

  /** The hosted Zone Id for the bucket */
  readonly hostedZoneId: string;

  /**
   * The Domain name of the static website.
   * @attribute
   */
  readonly websiteDomainName?: string;

  /**
   * Enable public read access for all the files in the bucket.
   *
   * This explicitly disables the default S3 bucket security settings. This
   * should be done with caution, as all bucket objects become publicly exposed.
   *
   * You don't need to enable this if you're using CloudFront to serve files from the bucket.
   *
   * @default `false`
   */
  public?: boolean;

  /**
   * The resource policy associated with this bucket.
   *
   * If `autoCreatePolicy` is true, a `BucketPolicy` will be created upon the
   * first call to addToResourcePolicy(s).
   */
  policy?: BucketPolicy;

  /**
   * Add a source of files for upload to the bucket.
   */
  addSource(props: AddSourceOptions, sourceId?: string): string;

  /**
   * If this bucket has been configured for static website hosting.
   */
  isWebsite(): this is {
    websiteDomainName: string;
    bucketOutputs: { websiteUrl: string; websiteDomainName: string };
  };

  /**
   * The https URL of an S3 object. For example:
   *
   * - `https://s3.us-west-1.amazonaws.com/onlybucket`
   * - `https://s3.us-west-1.amazonaws.com/bucket/key`
   * - `https://s3.cn-north-1.amazonaws.com.cn/china-bucket/mykey`
   * @param key The S3 key of the object. If not specified, the URL of the
   *      bucket is returned.
   * @returns an ObjectS3Url token
   */
  urlForObject(key?: string): string;

  /**
   * The S3 URL of an S3 object. For example:
   * - `s3://onlybucket`
   * - `s3://bucket/key`
   * @param key The S3 key of the object. If not specified, the S3 URL of the
   *      bucket is returned.
   * @returns an ObjectS3Url token
   */
  s3UrlForObject(key?: string): string;

  /**
   * Returns an ARN that represents all objects within the bucket that match
   * the key pattern specified. To represent all keys, specify ``"*"``.
   */
  arnForObjects(keyPattern: string): string;

  /**
   * Adds a statement to the resource policy for a principal (i.e.
   * account/role/service) to perform actions on this bucket and/or its
   * contents. Use `bucketArn` and `arnForObjects(keys)` to obtain ARNs for
   * this bucket or objects.
   *
   * Note that the policy statement may or may not be added to the policy.
   * For example, when an `IBucket` is created from an existing bucket,
   * it's not possible to tell whether the bucket already has a policy
   * attached, let alone to re-use that policy to add more statements to it.
   * So it's safest to do nothing in these cases.
   *
   * @param permission the policy statement to be added to the bucket's
   * policy.
   * @returns metadata about the execution of this method. If the policy
   * was not added, the value of `statementAdded` will be `false`. You
   * should always check this value to make sure that the operation was
   * actually carried out. Otherwise, synthesis and deploy will terminate
   * silently, which may be confusing.
   */
  addToResourcePolicy(
    permission: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * Grant read permissions for this bucket and it's contents to an IAM
   * principal (Role/Group/User).
   *
   * If encryption is used, permission to use the key to decrypt the contents
   * of the bucket will also be granted to the same principal.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  grantRead(identity: iam.IGrantable, objectsKeyPattern?: any): iam.Grant;

  /**
   * Grant write permissions to this bucket to an IAM principal.
   *
   * If encryption is used, permission to use the key to encrypt the contents
   * of written files will also be granted to the same principal.
   *
   * This does not include `s3:PutObjectAcl`, which could be used to grant read/write object access to IAM principals in other accounts.
   *
   * If you need the principal to have permissions to modify the ACLs,
   * use the `grantPutAcl` method.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   * @param allowedActionPatterns Restrict the permissions to certain list of action patterns
   */
  grantWrite(
    identity: iam.IGrantable,
    objectsKeyPattern?: any,
    allowedActionPatterns?: string[],
  ): iam.Grant;

  /**
   * Grants s3:PutObject* and s3:Abort* permissions for this bucket to an IAM principal.
   *
   * If encryption is used, permission to use the key to encrypt the contents
   * of written files will also be granted to the same principal.
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  grantPut(identity: iam.IGrantable, objectsKeyPattern?: any): iam.Grant;

  /**
   * Grant the given IAM identity permissions to modify the ACLs of objects in the given Bucket.
   *
   * calling `grantWrite` or `grantReadWrite` does not grant permissions to modify the ACLs of the objects;
   * in this case, if you need to modify object ACLs, call this method explicitly.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   */
  grantPutAcl(identity: iam.IGrantable, objectsKeyPattern?: string): iam.Grant;

  /**
   * Grants s3:DeleteObject* permission to an IAM principal for objects
   * in this bucket.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  grantDelete(identity: iam.IGrantable, objectsKeyPattern?: any): iam.Grant;

  /**
   * Grants read/write permissions for this bucket and it's contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to use the key for
   * encrypt/decrypt will also be granted.
   *
   * This does not include `s3:PutObjectAcl`, which could be used to grant read/write object access to IAM principals in other accounts.
   *
   * If you need the principal to have permissions to modify the ACLs,
   * use the `grantPutAcl` method.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  grantReadWrite(identity: iam.IGrantable, objectsKeyPattern?: any): iam.Grant;

  // /**
  //  * Allows unrestricted access to objects from this bucket.
  //  *
  //  * IMPORTANT: This permission allows anyone to perform actions on S3 objects
  //  * in this bucket, which is useful for when you configure your bucket as a
  //  * website and want everyone to be able to read objects in the bucket without
  //  * needing to authenticate.
  //  *
  //  * Without arguments, this method will grant read ("s3:GetObject") access to
  //  * all objects ("*") in the bucket.
  //  *
  //  * The method returns the `iam.Grant` object, which can then be modified
  //  * as needed. For example, you can add a condition that will restrict access only
  //  * to an IPv4 range like this:
  //  *
  //  *     const grant = bucket.grantPublicAccess();
  //  *     grant.resourceStatement!.addCondition(‘IpAddress’, { “aws:SourceIp”: “54.240.143.0/24” });
  //  *
  //  *
  //  * @param keyPrefix the prefix of S3 object keys (e.g. `home/*`). Default is "*".
  //  * @param allowedActions the set of S3 actions to allow. Default is "s3:GetObject".
  //  * @returns The `iam.PolicyStatement` object, which can be used to apply e.g. conditions.
  //  */
  // grantPublicAccess(keyPrefix?: string, ...allowedActions: string[]): iam.Grant;

  /**
   * Adds a bucket notification event destination.
   * @param event The event to trigger the notification
   * @param dest The notification destination (Lambda, SNS Topic or SQS Queue)
   *
   * @param filters S3 object key filter rules to determine which objects
   * trigger this event. Each filter must include a `prefix` and/or `suffix`
   * that will be matched against the s3 object key. Refer to the S3 Developer Guide
   * for details about allowed filter rules.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/NotificationHowTo.html#notification-how-to-filtering
   *
   * @example
   *
   *    declare const myLambda: lambda.Function;
   *    const bucket = new s3.Bucket(this, 'MyBucket');
   *    bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(myLambda), {prefix: 'home/myusername/*'})
   *
   * @see
   * https://docs.aws.amazon.com/AmazonS3/latest/dev/NotificationHowTo.html
   */
  addEventNotification(
    event: EventType,
    dest: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ): void;

  /**
   * Subscribes a destination to receive notifications when an object is
   * created in the bucket. This is identical to calling
   * `onEvent(s3.EventType.OBJECT_CREATED)`.
   *
   * @param dest The notification destination (see onEvent)
   * @param filters Filters (see onEvent)
   */
  addObjectCreatedNotification(
    dest: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ): void;

  /**
   * Subscribes a destination to receive notifications when an object is
   * removed from the bucket. This is identical to calling
   * `onEvent(EventType.OBJECT_REMOVED)`.
   *
   * @param dest The notification destination (see onEvent)
   * @param filters Filters (see onEvent)
   */
  addObjectRemovedNotification(
    dest: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ): void;

  /**
   * Enables event bridge notification, causing all events below to be sent to EventBridge:
   *
   * - Object Deleted (DeleteObject)
   * - Object Deleted (Lifecycle expiration)
   * - Object Restore Initiated
   * - Object Restore Completed
   * - Object Restore Expired
   * - Object Storage Class Changed
   * - Object Access Tier Changed
   * - Object ACL Updated
   * - Object Tags Added
   * - Object Tags Deleted
   */
  enableEventBridgeNotification(): void;
}

/**
 * The `Bucket` beacon provides an [AWS S3 Bucket](https://aws.amazon.com/s3/).
 *
 * ```ts
 * new storage.Bucket(spec, "MyWebsite", {
 *   path: path.join(__dirname, "dist"),
 * });
 * ```
 *
 * #### Public read access
 *
 * Enables `public` read access for all the files in the bucket. Dangerous and
 * recommended to use edge.Distribution instead.
 *
 * Useful for hosting public files directly from S3.
 *
 * ```ts
 * new storage.Bucket("MyBucket", {
 *   public: true
 * });
 * ```
 *
 * @resource aws_s3_bucket
 * @beacon-class storage.IBucket
 */

export class Bucket extends AwsBeaconBase implements IBucket {
  // TODO: Add static fromLookup?
  protected readonly resource: s3Bucket.S3Bucket;
  protected readonly websiteConfig?: s3BucketWebsiteConfiguration.S3BucketWebsiteConfiguration;
  protected readonly corsConfig?: s3BucketCorsConfiguration.S3BucketCorsConfiguration;

  /** @internal */
  private readonly sources: SourceIndex[] = [];
  /** @internal */
  private readonly _versioned: boolean;
  public get versioned(): boolean {
    return this._versioned;
  }

  /** @internal */
  private readonly _isWebsite: boolean;
  /** @internal */
  private sourceSleep?: sleep.Sleep;

  /** @internal */
  private readonly _outputs: BucketOutputs;
  public get bucketOutputs(): BucketOutputs {
    return this._outputs;
  }
  public get outputs(): Record<string, any> {
    return this.bucketOutputs;
  }

  public get bucketName(): string {
    return this.resource.bucket;
  }
  public get bucketArn(): string {
    return this.resource.arn;
  }
  public get hostedZoneId(): string {
    return this.resource.hostedZoneId;
  }
  public get websiteDomainName(): string | undefined {
    return this.websiteConfig?.websiteDomain;
  }

  public policy?: BucketPolicy;

  /**
   * Whether the bucket is public or not.
   */
  public public?: boolean;
  private notifications?: BucketNotifications;
  private readonly eventBridgeEnabled?: boolean;

  constructor(scope: Construct, name: string, props: BucketProps = {}) {
    super(scope, name, props);

    this.node.addValidation({
      validate: () => this.policy?.document.validateForResourcePolicy() ?? [],
    });

    const { websiteConfig, corsConfig, cloudfrontAccess } = props;
    this._isWebsite = false;

    if (props.bucketName && props.namePrefix) {
      throw new Error(
        "Cannot specify both 'bucketName' and 'namePrefix'. Use only one.",
      );
    }

    let bucketPrefix: string | undefined;
    if (!props.bucketName) {
      // Bucket names must be lowercase and between 3 (min) and 63 (max) characters long.
      bucketPrefix = this.stack.uniqueResourceNamePrefix(this, {
        prefix: (props.namePrefix ?? this.gridUUID) + "-",
        lowerCase: true,
        allowedSpecialCharacters: ".-",
        maxLength: 63,
      });
    }

    this.resource = new s3Bucket.S3Bucket(this, "Resource", {
      bucket: props.bucketName,
      forceDestroy: props.forceDestroy,
      bucketPrefix,
    });

    this._versioned = props.versioned ?? false;
    if (this._versioned) {
      new s3BucketVersioning.S3BucketVersioningA(this, "Versioning", {
        bucket: this.resource.bucket,
        versioningConfiguration: {
          status: this._versioned ? "Enabled" : "Suspended",
        },
      });
    }
    this.eventBridgeEnabled = props.eventBridgeEnabled;

    if (props.sources) {
      if (typeof props.sources === "string") {
        this.addSource({ path: props.sources });
      } else if (Array.isArray(props.sources)) {
        for (const sourceProps of props.sources) {
          if (typeof sourceProps === "string") {
            this.addSource({ path: sourceProps });
          } else {
            this.addSource(sourceProps);
          }
        }
      }
    }

    if (props.lifecycleRules) {
      new s3BucketLifecycleConfiguration.S3BucketLifecycleConfiguration(
        this,
        "LifeCycleConfig",
        {
          bucket: this.resource.bucket,
          rule: props.lifecycleRules.map((rule) => ({
            ...rule,
            status: rule.enabled ? "Enabled" : "Disabled",
          })),
        },
      );
    }

    // Enforce AWS Foundational Security Best Practice
    if (props.enforceSSL) {
      this.enforceSSLStatement();
      this.minimumTLSVersionStatement(props.minimumTLSVersion);
    } else if (props.minimumTLSVersion) {
      throw new Error(
        "'enforceSSL' must be enabled for 'minimumTLSVersion' to be applied",
      );
    }

    if (websiteConfig && websiteConfig.enabled) {
      this._isWebsite = true;
      this.websiteConfig =
        new s3BucketWebsiteConfiguration.S3BucketWebsiteConfiguration(
          this,
          "WebsiteConfig",
          {
            bucket: this.resource.bucket,
            ...websiteConfig,
            indexDocument: websiteConfig?.indexDocument
              ? {
                  suffix: websiteConfig.indexDocument,
                }
              : {
                  suffix: "index.html",
                },
          },
        );
    }

    this.public = props.public ?? false;
    if (this.public) {
      // TODO: switch to Lazy config using "grantPublicAccess" mechanism instead?
      // ref: https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-s3/lib/bucket.ts#L850
      const ownershipControls =
        new s3BucketOwnershipControls.S3BucketOwnershipControls(
          this,
          "OwnershipControls",
          {
            bucket: this.resource.bucket,
            rule: {
              objectOwnership: "BucketOwnerPreferred",
            },
          },
        );
      const publicAccessBlock =
        new s3BucketPublicAccessBlock.S3BucketPublicAccessBlock(
          this,
          "PublicAccessBlock",
          {
            bucket: this.resource.bucket,
            blockPublicAcls: false,
            blockPublicPolicy: false,
            ignorePublicAcls: false,
            restrictPublicBuckets: false,
          },
        );
      new s3BucketAcl.S3BucketAcl(this, "PublicAcl", {
        bucket: this.resource.bucket,
        acl: "public-read",
        dependsOn: [ownershipControls, publicAccessBlock],
      });
      this.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: [this.arnForObjects("*")],
          actions: ["s3:GetObject"],
          principals: [new iam.AnyPrincipal()],
        }),
      );
      // // policy depends on public access block?
      // // is this needed?
      // if (policyDependable && policyDependable instanceof Construct) {
      //   policyDependable.node.addDependency(publicAccessBlock);
      // }
    }

    if (corsConfig) {
      this.corsConfig = new s3BucketCorsConfiguration.S3BucketCorsConfiguration(
        this,
        "CorsConfig",
        {
          bucket: this.resource.bucket,
          ...corsConfig,
        },
      );
    }

    let originAccessIdentity: string | undefined;
    if (cloudfrontAccess?.enabled) {
      const oai = new OriginAccessIdentity(this, "OriginAccessIdentity", {
        comment: `OAI for ${this.resource.bucket}`,
      });
      originAccessIdentity = oai.cloudFrontOriginAccessIdentityPath;
      const resources = (cloudfrontAccess.keyPatterns ?? ["*"]).map(
        (keyPattern) => this.arnForObjects(keyPattern),
      );
      this.addToResourcePolicy(
        new iam.PolicyStatement({
          resources,
          actions: ["s3:GetObject"],
          principals: [oai.grantPrincipal],
        }),
      );
    }

    if (this.eventBridgeEnabled) {
      this.enableEventBridgeNotification();
    }

    //register outputs
    this._outputs = {
      name: this.resource.bucket,
      arn: this.resource.arn,
      domainName: this.resource.bucketDomainName,
      regionalDomainName: this.resource.bucketRegionalDomainName,
      websiteDomainName: this.websiteConfig?.websiteDomain,
      websiteUrl: this.websiteConfig?.websiteEndpoint,
      originAccessIdentity,
    };
  }

  /**
   * Adds a statement to the resource policy for a principal (i.e.
   * account/role/service) to perform actions on this bucket and/or its
   * contents. Use `bucketArn` and `arnForObjects(keys)` to obtain ARNs for
   * this bucket or objects.
   *
   * Note that the policy statement may or may not be added to the policy.
   * For example, when an `IBucket` is created from an existing bucket,
   * it's not possible to tell whether the bucket already has a policy
   * attached, let alone to re-use that policy to add more statements to it.
   * So it's safest to do nothing in these cases.
   *
   * @param permission the policy statement to be added to the bucket's
   * policy.
   * @returns metadata about the execution of this method. If the policy
   * was not added, the value of `statementAdded` will be `false`. You
   * should always check this value to make sure that the operation was
   * actually carried out. Otherwise, synthesis and deploy will terminate
   * silently, which may be confusing.
   */
  public addToResourcePolicy(
    permission: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    // TODO: re-add autoCreatePolicy option?
    // ref: https://github.com/aws/aws-cdk/blob/v2.160.0/packages/aws-cdk-lib/aws-s3/lib/bucket.ts#L652
    if (!this.policy) {
      this.policy = new BucketPolicy(this, "Policy", { bucket: this });
    }

    if (this.policy) {
      this.policy.document.addStatements(permission);
      return { statementAdded: true, policyDependable: this.policy };
    }

    return { statementAdded: false };
  }

  /**
   * Grant read permissions for this bucket and it's contents to an IAM
   * principal (Role/Group/User).
   *
   * If encryption is used, permission to use the key to decrypt the contents
   * of the bucket will also be granted to the same principal.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  public grantRead(identity: iam.IGrantable, objectsKeyPattern: any = "*") {
    return this.grant(
      identity,
      perms.BUCKET_READ_ACTIONS,
      perms.KEY_READ_ACTIONS,
      this.resource.arn,
      this.arnForObjects(objectsKeyPattern),
    );
  }

  public grantWrite(
    identity: iam.IGrantable,
    objectsKeyPattern: any = "*",
    allowedActionPatterns: string[] = [],
  ) {
    const grantedWriteActions =
      allowedActionPatterns.length > 0
        ? allowedActionPatterns
        : this.writeActions;
    return this.grant(
      identity,
      grantedWriteActions,
      perms.KEY_WRITE_ACTIONS,
      this.resource.arn,
      this.arnForObjects(objectsKeyPattern),
    );
  }

  /**
   * Grants s3:PutObject* and s3:Abort* permissions for this bucket to an IAM principal.
   *
   * If encryption is used, permission to use the key to encrypt the contents
   * of written files will also be granted to the same principal.
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  public grantPut(identity: iam.IGrantable, objectsKeyPattern: any = "*") {
    return this.grant(
      identity,
      perms.BUCKET_PUT_ACTIONS,
      perms.KEY_WRITE_ACTIONS,
      this.arnForObjects(objectsKeyPattern),
    );
  }

  public grantPutAcl(
    identity: iam.IGrantable,
    objectsKeyPattern: string = "*",
  ) {
    return this.grant(
      identity,
      perms.BUCKET_PUT_ACL_ACTIONS,
      [],
      this.arnForObjects(objectsKeyPattern),
    );
  }

  /**
   * Grants s3:DeleteObject* permission to an IAM principal for objects
   * in this bucket.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*'). Parameter type is `any` but `string` should be passed in.
   */
  public grantDelete(identity: iam.IGrantable, objectsKeyPattern: any = "*") {
    return this.grant(
      identity,
      perms.BUCKET_DELETE_ACTIONS,
      [],
      this.arnForObjects(objectsKeyPattern),
    );
  }

  public grantReadWrite(
    identity: iam.IGrantable,
    objectsKeyPattern: any = "*",
  ) {
    const bucketActions = perms.BUCKET_READ_ACTIONS.concat(this.writeActions);
    // we need unique permissions because some permissions are common between read and write key actions
    const keyActions = [
      ...new Set([...perms.KEY_READ_ACTIONS, ...perms.KEY_WRITE_ACTIONS]),
    ];

    return this.grant(
      identity,
      bucketActions,
      keyActions,
      this.resource.arn,
      this.arnForObjects(objectsKeyPattern),
    );
  }

  // TODO: currently only supported through `props.public` in constructor
  // /**
  //  * Allows unrestricted access to objects from this bucket.
  //  *
  //  * IMPORTANT: This permission allows anyone to perform actions on S3 objects
  //  * in this bucket, which is useful for when you configure your bucket as a
  //  * website and want everyone to be able to read objects in the bucket without
  //  * needing to authenticate.
  //  *
  //  * Without arguments, this method will grant read ("s3:GetObject") access to
  //  * all objects ("*") in the bucket.
  //  *
  //  * The method returns the `iam.Grant` object, which can then be modified
  //  * as needed. For example, you can add a condition that will restrict access only
  //  * to an IPv4 range like this:
  //  *
  //  *     const grant = bucket.grantPublicAccess();
  //  *     grant.resourceStatement!.addCondition(‘IpAddress’, { “aws:SourceIp”: “54.240.143.0/24” });
  //  *
  //  * Note that if this `IBucket` refers to an existing bucket, possibly not
  //  * managed by CloudFormation, this method will have no effect, since it's
  //  * impossible to modify the policy of an existing bucket.
  //  *
  //  * @param keyPrefix the prefix of S3 object keys (e.g. `home/*`). Default is "*".
  //  * @param allowedActions the set of S3 actions to allow. Default is "s3:GetObject".
  //  */
  // public grantPublicAccess(keyPrefix = "*", ...allowedActions: string[]) {
  //   if (!this.public) {
  //     throw new Error("Cannot grant public access when 'public' is enabled");
  //   }
  //   // TDOO: This should create publicAccess resource
  //   allowedActions =
  //     allowedActions.length > 0 ? allowedActions : ["s3:GetObject"];

  //   return iam.Grant.addToPrincipalOrResource({
  //     actions: allowedActions,
  //     resourceArns: [this.arnForObjects(keyPrefix)],
  //     grantee: new iam.AnyPrincipal(),
  //     resource: this,
  //   });
  // }

  /**
   * Adds a bucket notification event destination.
   *
   * S3 Buckets only support a single notification configuration resource.
   * Declaring multiple `aws_s3_bucket_notification` resources to the same
   * S3 Bucket will cause a perpetual difference in configuration.
   *
   * Calling this function will overwrite any existing event notifications configured
   * for the S3 bucket outside of this beacon.
   *
   * @param event The event to trigger the notification
   * @param dest The notification destination (Lambda, SNS Topic or SQS Queue)
   *
   * @param filters S3 object key filter rules to determine which objects
   * trigger this event. Each filter must include a `prefix` and/or `suffix`
   * that will be matched against the s3 object key. Refer to the S3 Developer Guide
   * for details about allowed filter rules.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/NotificationHowTo.html#notification-how-to-filtering
   *
   * @example
   *
   *    declare const myFunction: compute.Function;
   *    const bucket = new storage.Bucket(this, 'MyBucket');
   *    bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(myFunction), {prefix: 'home/myusername/*'});
   *
   * @see
   * https://docs.aws.amazon.com/AmazonS3/latest/dev/NotificationHowTo.html
   */
  public addEventNotification(
    event: EventType,
    dest: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ) {
    // TODO: This blocks adding notifications outside of the Stack owning the bucket...
    // AWS-CDK works around this by using a CustomResource handler (Lambda function) which modifies
    // the bucket policy in place (and CFN does not manage the actual bucket policy, so no tf state!)
    this.withNotifications((notifications) =>
      notifications.addNotification(event, dest, ...filters),
    );
  }

  private withNotifications(cb: (notifications: BucketNotifications) => void) {
    if (!this.notifications) {
      this.notifications = new BucketNotifications(this, "Notifications", {
        bucket: this,
      });
    }
    cb(this.notifications);
  }

  /**
   * Subscribes a destination to receive notifications when an object is
   * created in the bucket. This is identical to calling
   * `onEvent(EventType.OBJECT_CREATED)`.
   *
   * @param dest The notification destination (see onEvent)
   * @param filters Filters (see onEvent)
   */
  public addObjectCreatedNotification(
    dest: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ) {
    return this.addEventNotification(
      EventType.OBJECT_CREATED,
      dest,
      ...filters,
    );
  }

  /**
   * Subscribes a destination to receive notifications when an object is
   * removed from the bucket. This is identical to calling
   * `onEvent(EventType.OBJECT_REMOVED)`.
   *
   * @param dest The notification destination (see onEvent)
   * @param filters Filters (see onEvent)
   */
  public addObjectRemovedNotification(
    dest: IBucketNotificationDestination,
    ...filters: NotificationKeyFilter[]
  ) {
    return this.addEventNotification(
      EventType.OBJECT_REMOVED,
      dest,
      ...filters,
    );
  }

  /**
   * Enables event bridge notification, causing all events below to be sent to EventBridge:
   *
   * - Object Deleted (DeleteObject)
   * - Object Deleted (Lifecycle expiration)
   * - Object Restore Initiated
   * - Object Restore Completed
   * - Object Restore Expired
   * - Object Storage Class Changed
   * - Object Access Tier Changed
   * - Object ACL Updated
   * - Object Tags Added
   * - Object Tags Deleted
   */
  public enableEventBridgeNotification() {
    this.withNotifications((notifications) =>
      notifications.enableEventBridgeNotification(),
    );
  }

  private grant(
    grantee: iam.IGrantable,
    bucketActions: string[],
    _keyActions: string[],
    resourceArn: string,
    ...otherResourceArns: string[]
  ) {
    const resources = [resourceArn, ...otherResourceArns];

    const ret = iam.Grant.addToPrincipalOrResource({
      grantee,
      actions: bucketActions,
      resourceArns: resources,
      resource: this,
    });

    // TODO: re-add KMS support
    // if (this.encryptionKey && keyActions && keyActions.length !== 0) {
    //   this.encryptionKey.grant(grantee, ...keyActions);
    // }

    return ret;
  }

  private get writeActions(): string[] {
    return [...perms.BUCKET_DELETE_ACTIONS, ...perms.BUCKET_PUT_ACTIONS];
  }

  /**
   * Add a source to the bucket.
   *
   * @param props The properties of the source to add
   */
  public addSource(props: AddSourceOptions, sourceId?: string): string {
    if (this.versioned) {
      /**
       * If you enable versioning on a bucket for the first time, it might take up to 15 minutes
       * for the change to be fully propagated. We recommend that you wait for 15 minutes after
       * enabling versioning before issuing write operations (PUT or DELETE) on objects in the bucket.
       *
       * Write operations issued before this conversion is complete may apply to unversioned objects.
       */
      if (!this.sourceSleep) {
        this.sourceSleep = new sleep.Sleep(this, "VersioningSleep", {
          createDuration: "15m",
        });
      }
    }
    const indexedSource = this.sources.find(
      (sourceIndex) => sourceIndex.props === props,
    );
    if (indexedSource) {
      if (sourceId && sourceId !== indexedSource.id) {
        throw new Error(
          `Duplicate bucket source for ${indexedSource.id} and ${sourceId}.`,
        );
      }
      return indexedSource.id;
    }
    const nextIndex = this.sources.length;
    const id = sourceId ?? `source-${nextIndex}`;
    // ensure id (if provided) is unique within Bucket
    if (this.sources.some((sourceIndex) => sourceIndex.id === id)) {
      throw new Error(
        `Duplicate source id ${id}. SourceIds must be unique within a Bucket.`,
      );
    }
    this.sources.push({
      props: {
        ...props,
        bucket: this,
        dependsOn: this.sourceSleep ? [this.sourceSleep] : undefined,
      },
      id,
    });
    return id;
  }

  public isWebsite(): this is {
    websiteDomainName: string;
    bucketOutputs: { websiteUrl: string; websiteDomainName: string };
  } {
    return this._isWebsite;
  }

  /**
   * The https URL of an S3 object. Specify `regional: false` at the options
   * for non-regional URLs. For example:
   *
   * - `https://s3.us-west-1.amazonaws.com/onlybucket`
   * - `https://s3.us-west-1.amazonaws.com/bucket/key`
   * - `https://s3.cn-north-1.amazonaws.com.cn/china-bucket/mykey`
   *
   * @param key The S3 key of the object. If not specified, the URL of the
   *      bucket is returned.
   * @returns an ObjectS3Url token
   */
  public urlForObject(key?: string): string {
    const stack = AwsSpec.ofAwsBeacon(this);
    const prefix = `https://s3.${this.env.region}.${stack.urlSuffix}/`;
    if (typeof key !== "string") {
      return this.urlJoin(prefix, this.bucketName);
    }
    return this.urlJoin(prefix, this.bucketName, key);
  }

  /**
   * The S3 URL of an S3 object. For example:
   *
   * - `s3://onlybucket`
   * - `s3://bucket/key`
   *
   * @param key The S3 key of the object. If not specified, the S3 URL of the
   *      bucket is returned.
   * @returns an ObjectS3Url token
   */
  public s3UrlForObject(key?: string): string {
    const prefix = "s3://";
    if (typeof key !== "string") {
      return this.urlJoin(prefix, this.bucketName);
    }
    return this.urlJoin(prefix, this.bucketName, key);
  }

  /**
   * Returns an ARN that represents all objects within the bucket that match
   * the key pattern specified. To represent all keys, specify ``"*"``.
   *
   * If you need to specify a keyPattern with multiple components, concatenate them into a single string, e.g.:
   *
   *   arnForObjects(`home/${team}/${user}/*`)
   *
   */
  public arnForObjects(keyPattern: string): string {
    return `${this.resource.arn}/${keyPattern}`;
  }

  // https://github.com/aws/aws-cdk/blob/v2.140.0/packages/aws-cdk-lib/aws-s3/lib/bucket.ts#L953
  private urlJoin(...components: string[]): string {
    return components.reduce((result, component) => {
      if (result.endsWith("/")) {
        result = result.slice(0, -1);
      }
      if (component.startsWith("/")) {
        component = component.slice(1);
      }
      return `${result}/${component}`;
    });
  }

  /**
   * Adds an iam statement to enforce SSL requests only.
   */
  private enforceSSLStatement() {
    const statement = new iam.PolicyStatement({
      actions: ["s3:*"],
      condition: [
        {
          test: "Bool",
          variable: "aws:SecureTransport",
          values: ["false"],
        },
      ],
      effect: iam.Effect.DENY,
      resources: [this.resource.arn, this.arnForObjects("*")],
      principals: [new iam.AnyPrincipal()],
    });
    this.addToResourcePolicy(statement);
  }

  /**
   * Adds an iam statement to allow requests with a minimum TLS
   * version only.
   */
  private minimumTLSVersionStatement(minimumTLSVersion?: number) {
    if (!minimumTLSVersion) return;
    const statement = new iam.PolicyStatement({
      actions: ["s3:*"],
      condition: [
        {
          test: "NumericLessThan",
          variable: "s3:TlsVersion",
          values: [minimumTLSVersion.toString()],
        },
      ],
      effect: iam.Effect.DENY,
      resources: [this.resource.arn, this.arnForObjects("*")],
      principals: [new iam.AnyPrincipal()],
    });
    this.addToResourcePolicy(statement);
  }

  /**
   * Adds resource to the Terraform JSON output at Synth time.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    /**
     * A preparing resolve might add new resources to the stack
     *
     * should not add resources if no bucket sources are defined
     */
    if (Object.keys(this.sources).length === 0) {
      return {};
    }

    for (const source of this.sources) {
      // TODO: Ideally we should have used IResolvable.resolve and use the IResolveContext.preparing flag
      // ref: https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-iam/lib/policy-document.ts#L48
      if (this.node.tryFindChild(source.id)) continue; // ignore if already generated
      new BucketSource(this, source.id, source.props);
    }
    return {};
  }
}

export interface AddSourceOptions {
  /**
   * Local path to the source files
   */
  readonly path: string;
  /**
   * Prefix to add to the uploaded objects
   */
  readonly prefix?: string;
}

// private interface to index Bucket sources by id
interface SourceIndex {
  props: BucketSourceProps;
  id: string;
}

/**
 * Storage class to move an object to
 */
export enum StorageClass {
  /**
   * Storage class for data that is accessed less frequently, but requires rapid
   * access when needed.
   *
   * Has lower availability than Standard storage.
   */
  INFREQUENT_ACCESS = "STANDARD_IA",

  /**
   * Infrequent Access that's only stored in one availability zone.
   *
   * Has lower availability than standard InfrequentAccess.
   */
  ONE_ZONE_INFREQUENT_ACCESS = "ONEZONE_IA",

  /**
   * Storage class for long-term archival that can take between minutes and
   * hours to access.
   *
   * Use for archives where portions of the data might need to be retrieved in
   * minutes. Data stored in the GLACIER storage class has a minimum storage
   * duration period of 90 days and can be accessed in as little as 1-5 minutes
   * using expedited retrieval. If you delete an object before the 90-day
   * minimum, you are charged for 90 days.
   */
  GLACIER = "GLACIER",

  /**
   * Storage class for long-term archival that can be accessed in a few milliseconds.
   *
   * It is ideal for data that is accessed once or twice per quarter, and
   * that requires immediate access. Data stored in the GLACIER_IR storage class
   * has a minimum storage duration period of 90 days and can be accessed in
   * as milliseconds. If you delete an object before the 90-day minimum,
   * you are charged for 90 days.
   */
  GLACIER_INSTANT_RETRIEVAL = "GLACIER_IR",

  /**
   * Use for archiving data that rarely needs to be accessed. Data stored in the
   * DEEP_ARCHIVE storage class has a minimum storage duration period of 180
   * days and a default retrieval time of 12 hours. If you delete an object
   * before the 180-day minimum, you are charged for 180 days. For pricing
   * information, see Amazon S3 Pricing.
   */
  DEEP_ARCHIVE = "DEEP_ARCHIVE",

  /**
   * The INTELLIGENT_TIERING storage class is designed to optimize storage costs
   * by automatically moving data to the most cost-effective storage access
   * tier, without performance impact or operational overhead.
   * INTELLIGENT_TIERING delivers automatic cost savings by moving data on a
   * granular object level between two access tiers, a frequent access tier and
   * a lower-cost infrequent access tier, when access patterns change. The
   * INTELLIGENT_TIERING storage class is ideal if you want to optimize storage
   * costs automatically for long-lived data when access patterns are unknown or
   * unpredictable.
   */
  INTELLIGENT_TIERING = "INTELLIGENT_TIERING",
}

/**
 * Notification event types.
 * @link https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#supported-notification-event-types
 */
export enum EventType {
  /**
   * Amazon S3 APIs such as PUT, POST, and COPY can create an object. Using
   * these event types, you can enable notification when an object is created
   * using a specific API, or you can use the s3:ObjectCreated:* event type to
   * request notification regardless of the API that was used to create an
   * object.
   */
  OBJECT_CREATED = "s3:ObjectCreated:*",

  /**
   * Amazon S3 APIs such as PUT, POST, and COPY can create an object. Using
   * these event types, you can enable notification when an object is created
   * using a specific API, or you can use the s3:ObjectCreated:* event type to
   * request notification regardless of the API that was used to create an
   * object.
   */
  OBJECT_CREATED_PUT = "s3:ObjectCreated:Put",

  /**
   * Amazon S3 APIs such as PUT, POST, and COPY can create an object. Using
   * these event types, you can enable notification when an object is created
   * using a specific API, or you can use the s3:ObjectCreated:* event type to
   * request notification regardless of the API that was used to create an
   * object.
   */
  OBJECT_CREATED_POST = "s3:ObjectCreated:Post",

  /**
   * Amazon S3 APIs such as PUT, POST, and COPY can create an object. Using
   * these event types, you can enable notification when an object is created
   * using a specific API, or you can use the s3:ObjectCreated:* event type to
   * request notification regardless of the API that was used to create an
   * object.
   */
  OBJECT_CREATED_COPY = "s3:ObjectCreated:Copy",

  /**
   * Amazon S3 APIs such as PUT, POST, and COPY can create an object. Using
   * these event types, you can enable notification when an object is created
   * using a specific API, or you can use the s3:ObjectCreated:* event type to
   * request notification regardless of the API that was used to create an
   * object.
   */
  OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD = "s3:ObjectCreated:CompleteMultipartUpload",

  /**
   * By using the ObjectRemoved event types, you can enable notification when
   * an object or a batch of objects is removed from a bucket.
   *
   * You can request notification when an object is deleted or a versioned
   * object is permanently deleted by using the s3:ObjectRemoved:Delete event
   * type. Or you can request notification when a delete marker is created for
   * a versioned object by using s3:ObjectRemoved:DeleteMarkerCreated. For
   * information about deleting versioned objects, see Deleting Object
   * Versions. You can also use a wildcard s3:ObjectRemoved:* to request
   * notification anytime an object is deleted.
   *
   * You will not receive event notifications from automatic deletes from
   * lifecycle policies or from failed operations.
   */
  OBJECT_REMOVED = "s3:ObjectRemoved:*",

  /**
   * By using the ObjectRemoved event types, you can enable notification when
   * an object or a batch of objects is removed from a bucket.
   *
   * You can request notification when an object is deleted or a versioned
   * object is permanently deleted by using the s3:ObjectRemoved:Delete event
   * type. Or you can request notification when a delete marker is created for
   * a versioned object by using s3:ObjectRemoved:DeleteMarkerCreated. For
   * information about deleting versioned objects, see Deleting Object
   * Versions. You can also use a wildcard s3:ObjectRemoved:* to request
   * notification anytime an object is deleted.
   *
   * You will not receive event notifications from automatic deletes from
   * lifecycle policies or from failed operations.
   */
  OBJECT_REMOVED_DELETE = "s3:ObjectRemoved:Delete",

  /**
   * By using the ObjectRemoved event types, you can enable notification when
   * an object or a batch of objects is removed from a bucket.
   *
   * You can request notification when an object is deleted or a versioned
   * object is permanently deleted by using the s3:ObjectRemoved:Delete event
   * type. Or you can request notification when a delete marker is created for
   * a versioned object by using s3:ObjectRemoved:DeleteMarkerCreated. For
   * information about deleting versioned objects, see Deleting Object
   * Versions. You can also use a wildcard s3:ObjectRemoved:* to request
   * notification anytime an object is deleted.
   *
   * You will not receive event notifications from automatic deletes from
   * lifecycle policies or from failed operations.
   */
  OBJECT_REMOVED_DELETE_MARKER_CREATED = "s3:ObjectRemoved:DeleteMarkerCreated",

  /**
   * Using restore object event types you can receive notifications for
   * initiation and completion when restoring objects from the S3 Glacier
   * storage class.
   *
   * You use s3:ObjectRestore:Post to request notification of object restoration
   * initiation.
   */
  OBJECT_RESTORE_POST = "s3:ObjectRestore:Post",

  /**
   * Using restore object event types you can receive notifications for
   * initiation and completion when restoring objects from the S3 Glacier
   * storage class.
   *
   * You use s3:ObjectRestore:Completed to request notification of
   * restoration completion.
   */
  OBJECT_RESTORE_COMPLETED = "s3:ObjectRestore:Completed",

  /**
   * Using restore object event types you can receive notifications for
   * initiation and completion when restoring objects from the S3 Glacier
   * storage class.
   *
   * You use s3:ObjectRestore:Delete to request notification of
   * restoration completion.
   */
  OBJECT_RESTORE_DELETE = "s3:ObjectRestore:Delete",

  /**
   * You can use this event type to request Amazon S3 to send a notification
   * message when Amazon S3 detects that an object of the RRS storage class is
   * lost.
   */
  REDUCED_REDUNDANCY_LOST_OBJECT = "s3:ReducedRedundancyLostObject",

  /**
   * You receive this notification event when an object that was eligible for
   * replication using Amazon S3 Replication Time Control failed to replicate.
   */
  REPLICATION_OPERATION_FAILED_REPLICATION = "s3:Replication:OperationFailedReplication",

  /**
   * You receive this notification event when an object that was eligible for
   * replication using Amazon S3 Replication Time Control exceeded the 15-minute
   * threshold for replication.
   */
  REPLICATION_OPERATION_MISSED_THRESHOLD = "s3:Replication:OperationMissedThreshold",

  /**
   * You receive this notification event for an object that was eligible for
   * replication using the Amazon S3 Replication Time Control feature replicated
   * after the 15-minute threshold.
   */
  REPLICATION_OPERATION_REPLICATED_AFTER_THRESHOLD = "s3:Replication:OperationReplicatedAfterThreshold",

  /**
   * You receive this notification event for an object that was eligible for
   * replication using Amazon S3 Replication Time Control but is no longer tracked
   * by replication metrics.
   */
  REPLICATION_OPERATION_NOT_TRACKED = "s3:Replication:OperationNotTracked",

  /**
   * By using the LifecycleExpiration event types, you can receive a notification
   * when Amazon S3 deletes an object based on your S3 Lifecycle configuration.
   */
  LIFECYCLE_EXPIRATION = "s3:LifecycleExpiration:*",

  /**
   * The s3:LifecycleExpiration:Delete event type notifies you when an object
   * in an unversioned bucket is deleted.
   * It also notifies you when an object version is permanently deleted by an
   * S3 Lifecycle configuration.
   */
  LIFECYCLE_EXPIRATION_DELETE = "s3:LifecycleExpiration:Delete",

  /**
   * The s3:LifecycleExpiration:DeleteMarkerCreated event type notifies you
   * when S3 Lifecycle creates a delete marker when a current version of an
   * object in versioned bucket is deleted.
   */
  LIFECYCLE_EXPIRATION_DELETE_MARKER_CREATED = "s3:LifecycleExpiration:DeleteMarkerCreated",

  /**
   * You receive this notification event when an object is transitioned to
   * another Amazon S3 storage class by an S3 Lifecycle configuration.
   */
  LIFECYCLE_TRANSITION = "s3:LifecycleTransition",

  /**
   * You receive this notification event when an object within the
   * S3 Intelligent-Tiering storage class moved to the Archive Access tier or
   * Deep Archive Access tier.
   */
  INTELLIGENT_TIERING = "s3:IntelligentTiering",

  /**
   * By using the ObjectTagging event types, you can enable notification when
   * an object tag is added or deleted from an object.
   */
  OBJECT_TAGGING = "s3:ObjectTagging:*",

  /**
   * The s3:ObjectTagging:Put event type notifies you when a tag is PUT on an
   * object or an existing tag is updated.

   */
  OBJECT_TAGGING_PUT = "s3:ObjectTagging:Put",

  /**
   * The s3:ObjectTagging:Delete event type notifies you when a tag is removed
   * from an object.
   */
  OBJECT_TAGGING_DELETE = "s3:ObjectTagging:Delete",

  /**
   * You receive this notification event when an ACL is PUT on an object or when
   * an existing ACL is changed.
   * An event is not generated when a request results in no change to an
   * object’s ACL.
   */
  OBJECT_ACL_PUT = "s3:ObjectAcl:Put",
}

export interface NotificationKeyFilter {
  /**
   * Unique identifier for each of the notification configurations.
   */
  readonly id?: string;
  /**
   * S3 keys must have the specified prefix.
   */
  readonly prefix?: string;

  /**
   * S3 keys must have the specified suffix.
   */
  readonly suffix?: string;
}
