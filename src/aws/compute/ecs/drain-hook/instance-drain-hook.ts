// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/drain-hook/instance-drain-hook.ts

import { Construct } from "constructs";
import { Duration } from "../../../../duration";
import { IKey } from "../../../encryption";
import * as iam from "../../../iam";
import * as sns from "../../../notify";
import * as autoscaling from "../../auto-scaling";
import { Code } from "../../code";
import { LambdaFunction } from "../../function";
import { IFunction } from "../../function-base";
import { Runtime } from "../../runtime";
import { ICluster } from "../cluster";

// Reference for the source in this package:
//
// https://github.com/aws-samples/ecs-refarch-cloudformation/blob/master/infrastructure/lifecyclehook.yaml

// TERRACONSTRUCTS DEVIATION: upstream loads the drain-hook Lambda handler
// from `<aws-cdk-lib>/custom-resource-handlers/dist/aws-ecs/lambda-source/index.py`
// (a build asset shipped alongside the aws-cdk-lib package) via
// `fs.readFileSync(path.join(__dirname, ...))`. That asset pipeline is not
// part of this package, so the (unmodified) handler source is inlined here
// instead. Behavior is identical to upstream.
const DRAIN_HOOK_LAMBDA_SOURCE = `
import boto3, json, os, time

ecs = boto3.client('ecs')
autoscaling = boto3.client('autoscaling')


def lambda_handler(event, context):
  print(json.dumps(dict(event, ResponseURL='...')))
  cluster = os.environ['CLUSTER']
  snsTopicArn = event['Records'][0]['Sns']['TopicArn']
  lifecycle_event = json.loads(event['Records'][0]['Sns']['Message'])
  instance_id = lifecycle_event.get('EC2InstanceId')
  if not instance_id:
    print(f"Got event without EC2InstanceId: { json.dumps(dict(event, ResponseURL='...')) }")
    return

  instance_arn = container_instance_arn(cluster, instance_id)
  print('Instance %s has container instance ARN %s' % (lifecycle_event['EC2InstanceId'], instance_arn))

  if not instance_arn:
    return

  task_arns = container_instance_task_arns(cluster, instance_arn)

  if task_arns:
    print('Instance ARN %s has task ARNs %s' % (instance_arn, ', '.join(task_arns)))

  while has_tasks(cluster, instance_arn, task_arns):
    time.sleep(10)

  try:
    print('Terminating instance %s' % instance_id)
    autoscaling.complete_lifecycle_action(
        LifecycleActionResult='CONTINUE',
        **pick(lifecycle_event, 'LifecycleHookName', 'LifecycleActionToken', 'AutoScalingGroupName'))
  except Exception as e:
    # Lifecycle action may have already completed.
    print(str(e))


def container_instance_arn(cluster, instance_id):
  """Turn an instance ID into a container instance ARN."""
  arns = ecs.list_container_instances(cluster=cluster, filter='ec2InstanceId==' + instance_id)['containerInstanceArns']
  if not arns:
    return None
  return arns[0]

def container_instance_task_arns(cluster, instance_arn):
  """Fetch tasks for a container instance ARN."""
  arns = ecs.list_tasks(cluster=cluster, containerInstance=instance_arn)['taskArns']
  return arns

def has_tasks(cluster, instance_arn, task_arns):
  """Return True if the instance is running tasks for the given cluster."""
  instances = ecs.describe_container_instances(cluster=cluster, containerInstances=[instance_arn])['containerInstances']
  if not instances:
    return False
  instance = instances[0]

  if instance['status'] == 'ACTIVE':
    # Start draining, then try again later
    set_container_instance_to_draining(cluster, instance_arn)
    return True

  task_count = None

  if task_arns:
    # Fetch details for tasks running on the container instance
    tasks = ecs.describe_tasks(cluster=cluster, tasks=task_arns)['tasks']
    if tasks:
      # Consider any non-stopped tasks as running
      task_count = sum(task['lastStatus'] != 'STOPPED' for task in tasks) + instance['pendingTasksCount']

  if not task_count:
    # Fallback to instance task counts if detailed task information is unavailable
    task_count = instance['runningTasksCount'] + instance['pendingTasksCount']

  print('Instance %s has %s tasks' % (instance_arn, task_count))

  return task_count > 0

def set_container_instance_to_draining(cluster, instance_arn):
  ecs.update_container_instances_state(
      cluster=cluster,
      containerInstances=[instance_arn], status='DRAINING')


def pick(dct, *keys):
  """Pick a subset of a dict."""
  return {k: v for k, v in dct.items() if k in keys}
`;

/**
 * Use a Lambda Function as a hook target
 *
 * Internally creates a Topic to make the connection.
 *
 * TERRACONSTRUCTS DEVIATION: upstream `InstanceDrainHook` wires the ASG
 * lifecycle hook to the Lambda via `aws-autoscaling-hooktargets.FunctionHook`
 * (from a separate, unported CDK module). That adapter is small (Topic +
 * IAM role + kms grant + Lambda subscription), so it is reimplemented here,
 * locally, against this package's `autoscaling.ILifecycleHookTarget`
 * contract. Behavior mirrors the upstream `FunctionHook`/`TopicHook`
 * implementation 1:1 (see
 * https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-autoscaling-hooktargets/lib/lambda-hook.ts).
 */
