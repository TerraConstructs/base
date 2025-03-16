// https://github.com/aws/aws-cdk/blob/318eae6c9eca456e0c34ed21855dad9d2bfa2a0f/packages/aws-cdk-lib/aws-events/test/event-bus.test.ts

import {
  cloudwatchEventBus,
  cloudwatchEventArchive,
  cloudwatchEventBusPolicy,
  kmsKeyPolicy,
  dataAwsIamPolicyDocument,
  kmsKey,
  iamRolePolicy,
} from "@cdktf/provider-aws";
import {
  Lazy,
  TerraformMetaArguments,
  TerraformOutput,
  TerraformResource,
  Testing,
} from "cdktf";
import { Construct } from "constructs";
import { AwsStack, Arn } from "../../../src/aws";
import * as kms from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import * as sqs from "../../../src/aws/notify";
import "cdktf/lib/testing/adapters/jest";
import { EventBus } from "../../../src/aws/notify/event-bus";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("event bus", () => {
  let stack: AwsStack;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("default event bus", () => {
    // GIVEN

    // WHEN
    new EventBus(stack, "Bus");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        // name: "Bus", // TODO: BUG - This should be the name of the event bus
        name: "TestStackBus54CCAD7F",
      },
    );
  });

  test("default event bus with empty props object", () => {
    // GIVEN

    // WHEN
    new EventBus(stack, "Bus", {});

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        // name: "Bus", // TODO: BUG - This should be the name of the event bus
        name: "TestStackBus54CCAD7F",
      },
    );
  });

  test("named event bus", () => {
    // GIVEN

    // WHEN
    new EventBus(stack, "Bus", {
      eventBusName: "myEventBus",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        name: "myEventBus",
      },
    );
  });

  // // TODO: Event Bus Description is not supported by terraform-provider-aws
  // test("event bus with description", () => {
  //   // GIVEN

  //   // WHEN
  //   new EventBus(stack, "myEventBus", {
  //     description: "myEventBusDescription",
  //   });

  //   // THEN
  //   Template.synth(stack).toHaveResourceWithProperties(
  //     cloudwatchEventBus.CloudwatchEventBus,
  //     {
  //       description: "myEventBusDescription",
  //     },
  //   );
  // });

  test("partner event bus", () => {
    // GIVEN

    // WHEN
    new EventBus(stack, "Bus", {
      eventSourceName: "aws.partner/PartnerName/acct1/repo1",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        name: "aws.partner/PartnerName/acct1/repo1",
        event_source_name: "aws.partner/PartnerName/acct1/repo1",
      },
    );
  });

  test("imported event bus", () => {
    const eventBus = new EventBus(stack, "Bus");

    const importEB = EventBus.fromEventBusArn(
      stack,
      "ImportBus",
      eventBus.eventBusArn,
    );

    // WHEN
    new TestResource(stack, "Res", {
      properties: {
        EventBusArn1: eventBus.eventBusArn,
        EventBusArn2: importEB.eventBusArn,
      },
    });

    Template.synth(stack).toHaveResourceWithProperties(TestResource, {
      EventBusArn1: "${aws_cloudwatch_event_bus.Bus_EA82B648.arn}",
      EventBusArn2: "${aws_cloudwatch_event_bus.Bus_EA82B648.arn}",
    });
  });

  test("imported event bus from name", () => {
    const eventBus = new EventBus(stack, "Bus", {
      eventBusName: "test-bus-to-import-by-name",
    });

    const importEB = EventBus.fromEventBusName(
      stack,
      "ImportBus",
      eventBus.eventBusName,
    );

    // WHEN
    expect(stack.resolve(eventBus.eventBusName)).toEqual(
      stack.resolve(importEB.eventBusName),
    );
  });

  test("same account imported event bus has right resource env", () => {
    const eventBus = new EventBus(stack, "Bus");

    const importEB = EventBus.fromEventBusArn(
      stack,
      "ImportBus",
      eventBus.eventBusArn,
    );

    // WHEN
    expect(stack.resolve(importEB.env.account)).toEqual(
      '${element(split(":", aws_cloudwatch_event_bus.Bus_EA82B648.arn), 4)}',
    );
    expect(stack.resolve(importEB.env.region)).toEqual(
      '${element(split(":", aws_cloudwatch_event_bus.Bus_EA82B648.arn), 3)}',
    );
  });

  test("cross account imported event bus has right resource env", () => {
    const arnParts = {
      resource: "bus",
      service: "events",
      account: "myAccount",
      region: "us-west-1",
    };

    const arn = Arn.format(arnParts, stack);

    const importEB = EventBus.fromEventBusArn(stack, "ImportBus", arn);

    // WHEN
    expect(importEB.env.account).toEqual(arnParts.account);
    expect(importEB.env.region).toEqual(arnParts.region);
  });

  test("can get bus name", () => {
    // GIVEN
    const bus = new EventBus(stack, "Bus", {
      eventBusName: "myEventBus",
    });

    // WHEN
    new TestResource(stack, "Res", {
      properties: {
        EventBusName: bus.eventBusName,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(TestResource, {
      EventBusName: "${aws_cloudwatch_event_bus.Bus_EA82B648.name}",
    });
  });

  test("can get bus arn", () => {
    // GIVEN
    const bus = new EventBus(stack, "Bus", {
      eventBusName: "myEventBus",
    });

    // WHEN
    new TestResource(stack, "Res", {
      properties: {
        EventBusArn: bus.eventBusArn,
      },
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(TestResource, {
      EventBusArn: "${aws_cloudwatch_event_bus.Bus_EA82B648.arn}",
    });
  });

  test("event bus name cannot be default", () => {
    // GIVEN

    // WHEN
    const createInvalidBus = () =>
      new EventBus(stack, "Bus", {
        eventBusName: "default",
      });

    // THEN
    expect(() => {
      createInvalidBus();
    }).toThrow(/'eventBusName' must not be 'default'/);
  });

  test("event bus name cannot contain slash", () => {
    // GIVEN

    // WHEN
    const createInvalidBus = () =>
      new EventBus(stack, "Bus", {
        eventBusName: "my/bus",
      });

    // THEN
    expect(() => {
      createInvalidBus();
    }).toThrow(/'eventBusName' must not contain '\/'/);
  });

  test("event bus cannot have name and source name", () => {
    // GIVEN

    // WHEN
    const createInvalidBus = () =>
      new EventBus(stack, "Bus", {
        eventBusName: "myBus",
        eventSourceName: "myBus",
      });

    // THEN
    expect(() => {
      createInvalidBus();
    }).toThrow(/'eventBusName' and 'eventSourceName' cannot both be provided/);
  });

  test("event bus name cannot be empty string", () => {
    // GIVEN

    // WHEN
    const createInvalidBus = () =>
      new EventBus(stack, "Bus", {
        eventBusName: "",
      });

    // THEN
    expect(() => {
      createInvalidBus();
    }).toThrow(/'eventBusName' must satisfy: /);
  });

  test("does not throw if eventBusName is a token", () => {
    // GIVEN

    // WHEN / THEN
    expect(
      () =>
        new EventBus(stack, "EventBus", {
          eventBusName: Lazy.stringValue({
            produce: () => "Example",
          }),
        }),
    ).not.toThrow();
  });

  test("event bus source name must follow pattern", () => {
    // GIVEN

    // WHEN
    const createInvalidBus = () =>
      new EventBus(stack, "Bus", {
        eventSourceName: "invalid-partner",
      });

    // THEN
    expect(() => {
      createInvalidBus();
    }).toThrow(/'eventSourceName' must satisfy: \/\^aws/);
  });

  test("does not throw if eventSourceName is a token", () => {
    // GIVEN

    // WHEN / THEN
    expect(
      () =>
        new EventBus(stack, "EventBus", {
          eventSourceName: Lazy.stringValue({
            produce: () => "Example",
          }),
        }),
    ).not.toThrow();
  });

  test("event bus source name cannot be empty string", () => {
    // GIVEN

    // WHEN
    const createInvalidBus = () =>
      new EventBus(stack, "Bus", {
        eventSourceName: "",
      });

    // THEN
    expect(() => {
      createInvalidBus();
    }).toThrow(/'eventSourceName' must satisfy: /);
  });

  // TODO: Event Bus Description is not supported by terraform-provider-aws
  // test("event bus description cannot be too long", () => {
  //   // GIVEN
  //   const tooLongDescription = "a".repeat(513);

  //   // WHEN / THEN
  //   expect(() => {
  //     new EventBus(stack, "EventBusWithTooLongDescription", {
  //       description: tooLongDescription,
  //     });
  //   }).toThrow(
  //     "description must be less than or equal to 512 characters, got 513",
  //   );
  // });

  // DEPRECATED
  test("can grant PutEvents", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    EventBus.grantPutEvents(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
  });

  test("can grant PutEvents using grantAllPutEvents", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // WHEN
    EventBus.grantAllPutEvents(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
  });

  test("can grant PutEvents to a specific event bus", () => {
    // GIVEN
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    const eventBus = new EventBus(stack, "EventBus");

    // WHEN
    eventBus.grantPutEventsTo(role);

    // THEN
    const t = new Template(stack);
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["events:PutEvents"],
            effect: "Allow",
            resources: [stack.resolve(eventBus.eventBusArn)],
          },
        ],
      },
    );
    t.expect.toHaveResourceWithProperties(iamRolePolicy.IamRolePolicy, {
      name: "TestStackRoleDefaultPolicyC86B8D55",
      policy:
        "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
      role: stack.resolve(role.roleName),
    });
  });

  test("can archive events", () => {
    // GIVEN

    // WHEN
    const event = new EventBus(stack, "Bus");

    event.archive("MyArchive", {
      eventPattern: {
        account: [stack.account],
      },
      archiveName: "MyArchive",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        // name: "Bus", // TODO: BUG - This should be the name of the event bus
        name: "TestStackBus54CCAD7F",
      },
    );

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchEventArchive.CloudwatchEventArchive,
      {
        description:
          "Event Archive for ${aws_cloudwatch_event_bus.Bus_EA82B648.name} Event Bus",
        event_pattern: {
          account: ["${data.aws_caller_identity.CallerIdentity.account_id}"],
        },
        event_source_arn: stack.resolve(event.eventBusArn), // "${aws_cloudwatch_event_bus.Bus_EA82B648.arn}",
        name: "MyArchive",
        retention_days: 0,
      },
    );
  });

  test("can archive events from an imported EventBus", () => {
    // GIVEN

    // WHEN
    const bus = new EventBus(stack, "Bus");

    const importedBus = EventBus.fromEventBusArn(
      stack,
      "ImportedBus",
      bus.eventBusArn,
    );

    importedBus.archive("MyArchive", {
      eventPattern: {
        account: [stack.account],
      },
      archiveName: "MyArchive",
    });

    // THEN
    const t = new Template(stack);

    t.expect.toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        // name: "Bus", // TODO: BUG - This should be the name of the event bus
        name: "TestStackBus54CCAD7F",
      },
    );

    t.expect.toHaveResourceWithProperties(
      cloudwatchEventArchive.CloudwatchEventArchive,
      {
        description:
          'Event Archive for ${element(split("/", element(split(":", aws_cloudwatch_event_bus.Bus_EA82B648.arn), 5)), 1)} Event Bus',
        event_pattern: {
          account: ["${data.aws_caller_identity.CallerIdentity.account_id}"],
        },
        event_source_arn: stack.resolve(bus.eventBusArn),
        name: "MyArchive",
        retention_days: 0,
      },
    );
  });

  test("cross account event bus uses generated physical name", () => {
    // GIVEN
    // env: {
    //   account: "11111111111",
    //   region: "us-east-1",
    // },
    const stack1 = new AwsStack(Testing.app(), "Stack1", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    // env: {
    //   account: "22222222222",
    //   region: "us-east-1",
    // },
    const stack2 = new AwsStack(Testing.app(), "Stack2", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    // WHEN
    const bus1 = new EventBus(stack1, "Bus", {
      eventBusName: Lazy.stringValue({
        produce: () => "stack1bus",
      }), // PhysicalName.GENERATE_IF_NEEDED,
    });

    new TerraformOutput(stack2, "BusName", { value: bus1.eventBusName });

    // THEN
    Template.synth(stack1).toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        name: "stack1bus",
        // Name: "stack1stack1busca19bdf8ab2e51b62a5a",
      },
    );
  });

  test("can add one event bus policy", () => {
    // GIVEN
    const bus = new EventBus(stack, "Bus");

    // WHEN
    bus.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal("111111111111111")],
        actions: ["events:PutEvents"],
        sid: "123",
        resources: [bus.eventBusArn],
      }),
    );

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      cloudwatchEventBusPolicy.CloudwatchEventBusPolicy,
      {
        event_bus_name: "${aws_cloudwatch_event_bus.Bus_EA82B648.name}",
        policy:
          "${data.aws_iam_policy_document.Bus_Policy_Document_ABBD772C.json}",
      },
    );
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            sid: "123",
            actions: ["events:PutEvents"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::111111111111111:root",
                ],
                type: "AWS",
              },
            ],
            resources: [stack.resolve(bus.eventBusArn)],
          },
        ],
      },
    );
  });

  // TODO: TerraConstructs aggregates all statements in a single policy document...
  test.skip("can add more than one event bus policy", () => {
    // GIVEN
    const bus = new EventBus(stack, "Bus");

    const statement1 = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ArnPrincipal("arn")],
      actions: ["events:PutEvents"],
      sid: "statement1",
      resources: [bus.eventBusArn],
    });

    const statement2 = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ArnPrincipal("arn")],
      actions: ["events:DeleteRule"],
      sid: "statement2",
      resources: [bus.eventBusArn],
    });

    // WHEN
    const add1 = bus.addToResourcePolicy(statement1);
    const add2 = bus.addToResourcePolicy(statement2);

    // THEN
    expect(add1.statementAdded).toBe(true);
    expect(add2.statementAdded).toBe(true);
    const t = new Template(stack);
    t.resourceCountIs(cloudwatchEventBusPolicy.CloudwatchEventBusPolicy, 2);
  });

  // TODO: TerraConstructs does not error when sid is not provided
  test.skip("Event Bus policy statements must have a sid", () => {
    // GIVEN
    const bus = new EventBus(stack, "Bus");

    // THEN
    expect(() =>
      bus.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal("arn")],
          actions: ["events:PutEvents"],
        }),
      ),
    ).toThrow("Event Bus policy statements must have a sid");
  });

  // TODO: Event Bus DQL is not supported by terraform-provider-aws
  // test("set dead letter queue", () => {
  //   const dlq = new sqs.Queue(stack, "DLQ");
  //   new EventBus(stack, "Bus", {
  //     deadLetterQueue: dlq,
  //   });

  //   Template.synth(stack).toHaveResourceWithProperties(
  //     cloudwatchEventBus.CloudwatchEventBus,
  //     {
  //       DeadLetterConfig: {
  //         Arn: {
  //           "Fn::GetAtt": ["DLQ581697C4", "Arn"],
  //         },
  //       },
  //     },
  //   );
  // });

  test("Event Bus with a customer managed key", () => {
    // GIVEN
    const key = new kms.Key(stack, "Key");

    // WHEN
    const eventBus = new EventBus(stack, "Bus", {
      kmsKey: key,
    });

    // THEN
    const t = new Template(stack);
    t.expect.toHaveResourceWithProperties(
      cloudwatchEventBus.CloudwatchEventBus,
      {
        kms_key_identifier: stack.resolve(key.keyArn),
      },
    );

    t.expect.toHaveResourceWithProperties(kmsKey.KmsKey, {
      policy: "${data.aws_iam_policy_document.Key_Policy_48E51E45.json}",
    });
    t.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kms:*"],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
                ],
                type: "AWS",
              },
            ],
            resources: ["*"],
          },
          {
            actions: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
            condition: [
              {
                test: "StringEquals",
                values: [
                  "${data.aws_caller_identity.CallerIdentity.account_id}",
                ],
                variable: "aws:SourceAccount",
              },
              {
                test: "StringEquals",
                values: [
                  "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:event-bus/TestStackBus54CCAD7F",
                ],
                variable: "aws:SourceArn",
              },
              {
                test: "StringEquals",
                values: [
                  "arn:${data.aws_partition.Partitition.partition}:events:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:event-bus/TestStackBus54CCAD7F",
                ],
                variable: "kms:EncryptionContext:aws:events:event-bus:arn",
              },
            ],
            effect: "Allow",
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_events.name}",
                ],
                type: "Service",
              },
            ],
            resources: ["*"],
          },
        ],
      },
    );
  });
});

export enum TestProviderMetadata {
  TYPE = "test",
}
export interface TestResourceConfig extends TerraformMetaArguments {
  readonly properties?: { [name: string]: any };
}
export class TestResource extends TerraformResource {
  public static readonly tfResourceType: string = "test_resource";

  /**
   * AWS CloudFormation resource properties.
   *
   * This object is returned via cfnProperties
   * @internal
   */
  protected readonly _properties: any;
  constructor(scope: Construct, id: string, config: TestResourceConfig) {
    super(scope, id, {
      terraformResourceType: "test_resource",
      terraformGeneratorMetadata: {
        providerName: TestProviderMetadata.TYPE,
        providerVersionConstraint: "~> 2.0",
      },
      provider: config.provider,
      dependsOn: config.dependsOn,
      count: config.count,
      lifecycle: config.lifecycle,
      provisioners: config.provisioners,
      forEach: config.forEach,
    });
    this._properties = config.properties || {};
  }

  public get names(): string[] {
    return this.getListAttribute("names");
  }

  protected synthesizeAttributes(): { [name: string]: any } {
    return this._properties;
  }
}
