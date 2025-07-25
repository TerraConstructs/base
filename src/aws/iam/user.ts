// https://github.com/aws/aws-cdk/blob/f9f3681be9fc6a0c998cd26119053c5832ef9806/packages/aws-cdk-lib/aws-iam/lib/user.ts

import {
  iamUser,
  iamUserPolicyAttachment,
  iamUserGroupMembership,
  iamUserLoginProfile,
} from "@cdktf/provider-aws";
import { Construct } from "constructs";
import * as iam from ".";
import { Arn, ArnFormat } from "../arn";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import { AwsStack } from "../aws-stack";
import { IGroup } from "./group";
import { IManagedPolicy } from "./managed-policy";
import { Policy } from "./policy";
import { PolicyStatement } from "./policy-statement";
import {
  AddToPrincipalPolicyResult,
  ArnPrincipal,
  IPrincipal,
  PrincipalPolicyFragment,
} from "./principals";
import { AttachedPolicies } from "./private/util";

/**
 * Outputs which may be registered for output via the Grid.
 */
export interface UserOutputs {
  readonly arn: string;
  readonly name: string;
}

/**
 * Represents an IAM user.
 */
export interface IUser extends iam.IIdentity {
  /**
   * strongly typed roleOutputs
   *
   * @attribute
   */
  readonly userOutputs: UserOutputs;
  /**
   * The user's name.
   *
   * @attribute
   */
  readonly userName: string;

  /**
   * The user's ARN.
   *
   * @attribute
   */
  readonly userArn: string;

  /**
   * Adds this user to a group.
   */
  addToGroup(group: IGroup): void;
}

/**
 * Properties for defining an IAM user.
 */
export interface UserProps extends AwsConstructProps {
  /**
   * Groups to add this user to.
   *
   * @default - No groups.
   */
  readonly groups?: IGroup[];

  /**
   * Managed policies to attach to this user.
   *
   * @default - No managed policies.
   */
  readonly managedPolicies?: IManagedPolicy[];

  /**
   * The path for the user name.
   *
   * @default "/"
   */
  readonly path?: string;

  /**
   * The managed policy to use as the permissions boundary.
   *
   * @default - No permissions boundary.
   */
  readonly permissionsBoundary?: IManagedPolicy;

  /**
   * A name for the IAM user.
   *
   * @default - Generated by CloudFormation.
   */
  readonly userName?: string;

  // add Support for pgpKey for UserProfile

  /**
   * Whether to create a login profile for the User
   *
   * @default - No console access.
   */
  readonly createLoginProfile?: boolean;

  /**
   * The password for the user.
   *
   * @default - 20
   */
  readonly passwordLength?: number;

  /**
   * If true, the user must reset the password upon first sign–in.
   *
   * @default false
   */
  readonly passwordResetRequired?: boolean;
}

/**
 * Attributes for importing an existing IAM user.
 */
export interface UserAttributes {
  /**
   * The ARN of the user.
   *
   * Format: arn:<partition>:iam::<account-id>:user/<user-name-with-path>
   */
  readonly userArn: string;
}

/**
 * Defines a new IAM user.
 */
export class User extends AwsConstructBase implements IUser {
  // Static import methods

  /**
   * Import an existing user given a username.
   */
  public static fromUserName(
    scope: Construct,
    id: string,
    userName: string,
  ): IUser {
    const userArn = AwsStack.ofAwsConstruct(scope).formatArn({
      service: "iam",
      region: "",
      resource: "user",
      resourceName: userName,
    });
    return User.fromUserAttributes(scope, id, { userArn });
  }

  /**
   * Import an existing user given a user ARN.
   */
  public static fromUserArn(
    scope: Construct,
    id: string,
    userArn: string,
  ): IUser {
    return User.fromUserAttributes(scope, id, { userArn });
  }

