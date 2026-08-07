// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/user-group.ts

import { elasticacheUserGroup } from "@cdktn/provider-aws";
import { Lazy, Token } from "cdktn";
import { Construct } from "constructs";
import { UserEngine } from "./common";
import type { IUser } from "./user-base";
import { ValidationError, UnscopedValidationError } from "../../../errors";
import { ArnFormat } from "../../arn";
import {
  AwsConstructBase,
  AwsConstructProps,
  IAwsConstruct,
} from "../../aws-construct";
import { AwsStack } from "../../aws-stack";

const ELASTICACHE_USERGROUP_SYMBOL = Symbol.for(
  "@aws-cdk/aws-elasticache.UserGroup",
);

/**
 * Properties for defining an ElastiCache UserGroup
 *
 * TERRACONSTRUCTS DEVIATION: extends `AwsConstructProps` (account/region/environmentFromArn),
 * which upstream's `UserGroupProps` does not — matching the base-idiom used throughout this repo
 * for cross-account/-region construct placement.
 */
export interface UserGroupProps extends AwsConstructProps {
  /**
   * Enforces a particular physical user group name.
   * @default <generated>
   */
  readonly userGroupName?: string;
  /**
   * The engine type for the user group
   * Enum options: UserEngine.VALKEY, UserEngine.REDIS
   *
   * @default UserEngine.VALKEY
   */
  readonly engine?: UserEngine;
  /**
   * List of users inside the user group
   *
   * @default - no users
   */
  readonly users?: IUser[];
}

/**
 * Represents an ElastiCache UserGroup
 *
 * TODO: omitted — upstream also extends `aws_elasticache.IUserGroupRef`, a CloudFormation
 * cross-stack "Reference" marker interface generated from the CFN resource spec.
 * TerraConstructs has no equivalent generated-reference layer (identical omission pattern to the
 * rds/docdb `*Ref` interfaces) —
 * https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/user-group.ts#L41
 */
export interface IUserGroup extends IAwsConstruct {
  /**
   * The name of the user group
   *
   * @attribute
   */
  readonly userGroupName: string;
  /**
   * The engine type for the user group
   */
  readonly engine?: UserEngine;
  /**
   * List of users in the user group
   */
  readonly users?: IUser[];
  /**
   * The ARN of the user group
   *
   * @attribute
   */
  readonly userGroupArn: string;
  /**
   * Add a user to this user group
   *
   * @param user The user to add
   */
  addUser(user: IUser): void;
}

/**
 * Base class for UserGroup constructs
 */
export abstract class UserGroupBase
  extends AwsConstructBase
  implements IUserGroup
{
  /**
   * The name of the user group
   *
   * @attribute
   */
  public abstract readonly userGroupName: string;
  /**
   * The engine type for the user group
   */
  public abstract readonly engine?: UserEngine;
  /**
   * List of users in the user group
   */
  public abstract readonly users?: IUser[];
  /**
   * The ARN of the user group
   * @attribute
   */
  public abstract readonly userGroupArn: string;
  /**
   * Add a user to this user group
   *
   * @param _user The user to add
   */
  public addUser(_user: IUser): void {
    throw new UnscopedValidationError(
      "Cannot add users to an imported UserGroup. Only UserGroups created in this stack can be modified.",
    );
  }
}

/**
 * Attributes that can be specified when importing a UserGroup
 */
export interface UserGroupAttributes {
  /**
   * The name of the user group
   *
   * One of `userGroupName` or `userGroupArn` is required.
   *
   * @default - derived from userGroupArn
   */
  readonly userGroupName?: string;
  /**
   * The engine type for the user group
   *
   * @default - engine type is unknown
   */
  readonly engine?: UserEngine;
  /**
   * List of users in the user group
   *
   * @default - users are unknown
   */
  readonly users?: IUser[];
  /**
   * The ARN of the user group
   *
   * One of `userGroupName` or `userGroupArn` is required.
   *
   * @default - derived from userGroupName
   */
  readonly userGroupArn?: string;
}

/**
 * An ElastiCache UserGroup
 *
 * @resource aws_elasticache_user_group
 */
