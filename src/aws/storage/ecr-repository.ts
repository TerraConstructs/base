// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-ecr/lib/repository.ts

import { EOL } from "node:os";
import {
  ecrLifecyclePolicy,
  ecrRepository,
  ecrRepositoryPolicy,
} from "@cdktf/provider-aws";
import { Annotations, Token } from "cdktf";
import { IConstruct, Construct } from "constructs";
import { LifecycleRule, TagStatus } from "./ecr-lifecycle";
import { ArnFormat } from "../arn";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import * as encryption from "../encryption";
import * as iam from "../iam";
import * as events from "../notify";

/**
 * Represents an ECR repository.
 */
export interface IRepository extends iam.IAwsConstructWithPolicy {
  /**
   * The name of the repository
   * @attribute
   */
  readonly repositoryName: string;

  /**
   * The ARN of the repository
   * @attribute
   */
  readonly repositoryArn: string;

  /**
   * The URI of this repository (represents the latest image):
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY
   *
   * @attribute
   */
  readonly repositoryUri: string;

  /**
   * The URI of this repository's registry:
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com
   *
   * @attribute
   */
  readonly registryUri: string;

  /**
   * Returns the URI of the repository for a certain tag. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[:TAG]
   *
   * @param tag Image tag to use (tools usually default to "latest" if omitted)
   */
  repositoryUriForTag(tag?: string): string;

  /**
   * Returns the URI of the repository for a certain digest. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[@DIGEST]
   *
   * @param digest Image digest to use (tools usually default to the image with the "latest" tag if omitted)
   */
  repositoryUriForDigest(digest?: string): string;

  /**
   * Returns the URI of the repository for a certain tag or digest, inferring based on the syntax of the tag. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[:TAG]
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[@DIGEST]
   *
   * @param tagOrDigest Image tag or digest to use (tools usually default to the image with the "latest" tag if omitted)
   */
  repositoryUriForTagOrDigest(tagOrDigest?: string): string;

