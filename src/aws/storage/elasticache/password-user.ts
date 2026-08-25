// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/password-user.ts

import { elasticacheUser } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import { UserEngine } from "./common";
import type { UserBaseProps } from "./user-base";
import { UserBase } from "./user-base";
import { ValidationError } from "../../../errors";

const ELASTICACHE_PASSWORDUSER_SYMBOL = Symbol.for(
  "@aws-cdk/aws-elasticache.PasswordUser",
);

// TERRACONSTRUCTS DEVIATION: upstream types password fields as `core.SecretValue` (a
// CloudFormation dynamic-reference wrapper), which is not ported in this repo (see the
// TERRACONSTRUCTS DEVIATION note on `SecretProps.secretObjectValue` in `../../encryption/secret.ts`,
// and the identical deviation on `../rds/props.ts`). `passwords` below is a plain `string[]`
// instead (each entry may itself be an unresolved Token).

/**
 * Properties for defining an ElastiCache user with password authentication.
 */
export interface PasswordUserProps extends UserBaseProps {
  /**
   * The name of the user.
   *
   * @default - Same as userId.
   */
  readonly userName?: string;
  /**
   * The passwords for the user.
   * Password authentication requires using 1-2 passwords.
   */
  readonly passwords: string[];
}

/**
 * Define an ElastiCache user with password authentication.
 *
 * @resource aws_elasticache_user
 */
export class PasswordUser extends UserBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.elasticache.PasswordUser";

  /**
   * Return whether the given object is a `PasswordUser`.
   */
  public static isPasswordUser(x: any): x is PasswordUser {
    return (
      x !== null &&
      typeof x === "object" &&
      ELASTICACHE_PASSWORDUSER_SYMBOL in x
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
   * perpetual Terraform diff. Mirrors the identical `subnetGroupName` lowercasing convention in
   * `../rds/subnet-group.ts` and the sibling `userId` lowercasing on `IamUser`/`NoPasswordUser`.
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

  // TODO: omitted — upstream also exposes `userStatus` (`'active' | 'modifying' | 'deleting'`),
  // read off the generated CFN L1's `attrStatus`. See the identical omission and permalink on
  // `NoPasswordUser` in `./no-password-user.ts` — the `aws_elasticache_user` Terraform resource has
  // no equivalent attribute to honestly populate it from.

  /**
   * The underlying `aws_elasticache_user` L1.
   */
  public readonly resource: elasticacheUser.ElasticacheUser;

  constructor(scope: Construct, id: string, props: PasswordUserProps) {
    super(scope, id, props);

    this.engine = props.engine ?? UserEngine.VALKEY;
    this.userId = Token.isUnresolved(props.userId)
      ? props.userId
      : props.userId.toLowerCase();
    // TERRACONSTRUCTS DEVIATION: kept byte-close to upstream — defaults from `props.userId` (the
    // original casing), NOT the lowercased `this.userId` above.
    this.userName = props.userName ?? props.userId;
    this.accessString = props.accessControl.accessString;

    if (props.passwords.length < 1 || props.passwords.length > 2) {
      throw new ValidationError(
        "Password authentication requires 1-2 passwords.",
        this,
      );
    }

    this.resource = new elasticacheUser.ElasticacheUser(this, "Resource", {
      engine: this.engine.engineType,
      userId: this.userId,
      userName: this.userName,
      accessString: this.accessString,
      authenticationMode: {
        type: "password",
        passwords: props.passwords,
      },
      noPasswordRequired: false,
    });

    this.userArn = this.resource.arn;

    Object.defineProperty(this, ELASTICACHE_PASSWORDUSER_SYMBOL, {
      value: true,
    });
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream — repo-wide construct-output convention (see
   * `DatabaseInstanceBase.outputs` in `../docdb/instance.ts`) for use with `registerOutputs`/the
   * Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      userId: this.userId,
      arn: this.userArn,
      userName: this.userName,
    };
  }
}