export class UserGroup extends UserGroupBase {
  /**
   * Uniquely identifies this class
   */
  public static readonly PROPERTY_INJECTION_ID: string =
    "terraconstructs.aws.storage.elasticache.UserGroup";

  /**
   * Return whether the given object is a `UserGroup`
   */
  public static isUserGroup(x: any): x is UserGroup {
    return (
      x !== null && typeof x === "object" && ELASTICACHE_USERGROUP_SYMBOL in x
    );
  }

  /**
   * Import an existing user group by name
   *
   * @param scope The parent creating construct (usually `this`)
   * @param id The construct's name
   * @param userGroupName The name of the existing user group
   */
  public static fromUserGroupName(
    scope: Construct,
    id: string,
    userGroupName: string,
  ): IUserGroup {
    return UserGroup.fromUserGroupAttributes(scope, id, { userGroupName });
  }

  /**
   * Import an existing user group by ARN
   *
   * @param scope The parent creating construct (usually `this`)
   * @param id The construct's name
   * @param userGroupArn The ARN of the existing user group
   */
  public static fromUserGroupArn(
    scope: Construct,
    id: string,
    userGroupArn: string,
  ): IUserGroup {
    return UserGroup.fromUserGroupAttributes(scope, id, { userGroupArn });
  }

  /**
   * Import an existing user group using attributes
   *
   * @param scope The parent creating construct (usually `this`)
   * @param id The construct's name
   * @param attrs A `UserGroupAttributes` object
   */
  public static fromUserGroupAttributes(
    scope: Construct,
    id: string,
    attrs: UserGroupAttributes,
  ): IUserGroup {
    let userGroupName: string;
    let userGroupArn: string;
    const stack = AwsStack.ofAwsConstruct(scope);

    if (attrs.userGroupArn && attrs.userGroupName) {
      throw new ValidationError(
        "Only one of userGroupArn or userGroupName can be provided.",
        scope,
      );
    }

    if (attrs.userGroupArn) {
      userGroupArn = attrs.userGroupArn;
      const extractedUserGroupName = stack.splitArn(
        attrs.userGroupArn,
        ArnFormat.SLASH_RESOURCE_NAME,
      ).resourceName;
      if (!extractedUserGroupName) {
        throw new ValidationError(
          "Unable to extract user group name from ARN.",
          scope,
        );
      }
      userGroupName = extractedUserGroupName;
    } else if (attrs.userGroupName) {
      userGroupName = attrs.userGroupName;
      userGroupArn = stack.formatArn({
        service: "elasticache",
        resource: "usergroup",
        resourceName: attrs.userGroupName,
      });
    } else {
      throw new ValidationError(
        "One of userGroupName or userGroupArn is required.",
        scope,
      );
    }

    class Import extends UserGroupBase {
      public readonly engine?: UserEngine;
      public readonly userGroupName: string;
      public readonly userGroupArn: string;

      public get users(): IUser[] | undefined {
        return attrs.users ? [...attrs.users] : undefined;
      }

      public get outputs(): Record<string, any> {
        return { userGroupName: this.userGroupName, arn: this.userGroupArn };
      }

      constructor(_userGroupArn: string, _userGroupName: string) {
        super(scope, id);
        this.userGroupArn = _userGroupArn;
        this.userGroupName = _userGroupName;
        this.engine = attrs.engine;
      }
    }

    return new Import(userGroupArn, userGroupName);
  }

  public readonly engine?: UserEngine;
  /**
   * The name of the user group
   *
   * TERRACONSTRUCTS DEVIATION: lowercased at synth — ElastiCache stores `UserGroupId` as a
   * lowercase string server-side (verified against the `CreateUserGroup` API reference: "The ID of
   * the user group. This value is stored as a lowercase string."), and emitting the original
   * casing would report a perpetual Terraform diff. Mirrors the identical `dbClusterName`
   * lowercasing convention in `../docdb/cluster.ts`.
   */
  public readonly userGroupName: string;
  private readonly _users: IUser[];
  /**
   * The ARN of the user group
   *
   * @attribute
   */
  public readonly userGroupArn: string;