  /**
   * Grant the given identity permissions to read images in this repository.
   */
  grantRead(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions to pull images in this repository.
   */
  grantPull(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions to push images in this repository.
   */
  grantPush(grantee: iam.IGrantable): iam.Grant;

  /**
   * Grant the given identity permissions to pull and push images to this repository.
   */
  grantPullPush(grantee: iam.IGrantable): iam.Grant;

  /**
   * Define a CloudWatch event that triggers when something happens to this repository
   *
   * Requires that there exists at least one CloudTrail Trail in your account
   * that captures the event. This method will not create the Trail.
   *
   * @param id The id of the rule
   * @param options Options for adding the rule
   */
  onCloudTrailEvent(id: string, options?: events.OnEventOptions): events.Rule;

  /**
   * Defines an AWS CloudWatch event rule that can trigger a target when an image is pushed to this
   * repository.
   *
   * Requires that there exists at least one CloudTrail Trail in your account
   * that captures the event. This method will not create the Trail.
   *
   * @param id The id of the rule
   * @param options Options for adding the rule
   */
  onCloudTrailImagePushed(
    id: string,
    options?: OnCloudTrailImagePushedOptions,
  ): events.Rule;

  /**
   * Defines an AWS CloudWatch event rule that can trigger a target when the image scan is completed
   *
   *
   * @param id The id of the rule
   * @param options Options for adding the rule
   */
  onImageScanCompleted(
    id: string,
    options?: OnImageScanCompletedOptions,
  ): events.Rule;

  /**
   * Defines a CloudWatch event rule which triggers for repository events. Use
   * `rule.addEventPattern(pattern)` to specify a filter.
   */
  onEvent(id: string, options?: events.OnEventOptions): events.Rule;
}

/**
 * Base class for ECR repository. Reused between imported repositories and owned repositories.
 */
export abstract class RepositoryBase
  extends AwsConstructBase
  implements IRepository
{
  private readonly REPO_PULL_ACTIONS: string[] = [
    "ecr:BatchCheckLayerAvailability",
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
  ];

  // https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push.html#image-push-iam
  private readonly REPO_PUSH_ACTIONS: string[] = [
    "ecr:CompleteLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:InitiateLayerUpload",
    "ecr:BatchCheckLayerAvailability",
    "ecr:PutImage",
  ];

  /**
   * The name of the repository
   */
  public abstract readonly repositoryName: string;

  /**
   * The ARN of the repository
   */
  public abstract readonly repositoryArn: string;

  public get outputs(): Record<string, any> {
    return {
      repositoryName: this.repositoryName,
      repositoryArn: this.repositoryArn,
      repositoryUri: this.repositoryUri,
    };
  }

  /**
   * Add a policy statement to the repository's resource policy
   */
  public abstract addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult;

  /**
   * The URI of this repository (represents the latest image):
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY
   *
   */
  public get repositoryUri() {
    return this.repositoryUriForTag();
  }

  /**
   * The URI of this repository's registry:
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com
   *
   */
  public get registryUri(): string {
    const parts = this.stack.splitArn(
      this.repositoryArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    );
    return `${parts.account}.dkr.ecr.${parts.region}.${this.stack.urlSuffix}`;
  }

  /**
   * Returns the URL of the repository. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[:TAG]
   *
   * @param tag Optional image tag
   */
  public repositoryUriForTag(tag?: string): string {
    const tagSuffix = tag ? `:${tag}` : "";
    return this.repositoryUriWithSuffix(tagSuffix);
  }

  /**
   * Returns the URL of the repository. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[@DIGEST]
   *
   * @param digest Optional image digest
   */
  public repositoryUriForDigest(digest?: string): string {
    const digestSuffix = digest ? `@${digest}` : "";
    return this.repositoryUriWithSuffix(digestSuffix);
  }

  /**
   * Returns the URL of the repository. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[:TAG]
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[@DIGEST]
   *
   * @param tagOrDigest Optional image tag or digest (digests must start with `sha256:`)
   */
  public repositoryUriForTagOrDigest(tagOrDigest?: string): string {
    if (tagOrDigest?.startsWith("sha256:")) {
      return this.repositoryUriForDigest(tagOrDigest);
    } else {
      return this.repositoryUriForTag(tagOrDigest);
    }
  }

  /**
   * Returns the repository URI, with an appended suffix, if provided.
   * @param suffix An image tag or an image digest.
   * @private
   */
  private repositoryUriWithSuffix(suffix?: string): string {
    const parts = this.stack.splitArn(
      this.repositoryArn,
      ArnFormat.SLASH_RESOURCE_NAME,
    );
    return `${parts.account}.dkr.ecr.${parts.region}.${this.stack.urlSuffix}/${this.repositoryName}${suffix}`;
  }

  /**
   * Define a CloudWatch event that triggers when something happens to this repository
   *
   * Requires that there exists at least one CloudTrail Trail in your account
   * that captures the event. This method will not create the Trail.
   *
   * @param id The id of the rule
   * @param options Options for adding the rule
   */
  public onCloudTrailEvent(
    id: string,
    options: events.OnEventOptions = {},
  ): events.Rule {
    const rule = new events.Rule(this, id, options);
    rule.addTarget(options.target);
    rule.addEventPattern({
      source: ["aws.ecr"],
      detailType: ["AWS API Call via CloudTrail"],
      detail: {
        requestParameters: {
          repositoryName: [this.repositoryName],
        },
      },
    });
    return rule;
  }

  /**
   * Defines an AWS CloudWatch event rule that can trigger a target when an image is pushed to this
   * repository.
   *
   * Requires that there exists at least one CloudTrail Trail in your account
   * that captures the event. This method will not create the Trail.
   *
   * @param id The id of the rule
   * @param options Options for adding the rule
   */
  public onCloudTrailImagePushed(
    id: string,
    options: OnCloudTrailImagePushedOptions = {},
  ): events.Rule {
    const rule = this.onCloudTrailEvent(id, options);
    rule.addEventPattern({
      detail: {
        eventName: ["PutImage"],
        requestParameters: {
          imageTag: options.imageTag ? [options.imageTag] : undefined,
        },
      },
    });
    return rule;
  }
  /**
   * Defines an AWS CloudWatch event rule that can trigger a target when an image scan is completed
   *
   *
   * @param id The id of the rule
   * @param options Options for adding the rule
   */
  public onImageScanCompleted(
    id: string,
    options: OnImageScanCompletedOptions = {},
  ): events.Rule {
    const rule = new events.Rule(this, id, options);
    rule.addTarget(options.target);
    rule.addEventPattern({
      source: ["aws.ecr"],
      detailType: ["ECR Image Scan"],
      detail: {
        "repository-name": [this.repositoryName],
        "scan-status": ["COMPLETE"],
        "image-tags": options.imageTags ?? undefined,
      },
    });
    return rule;
  }

  /**
   * Defines a CloudWatch event rule which triggers for repository events. Use
   * `rule.addEventPattern(pattern)` to specify a filter.
   */
  public onEvent(id: string, options: events.OnEventOptions = {}) {
    const rule = new events.Rule(this, id, options);
    rule.addEventPattern({
      source: ["aws.ecr"],
      detail: {
        "repository-name": [this.repositoryName],
      },
    });
    rule.addTarget(options.target);
    return rule;
  }

  /**
   * Grant the given principal identity permissions to perform the actions on this repository
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]) {
    // TODO: Implement cross-account principal logic from CDK
    return iam.Grant.addToPrincipalOrResource({
      grantee,
      actions,
      resourceArns: [this.repositoryArn],
      resource: this,
    });
  }

  /**
   * Grant the given identity permissions to read the images in this repository
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return this.grant(
      grantee,
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
    );
  }

  /**
   * Grant the given identity permissions to use the images in this repository
   */
  public grantPull(grantee: iam.IGrantable) {
    const ret = this.grant(grantee, ...this.REPO_PULL_ACTIONS);

    iam.Grant.addToPrincipal({
      grantee,
      actions: ["ecr:GetAuthorizationToken"],
      resourceArns: ["*"],
      scope: this,
    });

    return ret;
  }

  /**
   * Grant the given identity permissions to use the images in this repository
   */
  public grantPush(grantee: iam.IGrantable) {
    const ret = this.grant(grantee, ...this.REPO_PUSH_ACTIONS);
    iam.Grant.addToPrincipal({
      grantee,
      actions: ["ecr:GetAuthorizationToken"],
      resourceArns: ["*"],
      scope: this,
    });

    return ret;
  }

  /**
   * Grant the given identity permissions to pull and push images to this repository.
   */
  public grantPullPush(grantee: iam.IGrantable) {
    const ret = this.grant(
      grantee,
      ...this.REPO_PULL_ACTIONS,
      ...this.REPO_PUSH_ACTIONS,
    );
    iam.Grant.addToPrincipal({
      grantee,
      actions: ["ecr:GetAuthorizationToken"],
      resourceArns: ["*"],
      scope: this,
    });

    return ret;
  }
}

/**
 * Options for the onCloudTrailImagePushed method
 */
export interface OnCloudTrailImagePushedOptions extends events.OnEventOptions {
  /**
   * Only watch changes to this image tag
   *
   * @default - Watch changes to all tags
   */
  readonly imageTag?: string;
}

/**
 * Options for the OnImageScanCompleted method
 */
export interface OnImageScanCompletedOptions extends events.OnEventOptions {
  /**
   * Only watch changes to the image tags specified.
   * Leave it undefined to watch the full repository.
   *
   * @default - Watch the changes to the repository with all image tags
   */
  readonly imageTags?: string[];
}

export interface RepositoryProps extends AwsConstructProps {
  /**
   * Name for this repository.
   *
   * The repository name must start with a letter and can only contain lowercase letters, numbers, hyphens, underscores, and forward slashes.
   *
   * > If you specify a name, you cannot perform updates that require replacement of this resource. You can perform updates that require no or some interruption. If you must replace the resource, specify a new name.
   *
   * @default Automatically generated name.
   */
  readonly repositoryName?: string;

  /**
   * The kind of server-side encryption to apply to this repository.
   *
   * If you choose KMS, you can specify a KMS key via `encryptionKey`. If
   * encryptionKey is not specified, an AWS managed KMS key is used.
   *
   * @default - `KMS` if `encryptionKey` is specified, or `AES256` otherwise.
   */
  readonly encryption?: RepositoryEncryption;

  /**
   * External KMS key to use for repository encryption.
   *
   * The 'encryption' property must be either not specified or set to "KMS".
   * An error will be emitted if encryption is set to "AES256".
   *
   * @default - If encryption is set to `KMS` and this property is undefined,
   * an AWS managed KMS key is used.
   */
  readonly encryptionKey?: encryption.IKey;

  /**
   * Life cycle rules to apply to this registry
   *
   * @default No life cycle rules
   */
  readonly lifecycleRules?: LifecycleRule[];

  /**
   * The AWS account ID associated with the registry that contains the repository.
   *
   * @see https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_PutLifecyclePolicy.html
   * @default The default registry is assumed.
   * @deprecated This property is not supported by the Terraform AWS provider for ECR lifecycle policies.
   */
  readonly lifecycleRegistryId?: string;

  /**
   * Enable the scan on push when creating the repository
   *
   *  @default false
   */
  readonly imageScanOnPush?: boolean;

  /**
   * The tag mutability setting for the repository. If this parameter is omitted, the default setting of MUTABLE will be used which will allow image tags to be overwritten.
   *
   *  @default TagMutability.MUTABLE
   */
  readonly imageTagMutability?: TagMutability;

  /**
   * Whether all images should be automatically deleted when the repository is
   * removed from the stack or when the stack is deleted.
   *
   * Requires the `forceDelete` property to be set to `true`.
   *
   * @default false
   * @deprecated Use `forceDelete` instead. This functionality is not implemented in TerraConstructs as it requires a custom resource.
   */
  readonly autoDeleteImages?: boolean;

  /**
   * If true, deleting the repository force deletes the contents of the repository. If false, the repository must be empty before attempting to delete it.
   *
   * @default false
   */
  readonly emptyOnDelete?: boolean;
}

export interface RepositoryAttributes {
  readonly repositoryName: string;
  readonly repositoryArn: string;
}

/**
 * Define an ECR repository
 */
export class Repository extends RepositoryBase {
  /**
   * Import a repository
   */
  public static fromRepositoryAttributes(
    scope: Construct,
    id: string,
    attrs: RepositoryAttributes,
  ): IRepository {
    class Import extends RepositoryBase {
      public readonly repositoryName = attrs.repositoryName;
      public readonly repositoryArn = attrs.repositoryArn;

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        // dropped
        return { statementAdded: false };
      }
    }

    return new Import(scope, id);
  }

  public static fromRepositoryArn(
    scope: Construct,
    id: string,
    repositoryArn: string,
  ): IRepository {
    if (Token.isUnresolved(repositoryArn)) {
      // TODO: UnscopedValidationError
      throw new Error(
        '"repositoryArn" is a late-bound value, and therefore "repositoryName" is required. Use `fromRepositoryAttributes` instead',
      );
    }

    validateRepositoryArn();

    const repositoryName = repositoryArn.split("/").slice(1).join("/");

    class Import extends RepositoryBase {
      public repositoryName = repositoryName;
      public repositoryArn = repositoryArn;

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        // dropped
        return { statementAdded: false };
      }
    }

    return new Import(scope, id, {
      environmentFromArn: repositoryArn,
    });

    function validateRepositoryArn() {
      const splitArn = repositoryArn.split(":");

      if (!splitArn[splitArn.length - 1].startsWith("repository/")) {
        // TODO: UnscopedValidationError
        throw new Error(
          `Repository arn should be in the format 'arn:<PARTITION>:ecr:<REGION>:<ACCOUNT>:repository/<NAME>', got ${repositoryArn}.`,
        );
      }
    }
  }

