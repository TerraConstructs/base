// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/no-password-user.ts

import { elasticacheUser } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import { UserEngine } from "./common";
import type { UserBaseProps } from "./user-base";
import { UserBase } from "./user-base";
import { ValidationError } from "../../../errors";

/**
 * List of engines that support no-password authentication.
 */
const SUPPORTED_NO_PASSWORD_ENGINES = [UserEngine.REDIS];

const ELASTICACHE_NOPASSWORDUSER_SYMBOL = Symbol.for(
  "@aws-cdk/aws-elasticache.NoPasswordUser",
);

/**
 * Properties for defining an ElastiCache user with no password authentication.
 */
export interface NoPasswordUserProps extends UserBaseProps {
  /**
   * The name of the user.
   *
   * @default - Same as userId.
   */
  readonly userName?: string;
}

/**
 * Define an ElastiCache user with no password authentication.
 *
 * @resource aws_elasticache_user
 */
export class NoPasswordUser extends UserBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.elasticache.NoPasswordUser";

  /**
   * Return whether the given object is a `NoPasswordUser`.
   */
  public static isNoPasswordUser(x: any): x is NoPasswordUser {
    return (
      x !== null &&
      typeof x === "object" &&
      ELASTICACHE_NOPASSWORDUSER_SYMBOL in x
    );
  }

  /**
   * The engine for the user.
   */
  public readonly engine?: UserEngine;
  /**
   * The user's ID.
   *
   * TERRACONSTRUCTS DEVIATION: lowercased at synth — ElastiCache stores `UserId` as a lowercase
   * string server-side (verified against the `CreateUser` API reference: "The ID of the user. This
   * value is stored as a lowercase string."), and emitting the original casing would report a
   * perpetual Terraform diff. Mirrors the identical `dbClusterName`/`clusterIdentifier` lowercasing
   * convention in `../docdb/cluster.ts`.
   *
   * @attribute
   */
  public readonly userId: string;
  /**
   * The user's name.
   *
   * @attribute
   */
  public readonly userName?: string;
  /**
   * The access string that defines the user's permissions.
   */
  public readonly accessString: string;
  /**
   * The user's ARN.
   *
   * @attribute
   */
  public readonly userArn: string;

  // TODO: omitted — upstream's `userStatus` (`CfnUser.attrStatus`, CloudFormation-computed
  // `Status` attribute: 'active' | 'modifying' | 'deleting') has no Terraform-provider equivalent.
  // The `aws_elasticache_user` resource does not expose a computed `status`/`user_status` attribute
  // at all (verified against the full config shape in
  // `node_modules/@cdktn/provider-aws/lib/elasticache-user/index.d.ts`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/no-password-user.ts#L76-L81
  // readonly userStatus: string;

  /**
   * The underlying `aws_elasticache_user` L1.
   */
  public readonly resource: elasticacheUser.ElasticacheUser;

  constructor(scope: Construct, id: string, props: NoPasswordUserProps) {
    super(scope, id, props);

    this.engine = props.engine ?? UserEngine.REDIS;
    this.userId = Token.isUnresolved(props.userId)
      ? props.userId
      : props.userId.toLowerCase();
    // TERRACONSTRUCTS DEVIATION: kept byte-close to upstream — defaults from `props.userId` (the
    // original casing), NOT the lowercased `this.userId` above.
    this.userName = props.userName ?? props.userId;
    this.accessString = props.accessControl.accessString;

    if (
      !SUPPORTED_NO_PASSWORD_ENGINES.some(
        (e) => e.engineType === this.engine!.engineType,
      )
    ) {
      throw new ValidationError(
        `Engine '${this.engine}' does not support no-password authentication. Supported engines: ${SUPPORTED_NO_PASSWORD_ENGINES.join(", ")}.`,
        this,
      );
    }

    this.resource = new elasticacheUser.ElasticacheUser(this, "Resource", {
      engine: this.engine.engineType,
      userId: this.userId,
      userName: this.userName,
      accessString: this.accessString,
      authenticationMode: {
        type: "no-password-required",
      },
      noPasswordRequired: true,
    });

    this.userArn = this.resource.arn;

    Object.defineProperty(this, ELASTICACHE_NOPASSWORDUSER_SYMBOL, {
      value: true,
    });
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseClusterBase.outputs` in `../rds/cluster.ts`) — bare, bound-per-construct `outputs` for
   * use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      userId: this.userId,
      arn: this.userArn,
    };
  }
}
