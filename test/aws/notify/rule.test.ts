// https://github.com/aws/aws-cdk/blob/17b12f2aa7a2b519a6e802bf79d3099f2fcd7851/packages/aws-cdk-lib/aws-events/test/rule.test.ts

import {
  cloudwatchEventRule,
  cloudwatchEventTarget,
  cloudwatchEventBusPolicy,
} from "@cdktf/provider-aws";
import { App, Testing, Lazy } from "cdktf";
import { Construct, IConstruct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as iam from "../../../src/aws/iam";
import {
  EventBus,
  EventField,
  IRule,
  IRuleTarget,
  RuleTargetConfig,
  RuleTargetInput,
  Schedule,
  Match as m,
} from "../../../src/aws/notify";
import { Rule } from "../../../src/aws/notify/rule";
import { Duration } from "../../../src/duration";
import { Fn } from "../../../src/terra-func";
import { Annotations, Template } from "../../assertions";
import { TestResource } from "../../test-resource";

const ruleTfResource = cloudwatchEventRule.CloudwatchEventRule.tfResourceType;
const ruleTargetTfResource =
  cloudwatchEventTarget.CloudwatchEventTarget.tfResourceType;

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridUUID2 = "123e4567-e89b-12d4";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("rule", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });
  test("default rule", () => {
    new Rule(stack, "MyRule", {
      schedule: Schedule.rate(Duration.minutes(10)),
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [ruleTfResource]: {
          MyRule_A44AB831: {
            schedule_expression: "rate(10 minutes)",
            state: "ENABLED",
          },
        },
      },
    });
  });

  test("rule displays warning when minutes are not included in cron", () => {
    new Rule(stack, "MyRule", {
      schedule: Schedule.cron({
        hour: "8",
        day: "1",
      }),
    });

    const template = Annotations.fromStack(stack);
    template.hasWarnings({
      constructPath: "MyStack/MyRule",
      // TODO: Support Warning Acknowledgements - [ack: @aws-cdk/aws-events:scheduleWillRunEveryMinute]
      message:
        "cron: If you don't pass 'minute', by default the event runs every minute. Pass 'minute: '*'' if that's what you intend, or 'minute: 0' to run once per hour instead.",
    });
  });

  test("rule does not display warning when minute is set to * in cron", () => {
    new Rule(stack, "MyRule", {
      schedule: Schedule.cron({
        minute: "*",
        hour: "8",
        day: "1",
      }),
    });

    const template = Annotations.fromStack(stack);
    template.hasNoWarnings({
      constructPath: "MyStack/MyRule",
    });
  });

  test("can get rule name", () => {
    const rule = new Rule(stack, "MyRule", {
      schedule: Schedule.rate(Duration.minutes(10)),
    });

    new TestResource(stack, "Res", {
      properties: {
        RuleName: rule.ruleName,
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(TestResource, {
      RuleName: "${aws_cloudwatch_event_rule.MyRule_A44AB831.name}",
    });
  });

  test("rule cannot have more than 5 targets", () => {
    const resource = new Construct(stack, "Resource");
    const rule = new Rule(stack, "MyRule", {
      schedule: Schedule.rate(Duration.minutes(10)),
      targets: [
        new SomeTarget("T1", resource),
        new SomeTarget("T2", resource),
        new SomeTarget("T3", resource),
        new SomeTarget("T4", resource),
        new SomeTarget("T5", resource),
        new SomeTarget("T6", resource),
      ],
    });

    expect(() => app.synth()).toThrow(
      /Event rule cannot have more than 5 targets./,
    );
  });

  test("get rate as token", () => {
    const lazyDuration = Duration.minutes(
      Lazy.numberValue({ produce: () => 5 }),
    );

    new Rule(stack, "MyScheduledRule", {
      ruleName: "rateInMinutes",
      schedule: Schedule.rate(lazyDuration),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        name: "rateInMinutes",
        schedule_expression: "rate(5 minutes)",
      },
    );
  });

  test("Seconds is not an allowed value for Schedule rate", () => {
    const lazyDuration = Duration.seconds(
      Lazy.numberValue({ produce: () => 5 }),
    );
    expect(() => Schedule.rate(lazyDuration)).toThrow(
      /Allowed units for scheduling/i,
    );
  });

  test("Millis is not an allowed value for Schedule rate", () => {
    const lazyDuration = Duration.millis(
      Lazy.numberValue({ produce: () => 5 }),
    );

    // THEN
    expect(() => Schedule.rate(lazyDuration)).toThrow(
      /Allowed units for scheduling/i,
    );
  });

  test("rule with physical name", () => {
    // GIVEN

    // WHEN
    new Rule(stack, "MyRule", {
      ruleName: "PhysicalName",
      schedule: Schedule.rate(Duration.minutes(10)),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        name: "PhysicalName",
      },
    );
  });

  test("eventPattern is rendered properly", () => {
    new Rule(stack, "MyRule", {
      eventPattern: {
        account: ["account1", "account2"],
        detail: {
          foo: [1, 2],
          strings: ["foo", "bar"],
          rangeMatcher: m.interval(-1, 1),
          stringMatcher: m.exactString("I am just a string"),
          prefixMatcher: m.prefix("aws."),
          ipAddress: m.ipAddressRange("192.0.2.0/24"),
          shouldExist: m.exists(),
          shouldNotExist: m.doesNotExist(),
          numbers: m.allOf(m.greaterThan(0), m.lessThan(5)),
          topLevel: {
            deeper: m.equal(42),
            oneMoreLevel: {
              deepest: m.anyOf(m.lessThanOrEqual(-1), m.greaterThanOrEqual(1)),
            },
          },
          state: m.anythingBut("initializing"),
          limit: m.anythingBut(100, 200, 300),
          notPrefixedBy: m.anythingButPrefix("sensitive-"),
          bar: undefined,
        },
        detailType: ["detailType1"],
        id: ["id1", "id2"],
        region: ["region1", "region2", "region3"],
        resources: ["r1"],
        source: ["src1", "src2"],
        time: ["t1"],
        version: ["0"],
      },
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [ruleTfResource]: {
          MyRule_A44AB831: {
            event_pattern:
              '{"account":["account1","account2"],"detail":{"foo":[1,2],"strings":["foo","bar"],"rangeMatcher":[{"numeric":[">=",-1,"<=",1]}],"stringMatcher":["I am just a string"],"prefixMatcher":[{"prefix":"aws."}],"ipAddress":[{"cidr":"192.0.2.0/24"}],"shouldExist":[{"exists":true}],"shouldNotExist":[{"exists":false}],"numbers":[{"numeric":[">",0,"<",5]}],"topLevel":{"deeper":[{"numeric":["=",42]}],"oneMoreLevel":{"deepest":[{"numeric":["<=",-1]},{"numeric":[">=",1]}]}},"state":[{"anything-but":["initializing"]}],"limit":[{"anything-but":[100,200,300]}],"notPrefixedBy":[{"anything-but":{"prefix":"sensitive-"}}]},"detail-type":["detailType1"],"id":["id1","id2"],"region":["region1","region2","region3"],"resources":["r1"],"source":["src1","src2"],"time":["t1"],"version":["0"]}',
            state: "ENABLED",
          },
        },
      },
    });
  });

  test("fails synthesis if neither eventPattern nor scheduleExpression are specified", () => {
    new Rule(stack, "Rule");
    expect(() => app.synth()).toThrow(
      /Either 'eventPattern' or 'schedule' must be defined/,
    );
  });

  test("fails synthesis when rule name is less than 1 chars", () => {
    new Rule(stack, "Rule", {
      ruleName: "",
      schedule: Schedule.rate(Duration.minutes(10)),
    });
    expect(() => app.synth()).toThrow(
      /Event rule name must be between 1 and 64 characters./,
    );
  });

  test("fails synthesis when rule name is longer than 64 chars", () => {
    new Rule(stack, "Rule", {
      ruleName: "a".repeat(65),
      schedule: Schedule.rate(Duration.minutes(10)),
    });
    expect(() => app.synth()).toThrow(
      /Event rule name must be between 1 and 64 characters./,
    );
  });

  test("fails synthesis when rule name contains invalid characters", () => {
    [" ", "\n", "\r", "[", "]", "<", ">", "$"].forEach((invalidChar) => {
      new Rule(stack, `Rule${invalidChar}`, {
        ruleName: `Rule${invalidChar}`,
        schedule: Schedule.rate(Duration.minutes(10)),
      });
      expect(() => app.synth()).toThrow(
        /can contain only letters, numbers, periods, hyphens, or underscores with no spaces./,
      );
    });
  });

  test("addEventPattern can be used to add filters", () => {
    const rule = new Rule(stack, "MyRule");
    rule.addEventPattern({
      account: ["12345"],
      detail: {
        foo: ["hello", "bar", "hello"],
      },
    });

    rule.addEventPattern({
      source: ["aws.source"],
      detail: {
        foo: ["bar", "hello"],
        goo: {
          hello: ["world"],
        },
      },
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [ruleTfResource]: {
          MyRule_A44AB831: {
            event_pattern:
              '{"account":["12345"],"detail":{"foo":["hello","bar"],"goo":{"hello":["world"]}},"source":["aws.source"]}',
            state: "ENABLED",
          },
        },
      },
    });
  });

  test("addEventPattern can de-duplicate filters and keep the order", () => {
    const rule = new Rule(stack, "MyRule");
    rule.addEventPattern({
      detailType: [
        "AWS API Call via CloudTrail",
        "AWS API Call via CloudTrail",
      ],
    });

    rule.addEventPattern({
      detailType: [
        "EC2 Instance State-change Notification",
        "AWS API Call via CloudTrail",
      ],
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [ruleTfResource]: {
          MyRule_A44AB831: {
            event_pattern:
              '{"detail-type":["AWS API Call via CloudTrail","EC2 Instance State-change Notification"]}',
            state: "ENABLED",
          },
        },
      },
    });
  });

  test("targets can be added via props or addTarget with input transformer", () => {
    const t1: IRuleTarget = {
      bind: () => ({
        id: "",
        arn: "ARN1",
        kinesisParameters: { partitionKeyPath: "partitionKeyPath" },
      }),
    };

    const t2: IRuleTarget = {
      bind: () => ({
        id: "",
        arn: "ARN2",
        input: RuleTargetInput.fromText(
          `This is ${EventField.fromPath("$.detail.bla")}`,
        ),
      }),
    };

    const rule = new Rule(stack, "EventRule", {
      targets: [t1],
      schedule: Schedule.rate(Duration.minutes(5)),
    });

    rule.addTarget(t2);

    Template.fromStack(stack).toMatchObject({
      resource: {
        [ruleTfResource]: {
          EventRule_5A491D2C: {
            schedule_expression: "rate(5 minutes)",
            state: "ENABLED",
          },
        },
        [ruleTargetTfResource]: {
          EventRule_Target0_5CFEC68B: {
            arn: "ARN1",
            target_id: "Target0",
            kinesis_target: {
              partition_key_path: "partitionKeyPath",
            },
            rule: stack.resolve(rule.ruleName),
          },
          EventRule_Target1_D32A87E8: {
            arn: "ARN2",
            target_id: "Target1",
            input_transformer: {
              input_paths: {
                "detail-bla": "$.detail.bla",
              },
              input_template: '"This is <detail-bla>"',
            },
            rule: stack.resolve(rule.ruleName),
          },
        },
      },
    });
  });

  test("input template can contain tokens", () => {
    const rule = new Rule(stack, "EventRule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    // a plain string should just be stringified (i.e. double quotes added and escaped)
    rule.addTarget({
      bind: () => ({
        id: "",
        arn: "ARN2",
        input: RuleTargetInput.fromText('Hello, "world"'),
      }),
    });

    // tokens are used here (FnConcat), but this is a text template so we
    // expect it to be wrapped in double quotes automatically for us.
    rule.addTarget({
      bind: () => ({
        id: "",
        arn: "ARN1",
        kinesisParameters: { partitionKeyPath: "partitionKeyPath" },
        input: RuleTargetInput.fromText(Fn.join("", ["a", "b"]).toString()),
      }),
    });

    // jsonTemplate can be used to format JSON documents with replacements
    rule.addTarget({
      bind: () => ({
        id: "",
        arn: "ARN3",
        input: RuleTargetInput.fromObject({
          foo: EventField.fromPath("$.detail.bar"),
        }),
      }),
    });

    // tokens can also used for JSON templates.
    rule.addTarget({
      bind: () => ({
        id: "",
        arn: "ARN4",
        input: RuleTargetInput.fromText(
          Fn.join(" ", ["hello", '"world"']).toString(),
        ),
      }),
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        [ruleTfResource]: {
          EventRule_5A491D2C: {
            state: "ENABLED",
            schedule_expression: "rate(1 minute)",
          },
        },
        [ruleTargetTfResource]: {
          EventRule_Target0_5CFEC68B: {
            arn: "ARN2",
            target_id: "Target0",
            input: '"Hello, \\"world\\""',
            rule: stack.resolve(rule.ruleName),
          },
          EventRule_Target1_D32A87E8: {
            arn: "ARN1",
            target_id: "Target1",
            input: '"ab"',
            kinesis_target: {
              partition_key_path: "partitionKeyPath",
            },
            rule: stack.resolve(rule.ruleName),
          },
          EventRule_Target2_473012E1: {
            arn: "ARN3",
            target_id: "Target2",
            input_transformer: {
              input_paths: {
                "detail-bar": "$.detail.bar",
              },
              input_template: '{"foo":<detail-bar>}',
            },
            rule: stack.resolve(rule.ruleName),
          },
          EventRule_Target3_9CB495EC: {
            arn: "ARN4",
            target_id: "Target3",
            input: '"hello \\"world\\""',
            rule: stack.resolve(rule.ruleName),
          },
        },
      },
    });
  });

  test("target can declare role which will be used", () => {
    // GIVEN
    const rule = new Rule(stack, "EventRule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    const role = new iam.Role(stack, "SomeRole", {
      assumedBy: new iam.ServicePrincipal("nobody"),
    });

    // a plain string should just be stringified (i.e. double quotes added and escaped)
    rule.addTarget({
      bind: () => ({
        id: "",
        arn: "ARN2",
        role,
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "ARN2",
        target_id: "Target0",
        role_arn: stack.resolve(role.roleArn),
      },
    );
  });

  // TODO: BUG - cross stack config is not working
  test.skip("in cross-account scenario, target role is only used in target account", () => {
    // GIVEN
    // env: { account: "1234", region: "us-east-1" },
    const ruleStack = new AwsStack(app, "RuleStack", {
      environmentName,
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig,
    });
    // env: { account: "5678", region: "us-east-1" },
    const targetStack = new AwsStack(app, "TargeTStack", {
      environmentName,
      gridUUID: gridUUID2,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig,
    });

    const rule = new Rule(ruleStack, "EventRule", {
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    const role = new iam.Role(targetStack, "SomeRole", {
      assumedBy: new iam.ServicePrincipal("nobody"),
    });

    // a plain string should just be stringified (i.e. double quotes added and escaped)
    rule.addTarget({
      bind: () => ({
        id: "",
        arn: "ARN2",
        role,
        targetResource: role, // Not really but good enough
      }),
    });

    // THEN
    Template.synth(ruleStack).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        // TODO: Should be targetStack account ...
        arn: "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:5678:event-bus/default",
      },
    );
    Template.synth(targetStack).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "ARN2",
        role_arn: stack.resolve(role.roleArn),
      },
    );
  });

  test("asEventRuleTarget can use the ruleArn and a uniqueId of the rule", () => {
    let receivedRuleArn = "FAIL";
    let receivedRuleId = "FAIL";

    const t1: IRuleTarget = {
      bind: (eventRule: IRule) => {
        receivedRuleArn = eventRule.ruleArn;
        receivedRuleId = AwsStack.uniqueId(eventRule.node);

        return {
          id: "",
          arn: "ARN1",
          kinesisParameters: { partitionKeyPath: "partitionKeyPath" },
        };
      },
    };

    const rule = new Rule(stack, "EventRule");
    rule.addTarget(t1);

    expect(stack.resolve(receivedRuleArn)).toEqual(stack.resolve(rule.ruleArn));
    expect(receivedRuleId).toEqual(AwsStack.uniqueId(rule));
  });

  test("fromEventRuleArn", () => {
    // GIVEN

    // WHEN
    const importedRule = Rule.fromEventRuleArn(
      stack,
      "ImportedRule",
      "arn:aws:events:us-east-2:123456789012:rule/example",
    );

    // THEN
    expect(importedRule.ruleArn).toEqual(
      "arn:aws:events:us-east-2:123456789012:rule/example",
    );
    expect(importedRule.ruleName).toEqual("example");
  });

  test("sets account for imported rule env by fromEventRuleArn", () => {
    const importedRule = Rule.fromEventRuleArn(
      stack,
      "Imported",
      "arn:aws:events:us-west-2:999999999999:rule/example",
    );

    expect(importedRule.env.account).toEqual("999999999999");
  });

  test("sets region for imported rule env by fromEventRuleArn", () => {
    const importedRule = Rule.fromEventRuleArn(
      stack,
      "Imported",
      "arn:aws:events:us-west-2:999999999999:rule/example",
    );

    expect(importedRule.env.region).toEqual("us-west-2");
  });

  test("rule can be disabled", () => {
    // GIVEN

    // WHEN
    new Rule(stack, "Rule", {
      schedule: Schedule.expression("foom"),
      enabled: false,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        state: "DISABLED",
      },
    );
  });

  test("can add multiple targets with the same id", () => {
    // GIVEN
    const rule = new Rule(stack, "Rule", {
      schedule: Schedule.expression("foom"),
      enabled: false,
    });
    rule.addTarget(new SomeTarget());
    rule.addTarget(new SomeTarget());

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "ARN1",
        target_id: "Target0",
        kinesis_target: {
          partition_key_path: "partitionKeyPath",
        },
      },
    );
    t.expect.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "ARN1",
        target_id: "Target1",
        kinesis_target: {
          partition_key_path: "partitionKeyPath",
        },
      },
    );
  });

  test("sqsParameters are generated when they are specified in target props", () => {
    const t1: IRuleTarget = {
      bind: () => ({
        id: "",
        arn: "ARN1",
        sqsParameters: { messageGroupId: "messageGroupId" },
      }),
    };

    const rule = new Rule(stack, "EventRule", {
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [t1],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "ARN1",
        sqs_target: {
          message_group_id: "messageGroupId",
        },
        rule: stack.resolve(rule.ruleName),
      },
    );
  });

  test("redshiftDataParameters are generated when they are specified in target props", () => {
    const t1: IRuleTarget = {
      bind: () => ({
        id: "",
        arn: "ARN1",
        redshiftDataParameters: {
          database: "database",
          dbUser: "dbUser",
          secretsManagerArn: "secretManagerArn",
          // the sql statement text to run
          // (NOTE: CFN supports an array of strings)
          // http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-events-rule-redshiftdataparameters.html#cfn-events-rule-redshiftdataparameters-sqls
          sql: "sql",
          statementName: "statementName",
          withEvent: true,
        },
      }),
    };

    const rule = new Rule(stack, "EventRule", {
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [t1],
    });

    const t = new Template(stack);
    // // eslint-disable-next-line no-console
    // console.log(
    //   (t.resourcesByType(cloudwatchEventRule.CloudwatchEventRule) as any)
    //     .EventRule_5A491D2C.targets[0],
    // );

    t.expect.toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        schedule_expression: "rate(5 minutes)",
        state: "ENABLED",
      },
    );
    t.expect.toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        arn: "ARN1",
        redshift_target: {
          database: "database",
          db_user: "dbUser",
          secrets_manager_arn: "secretManagerArn",
          sql: "sql",
          statement_name: "statementName",
          with_event: true,
        },
        rule: stack.resolve(rule.ruleName),
      },
    );
  });

  test("associate rule with event bus", () => {
    // GIVEN
    const eventBus = new EventBus(stack, "EventBus");

    // WHEN
    new Rule(stack, "MyRule", {
      eventPattern: {
        detail: ["detail"],
      },
      eventBus,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventRule.CloudwatchEventRule,
      {
        event_bus_name: stack.resolve(eventBus.eventBusName),
      },
    );
  });

  test("throws with eventBus and schedule", () => {
    // GIVEN
    const eventBus = new EventBus(stack, "EventBus");

    // THEN
    expect(
      () =>
        new Rule(stack, "MyRule", {
          schedule: Schedule.rate(Duration.minutes(10)),
          eventBus,
        }),
    ).toThrow(/Cannot associate rule with 'eventBus' when using 'schedule'/);
  });

  test("allow an imported target if is in the same account and region", () => {
    const sourceAccount = "123456789012";
    const sourceRegion = "us-west-2";
    // env: { account: sourceAccount, region: sourceRegion },
    const sourceStack = new AwsStack(app, "SourceStack", {
      environmentName,
      gridUUID,
      providerConfig: {
        region: sourceRegion,
      },
      gridBackendConfig,
    });
    const rule = new Rule(sourceStack, "Rule", {
      eventPattern: {
        source: ["some-event"],
      },
    });

    const resource = EventBus.fromEventBusArn(
      sourceStack,
      "TargetEventBus",
      `arn:aws:events:${sourceRegion}:${sourceAccount}:event-bus/default`,
    );

    rule.addTarget(new SomeTarget("T", resource));

    Template.synth(sourceStack).toHaveResourceWithProperties(
      cloudwatchEventTarget.CloudwatchEventTarget,
      {
        // id: "T",
        arn: "ARN1",
        kinesis_target: {
          partition_key_path: "partitionKeyPath",
        },
      },
    );
  });

  // TODO: BUG - cross stack config is not working
  describe.skip("for cross-account and/or cross-region targets", () => {
    test("requires that the source stack specify a concrete account", () => {
      const rule = new Rule(stack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      // const targetAccount = "234567890123";
      // TODO: Support constructors with account - env: { account: targetAccount },
      const targetStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig,
        gridBackendConfig,
      });
      const resource = new Construct(targetStack, "Resource");
      rule.addTarget(new SomeTarget("T", resource));
      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          Targets: [
            {
              Id: "T",
              Arn: "ARN1",
            },
          ],
        },
      );
      Annotations.fromStack(stack).hasWarnings({
        constructPath: rule.node.path,
        message:
          /Either the Event Rule or target has an unresolved environment/,
      });
    });

    test("requires that the target stack specify a concrete account", () => {
      // const sourceAccount = "123456789012";
      // TODO: Support constructors with account - env: { account: sourceAccount },
      const sourceStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig,
        gridBackendConfig,
      });
      const rule = new Rule(sourceStack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      const resource = new Construct(stack, "Resource");
      rule.addTarget(new SomeTarget("T", resource));
      Template.fromStack(sourceStack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          Targets: [
            {
              Id: "T",
              Arn: "ARN1",
            },
          ],
        },
      );
      Annotations.fromStack(sourceStack).hasWarnings({
        constructPath: rule.node.path,
        message:
          /Either the Event Rule or target has an unresolved environment/,
      });
    });

    // // NOTE: TerraConstructs Stacks always specify a concrete region
    // test("requires that the target stack specify a concrete region", () => {
    //   const sourceAccount = "123456789012";
    //   const sourceStack = new cdk.Stack(app, "SourceStack", {
    //     env: { account: sourceAccount },
    //   });
    //   const rule = new Rule(sourceStack, "Rule");

    //   const targetAccount = "234567890123";
    //   const targetStack = new cdk.Stack(app, "TargetStack", {
    //     env: { account: targetAccount },
    //   });
    //   const resource = new Construct(targetStack, "Resource");

    //   expect(() => {
    //     rule.addTarget(new SomeTarget("T", resource));
    //   }).toThrow(
    //     /You need to provide a concrete region for the target stack when using cross-account or cross-region events/,
    //   );
    // });

    test("creates cross-account targets if in the same region", () => {
      // const sourceAccount = "123456789012";
      const sourceRegion = "eu-west-2";
      const rule = new Rule(stack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      const targetAccount = "234567890123";
      const targetRegion = sourceRegion;
      // env: { account: targetAccount, region: targetRegion },
      const targetStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig: {
          region: targetRegion,
        },
        gridBackendConfig,
      });
      const resource = new Construct(targetStack, "Resource");

      rule.addTarget(new SomeTarget("T", resource));

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          state: "ENABLED",
          targets: [
            {
              id: "T",
              arn: {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    { Ref: "AWS::Partition" },
                    `:events:${targetRegion}:${targetAccount}:event-bus/default`,
                  ],
                ],
              },
            },
          ],
        },
      );

      Template.fromStack(targetStack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          targets: [
            {
              arn: "ARN1",
              id: "T",
              kinesis_parameters: {
                partition_key_path: "partitionKeyPath",
              },
            },
          ],
        },
      );
    });

    test("creates cross-region targets", () => {
      const sourceAccount = "123456789012";
      const sourceRegion = "us-west-2";
      // env: { account: sourceAccount, region: sourceRegion },
      const rule = new Rule(stack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      const targetAccount = "234567890123";
      const targetRegion = "us-east-1";
      // env: { account: targetAccount, region: targetRegion },
      const targetStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig: {
          region: targetRegion,
        },
        gridBackendConfig,
      });
      const resource = new Construct(targetStack, "Resource");

      rule.addTarget(new SomeTarget("T", resource));

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          state: "ENABLED",
          targets: [
            {
              id: "T",
              arn: {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    { Ref: "AWS::Partition" },
                    `:events:${targetRegion}:${targetAccount}:event-bus/default`,
                  ],
                ],
              },
            },
          ],
        },
      );

      Template.synth(targetStack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          Targets: [
            {
              Arn: "ARN1",
              Id: "T",
              KinesisParameters: {
                PartitionKeyPath: "partitionKeyPath",
              },
            },
          ],
        },
      );
    });

    test("do not create duplicated targets", () => {
      const sourceAccount = "123456789012";
      const sourceRegion = "us-west-2";
      // env: { account: sourceAccount, region: sourceRegion },
      const rule = new Rule(stack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      const targetAccount = "234567890123";
      const targetRegion = "us-east-1";
      // env: { account: targetAccount, region: targetRegion },
      const targetStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        providerConfig: {
          region: targetRegion,
        },
        gridBackendConfig,
      });
      const resource = new Construct(targetStack, "Resource");

      rule.addTarget(new SomeTarget("T", resource));
      // same target should be skipped
      rule.addTarget(new SomeTarget("T1", resource));

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          state: "ENABLED",
          targets: [
            {
              id: "T",
              arn: {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    { Ref: "AWS::Partition" },
                    `:events:${targetRegion}:${targetAccount}:event-bus/default`,
                  ],
                ],
              },
            },
          ],
        },
      );

      Template.synth(stack).not.toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        expect.anything(),
        // Match.not({
        // {
        //   state: "ENABLED",
        //   targets: [
        //     {
        //       id: "T1",
        //       arn: {
        //         "Fn::Join": [
        //           "",
        //           [
        //             "arn:",
        //             { Ref: "AWS::Partition" },
        //             `:events:${targetRegion}:${targetAccount}:event-bus/default`,
        //           ],
        //         ],
        //       },
        //     },
        //   ],
        // },
      );
    });

    test("requires that the target is not imported", () => {
      // const sourceAccount = "123456789012";
      // const sourceRegion = "us-west-2";
      // env: { account: sourceAccount, region: sourceRegion },
      const rule = new Rule(stack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      const targetAccount = "123456789012";
      const targetRegion = "us-west-1";
      const resource = EventBus.fromEventBusArn(
        stack,
        "TargetEventBus",
        `arn:aws:events:${targetRegion}:${targetAccount}:event-bus/default`,
      );
      expect(() => {
        rule.addTarget(new SomeTarget("T", resource));
      }).toThrow(
        /Cannot create a cross-account or cross-region rule for an imported resource/,
      );
    });

    test("requires that the source and target stacks be part of the same App", () => {
      // const sourceAccount = "123456789012";
      // env: { account: sourceAccount, region: "us-west-2" },
      const rule = new Rule(stack, "Rule");

      const targetApp = Testing.app();
      // const targetAccount = "234567890123";
      // env: { account: targetAccount, region: "us-west-2" },
      const targetStack = new AwsStack(targetApp, "MyStack", {
        environmentName,
        gridUUID: gridUUID2,
        gridBackendConfig,
        providerConfig,
        // : {
        //   region: targetRegion,
        // },
      });
      const resource = new Construct(targetStack, "Resource");

      expect(() => {
        rule.addTarget(new SomeTarget("T", resource));
      }).toThrow(
        /Event stack and target stack must belong to the same CDK app/,
      );
    });

    test("generates the correct rules in the source and target stacks when eventPattern is passed in the constructor", () => {
      // https://registry.terraform.io/providers/hashicorp/aws/5.88.0/docs/resources/cloudwatch_event_target#cross-account-event-bus-target
      const sourceAccount = "123456789012";
      const uniqueName = "SourceStackRuleD6962A13";
      // {
      //   env: {
      //     account: sourceAccount,
      //     region: "us-west-2",
      //   },
      // }
      const rule = new Rule(stack, "Rule", {
        eventPattern: {
          source: ["some-event"],
        },
      });

      const targetAccount = "234567890123";
      const targetStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        gridBackendConfig,
        providerConfig: {
          //account: targetAccount
          region: "us-west-2",
        },
      });
      const resource1 = new Construct(targetStack, "Resource1");
      const resource2 = new Construct(targetStack, "Resource2");

      rule.addTarget(new SomeTarget("T1", resource1));
      rule.addTarget(new SomeTarget("T2", resource2));

      const t1 = new Template(stack);
      t1.expect.toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: '{"source":["some-event"]}',
          state: "ENABLED",
        },
      );
      t1.expect.toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          // id: "T1",
          // TODO: Should be targetStack account ...
          // arn: "arn:${data.aws_partition.Partitition.partition}:events:us-west-2:${data.aws_caller_identity.CallerIdentity.account_id}:event-bus/default",
          arn: "ARN1",
          rule: stack.resolve(rule.ruleName),
        },
      );

      const t2 = new Template(targetStack);
      t2.expect.toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: '{"source":["some-event"]}',
          state: "ENABLED",
        },
      );
      t2.expect.toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          // id: "T1",
          arn: "ARN1",
        },
      );
      t2.expect.toHaveResourceWithProperties(
        cloudwatchEventTarget.CloudwatchEventTarget,
        {
          // id: "T2",
          arn: "ARN1",
        },
      );

      const eventBusPolicyStack = app.node.findChild(
        `EventBusPolicy-${sourceAccount}-us-west-2-${targetAccount}`,
      ) as AwsStack;
      Template.synth(eventBusPolicyStack).toHaveResourceWithProperties(
        cloudwatchEventBusPolicy.CloudwatchEventBusPolicy,
        {
          action: "events:PutEvents",
          statement_id: `Allow-account-${sourceAccount}-${uniqueName}`,
          principal: sourceAccount,
        },
      );
    });

    test("generates the correct rule in the target stack when addEventPattern in the source rule is used", () => {
      // const sourceAccount = "123456789012";
      // env: {
      //   account: sourceAccount,
      //   region: "us-west-2",
      // },
      const rule = new Rule(stack, "Rule");

      // const targetAccount = "234567890123";
      const targetStack = new AwsStack(app, "TargetStack", {
        environmentName,
        gridUUID: gridUUID2,
        gridBackendConfig,
        providerConfig: {
          //account: targetAccount
          region: "us-west-2",
        },
      });
      const resource = new Construct(targetStack, "Resource1");

      rule.addTarget(new SomeTarget("T", resource));

      rule.addEventPattern({
        source: ["some-event"],
      });

      Template.synth(targetStack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: {
            source: ["some-event"],
          },
          state: "ENABLED",
          targets: [
            {
              id: "T",
              arn: "ARN1",
            },
          ],
        },
      );
    });
  });
});

class SomeTarget implements IRuleTarget {
  public constructor(
    private readonly id?: string,
    private readonly resource?: IConstruct,
  ) {}

  public bind(): RuleTargetConfig {
    return {
      // TODO: TerraConstructs have no Id in RuleTargetConfig
      // id: this.id || "",
      arn: "ARN1",
      kinesisParameters: { partitionKeyPath: "partitionKeyPath" },
      targetResource: this.resource,
    };
  }
}