  public static fromRepositoryName(
    scope: Construct,
    id: string,
    repositoryName: string,
  ): IRepository {
    class Import extends RepositoryBase {
      public repositoryName = repositoryName;
      public repositoryArn = Repository.arnForLocalRepository(
        repositoryName,
        scope,
      );

      public addToResourcePolicy(
        _statement: iam.PolicyStatement,
      ): iam.AddToResourcePolicyResult {
        // dropped
        return { statementAdded: false };
      }
    }

    return new Import(scope, id);
  }

  /**
   * Returns an ECR ARN for a repository that resides in the same account/region
   * as the current stack.
   */
  public static arnForLocalRepository(
    repositoryName: string,
    scope: IConstruct,
    account?: string,
  ): string {
    return AwsStack.ofAwsConstruct(scope).formatArn({
      account,
      service: "ecr",
      resource: "repository",
      resourceName: repositoryName,
    });
  }

  private static validateRepositoryName(physicalName: string) {
    const repositoryName = physicalName;
    if (!repositoryName || Token.isUnresolved(repositoryName)) {
      // the name is a late-bound value, not a defined string,
      // so skip validation
      return;
    }

    const errors: string[] = [];

    // Rules codified from https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ecr-repository.html
    if (repositoryName.length < 2 || repositoryName.length > 256) {
      errors.push(
        "Repository name must be at least 2 and no more than 256 characters",
      );
    }
    const isPatternMatch =
      /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(
        repositoryName,
      );
    if (!isPatternMatch) {
      errors.push(
        "Repository name must start with a letter and can only contain lowercase letters, numbers, hyphens, underscores, periods and forward slashes",
      );
    }

    if (errors.length > 0) {
      // TODO: UnscopedValidationError
      throw new Error(
        `Invalid ECR repository name (value: ${repositoryName})${EOL}${errors.join(
          EOL,
        )}`,
      );
    }
  }

