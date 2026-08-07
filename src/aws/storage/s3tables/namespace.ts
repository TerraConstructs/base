// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/namespace.ts
//
// TODO(alpha-tracker): ported from @aws-cdk/aws-s3tables-alpha@2.263.0-alpha.0 (stability:
// experimental). Re-diff against upstream on every reference-tag bump — alpha surfaces churn
// without deprecation cycles.

import { EOL } from "node:os";
import { s3TablesNamespace } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import type { ITableBucket } from "./table-bucket";
import { UnscopedValidationError } from "../../../errors";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";

/**
 * Represents an S3 Tables Namespace.
 */
export interface INamespace extends IAwsConstruct {
  /**
   * The name of this namespace
   * @attribute
   */
  readonly namespaceName: string;

  /**
   * The table bucket which this namespace belongs to
   * @attribute
   */
  readonly tableBucket: ITableBucket;
}

/**
 * Parameters for constructing a Namespace
 */
export interface NamespaceProps extends AwsConstructProps {
  /**
   * A name for the namespace
   *
   * TERRACONSTRUCTS DEVIATION: kept required, matching upstream verbatim -- see the identical note
   * on `TableBucketProps.tableBucketName` in `./table-bucket.ts` for the rationale (this repo's
   * `uniqueResourceName` house-pattern default was deliberately not adopted here).
   */
  readonly namespaceName: string;
  /**
   * The table bucket this namespace belongs to.
   */
  readonly tableBucket: ITableBucket;

  // TODO: omitted — upstream's `removalPolicy?: RemovalPolicy` (default `RemovalPolicy.DESTROY`,
  // applied via `_resource.applyRemovalPolicy`) is CloudFormation's DeletionPolicy concept.
  // `core.RemovalPolicy` is not ported anywhere in this repo (see the identical omission on
  // `TableProps`/`TablePolicyProps` in `./table.ts`/`./table-policy.ts` and on every other ported
  // module, e.g. `../docdb/cluster.ts`). `aws_s3tables_namespace` has no Terraform-native
  // lifecycle replacement to offer here (unlike e.g. `skipFinalSnapshot` on `aws_neptune_cluster`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-s3tables-alpha/lib/namespace.ts#L40-L44
  // readonly removalPolicy?: RemovalPolicy;
}

/**
 * Attributes for importing an existing namespace
 */
export interface NamespaceAttributes {
  /**
   * The name of the namespace
   */
  readonly namespaceName: string;

  /**
   * The table bucket this namespace belongs to
   */
  readonly tableBucket: ITableBucket;
}

/**
 * An S3 Tables Namespace with helpers.
 *
 * A namespace is a logical container for tables within a table bucket.
 *
 * @resource aws_s3tables_namespace
 */
export class Namespace extends AwsConstructBase implements INamespace {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.s3tables.Namespace";

  /**
   * Import an existing namespace from its attributes
   */
  public static fromNamespaceAttributes(
    scope: Construct,
    id: string,
    attrs: NamespaceAttributes,
  ): INamespace {
    class Import extends AwsConstructBase implements INamespace {
      public readonly namespaceName = attrs.namespaceName;
      public readonly tableBucket = attrs.tableBucket;
      public get outputs(): Record<string, any> {
        return {
          namespaceName: this.namespaceName,
        };
      }
    }

    return new Import(scope, id);
  }
  /**
   * See https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-buckets-naming.html
   * @param namespaceName Name of the namespace
   * @throws UnscopedValidationError if any naming errors are detected
   */
  public static validateNamespaceName(namespaceName: string) {
    if (namespaceName == undefined || Token.isUnresolved(namespaceName)) {
      // the name is a late-bound value, not a defined string, so skip validation
      return;
    }

    const errors: string[] = [];

    // Length validation
    if (namespaceName.length < 1 || namespaceName.length > 255) {
      errors.push(
        "Namespace name must be at least 1 and no more than 255 characters",
      );
    }

    // Character set validation
    const illegalCharsetRegEx = /[^a-z0-9_]/;
    const allowedEdgeCharsetRegEx = /[a-z0-9]/;

    const illegalCharMatch = namespaceName.match(illegalCharsetRegEx);
    if (illegalCharMatch) {
      errors.push(
        "Namespace name must only contain lowercase characters, numbers, and underscores (_)" +
          ` (offset: ${illegalCharMatch.index})`,
      );
    }

    // Edge character validation
    if (!allowedEdgeCharsetRegEx.test(namespaceName.charAt(0))) {
      errors.push(
        "Namespace name must start with a lowercase letter or number (offset: 0)",
      );
    }
    if (
      !allowedEdgeCharsetRegEx.test(
        namespaceName.charAt(namespaceName.length - 1),
      )
    ) {
      errors.push(
        `Namespace name must end with a lowercase letter or number (offset: ${
          namespaceName.length - 1
        })`,
      );
    }

    if (namespaceName.startsWith("aws")) {
      errors.push("Namespace name must not start with reserved prefix 'aws'");
    }

    if (errors.length > 0) {
      throw new UnscopedValidationError(
        `Invalid S3 Tables namespace name (value: ${namespaceName})${EOL}${errors.join(EOL)}`,
      );
    }
  }

  /**
   * @internal The underlying namespace resource.
   */
  private readonly _resource: s3TablesNamespace.S3TablesNamespace;

  /**
   * The name of this namespace
   */
  public readonly namespaceName: string;

  /**
   * The table bucket which this namespace belongs to
   */
  public readonly tableBucket: ITableBucket;

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * e.g. `TableBucketBase.outputs` in `./table-bucket.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      namespaceName: this.namespaceName,
      tableBucketArn: this._resource.tableBucketArn,
    };
  }

  constructor(scope: Construct, id: string, props: NamespaceProps) {
    // NOTE: `props.account`/`props.region` are intentionally NOT forwarded here -- identical
    // rationale to `TableBucket`'s constructor in `./table-bucket.ts` (see the note on
    // `TableBucketProps.region` there): forwarding them would give this construct's
    // `env.account`/`env.region` a literal value that defeats the
    // `iam.Grant.addToPrincipalOrResource()` same-account short-circuit (`../../iam/grant.ts`),
    // spuriously attaching a resource policy to every same-account grant.
    super(scope, id, { ...props, account: undefined, region: undefined });

    Namespace.validateNamespaceName(props.namespaceName);

    this.tableBucket = props.tableBucket;
    this.namespaceName = props.namespaceName;
    this._resource = new s3TablesNamespace.S3TablesNamespace(this, "Resource", {
      namespace: props.namespaceName,
      tableBucketArn: this.tableBucket.tableBucketArn,
    });

    // TODO: omitted — see the `removalPolicy` TODO on `NamespaceProps` above.
    // if (props.removalPolicy) {
    //   this._resource.applyRemovalPolicy(props.removalPolicy);
    // }
  }
}
