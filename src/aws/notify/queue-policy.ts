import { sqsQueuePolicy } from "@cdktf/provider-aws";
import { Construct } from "constructs";
import { AwsBeaconBase, AwsBeaconProps } from "../beacon";
import { IQueue } from "./";
import { PolicyDocument } from "../iam";

/**
 * Properties to associate SQS queues with a policy
 */
export interface QueuePolicyProps extends AwsBeaconProps {
  /**
   * The set of queues this policy applies to.
   */
  readonly queue: IQueue;
}

/**
 * The policy for an SQS Queue
 *
 * Policies define the operations that are allowed on this resource.
 *
 * You almost never need to define this construct directly.
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * Prefer to use `addToResourcePolicy()` instead.
 */
export class QueuePolicy extends AwsBeaconBase {
  /**
   * The IAM policy document for this policy.
   */
  public readonly document: PolicyDocument;
  public get outputs(): Record<string, any> {
    return this.document.outputs;
  }
  constructor(scope: Construct, id: string, props: QueuePolicyProps) {
    super(scope, id, props);
    this.document = new PolicyDocument(this, "Policy");

    new sqsQueuePolicy.SqsQueuePolicy(this, "Resource", {
      policy: this.document.json,
      queueUrl: props.queue.queueUrl,
    });
  }
}
