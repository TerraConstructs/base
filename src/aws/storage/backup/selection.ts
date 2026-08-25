// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/aws-cdk-lib/aws-backup/lib/selection.ts

import { backupSelection } from "@cdktn/provider-aws";
import { Aspects, Lazy } from "cdktn";
import { Construct } from "constructs";
import { BackupableResourcesCollector } from "./backupable-resources-collector";
import type { IBackupPlan } from "./plan";
import type { BackupResource } from "./resource";
import { TagOperation } from "./resource";
import { AwsConstructBase, AwsConstructProps } from "../../aws-construct";
import * as iam from "../../iam";

/**
 * Options for a BackupSelection
 */
export interface BackupSelectionOptions {
  /**
   * The resources to backup.
   * Use the helper static methods defined on `BackupResource`.
   */
  readonly resources: BackupResource[];

  /**
   * The name for this selection
   *
   * @default - a CDK generated name
   */
  readonly backupSelectionName?: string;

  /**
   * The role that AWS Backup uses to authenticate when backuping or restoring
   * the resources. The `AWSBackupServiceRolePolicyForBackup` managed policy
   * will be attached to this role unless `disableDefaultBackupPolicy`
   * is set to `true`.
   *
   * @default - a new role will be created
   */
  readonly role?: iam.IRole;

  /**
   * Whether to disable automatically assigning default backup permissions to the role
   * that AWS Backup uses.
   * If `false`, the `AWSBackupServiceRolePolicyForBackup` managed policy will be
   * attached to the role.
   *
   * @default false
   */
  readonly disableDefaultBackupPolicy?: boolean;

  /**
   * Whether to automatically give restores permissions to the role that AWS
   * Backup uses. If `true`, the `AWSBackupServiceRolePolicyForRestores` managed
   * policy will be attached to the role.
   *
   * @default false
   */
  readonly allowRestores?: boolean;
}

/**
 * Properties for a BackupSelection
 */
export interface BackupSelectionProps
  extends BackupSelectionOptions,
    AwsConstructProps {
  /**
   * The backup plan for this selection
   */
  readonly backupPlan: IBackupPlan;
}

/**
 * A backup selection
 */
export class BackupSelection
  extends AwsConstructBase
  implements iam.IGrantable
{
  /**
   * The identifier of the backup plan.
   *
   * @attribute
   */
  public readonly backupPlanId: string;

  /**
   * The identifier of the backup selection.
   *
   * @attribute
   */
  public readonly selectionId: string;

  /**
   * The principal to grant permissions to
   */
  public readonly grantPrincipal: iam.IPrincipal;

  public get outputs(): Record<string, any> {
    return {
      backupPlanId: this.backupPlanId,
      selectionId: this.selectionId,
    };
  }

  // TERRACONSTRUCTS DEVIATION (same block-typed-L1-arg-accumulated-after-construction footgun as
  // `BackupPlan.addRule()` in `./plan.ts` -- see the note there): `selection_tag` on
  // `aws_backup_selection` is block-typed (`BackupSelectionSelectionTag[] | cdktn.IResolvable`),
  // and tag conditions on constructs reached via `BackupResource.fromConstruct()` are only
  // resolved by the `BackupableResourcesCollector` Aspect during synth, well after this
  // constructor returns. `selectionTag` is therefore fed a `Lazy.anyValue` that maps this
  // accumulator through the L1's own `backupSelectionSelectionTagToTerraform` renderer, mirroring
  // `../table.ts`'s `addGlobalSecondaryIndex()` pattern.
  private readonly tags =
    new Array<backupSelection.BackupSelectionSelectionTag>();

  // Plain string list -- `resources` on `aws_backup_selection` is NOT block-typed, so a
  // `Lazy.listValue` combining this accumulator with the Aspect-collected resources below
  // resolves without the ComplexObject/internalValue footgun (see `TagCondition` note above).
  private readonly resourceArns = new Array<string>();
  private readonly backupableResourcesCollector =
    new BackupableResourcesCollector();

  constructor(scope: Construct, id: string, props: BackupSelectionProps) {
    super(scope, id, props);

    const role =
      props.role ||
      new iam.Role(this, "Role", {
        assumedBy: new iam.ServicePrincipal("backup.amazonaws.com"),
      });
    if (!props.disableDefaultBackupPolicy) {
      role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          this,
          "BackupPolicy",
          "service-role/AWSBackupServiceRolePolicyForBackup",
        ),
      );
    }
    if (props.allowRestores) {
      role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          this,
          "RestoresPolicy",
          "service-role/AWSBackupServiceRolePolicyForRestores",
        ),
      );
    }
    this.grantPrincipal = role;

    const selection = new backupSelection.BackupSelection(this, "Resource", {
      planId: props.backupPlan.backupPlanId,
      name: props.backupSelectionName || this.node.id,
      iamRoleArn: role.roleArn,
      resources: Lazy.listValue(
        {
          produce: () => [
            ...this.resourceArns,
            ...this.backupableResourcesCollector.resources,
          ],
        },
        { omitEmpty: true },
      ),
      selectionTag: Lazy.anyValue(
        {
          produce: () =>
            this.tags.map((tag) =>
              backupSelection.backupSelectionSelectionTagToTerraform(tag),
            ),
        },
        { omitEmptyArray: true },
      ),
    });

    this.backupPlanId = selection.planId;
    this.selectionId = selection.id;

    for (const resource of props.resources) {
      this.addResource(resource);
    }
  }

  private addResource(resource: BackupResource) {
    if (resource.tagCondition) {
      this.tags.push({
        key: resource.tagCondition.key,
        type: resource.tagCondition.operation || TagOperation.STRING_EQUALS,
        value: resource.tagCondition.value,
      });
    }

    if (resource.resource) {
      this.resourceArns.push(resource.resource);
    }

    if (resource.construct) {
      // Cannot push `this.backupableResourcesCollector.resources` to `this.resourceArns` here
      // because it has not been evaluated yet (the Aspect only runs during synth). Concatenated
      // to `this.resourceArns` in the `Lazy.listValue` producer above instead.
      // TERRACONSTRUCTS DEVIATION: upstream passes `{ priority: mutatingAspectPrio32333(...) }`;
      // cdktn's `Aspects.add()` takes no priority/options argument, so there is no analog to port.
      Aspects.of(resource.construct).add(this.backupableResourcesCollector);
    }
  }
}