  /**
   * Import an existing user given user attributes.
   */
  public static fromUserAttributes(
    scope: Construct,
    id: string,
    attrs: UserAttributes,
  ): IUser {
    class Import extends AwsConstructBase implements IUser {
      public get userOutputs(): UserOutputs {
        return {
          arn: this.userArn,
          name: this.userName,
        };
      }
      public get outputs(): Record<string, any> {
        return this.userOutputs;
      }
      public readonly grantPrincipal: IPrincipal = this;
      public readonly principalAccount = AwsStack.ofAwsConstruct(
        scope,
      ).splitArn(attrs.userArn, ArnFormat.SLASH_RESOURCE_NAME).account;
      // Extract the user name from the ARN. For a user ARN, the resource part includes the path.
      public readonly userName: string = Arn.extractResourceName(
        attrs.userArn,
        "user",
      )
        .split("/")
        .pop()!;
      public readonly userArn: string = attrs.userArn;
      public readonly assumeRoleAction: string = "sts:AssumeRole";
      public readonly policyFragment: PrincipalPolicyFragment =
        new ArnPrincipal(attrs.userArn).policyFragment;
      private readonly attachedPolicies = new AttachedPolicies();
      private defaultPolicy?: Policy;
      private groupId = 0;

      public addToPolicy(statement: PolicyStatement): boolean {
        return this.addToPrincipalPolicy(statement).statementAdded;
      }

      public addToPrincipalPolicy(
        statement: PolicyStatement,
      ): AddToPrincipalPolicyResult {
        if (!this.defaultPolicy) {
          this.defaultPolicy = new Policy(this, "Policy");
          this.defaultPolicy.attachToUser(this);
        }
        this.defaultPolicy.addStatements(statement);
        return { statementAdded: true, policyDependable: this.defaultPolicy };
      }

      public addToGroup(group: IGroup): void {
        new iamUserGroupMembership.IamUserGroupMembership(
          AwsStack.ofAwsConstruct(group),
          `${this.userName}Group${this.groupId}`,
          {
            groups: [group.groupName],
            user: this.userName,
            // groups: group.groupName,
            // users: [this.userName],
          },
        );
        this.groupId += 1;
      }

      public attachInlinePolicy(policy: Policy): void {
        this.attachedPolicies.attach(policy);
        policy.attachToUser(this);
      }

      public addManagedPolicy(_policy: IManagedPolicy): void {
        throw new Error("Cannot add managed policy to imported User");
      }
    }
    return new Import(scope, id);
  }

  public readonly grantPrincipal: IPrincipal = this;
  public readonly principalAccount: string | undefined = this.env.account;
  public readonly assumeRoleAction: string = "sts:AssumeRole";
  public get userOutputs(): UserOutputs {
    return {
      arn: this.userArn,
      name: this.userName,
    };
  }
  public get outputs(): Record<string, any> {
    return this.userOutputs;
  }

  /**
   * The IAM user's name.
   * @attribute
   */
  public readonly userName: string;

  /**
   * The IAM user's ARN.
   * @attribute
   */
  public readonly userArn: string;

  /**
   * The permissions boundary assigned to this user.
   */
  public readonly permissionsBoundary?: IManagedPolicy;

  public readonly policyFragment: PrincipalPolicyFragment;

  private readonly groups: string[] = [];
  private readonly managedPolicies: IManagedPolicy[] = [];
  private readonly attachedPolicies = new AttachedPolicies();
  private defaultPolicy?: Policy;
  private groupId = 0;