  public readonly repositoryName: string;
  public readonly repositoryArn: string;
  private readonly lifecycleRules = new Array<LifecycleRule>();
  private policyDocument?: iam.PolicyDocument;
  private readonly resource: ecrRepository.EcrRepository;

  constructor(scope: Construct, id: string, props: RepositoryProps = {}) {
    super(scope, id, props);

    const name =
      props.repositoryName ||
      this.stack.uniqueResourceName(this, {
        // TODO: Repo name can't start with a number...
        // prefix: this.gridUUID,
        //Repository name must start with a letter and can only contain lowercase letters, numbers, hyphens, underscores, periods and forward slashes
        maxLength: 256,
        lowerCase: true,
        allowedSpecialCharacters: "-_./",
        separator: "-",
      });
    Repository.validateRepositoryName(name);

    this.resource = new ecrRepository.EcrRepository(this, "Resource", {
      name: name,
      imageScanningConfiguration:
        props.imageScanOnPush !== undefined
          ? { scanOnPush: props.imageScanOnPush }
          : undefined,
      imageTagMutability: props.imageTagMutability || undefined,
      encryptionConfiguration: this.parseEncryption(props),
      forceDelete: props.emptyOnDelete,
      // TODO: implement retain policy by default?
      // lifecycle: {
      //   preventDestroy: props.emptyOnDelete === false,
      // },
    });

    if (props.lifecycleRegistryId) {
      // TODO: Annotations.of(this).addWarningV2(...)
      Annotations.of(this).addWarning(
        "lifecycleRegistryId is not supported by the Terraform AWS provider and will be ignored.",
      );
    }

    if (props.lifecycleRules) {
      props.lifecycleRules.forEach(this.addLifecycleRule.bind(this));
    }

    this.repositoryName = this.resource.name;
    this.repositoryArn = this.resource.arn;

    if (props.emptyOnDelete === false && props.autoDeleteImages) {
      // TODO: ValidationError
      throw new Error(
        "Cannot use 'autoDeleteImages' property on a repository without setting forceDelete to 'true'.",
      );
    } else if (props.autoDeleteImages) {
      // TODO: Implement Custom Resource for auto-deleting images.
      // this.enableAutoDeleteImages();
      Annotations.of(this).addWarning(
        "autoDeleteImages is deprecated and not implemented. Use forceDelete instead.",
      );
    }

    this.node.addValidation({
      validate: () => this.policyDocument?.validateForResourcePolicy() ?? [],
    });
  }

