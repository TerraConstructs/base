// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/iam-user.ts

import { elasticacheUser } from "@cdktn/provider-aws";
import { Token } from "cdktn";
import { Construct } from "constructs";
import { UserEngine } from "./common";
import type { UserBaseProps } from "./user-base";
import { UserBase } from "./user-base";
import { ValidationError } from "../../../errors";
import * as iam from "../../iam";

const ELASTICACHE_IAMUSER_SYMBOL = Symbol.for(
  "@aws-cdk/aws-elasticache.IamUser",
);

/**
 * Properties for defining an ElastiCache user with IAM authentication.
 */
export interface IamUserProps extends UserBaseProps {
  /**
   * The name of the user.
   *
   * @default - Same as userId.
   */
  readonly userName?: string;
}

/**
 * Define an ElastiCache user with IAM authentication.
 *
 * @resource aws_elasticache_user
 */
export class IamUser extends UserBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.elasticache.IamUser";

  /**
   * Return whether the given object is an `IamUser`.
   */
  public static isIamUser(x: any): x is IamUser {
    return (
      x !== null && typeof x === "object" && ELASTICACHE_IAMUSER_SYMBOL in x
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
   * `../rds/subnet-group.ts` and the sibling `userId` lowercasing on `PasswordUser`/`NoPasswordUser`.
   *
   * @attribute
   */
  public readonly userId: string;
  /**
   * The user's name.
   * For IAM authentication userName must be equal to userId.
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

  constructor(scope: Construct, id: string, props: IamUserProps) {
    super(scope, id, props);

    this.engine = props.engine ?? UserEngine.VALKEY;
    this.userId = Token.isUnresolved(props.userId)
      ? props.userId
      : props.userId.toLowerCase();
    // TERRACONSTRUCTS DEVIATION: kept byte-close to upstream — `userName` defaults from
    // `props.userId` in its ORIGINAL casing, NOT the lowercased `this.userId` above. On `IamUser`
    // this matters: a mixed-case `userId` supplied without an explicit lowercase `userName` fails
    // the `userName === userId` equality check below, because `this.userId` has been lowercased
    // while `this.userName` has not — callers must pass an already-lowercase `userId` (or a
    // matching lowercase `userName`). When `userId` is an unresolved Token, no case transform is
    // applied to it, so the default `userName` (also `props.userId`) equals `this.userId` and the
    // check below passes.
    this.userName = props.userName ?? props.userId;
    this.accessString = props.accessControl.accessString;

    if (this.userName !== this.userId) {
      throw new ValidationError(
        `For IAM authentication, userName must be equal to userId. \`userId\` is lowercased to '${this.userId}' (ElastiCache stores UserId as a lowercase string), so supply an already-lowercase \`userId\`, or pass a matching lowercase \`userName\`.`,
        this,
      );
    }

    this.resource = new elasticacheUser.ElasticacheUser(this, "Resource", {
      engine: this.engine.engineType,
      userId: this.userId,
      userName: this.userName,
      accessString: this.accessString,
      authenticationMode: {
        type: "iam",
      },
      noPasswordRequired: false,
    });

    this.userArn = this.resource.arn;

    Object.defineProperty(this, ELASTICACHE_IAMUSER_SYMBOL, { value: true });
  }

  /**
   * Grant connect permissions to the given IAM identity.
   *
   * @param grantee The IAM identity to grant permissions to.
   */
  public grantConnect(grantee: iam.IGrantable): iam.Grant {
    return this.grant(grantee, "elasticache:Connect");
  }

  /**
   * Grant the given identity custom permissions.
   *
   * @param grantee The IAM identity to grant permissions to.
   * @param actions The actions to grant.
   */
  public grant(grantee: iam.IGrantable, ...actions: string[]): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions,
      resourceArns: [this.userArn],
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
