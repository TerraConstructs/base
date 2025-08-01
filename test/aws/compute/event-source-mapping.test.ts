// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-lambda/test/event-source-mapping.test.ts

import { lambdaEventSourceMapping } from "@cdktf/provider-aws";
import { Testing, Token, Lazy, TerraformVariable } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Duration } from "../../../src/";
import { compute, AwsStack } from "../../../src/aws";

const gridUUID = "123e4567-e89b-12d3";
let stack: AwsStack;
let fn: compute.LambdaFunction;
beforeEach(() => {
  stack = new AwsStack(Testing.app(), `TestStack`, {
    environmentName: "Test",
    gridUUID,
    providerConfig: {
      region: "us-east-1",
    },
    gridBackendConfig: {
      address: "http://localhost:3000",
    },
  });
  fn = new compute.LambdaFunction(stack, "MyLambda", {
    handler: "index.handler",
    code: compute.Code.fromInline("exports.handler = ${handler.toString()}"),
    runtime: compute.Runtime.NODEJS_LATEST,
  });
});

describe("event source mapping", () => {
  // TODO: Revisit this test
  test.skip("verify that alias.addEventSourceMapping produces stable ids", () => {
    // GIVEN
    const alias = new compute.Alias(stack, "LiveAlias", {
      aliasName: "Live",
      function: fn,
      version: fn.version,
    });

    // WHEN
    alias.addEventSourceMapping("MyMapping", {
      eventSourceArn: "asfd",
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    expect(synthesized).toMatchSnapshot();
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     // Crucially, no ID in there that depends on the state of the Lambda
    //     LiveAliasMyMapping4E1B698B: { Type: "AWS::Lambda::EventSourceMapping" },
    //   },
    // });
  });

  test("throws if maxBatchingWindow > 300 seconds", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          maxBatchingWindow: Duration.seconds(301),
        }),
    ).toThrow(/maxBatchingWindow cannot be over 300 seconds/);
  });

  test("throws if maxConcurrency < 2 concurrent instances", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          maxConcurrency: 1,
        }),
    ).toThrow(/maxConcurrency must be between 2 and 1000 concurrent instances/);
  });

  test("throws if maxConcurrency > 1000 concurrent instances", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          maxConcurrency: 1001,
        }),
    ).toThrow(/maxConcurrency must be between 2 and 1000 concurrent instances/);
  });

  test("does not throw if maxConcurrency is a token", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          maxConcurrency: Token.asNumber({ Ref: "abc" }),
        }),
    ).not.toThrow();
  });

  test("maxConcurrency appears in stack", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      maxConcurrency: 2,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        scaling_config: {
          maximum_concurrency: 2,
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     ScalingConfig: { MaximumConcurrency: 2 },
    //   },
    // );
  });

  test("throws if maxRecordAge is below 60 seconds", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          maxRecordAge: Duration.seconds(59),
        }),
    ).toThrow(/maxRecordAge must be between 60 seconds and 7 days inclusive/);
  });

  test("throws if maxRecordAge is over 7 days", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          maxRecordAge: Duration.seconds(604801),
        }),
    ).toThrow(/maxRecordAge must be between 60 seconds and 7 days inclusive/);
  });

  test("throws if retryAttempts is negative", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          retryAttempts: -1,
        }),
    ).toThrow(/retryAttempts must be between 0 and 10000 inclusive, got -1/);
  });

  test("throws if retryAttempts is over 10000", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          retryAttempts: 10001,
        }),
    ).toThrow(/retryAttempts must be between 0 and 10000 inclusive, got 10001/);
  });

  test("accepts if retryAttempts is a token", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      retryAttempts: Lazy.numberValue({ produce: () => 100 }),
    });
  });

  test("throws if parallelizationFactor is below 1", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          parallelizationFactor: 0,
        }),
    ).toThrow(
      /parallelizationFactor must be between 1 and 10 inclusive, got 0/,
    );
  });

  test("throws if parallelizationFactor is over 10", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          parallelizationFactor: 11,
        }),
    ).toThrow(
      /parallelizationFactor must be between 1 and 10 inclusive, got 11/,
    );
  });

  test("accepts if parallelizationFactor is a token", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      parallelizationFactor: Lazy.numberValue({ produce: () => 20 }),
    });
  });

  // test("import event source mapping", () => {
  //   const stack2 = new AwsStack(Testing.app(), "Stack2", {
  //     stackName: "test-stack",
  //   });
  //   const imported = compute.EventSourceMapping.fromEventSourceMappingId(
  //     stack2,
  //     "imported",
  //     "14e0db71-5d35-4eb5-b481-8945cf9d10c2",
  //   );

  //   expect(imported.eventSourceMappingId).toEqual(
  //     "14e0db71-5d35-4eb5-b481-8945cf9d10c2",
  //   );
  //   expect(imported.stack.stackName).toEqual("test-stack");
  //   expect(
  //     imported.eventSourceMappingArn.endsWith(
  //       ":event-source-mapping:14e0db71-5d35-4eb5-b481-8945cf9d10c2",
  //     ),
  //   ).toBeTruthy();
  // });

  // test("accepts if kafkaTopic is a parameter", () => {
  //   const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
  //     type: "String",
  //   });

  //   new compute.EventSourceMapping(stack, "test", {
  //     target: fn,
  //     eventSourceArn: "",
  //     kafkaTopic: topicNameParam.stringValue,
  //   });

  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::Lambda::EventSourceMapping",
  //   //   {
  //   //     Topics: [
  //   //       {
  //   //         Ref: "TopicNameParam",
  //   //       },
  //   //     ],
  //   //   },
  //   // );
  // });

  test("throws if neither eventSourceArn nor kafkaBootstrapServers are set", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
        }),
    ).toThrow(/Either eventSourceArn or kafkaBootstrapServers must be set/);
  });

  test("throws if both eventSourceArn and kafkaBootstrapServers are set", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          eventSourceArn: "",
          kafkaBootstrapServers: [],
          target: fn,
        }),
    ).toThrow(
      /eventSourceArn and kafkaBootstrapServers are mutually exclusive/,
    );
  });

  test("throws if both kafkaBootstrapServers is set but empty", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          kafkaBootstrapServers: [],
          target: fn,
        }),
    ).toThrow(/kafkaBootStrapServers must not be empty if set/);
  });

  test("throws if kafkaConsumerGroupId is invalid", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          eventSourceArn:
            "arn:aws:kafka:us-east-1:123456789012:cluster/vpc-2priv-2pub/751d2973-a626-431c-9d4e-d7975eb44dd7-2",
          kafkaConsumerGroupId: "some invalid",
          target: fn,
        }),
    ).toThrow(
      'kafkaConsumerGroupId contains invalid characters. Allowed values are "[a-zA-Z0-9-/*:_+=.@-]"',
    );
  });

  test("throws if kafkaConsumerGroupId is too long", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          eventSourceArn:
            "arn:aws:kafka:us-east-1:123456789012:cluster/vpc-2priv-2pub/751d2973-a626-431c-9d4e-d7975eb44dd7-2",
          kafkaConsumerGroupId: "x".repeat(201),
          target: fn,
        }),
    ).toThrow(
      "kafkaConsumerGroupId must be a valid string between 1 and 200 characters",
    );
  });

  test("not throws if kafkaConsumerGroupId is empty", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          eventSourceArn:
            "arn:aws:kafka:us-east-1:123456789012:cluster/vpc-2priv-2pub/751d2973-a626-431c-9d4e-d7975eb44dd7-2",
          kafkaConsumerGroupId: "",
          target: fn,
        }),
    ).not.toThrow();
  });

  test("not throws if kafkaConsumerGroupId is token", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          eventSourceArn:
            "arn:aws:kafka:us-east-1:123456789012:cluster/vpc-2priv-2pub/751d2973-a626-431c-9d4e-d7975eb44dd7-2",
          kafkaConsumerGroupId: Lazy.stringValue({ produce: () => "test" }),
          target: fn,
        }),
    ).not.toThrow();
  });

  test("not throws if kafkaConsumerGroupId is valid for amazon managed kafka", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          eventSourceArn:
            "arn:aws:kafka:us-east-1:123456789012:cluster/vpc-2priv-2pub/751d2973-a626-431c-9d4e-d7975eb44dd7-2",
          kafkaConsumerGroupId: "someValidConsumerGroupId",
          target: fn,
        }),
    ).not.toThrow();
  });

  test("not throws if kafkaConsumerGroupId is valid for self managed kafka", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          kafkaBootstrapServers: ["kafka-broker-1:9092", "kafka-broker-2:9092"],
          kafkaConsumerGroupId: "someValidConsumerGroupId",
          target: fn,
        }),
    ).not.toThrow();
  });

  test("eventSourceArn appears in stack", () => {
    const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
      type: "String",
    });

    const eventSourceArn = "some-arn";

    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: eventSourceArn,
      kafkaTopic: topicNameParam.stringValue,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        event_source_arn: eventSourceArn,
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     EventSourceArn: eventSourceArn,
    //   },
    // );
  });

  test("filter with one pattern", () => {
    const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
      type: "String",
    });

    const eventSourceArn = "some-arn";

    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: eventSourceArn,
      kafkaTopic: topicNameParam.stringValue,
      filters: [
        compute.FilterCriteria.filter({
          numericEquals: compute.FilterRule.isEqual(1),
        }),
      ],
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        filter_criteria: {
          filter: [
            {
              pattern: '{"numericEquals":[{"numeric":["=",1]}]}',
            },
          ],
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     FilterCriteria: {
    //       Filters: [
    //         {
    //           Pattern: '{"numericEquals":[{"numeric":["=",1]}]}',
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  test("filter with more than one pattern", () => {
    const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
      type: "String",
    });

    const eventSourceArn = "some-arn";

    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: eventSourceArn,
      kafkaTopic: topicNameParam.stringValue,
      filters: [
        compute.FilterCriteria.filter({
          orFilter: compute.FilterRule.or("one", "two"),
          stringEquals: compute.FilterRule.isEqual("test"),
        }),
        compute.FilterCriteria.filter({
          numericEquals: compute.FilterRule.isEqual(1),
        }),
      ],
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        filter_criteria: {
          filter: [
            {
              pattern: '{"orFilter":["one","two"],"stringEquals":["test"]}',
            },
            {
              pattern: '{"numericEquals":[{"numeric":["=",1]}]}',
            },
          ],
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     FilterCriteria: {
    //       Filters: [
    //         {
    //           Pattern: '{"orFilter":["one","two"],"stringEquals":["test"]}',
    //         },
    //         {
    //           Pattern: '{"numericEquals":[{"numeric":["=",1]}]}',
    //         },
    //       ],
    //     },
    //   },
    // );
  });

  // test("adding filter criteria encryption", () => {
  //   const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
  //     type: "String",
  //   });

  //   let eventSourceArn = "some-arn";

  //   const myKey = encryption.Key.fromKeyArn(
  //     stack,
  //     "SourceBucketEncryptionKey",
  //     "arn:aws:kms:us-east-1:123456789012:key/<key-id>",
  //   );

  //   // WHEN
  //   new compute.EventSourceMapping(stack, "test", {
  //     target: fn,
  //     eventSourceArn: eventSourceArn,
  //     kafkaTopic: topicNameParam.stringValue,
  //     filters: [
  //       compute.FilterCriteria.filter({
  //         orFilter: compute.FilterRule.or("one", "two"),
  //         stringEquals: compute.FilterRule.isEqual("test"),
  //       }),
  //       compute.FilterCriteria.filter({
  //         numericEquals: compute.FilterRule.isEqual(1),
  //       }),
  //     ],
  //     filterEncryption: myKey,
  //   });

  //   // THEN
  //   // Do prepare run to resolve all Terraform resources
  //   stack.prepareStack();
  //   const synthesized = Testing.synth(stack);
  //   expect(synthesized).toMatchSnapshot();
  //   // Template.fromStack(stack).hasResourceProperties(
  //   //   "AWS::Lambda::EventSourceMapping",
  //   //   {
  //   //     FilterCriteria: {
  //   //       Filters: [
  //   //         {
  //   //           Pattern: '{"orFilter":["one","two"],"stringEquals":["test"]}',
  //   //         },
  //   //         {
  //   //           Pattern: '{"numericEquals":[{"numeric":["=",1]}]}',
  //   //         },
  //   //       ],
  //   //     },
  //   //     KmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/<key-id>",
  //   //   },
  //   // );
  // });

  // test("adding filter criteria encryption without filter criteria", () => {
  //   const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
  //     type: "String",
  //   });

  //   let eventSourceArn = "some-arn";

  //   const myKey = encryption.Key.fromKeyArn(
  //     stack,
  //     "SourceBucketEncryptionKey",
  //     "arn:aws:kms:us-east-1:123456789012:key/<key-id>",
  //   );

  //   expect(
  //     () =>
  //       new compute.EventSourceMapping(stack, "test", {
  //         target: fn,
  //         eventSourceArn: eventSourceArn,
  //         kafkaTopic: topicNameParam.stringValue,
  //         filterEncryption: myKey,
  //       }),
  //   ).toThrow(
  //     /filter criteria must be provided to enable setting filter criteria encryption/,
  //   );
  // });

  test("kafkaBootstrapServers appears in stack", () => {
    const topicNameParam = new TerraformVariable(stack, "TopicNameParam", {
      type: "String",
    });

    const kafkaBootstrapServers = ["kafka-broker.example.com:9092"];
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      kafkaBootstrapServers,
      kafkaTopic: topicNameParam.stringValue,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        self_managed_event_source: {
          endpoints: {
            KAFKA_BOOTSTRAP_SERVERS: kafkaBootstrapServers.join(","),
          },
        },
        topics: ["${var.TopicNameParam}"],
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     SelfManagedEventSource: {
    //       Endpoints: { KafkaBootstrapServers: kafkaBootstrapServers },
    //     },
    //   },
    // );
  });

  test("throws if tumblingWindow > 900 seconds", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          tumblingWindow: Duration.seconds(901),
        }),
    ).toThrow(/tumblingWindow cannot be over 900 seconds/);
  });

  test("accepts if tumblingWindow is a token", () => {
    const lazyDuration = Duration.seconds(
      Lazy.numberValue({ produce: () => 60 }),
    );

    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      tumblingWindow: lazyDuration,
    });
  });

  test("transforms reportBatchItemFailures into functionResponseTypes with ReportBatchItemFailures", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      reportBatchItemFailures: true,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        function_response_types: ["ReportBatchItemFailures"],
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     FunctionResponseTypes: ["ReportBatchItemFailures"],
    //   },
    // );
  });

  test("transforms missing reportBatchItemFailures into absent FunctionResponseTypes", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).not.toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        function_response_types: expect.anything(),
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   expect.not.objectContaining({
    //     FunctionResponseTypes: expect.anything(),
    //   }),
    // );
  });

  test("transforms reportBatchItemFailures false into absent FunctionResponseTypes", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      reportBatchItemFailures: false,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).not.toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        function_response_types: expect.anything(),
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   expect.not.objectContaining({
    //     FunctionResponseTypes: expect.anything(),
    //   }),
    // );
  });

  test("AT_TIMESTAMP starting position", () => {
    new compute.EventSourceMapping(stack, "test", {
      target: fn,
      eventSourceArn: "",
      startingPosition: compute.StartingPosition.AT_TIMESTAMP,
      startingPositionTimestamp: 1640995200,
    });

    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      lambdaEventSourceMapping.LambdaEventSourceMapping,
      {
        starting_position: "AT_TIMESTAMP",
        // A timestamp in RFC3339 format of the data
        // https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/resources/lambda_event_source_mapping#starting_position_timestamp
        starting_position_timestamp: "2022-01-01T00:00:00.000Z",
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::Lambda::EventSourceMapping",
    //   {
    //     StartingPosition: "AT_TIMESTAMP",
    //     StartingPositionTimestamp: 1640995200,
    //   },
    // );
  });

  test("startingPositionTimestamp missing throws error", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          startingPosition: compute.StartingPosition.AT_TIMESTAMP,
        }),
    ).toThrow(
      /startingPositionTimestamp must be provided when startingPosition is AT_TIMESTAMP/,
    );
  });

  test("startingPositionTimestamp without AT_TIMESTAMP throws error", () => {
    expect(
      () =>
        new compute.EventSourceMapping(stack, "test", {
          target: fn,
          eventSourceArn: "",
          startingPosition: compute.StartingPosition.LATEST,
          startingPositionTimestamp: 1640995200,
        }),
    ).toThrow(
      /startingPositionTimestamp can only be used when startingPosition is AT_TIMESTAMP/,
    );
  });
});