  /**
   * Add a policy statement to the repository's resource policy.
   */
  public addToResourcePolicy(
    statement: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    if (statement.resources.length) {
      // TODO: Annotations.of(this).addWarningV2('@aws-cdk/aws-ecr:noResourceStatements, ...)
      Annotations.of(this).addWarning(
        "ECR resource policy does not allow resource statements.",
      );
    }
    if (this.policyDocument === undefined) {
      this.policyDocument = new iam.PolicyDocument(this, "PolicyDocument");
      new ecrRepositoryPolicy.EcrRepositoryPolicy(this, "Policy", {
        repository: this.repositoryName,
        policy: this.policyDocument.json,
      });
    }
    this.policyDocument.addStatements(statement);
    return { statementAdded: true, policyDependable: this.policyDocument };
  }

  /**
   * The URI of this repository's registry:
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com
   *
   */
  public get registryUri(): string {
    return this.resource.registryId;
  }

  /**
   * Returns the URL of the repository. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[:TAG]
   *
   * @param tag Optional image tag
   */
  public repositoryUriForTag(tag?: string): string {
    const tagSuffix = tag ? `:${tag}` : "";
    return this.resource.repositoryUrl + tagSuffix;
  }

  /**
   * Returns the URL of the repository. Can be used in `docker push/pull`.
   *
   *    ACCOUNT.dkr.ecr.REGION.amazonaws.com/REPOSITORY[@DIGEST]
   *
   * @param digest Optional image digest
   */
  public repositoryUriForDigest(digest?: string): string {
    const digestSuffix = digest ? `@${digest}` : "";
    return this.resource.repositoryUrl + digestSuffix;
  }

