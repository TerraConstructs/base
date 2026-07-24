// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/aws-log-driver.test.ts

import {
  cloudwatchLogGroup,
  dataAwsIamPolicyDocument,
  ecsTaskDefinition,
} from "@cdktn/provider-aws";
import { HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack, RetentionDays } from "../../../../src/aws";
import { LogGroup } from "../../../../src/aws/cloudwatch";
import * as ecs from "../../../../src/aws/compute/ecs";
import { Size } from "../../../../src/size";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let stack: AwsStack;
let td: ecs.FargateTaskDefinition;
const image = ecs.ContainerImage.fromRegistry("test-image");

describe("aws log driver", () => {
  beforeEach(() => {
    stack = new AwsStack(Testing.app());
    td = new ecs.FargateTaskDefinition(stack, "TaskDefinition");
  });

  test("create an aws log driver", () => {
    // WHEN
    const awsLogDriver = new ecs.AwsLogDriver({
      datetimeFormat: "format",
      logRetention: RetentionDays.ONE_MONTH,
      multilinePattern: "pattern",
      streamPrefix: "hello",
      mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      maxBufferSize: Size.mebibytes(25),
    });
    td.addContainer("Container", {
      image,
      logging: awsLogDriver,
    });
    stack.prepareStack(); // may generate additional resources

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        retention_in_days: RetentionDays.ONE_MONTH,
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Logs::LogGroup', {
    //   RetentionInDays: logs.RetentionDays.ONE_MONTH,
    // });

    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": stack.resolve(awsLogDriver.logGroup!.logGroupName),
            "awslogs-stream-prefix": "hello",
            "awslogs-region": expect.any(String),
            "awslogs-datetime-format": "format",
            "awslogs-multiline-pattern": "pattern",
            mode: "non-blocking",
            "max-buffer-size": "26214400b",
          },
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awslogs',
    //         Options: {
    //           'awslogs-group': { Ref: 'TaskDefinitionContainerLogGroup4D0A87C1' },
    //           'awslogs-stream-prefix': 'hello',
    //           'awslogs-region': { Ref: 'AWS::Region' },
    //           'awslogs-datetime-format': 'format',
    //           'awslogs-multiline-pattern': 'pattern',
    //           'mode': 'non-blocking',
    //           'max-buffer-size': '26214400b',
    //         },
    //       },
    //     }),
    //   ],
    // });

    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [stack.resolve(awsLogDriver.logGroup!.logGroupArn)],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    //   PolicyDocument: {
    //     Statement: [{
    //       Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    //       Effect: 'Allow',
    //       Resource: {
    //         'Fn::GetAtt': ['TaskDefinitionContainerLogGroup4D0A87C1', 'Arn'],
    //       },
    //     }],
    //   },
    // });
  });

  test("create an aws log driver using awsLogs", () => {
    // WHEN
    const awsLogDriver = ecs.AwsLogDriver.awsLogs({
      datetimeFormat: "format",
      logRetention: RetentionDays.ONE_MONTH,
      multilinePattern: "pattern",
      streamPrefix: "hello",
    }) as ecs.AwsLogDriver;
    td.addContainer("Container", {
      image,
      logging: awsLogDriver,
    });
    stack.prepareStack(); // may generate additional resources

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        retention_in_days: RetentionDays.ONE_MONTH,
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Logs::LogGroup', {
    //   RetentionInDays: logs.RetentionDays.ONE_MONTH,
    // });

    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": stack.resolve(awsLogDriver.logGroup!.logGroupName),
            "awslogs-stream-prefix": "hello",
            "awslogs-region": expect.any(String),
            "awslogs-datetime-format": "format",
            "awslogs-multiline-pattern": "pattern",
          },
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awslogs',
    //         Options: {
    //           'awslogs-group': { Ref: 'TaskDefinitionContainerLogGroup4D0A87C1' },
    //           'awslogs-stream-prefix': 'hello',
    //           'awslogs-region': { Ref: 'AWS::Region' },
    //           'awslogs-datetime-format': 'format',
    //           'awslogs-multiline-pattern': 'pattern',
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("with a defined log group", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "hello",
      }),
    });
    stack.prepareStack(); // may generate additional resources

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        retention_in_days: RetentionDays.TWO_YEARS,
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Logs::LogGroup', {
    //   RetentionInDays: logs.RetentionDays.TWO_YEARS,
    // });

    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": stack.resolve(logGroup.logGroupName),
            "awslogs-stream-prefix": "hello",
            "awslogs-region": expect.any(String),
          },
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awslogs',
    //         Options: {
    //           'awslogs-group': { Ref: 'LogGroupF5B46931' },
    //           'awslogs-stream-prefix': 'hello',
    //           'awslogs-region': { Ref: 'AWS::Region' },
    //         },
    //       },
    //     }),
    //   ],
    // });
  });

  test("without a defined log group: creates one anyway", () => {
    // GIVEN
    td.addContainer("Container", {
      image,
      logging: new ecs.AwsLogDriver({
        streamPrefix: "hello",
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {},
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::Logs::LogGroup', {});
  });

  test("throws when specifying log retention and log group", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // THEN
    expect(
      () =>
        new ecs.AwsLogDriver({
          logGroup,
          logRetention: RetentionDays.FIVE_DAYS,
          streamPrefix: "hello",
        }),
    ).toThrow(/`logGroup`.*`logRetentionDays`/);
  });

  test("throws error when specifying maxBufferSize and blocking mode", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // THEN
    expect(
      () =>
        new ecs.AwsLogDriver({
          logGroup,
          streamPrefix: "hello",
          mode: ecs.AwsLogDriverMode.BLOCKING,
          maxBufferSize: Size.mebibytes(25),
        }),
    ).toThrow(/.*maxBufferSize.*/);
  });

  test("throws error when specifying maxBufferSize and default settings", () => {
    // GIVEN
    const logGroup = new LogGroup(stack, "LogGroup");

    // THEN
    expect(
      () =>
        new ecs.AwsLogDriver({
          logGroup,
          streamPrefix: "hello",
          maxBufferSize: Size.mebibytes(25),
        }),
    ).toThrow(/.*maxBufferSize.*/);
  });

  test("allows cross-region log group", () => {
    // GIVEN
    const logGroupRegion = "asghard";
    const logGroup = LogGroup.fromLogGroupArn(
      stack,
      "LogGroup",
      `arn:aws:logs:${logGroupRegion}:1234:log-group:my_log_group`,
    );

    // WHEN
    td.addContainer("Container", {
      image,
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "hello",
      }),
    });

    // THEN
    new Template(stack).resourceCountIs(
      cloudwatchLogGroup.CloudwatchLogGroup,
      0,
    );
    // Template.fromStack(stack).resourceCountIs('AWS::Logs::LogGroup', 0);

    expect(renderContainerDefinitions(stack)).toMatchObject([
      {
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup.logGroupName,
            "awslogs-stream-prefix": "hello",
            "awslogs-region": logGroupRegion,
          },
        },
      },
    ]);
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ContainerDefinitions: [
    //     Match.objectLike({
    //       LogConfiguration: {
    //         LogDriver: 'awslogs',
    //         Options: {
    //           'awslogs-group': logGroup.logGroupName,
    //           'awslogs-stream-prefix': 'hello',
    //           'awslogs-region': logGroupRegion,
    //         },
    //       },
    //     }),
    //   ],
    // });
  });
});