  // TODO: omitted — upstream's `userGroupStatus` (`CfnUserGroup.attrStatus`,
  // CloudFormation-computed `Status` attribute: 'creating' | 'active' | 'modifying' | 'deleting')
  // has no Terraform-provider equivalent. The `aws_elasticache_user_group` resource does not
  // expose a computed `status`/`user_group_status` attribute at all (verified against the full
  // config shape in `node_modules/@cdktn/provider-aws/lib/elasticache-user-group/index.d.ts`) —
  // https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-elasticache-alpha/lib/user-group.ts#L242-L248
  // readonly userGroupStatus: string;

  /**
   * The underlying `aws_elasticache_user_group` L1.
   */
  public readonly resource: elasticacheUserGroup.ElasticacheUserGroup;

  constructor(scope: Construct, id: string, props: UserGroupProps = {}) {
    super(scope, id, props);

    this.engine = props.engine ?? UserEngine.VALKEY;
    this.userGroupName = Token.isUnresolved(props.userGroupName)
      ? (props.userGroupName as string)
      : (
          props.userGroupName ??
          // ElastiCache allows only up to 40 characters for a user group id.
          this.stack.uniqueResourceName(this, { maxLength: 40 })
        ).toLowerCase();

    // TERRACONSTRUCTS DEVIATION: upstream defers `userIds` to synth time via a lazy, mutable
    // `IArrayBox` (`aws-cdk-lib/core/lib/helpers-internal`, CDK-internal and not ported here) so
    // that users added later via `addUser()` are still reflected when the underlying
    // `CfnUserGroup.userIds` token resolves. `Lazy.listValue()` (public cdktn API) gives the same
    // synth-time-deferred behavior: `_users` is captured by reference in the closure below, so
    // mutations from `addUser()` before synth are picked up identically.
    this._users = [...(props.users ?? [])];

    this.resource = new elasticacheUserGroup.ElasticacheUserGroup(
      this,
      "Resource",
      {
        engine: this.engine.engineType,
        userGroupId: this.userGroupName,
        userIds: Lazy.listValue({
          produce: () => {
            this.validateUsers();
            return this._users.map((user) => user.userId);
          },
        }),
      },
    );

    if (props.users) {
      props.users.forEach((user) => this.addUserDependency(user));
    }

    this.userGroupArn = this.resource.arn;

    Object.defineProperty(this, ELASTICACHE_USERGROUP_SYMBOL, {
      value: true,
    });
  }

  /**
   * Add a CloudFormation dependency on the user resource to ensure proper creation order.
   */
  private addUserDependency(user: IUser): void {
    this.resource.node.addDependency(user);
  }

  /**
   * Array of users in the user group
   *
   * Do not push directly to this array.
   * Use addUser() instead to ensure proper validation and dependency management.
   */
  public get users(): IUser[] | undefined {
    return [...this._users];
  }

  /**
   * Validates users in the user group for duplicate usernames and Redis-specific requirements.
   */
  private validateUsers(): void {
    const users = this._users;
    const userNames = users.map((user) => user.userName);
    const duplicates = userNames.filter(
      (name, index) => userNames.indexOf(name) !== index,
    );
    if (duplicates.length > 0) {
      throw new ValidationError(
        "User group cannot have users with the same user name.",
        this,
      );
    }

    if (this.engine?.engineType === "redis") {
      users.forEach((user) => {
        if (user.engine?.engineType !== "redis") {
          throw new ValidationError(
            "Redis user group can only contain Redis users.",
            this,
          );
        }
      });
      const hasDefaultUser = users.some((user) => user.userName === "default");
      if (!hasDefaultUser) {
        throw new ValidationError(
          'Redis user groups need to contain a user with the user name "default".',
          this,
        );
      }
    }
  }

  /**
   * Add a user to this user group
   *
   * @param user The user to add to the group
   */
  public addUser(user: IUser): void {
    this._users.push(user);
    this.addUserDependency(user);
  }

  /**
   * TERRACONSTRUCTS DEVIATION: not present upstream. Repo-wide construct-output convention (see
   * `DatabaseClusterBase.outputs` in `../rds/cluster.ts`) — bare, bound-per-construct `outputs`
   * for use with `registerOutputs`/the Grid.
   */
  public get outputs(): Record<string, any> {
    return {
      userGroupName: this.userGroupName,
      arn: this.userGroupArn,
    };
  }
}