  /**
   * Add a life cycle rule to the repository
   *
   * Life cycle rules automatically expire images from the repository that match
   * certain conditions.
   */
  public addLifecycleRule(rule: LifecycleRule) {
    // Validate rule here so users get errors at the expected location
    if (rule.tagStatus === undefined) {
      rule = {
        ...rule,
        tagStatus:
          rule.tagPrefixList === undefined && rule.tagPatternList === undefined
            ? TagStatus.ANY
            : TagStatus.TAGGED,
      };
    }

    if (
      rule.tagStatus === TagStatus.TAGGED &&
      (rule.tagPrefixList === undefined || rule.tagPrefixList.length === 0) &&
      (rule.tagPatternList === undefined || rule.tagPatternList.length === 0)
    ) {
      // TODO: ValidationError
      throw new Error(
        "TagStatus.Tagged requires the specification of a tagPrefixList or a tagPatternList",
      );
    }
    if (
      rule.tagStatus !== TagStatus.TAGGED &&
      (rule.tagPrefixList !== undefined || rule.tagPatternList !== undefined)
    ) {
      // TODO: ValidationError
      throw new Error(
        "tagPrefixList and tagPatternList can only be specified when tagStatus is set to Tagged",
      );
    }
    if (rule.tagPrefixList !== undefined && rule.tagPatternList !== undefined) {
      // TODO: ValidationError
      throw new Error(
        "Both tagPrefixList and tagPatternList cannot be specified together in a rule",
      );
    }
    if (rule.tagPatternList !== undefined) {
      rule.tagPatternList.forEach((pattern) => {
        const splitPatternLength = pattern.split("*").length;
        if (splitPatternLength > 5) {
          // TODO: ValidationError
          throw new Error(
            `A tag pattern cannot contain more than four wildcard characters (*), pattern: ${pattern}, counts: ${
              splitPatternLength - 1
            }`,
          );
        }
      });
    }
    if (
      (rule.maxImageAge !== undefined) ===
      (rule.maxImageCount !== undefined)
    ) {
      // TODO: ValidationError
      throw new Error(
        `Life cycle rule must contain exactly one of 'maxImageAge' and 'maxImageCount', got: ${JSON.stringify(
          rule,
        )}`,
      );
    }

    if (
      rule.tagStatus === TagStatus.ANY &&
      this.lifecycleRules.filter((r) => r.tagStatus === TagStatus.ANY).length >
        0
    ) {
      // TODO: ValidationError
      throw new Error("Life cycle can only have one TagStatus.Any rule");
    }

    this.lifecycleRules.push({ ...rule });
  }