// Repo-specific: snapshot coverage on top of the ported upstream suite (see
// test/aws/notify/queue.test.ts / test/aws/compute/ecs/json-file-log-driver.test.ts
// for the harness idiom) - guards against emitted-Terraform drift for the
// jsonencoded `container_definitions` blob the AwsLogDriver contributes
// `logConfiguration` to, plus the LogGroup + execution-role IAM policy it creates.
describe("aws log driver synth", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app = Testing.app();
    const synthStack = new AwsStack(app);
    new HttpBackend(synthStack, gridBackendConfig);
    const taskDefinition = new ecs.FargateTaskDefinition(
      synthStack,
      "TaskDefinition",
    );

    // WHEN
    taskDefinition.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("test-image"),
      logging: new ecs.AwsLogDriver({
        datetimeFormat: "format",
        logRetention: RetentionDays.ONE_MONTH,
        multilinePattern: "pattern",
        streamPrefix: "hello",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
        maxBufferSize: Size.mebibytes(25),
      }),
    });

    // THEN
    synthStack.prepareStack(); // may generate additional resources
    expect(Testing.synth(synthStack)).toMatchSnapshot();
  });
});

/**
 * `aws_ecs_task_definition.container_definitions` is a single jsonencode()'d string on
 * TerraConstructs (there is no CFN L1 layer / typed `ContainerDefinitionProperty[]` here -
 * see the `// TERRACONSTRUCTS DEVIATION` note on `ContainerDefinition.renderContainerDefinition`).
 * Parse it back out so assertions can target the `logConfiguration` of a single container the
 * same way upstream's `Match.objectLike` does against the CFN `ContainerDefinitions` array.
 */
function renderContainerDefinitions(forStack: AwsStack): any[] {
  const template = new Template(forStack);
  const taskDefs = template.resourceTypeArray(
    ecsTaskDefinition.EcsTaskDefinition,
  ) as Array<{ container_definitions: string }>;
  expect(taskDefs).toHaveLength(1);
  return JSON.parse(taskDefs[0].container_definitions);
}