  constructor(scope: Construct, id: string, props: UserProps = {}) {
    super(scope, id, props);
    const userName =
      props.userName ||
      this.stack.uniqueResourceName(this, {
        prefix: this.gridUUID,
      });

    if (props.managedPolicies) {
      this.managedPolicies.push(...props.managedPolicies);
    }
    this.permissionsBoundary = props.permissionsBoundary;

    const userResource = new iamUser.IamUser(this, "Resource", {
      name: userName,
      path: props.path,
      permissionsBoundary: this.permissionsBoundary
        ? this.permissionsBoundary.managedPolicyArn
        : undefined,
      forceDestroy: false,
      // loginProfile: this.parseLoginProfile(props),
      // tags: undefinedIfEmpty(() => this.tags),
    });

    this.userName = userResource.name;
    this.userArn = userResource.arn;
    // this.getResourceArnAttribute(userResource.arn, {
    //   region: "",
    //   service: "iam",
    //   resource: "user",
    //   // Remove a leading slash from the path if present.
    //   resourceName: `${props.path ? props.path.replace(/^\//, "") : ""}${this.physicalName}`,
    // });

    if (props.createLoginProfile) {
      new iamUserLoginProfile.IamUserLoginProfile(
        this,
        `${userName}-LoginProfile`,
        {
          user: this.userName,
          passwordLength: props.passwordLength,
          passwordResetRequired: props.passwordResetRequired,
        },
      );
    }

    this.policyFragment = new ArnPrincipal(this.userArn).policyFragment;

    if (props.groups) {
      props.groups.forEach((g) => this.addToGroup(g));
    }
  }

  /**
   * Adds this user to the specified group.
   */
  public addToGroup(group: IGroup): void {
    // `${this.userName}-Group${this.groupId}`,
    const id = `Group${this.groupId}`;
    new iamUserGroupMembership.IamUserGroupMembership(this, id, {
      groups: [group.groupName],
      user: this.userName,
      // groupName: group.groupName,
      // users: [this.userName],
    });
    this.groupId++;
    this.groups.push(group.groupName);
  }

  /**
   * Attaches a managed policy to the user.
   */
  public addManagedPolicy(policy: IManagedPolicy): void {
    if (this.managedPolicies.find((mp) => mp === policy)) {
      return;
    }
    this.managedPolicies.push(policy);
  }

  /**
   * Attaches an inline policy to the user.
   */
  public attachInlinePolicy(policy: Policy): void {
    this.attachedPolicies.attach(policy);
    policy.attachToUser(this);
  }

  /**
   * Adds an IAM statement to the default inline policy.
   *
   * If no default policy exists yet, one is created.
   */
  public addToPrincipalPolicy(
    statement: PolicyStatement,
  ): AddToPrincipalPolicyResult {
    if (!this.defaultPolicy) {
      this.defaultPolicy = new Policy(this, "DefaultPolicy");
      this.defaultPolicy.attachToUser(this);
    }
    this.defaultPolicy.addStatements(statement);
    return { statementAdded: true, policyDependable: this.defaultPolicy };
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  /**
   * Adds resource to the terraform JSON output.
   *
   * called by TerraformStack.prepareStack()
   */
  public toTerraform(): any {
    /**
     * A preparing resolve run might add new resources to the stack
     *
     * should not add resources if `force` is `false` and the policy
     * document is empty or not attached
     * ref: https://github.com/aws/aws-cdk/blob/v2.143.0/packages/aws-cdk-lib/aws-iam/lib/policy.ts#L149
     */
    if (this.managedPolicies.length === 0) {
      return {};
    }

    // add iamUserPolicyAttachment resource for each referenced ManagedPolicy
    // NOTE: The TerraformDependendableAspect will propgate construct dependencies on this policy to its IamRolePolicy resources
    // not sure if time.sleep is still necessary?
    // https://github.com/pulumi/pulumi-aws/issues/2260#issuecomment-1977606509
    // else need: https://github.com/hashicorp/terraform-provider-aws/issues/29828#issuecomment-1693307500
    for (let i = 0; i < this.managedPolicies.length; i++) {
      const id = `ResourceManagedPolicy${i}`; // unique id for each managed policy
      // ignore if already generated
      if (this.node.tryFindChild(id)) continue;

      new iamUserPolicyAttachment.IamUserPolicyAttachment(this, id, {
        user: this.userName,
        policyArn: this.managedPolicies[i].managedPolicyArn,
      });
    }
    return {};
  }
}