  /**
   * Render the life cycle policy object
   */
  private renderLifecyclePolicy(): string | undefined {
    if (this.lifecycleRules.length === 0) {
      return undefined;
    }

    const policy = {
      rules: this.orderedLifecycleRules().map(renderLifecycleRule),
    };

    return this.stack.toJsonString(policy);
  }

  /**
   * Return life cycle rules with automatic ordering applied.
   *
   * Also applies validation of the 'any' rule.
   */
  private orderedLifecycleRules(): LifecycleRule[] {
    if (this.lifecycleRules.length === 0) {
      return [];
    }

    const prioritizedRules = this.lifecycleRules.filter(
      (r) => r.rulePriority !== undefined && r.tagStatus !== TagStatus.ANY,
    );
    const autoPrioritizedRules = this.lifecycleRules.filter(
      (r) => r.rulePriority === undefined && r.tagStatus !== TagStatus.ANY,
    );
    const anyRules = this.lifecycleRules.filter(
      (r) => r.tagStatus === TagStatus.ANY,
    );
    if (
      anyRules.length > 0 &&
      anyRules[0].rulePriority !== undefined &&
      autoPrioritizedRules.length > 0
    ) {
      // Supporting this is too complex for very little value. We just prohibit it.
      // TODO: ValidationError
      throw new Error(
        "Cannot combine prioritized TagStatus.Any rule with unprioritized rules. Remove rulePriority from the 'Any' rule.",
      );
    }

    const prios = prioritizedRules.map((r) => r.rulePriority!);
    let autoPrio = (prios.length > 0 ? Math.max(...prios) : 0) + 1;

    const ret = new Array<LifecycleRule>();
    for (const rule of prioritizedRules
      .concat(autoPrioritizedRules)
      .concat(anyRules)) {
      ret.push({
        ...rule,
        rulePriority: rule.rulePriority ?? autoPrio++,
      });
    }

    // Do validation on the final array--might still be wrong because the user supplied all prios, but incorrectly.
    validateAnyRuleLast(ret);
    return ret;
  }