class FunctionHook implements autoscaling.ILifecycleHookTarget {
  /**
   * @param fn Function to invoke in response to a lifecycle event
   * @param encryptionKey If provided, this key is used to encrypt the contents of the SNS topic.
   */
  constructor(
    private readonly fn: IFunction,
    private readonly encryptionKey?: IKey,
  ) {}

  /**
   * If the `IRole` does not exist in `options`, will create an `IRole` and an SNS Topic and attach both to the lifecycle hook.
   * If the `IRole` does exist in `options`, will only create an SNS Topic and attach it to the lifecycle hook.
   */
  public bind(
    scope: Construct,
    options: autoscaling.BindHookTargetOptions,
  ): autoscaling.LifecycleHookTargetConfig {
    const topic = new sns.Topic(scope, "Topic", {
      masterKey: this.encryptionKey,
    });

    const role =
      options.role ??
      new iam.Role(scope, "Role", {
        assumedBy: new iam.ServicePrincipal("autoscaling.amazonaws.com"),
      });

    // Per: https://docs.aws.amazon.com/sns/latest/dg/sns-key-management.html#sns-what-permissions-for-sse
    // Topic's grantPublish() is in a base class that does not know there is a kms key, and so does not
    // grant appropriate permissions to the kms key. We do that here to ensure the correct permissions
    // are in place.
    this.encryptionKey?.grant(role, "kms:Decrypt", "kms:GenerateDataKey");
    topic.addSubscription(new sns.subscriptions.LambdaSubscription(this.fn));
    topic.grantPublish(role);

    return {
      notificationTargetArn: topic.topicArn,
      createdRole: role,
    };
  }
}

/**
 * Properties for instance draining hook
 */
export interface InstanceDrainHookProps {
  /**
   * The AutoScalingGroup to install the instance draining hook for
   */
  autoScalingGroup: autoscaling.IAutoScalingGroup;

  /**
   * The cluster on which tasks have been scheduled
   */
  cluster: ICluster;

  /**
   * How many seconds to give tasks to drain before the instance is terminated anyway
   *
   * Must be between 0 and 15 minutes.
   *
   * @default Duration.minutes(15)
   */
  drainTime?: Duration;

  /**
   * The InstanceDrainHook creates an SNS topic for the lifecycle hook of the ASG. If provided, then this
   * key will be used to encrypt the contents of that SNS Topic.
   * See [SNS Data Encryption](https://docs.aws.amazon.com/sns/latest/dg/sns-data-encryption.html) for more information.
   *
   * @default The SNS Topic will not be encrypted.
   */
  topicEncryptionKey?: IKey;
}

/**
 * A hook to drain instances from ECS traffic before they're terminated
 */
export class InstanceDrainHook extends Construct {
  /**
   * Constructs a new instance of the InstanceDrainHook class.
   */
  constructor(scope: Construct, id: string, props: InstanceDrainHookProps) {
    super(scope, id);

    const drainTime = props.drainTime || Duration.minutes(5);

    // Invoke Lambda via SNS Topic
    const fn = new LambdaFunction(this, "Function", {
      code: Code.fromInline(DRAIN_HOOK_LAMBDA_SOURCE),
      handler: "index.lambda_handler",
      // TERRACONSTRUCTS DEVIATION: upstream resolves this via
      // `lambda.Runtime.determineLatestPythonRuntime(this)`, a convenience
      // static that (as of the pinned upstream tag) simply returns
      // `Runtime.PYTHON_3_13` and is not part of the ported `Runtime` class.
      // Pinned directly to the same runtime it currently resolves to.
      runtime: Runtime.PYTHON_3_13,
      // Timeout: some extra margin for additional API calls made by the Lambda,
      // up to a maximum of 15 minutes.
      timeout: Duration.seconds(Math.min(drainTime.toSeconds() + 10, 900)),
      environment: {
        CLUSTER: props.cluster.clusterName,
      },
    });

    // Hook everything up: ASG -> Topic, Topic -> Lambda
    props.autoScalingGroup.addLifecycleHook("DrainHook", {
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_TERMINATING,
      defaultResult: autoscaling.DefaultResult.CONTINUE,
      notificationTarget: new FunctionHook(fn, props.topicEncryptionKey),
      heartbeatTimeout: drainTime,
    });

    // Describe actions cannot be restricted and restrict the CompleteLifecycleAction to the ASG arn
    // https://docs.aws.amazon.com/autoscaling/ec2/userguide/control-access-using-iam.html
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceAttribute",
          "ec2:DescribeInstanceStatus",
          "ec2:DescribeHosts",
        ],
        resources: ["*"],
      }),
    );

    // Restrict to the ASG
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["autoscaling:CompleteLifecycleAction"],
        resources: [props.autoScalingGroup.autoScalingGroupArn],
      }),
    );

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeContainerInstances", "ecs:DescribeTasks"],
        resources: ["*"],
        condition: [
          {
            test: "ArnEquals",
            variable: "ecs:cluster",
            values: [props.cluster.clusterArn],
          },
        ],
      }),
    );

    // Restrict to the ECS Cluster
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecs:ListContainerInstances",
          "ecs:SubmitContainerStateChange",
          "ecs:SubmitTaskStateChange",
        ],
        resources: [props.cluster.clusterArn],
      }),
    );

    // Restrict the container-instance operations to the ECS Cluster
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:UpdateContainerInstancesState", "ecs:ListTasks"],
        condition: [
          {
            test: "ArnEquals",
            variable: "ecs:cluster",
            values: [props.cluster.clusterArn],
          },
        ],
        resources: ["*"],
      }),
    );
  }
}