  /**
   * Set up key properties and return the Repository encryption property from the
   * user's configuration.
   */
  private parseEncryption(
    props: RepositoryProps,
  ): ecrRepository.EcrRepositoryEncryptionConfiguration[] | undefined {
    // default based on whether encryptionKey is specified
    const encryptionType =
      props.encryption ??
      (props.encryptionKey
        ? RepositoryEncryption.KMS
        : RepositoryEncryption.AES_256);

    // if encryption key is set, encryption must be set to KMS.
    if (encryptionType !== RepositoryEncryption.KMS && props.encryptionKey) {
      // TODO: ValidationError
      throw new Error(
        `encryptionKey is specified, so 'encryption' must be set to KMS (value: ${encryptionType.value})`,
      );
    }

    if (encryptionType === RepositoryEncryption.AES_256) {
      return undefined;
    }

    if (encryptionType === RepositoryEncryption.KMS) {
      return [
        {
          encryptionType: "KMS",
          kmsKey: props.encryptionKey?.keyArn,
        },
      ];
    }

    // TODO: ValidationError
    throw new Error(`Unexpected 'encryptionType': ${encryptionType}`);
  }

  /**
   * Adds resource to the Terraform JSON output at Synth time.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    /**
     * A preparing resolve might add new resources to the stack
     */
    const lifeCyclePolicy = this.renderLifecyclePolicy();
    // ignore if undefined or already generated
    if (lifeCyclePolicy && !this.node.tryFindChild("LifecyclePolicy")) {
      new ecrLifecyclePolicy.EcrLifecyclePolicy(this, "LifecyclePolicy", {
        repository: this.repositoryName,
        policy: lifeCyclePolicy,
      });
    }
    return {};
  }
}

function validateAnyRuleLast(rules: LifecycleRule[]) {
  const anyRules = rules.filter((r) => r.tagStatus === TagStatus.ANY);
  if (anyRules.length === 1) {
    const maxPrio = Math.max(...rules.map((r) => r.rulePriority!));
    if (anyRules[0].rulePriority !== maxPrio) {
      // TODO: UnscopedValidationError
      throw new Error(
        `TagStatus.Any rule must have highest priority, has ${anyRules[0].rulePriority} which is smaller than ${maxPrio}`,
      );
    }
  }
}

/**
 * Render the lifecycle rule to JSON
 */
function renderLifecycleRule(rule: LifecycleRule) {
  return {
    rulePriority: rule.rulePriority,
    description: rule.description,
    selection: {
      tagStatus: rule.tagStatus || TagStatus.ANY,
      tagPrefixList: rule.tagPrefixList,
      tagPatternList: rule.tagPatternList,
      countType:
        rule.maxImageAge !== undefined
          ? CountType.SINCE_IMAGE_PUSHED
          : CountType.IMAGE_COUNT_MORE_THAN,
      countNumber: rule.maxImageAge?.toDays() ?? rule.maxImageCount,
      countUnit: rule.maxImageAge !== undefined ? "days" : undefined,
    },
    action: {
      type: "expire",
    },
  };
}

/**
 * Select images based on counts
 */
enum CountType {
  /**
   * Set a limit on the number of images in your repository
   */
  IMAGE_COUNT_MORE_THAN = "imageCountMoreThan",

  /**
   * Set an age limit on the images in your repository
   */
  SINCE_IMAGE_PUSHED = "sinceImagePushed",
}

/**
 * The tag mutability setting for your repository.
 */
export enum TagMutability {
  /**
   * allow image tags to be overwritten.
   */
  MUTABLE = "MUTABLE",

  /**
   * all image tags within the repository will be immutable which will prevent them from being overwritten.
   */
  IMMUTABLE = "IMMUTABLE",
}

/**
 * Indicates whether server-side encryption is enabled for the object, and whether that encryption is
 * from the AWS Key Management Service (AWS KMS) or from Amazon S3 managed encryption (SSE-S3).
 * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html#SysMetadata
 */
export class RepositoryEncryption {
  /**
   * 'AES256'
   */
  public static readonly AES_256 = new RepositoryEncryption("AES256");
  /**
   * 'KMS'
   */
  public static readonly KMS = new RepositoryEncryption("KMS");
  /**
   * 'KMS_DSSE'
   */
  public static readonly KMS_DSSE = new RepositoryEncryption("KMS_DSSE");

  /**
   * @param value the string value of the encryption
   */
  protected constructor(public readonly value: string) {}
}
