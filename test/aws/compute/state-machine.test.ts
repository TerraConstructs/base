import { dataAwsIamPolicyDocument, sfnStateMachine } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { FakeTask } from "./private/fake-task";
import { storage, iam, compute, AwsStack } from "../../../src/aws";
// import * as task from "../../../src/aws/compute/tasks";
// import * as kms from "../../aws-kms";
// import * as logs from "../../aws-logs";

const gridUUID = "123e4567-e89b-12d3";

describe("State Machine", () => {
  let stack: AwsStack;
  beforeEach(() => {
    // GIVEN
    const app = Testing.app();
    stack = new AwsStack(app, `TestStack`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });
  });
  test("Instantiate Default State Machine with deprecated definition", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     StateMachineName: "MyStateMachine",
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //   },
    // );
  });

  test("Instantiate Default State Machine with string definition", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromString(
        '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
      ),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     StateMachineName: "MyStateMachine",
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //   },
    // );
  });

  // TODO: `definition` field was never ported to terraconstructs
  // test("Instantiate fails with old and new definition specified", () => {
  //   // FAIL
  //   expect(() => {
  //     new compute.StateMachine(stack, "MyStateMachine", {
  //       stateMachineName: "MyStateMachine",
  //       definitionBody: compute.DefinitionBody.fromChainable(
  //         compute.Chain.start(new compute.Pass(stack, "Pass2")),
  //       ),
  //     });
  //   }).toThrow(
  //     "Cannot specify definition and definitionBody at the same time",
  //   );
  // }),
  // test("Instantiate fails with no definition specified", () => {
  //   // FAIL
  //   expect(() => {
  //     new compute.StateMachine(stack, "MyStateMachine", {
  //       stateMachineName: "MyStateMachine",
  //     });
  //   }).toThrow("You need to specify either definition or definitionBody");
  // }),
  test("Instantiate Default State Machine", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        name: "MyStateMachine",
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     StateMachineName: "MyStateMachine",
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //   },
    // );
  });

  test("Instantiate Standard State Machine", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
      stateMachineType: compute.StateMachineType.STANDARD,
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        name: "MyStateMachine",
        type: "STANDARD",
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     StateMachineName: "MyStateMachine",
    //     StateMachineType: "STANDARD",
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //   },
    // );
  });

  test("Instantiate Standard State Machine With Comment", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
      stateMachineType: compute.StateMachineType.STANDARD,
      comment: "zorp",
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        name: "MyStateMachine",
        type: "STANDARD",
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}},"Comment":"zorp"}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     StateMachineName: "MyStateMachine",
    //     StateMachineType: "STANDARD",
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}},"Comment":"zorp"}',
    //   },
    // );
  });

  test("Instantiate Express State Machine", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
      stateMachineType: compute.StateMachineType.EXPRESS,
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        name: "MyStateMachine",
        type: "EXPRESS",
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     StateMachineName: "MyStateMachine",
    //     StateMachineType: "EXPRESS",
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //   },
    // );
  });

  test("Instantiate State Machine With Distributed Map State", () => {
    // WHEN
    const map = new compute.DistributedMap(stack, "Map State");
    map.itemProcessor(new compute.Pass(stack, "Pass"));
    new compute.StateMachine(stack, "MyStateMachine", {
      stateMachineName: "MyStateMachine",
      definitionBody: compute.DefinitionBody.fromChainable(map),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["states:StartExecution"],
            effect: "Allow",
            resources: ["${aws_sfn_state_machine.MyStateMachine_6C968CA5.arn}"],
          },
          {
            actions: ["states:DescribeExecution", "states:StopExecution"],
            effect: "Allow",
            resources: [
              "${aws_sfn_state_machine.MyStateMachine_6C968CA5.arn}:*",
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: "states:StartExecution",
    //         Effect: "Allow",
    //         Resource: { Ref: "MyStateMachine6C968CA5" },
    //       },
    //       {
    //         Action: ["states:DescribeExecution", "states:StopExecution"],
    //         Effect: "Allow",
    //         Resource: {
    //           "Fn::Join": ["", [{ Ref: "MyStateMachine6C968CA5" }, ":*"]],
    //         },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   PolicyName: "MyStateMachineDistributedMapPolicy11E47E72",
    //   Roles: [
    //     {
    //       Ref: "MyStateMachineRoleD59FFEBC",
    //     },
    //   ],
    // });
  });

  test("State Machine with invalid name", () => {
    // WHEN
    const createStateMachine = (name: string) => {
      new compute.StateMachine(stack, name + "StateMachine", {
        stateMachineName: name,
        definitionBody: compute.DefinitionBody.fromChainable(
          compute.Chain.start(new compute.Pass(stack, name + "Pass")),
        ),
        stateMachineType: compute.StateMachineType.EXPRESS,
      });
    };

    // A name prefix is generated by the CDK, so this isn't throwing for our implementation
    // const tooShortName = "";

    const tooLongName = "M".repeat(81);
    const invalidCharactersName = "*";

    // THEN
    // expect(() => {
    //   createStateMachine(tooShortName);
    // }).toThrow(
    //   `State Machine name must be between 1 and 80 characters. Received: ${tooShortName}`,
    // );

    expect(() => {
      createStateMachine(tooLongName);
    }).toThrow(
      `State Machine name must be between 1 and 80 characters. Received: ${tooLongName}`,
    );

    expect(() => {
      createStateMachine(invalidCharactersName);
    }).toThrow(
      `State Machine name must match "^[a-z0-9+!@.()-=_']+$/i". Received: ${invalidCharactersName}`,
    );
  });

  test("State Machine with valid name", () => {
    const newStateMachine = new compute.StateMachine(
      stack,
      "dummyStateMachineToken",
      {
        definitionBody: compute.DefinitionBody.fromChainable(
          compute.Chain.start(
            new compute.Pass(stack, "dummyStateMachineTokenPass"),
          ),
        ),
      },
    );

    // WHEN
    const nameContainingToken = newStateMachine.stateMachineName + "-Name";
    const validName = "AWS-Stepfunctions_Name.Test(@aws-cdk+)!='1'";

    // THEN
    expect(() => {
      new compute.StateMachine(stack, "TokenTest-StateMachine", {
        stateMachineName: nameContainingToken,
        definitionBody: compute.DefinitionBody.fromChainable(
          compute.Chain.start(
            new compute.Pass(stack, "TokenTest-StateMachinePass"),
          ),
        ),
        stateMachineType: compute.StateMachineType.EXPRESS,
      });
    }).not.toThrow();

    expect(() => {
      new compute.StateMachine(stack, "ValidNameTest-StateMachine", {
        stateMachineName: validName,
        definitionBody: compute.DefinitionBody.fromChainable(
          compute.Chain.start(
            new compute.Pass(stack, "ValidNameTest-StateMachinePass"),
          ),
        ),
        stateMachineType: compute.StateMachineType.EXPRESS,
      });
    }).not.toThrow();
  });

  // TODO: Add logging support
  // test("log configuration", () => {
  //   // WHEN
  //   const logGroup = new logs.LogGroup(stack, "MyLogGroup");

  //   new compute.StateMachine(stack, "MyStateMachine", {
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       compute.Chain.start(new compute.Pass(stack, "Pass")),
  //     ),
  //     logs: {
  //       destination: logGroup,
  //       level: compute.LogLevel.FATAL,
  //       includeExecutionData: false,
  //     },
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachine",
  //     {
  //       DefinitionString:
  //         '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
  //       LoggingConfiguration: {
  //         Destinations: [
  //           {
  //             CloudWatchLogsLogGroup: {
  //               LogGroupArn: {
  //                 "Fn::GetAtt": ["MyLogGroup5C0DAD85", "Arn"],
  //               },
  //             },
  //           },
  //         ],
  //         IncludeExecutionData: false,
  //         Level: "FATAL",
  //       },
  //     },
  //   );

  //   Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //     PolicyDocument: {
  //       Statement: [
  //         {
  //           Action: [
  //             "logs:CreateLogDelivery",
  //             "logs:GetLogDelivery",
  //             "logs:UpdateLogDelivery",
  //             "logs:DeleteLogDelivery",
  //             "logs:ListLogDeliveries",
  //             "logs:PutResourcePolicy",
  //             "logs:DescribeResourcePolicies",
  //             "logs:DescribeLogGroups",
  //           ],
  //           Effect: "Allow",
  //           Resource: "*",
  //         },
  //       ],
  //       Version: "2012-10-17",
  //     },
  //     PolicyName: "MyStateMachineRoleDefaultPolicyE468EB18",
  //     Roles: [
  //       {
  //         Ref: "MyStateMachineRoleD59FFEBC",
  //       },
  //     ],
  //   });
  // });

  test("tracing configuration", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
      tracingEnabled: true,
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
        tracing_configuration: {
          enabled: true,
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //     TracingConfiguration: {
    //       Enabled: true,
    //     },
    //   },
    // );

    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           "xray:PutTraceSegments",
    //           "xray:PutTelemetryRecords",
    //           "xray:GetSamplingRules",
    //           "xray:GetSamplingTargets",
    //         ],
    //         Effect: "Allow",
    //         Resource: "*",
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   PolicyName: "MyStateMachineRoleDefaultPolicyE468EB18",
    //   Roles: [
    //     {
    //       Ref: "MyStateMachineRoleD59FFEBC",
    //     },
    //   ],
    // });
  });

  test("disable tracing configuration", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
      tracingEnabled: false,
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();

    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        definition:
          '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
        tracing_configuration: {
          enabled: false,
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     DefinitionString:
    //       '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
    //     TracingConfiguration: {
    //       Enabled: false,
    //     },
    //   },
    // );
  });

  test("grant access", () => {
    // WHEN
    const sm = new compute.StateMachine(stack, "MyStateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        compute.Chain.start(new compute.Pass(stack, "Pass")),
      ),
    });
    const bucket = new storage.Bucket(stack, "MyBucket");
    bucket.grantRead(sm);

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["s3:GetObject*", "s3:GetBucket*", "s3:List*"],
            effect: "Allow",
            resources: [
              "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
              "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
            ],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ["s3:GetObject*", "s3:GetBucket*", "s3:List*"],
    //         Effect: "Allow",
    //         Resource: [
    //           {
    //             "Fn::GetAtt": ["MyBucketF68F3FF0", "Arn"],
    //           },
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 {
    //                   "Fn::GetAtt": ["MyBucketF68F3FF0", "Arn"],
    //                 },
    //                 "/*",
    //               ],
    //             ],
    //           },
    //         ],
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   PolicyName: "MyStateMachineRoleDefaultPolicyE468EB18",
    //   Roles: [
    //     {
    //       Ref: "MyStateMachineRoleD59FFEBC",
    //     },
    //   ],
    // });
  });

  // test("Instantiate a State Machine with a task assuming a literal roleArn (cross-account)", () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stateMachineStack = new cdk.Stack(app, "StateMachineStack", {
  //     env: { account: "123456789" },
  //   });
  //   const roleStack = new cdk.Stack(app, "RoleStack", {
  //     env: { account: "987654321" },
  //   });
  //   const role = iam.Role.fromRoleName(roleStack, "Role", "example-role");

  //   // WHEN
  //   new compute.StateMachine(stateMachineStack, "MyStateMachine", {
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       new FakeTask(stateMachineStack, "fakeTask", {
  //         credentials: { role: compute.TaskRole.fromRole(role) },
  //       }),
  //     ),
  //   });

  //   // THEN
  //   Template.fromStack(stateMachineStack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachine",
  //     {
  //       DefinitionString: {
  //         "Fn::Join": [
  //           "",
  //           [
  //             '{"StartAt":"fakeTask","States":{"fakeTask":{"End":true,"Type":"Task","Credentials":{"RoleArn":"arn:',
  //             {
  //               Ref: "AWS::Partition",
  //             },
  //             ':iam::987654321:role/example-role"},"Resource":"my-resource","Parameters":{"MyParameter":"myParameter"}}}}',
  //           ],
  //         ],
  //       },
  //     },
  //   );

  //   Template.fromStack(stateMachineStack).hasResourceProperties(
  //     "AWS::IAM::Policy",
  //     {
  //       PolicyDocument: {
  //         Statement: [
  //           {
  //             Effect: "Allow",
  //             Action: "sts:AssumeRole",
  //             Resource: {
  //               "Fn::Join": [
  //                 "",
  //                 [
  //                   "arn:",
  //                   {
  //                     Ref: "AWS::Partition",
  //                   },
  //                   ":iam::987654321:role/example-role",
  //                 ],
  //               ],
  //             },
  //           },
  //         ],
  //         Version: "2012-10-17",
  //       },
  //       PolicyName: "MyStateMachineRoleDefaultPolicyE468EB18",
  //       Roles: [
  //         {
  //           Ref: "MyStateMachineRoleD59FFEBC",
  //         },
  //       ],
  //     },
  //   );
  // });

  test("Instantiate a State Machine with a task assuming a literal roleArn (same-account)", () => {
    // WHEN
    const role = iam.Role.fromRoleName(stack, "Role", "example-role");
    new compute.StateMachine(stack, "MyStateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        new FakeTask(stack, "fakeTask", {
          credentials: { role: compute.TaskRole.fromRole(role) },
        }),
      ),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        definition:
          '{"StartAt":"fakeTask","States":{"fakeTask":{"End":true,"Type":"Task","Credentials":{"RoleArn":"arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:role/example-role"},"Resource":"my-resource","Parameters":{"MyParameter":"myParameter"}}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     DefinitionString: {
    //       "Fn::Join": [
    //         "",
    //         [
    //           '{"StartAt":"fakeTask","States":{"fakeTask":{"End":true,"Type":"Task","Credentials":{"RoleArn":"arn:',
    //           {
    //             Ref: "AWS::Partition",
    //           },
    //           ":iam::",
    //           {
    //             Ref: "AWS::AccountId",
    //           },
    //           ':role/example-role"},"Resource":"my-resource","Parameters":{"MyParameter":"myParameter"}}}}',
    //         ],
    //       ],
    //     },
    //   },
    // );

    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Effect: "Allow",
    //         Action: "sts:AssumeRole",
    //         Resource: {
    //           "Fn::Join": [
    //             "",
    //             [
    //               "arn:",
    //               {
    //                 Ref: "AWS::Partition",
    //               },
    //               ":iam::",
    //               {
    //                 Ref: "AWS::AccountId",
    //               },
    //               ":role/example-role",
    //             ],
    //           ],
    //         },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   PolicyName: "MyStateMachineRoleDefaultPolicyE468EB18",
    //   Roles: [
    //     {
    //       Ref: "MyStateMachineRoleD59FFEBC",
    //     },
    //   ],
    // });
  });

  test("Instantiate a State Machine with a task assuming a JSONPath roleArn", () => {
    // WHEN
    new compute.StateMachine(stack, "MyStateMachine", {
      definitionBody: compute.DefinitionBody.fromChainable(
        new FakeTask(stack, "fakeTask", {
          credentials: {
            role: compute.TaskRole.fromRoleArnJsonPath("$.RoleArn"),
          },
        }),
      ),
    });

    // THEN
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    // expect(synthesized).toMatchSnapshot();
    expect(synthesized).toHaveResourceWithProperties(
      sfnStateMachine.SfnStateMachine,
      {
        definition:
          '{"StartAt":"fakeTask","States":{"fakeTask":{"End":true,"Type":"Task","Credentials":{"RoleArn.$":"$.RoleArn"},"Resource":"my-resource","Parameters":{"MyParameter":"myParameter"}}}}',
      },
    );
    // Template.fromStack(stack).hasResourceProperties(
    //   "AWS::StepFunctions::StateMachine",
    //   {
    //     DefinitionString:
    //       '{"StartAt":"fakeTask","States":{"fakeTask":{"End":true,"Type":"Task","Credentials":{"RoleArn.$":"$.RoleArn"},"Resource":"my-resource","Parameters":{"MyParameter":"myParameter"}}}}',
    //   },
    // );

    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["sts:AssumeRole"],
            effect: "Allow",
            resources: ["*"],
          },
        ],
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Effect: "Allow",
    //         Action: "sts:AssumeRole",
    //         Resource: "*",
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    //   PolicyName: "MyStateMachineRoleDefaultPolicyE468EB18",
    //   Roles: [
    //     {
    //       Ref: "MyStateMachineRoleD59FFEBC",
    //     },
    //   ],
    // });
  });

  describe("StateMachine.fromStateMachineArn()", () => {
    describe("for a state machine in a different account and region", () => {
      let mach: compute.IStateMachine;

      beforeEach(() => {
        mach = compute.StateMachine.fromStateMachineArn(
          stack,
          "iMach",
          "arn:aws:states:machine-region:222222222222:stateMachine:machine-name",
        );
      });

      test("the state machine's region is taken from the ARN", () => {
        expect(mach.env.region).toBe("machine-region");
      });

      test("the state machine's account is taken from the ARN", () => {
        expect(mach.env.account).toBe("222222222222");
      });
    });
  });

  describe("StateMachine.fromStateMachineName()", () => {
    // beforeEach(() => {
    //   const app = new cdk.App();
    //   stack = new AwsStack(app, "Base", {
    //     env: { account: "111111111111", region: "stack-region" },
    //   });
    // });

    describe("for a state machine in the same account and region", () => {
      let mach: compute.IStateMachine;

      beforeEach(() => {
        mach = compute.StateMachine.fromStateMachineName(
          stack,
          "iMach",
          "machine-name",
        );
      });

      test("the state machine's region is taken from the current stack", () => {
        expect(mach.env.region).toBe("us-east-1");
      });

      test("the state machine's account is taken from the current stack", () => {
        expect(stack.resolve(mach.env.account)).toBe(
          "${data.aws_caller_identity.CallerIdentity.account_id}",
        );
      });

      test("the state machine's account is taken from the current stack", () => {
        expect(
          stack
            .resolve(mach.stateMachineArn)
            .endsWith(
              ":states:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:stateMachine:machine-name",
            ),
        ).toBeTruthy();
      });
    });
  });

  // // TODO: Aws provider does not have `StateMachineVersion` resource
  // test("stateMachineRevisionId property uses attribute reference", () => {
  //   // WHEN
  //   const stateMachine = new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       new compute.Pass(stack, "Pass"),
  //     ),
  //   });

  //   new compute.CfnStateMachineVersion(stack, "MyStateMachineVersion", {
  //     stateMachineRevisionId: stateMachine.stateMachineRevisionId,
  //     stateMachineArn: stateMachine.stateMachineArn,
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachineVersion",
  //     {
  //       StateMachineArn: { Ref: "MyStateMachine6C968CA5" },
  //       StateMachineRevisionId: {
  //         "Fn::GetAtt": ["MyStateMachine6C968CA5", "StateMachineRevisionId"],
  //       },
  //     },
  //   );
  // });

  // // TODO: Aws provider does not have `StateMachineVersion` resource
  // test("comments rendered properly", () => {
  //   const choice = new compute.Choice(stack, "choice", {
  //     comment: "nebraska",
  //   });
  //   const success = new compute.Succeed(stack, "success");
  //   choice.when(compute.Condition.isPresent("$.success"), success, {
  //     comment: "london",
  //   });
  //   choice.otherwise(success);

  //   // WHEN
  //   const stateMachine = new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(choice),
  //   });

  //   new compute.CfnStateMachineVersion(stack, "MyStateMachineVersion", {
  //     stateMachineRevisionId: stateMachine.stateMachineRevisionId,
  //     stateMachineArn: stateMachine.stateMachineArn,
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachine",
  //     {
  //       DefinitionString:
  //         '{"StartAt":"choice","States":{"choice":{"Type":"Choice","Comment":"nebraska","Choices":[{"Variable":"$.success","IsPresent":true,"Next":"success","Comment":"london"}],"Default":"success"},"success":{"Type":"Succeed"}}}',
  //     },
  //   );
  // });

  // // TODO: Re-add KMS Support
  // test("Instantiate StateMachine with EncryptionConfiguration using Customer Managed Key", () => {
  //   // GIVEN
  //   const kmsKey = new kms.Key(stack, "Key");

  //   // WHEN
  //   new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       compute.Chain.start(new compute.Pass(stack, "Pass")),
  //     ),
  //     stateMachineType: compute.StateMachineType.STANDARD,
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(
  //         kmsKey,
  //         cdk.Duration.seconds(75),
  //       ),
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachine",
  //     {
  //       StateMachineName: "MyStateMachine",
  //       StateMachineType: "STANDARD",
  //       DefinitionString:
  //         '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
  //       EncryptionConfiguration: Match.objectEquals({
  //         KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //         KmsDataKeyReusePeriodSeconds: 75,
  //         Type: "CUSTOMER_MANAGED_KMS_KEY",
  //       }),
  //     },
  //   );

  //   // StateMachine execution IAM policy allows only executions of MyStateMachine to use key
  //   Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //     PolicyDocument: {
  //       Statement: [
  //         {
  //           Action: ["kms:Decrypt", "kms:GenerateDataKey"],
  //           Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //           Condition: {
  //             StringEquals: {
  //               "kms:EncryptionContext:aws:states:stateMachineArn": {
  //                 "Fn::Join": [
  //                   "",
  //                   [
  //                     "arn:",
  //                     {
  //                       Ref: "AWS::Partition",
  //                     },
  //                     ":states:",
  //                     {
  //                       Ref: "AWS::Region",
  //                     },
  //                     ":",
  //                     {
  //                       Ref: "AWS::AccountId",
  //                     },
  //                     ":stateMachine:MyStateMachine",
  //                   ],
  //                 ],
  //               },
  //             },
  //           },
  //         },
  //       ],
  //       Version: "2012-10-17",
  //     },
  //   });
  // });

  // // TODO: Re-add Logging support
  // test("StateMachine with CWL Encryption generates the correct iam and key policies", () => {
  //   // GIVEN
  //   const kmsKey = new kms.Key(stack, "Key");
  //   const logGroup = new logs.LogGroup(stack, "MyLogGroup", {
  //     logGroupName: "/aws/vendedlogs/states/MyLogGroup",
  //   });

  //   // WHEN
  //   new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       compute.Chain.start(new compute.Pass(stack, "Pass")),
  //     ),
  //     stateMachineType: compute.StateMachineType.STANDARD,
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(kmsKey),
  //     logs: {
  //       destination: logGroup,
  //       level: compute.LogLevel.ALL,
  //       includeExecutionData: false,
  //     },
  //   });

  //   // Ensure execution role has policy that includes kms actions and encryption context for logging
  //   Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //     PolicyDocument: {
  //       Statement: [
  //         {
  //           Action: ["kms:Decrypt", "kms:GenerateDataKey"],
  //           Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //           Condition: {
  //             StringEquals: {
  //               "kms:EncryptionContext:aws:states:stateMachineArn": {
  //                 "Fn::Join": [
  //                   "",
  //                   [
  //                     "arn:",
  //                     {
  //                       Ref: "AWS::Partition",
  //                     },
  //                     ":states:",
  //                     {
  //                       Ref: "AWS::Region",
  //                     },
  //                     ":",
  //                     {
  //                       Ref: "AWS::AccountId",
  //                     },
  //                     ":stateMachine:MyStateMachine",
  //                   ],
  //                 ],
  //               },
  //             },
  //           },
  //         },
  //         {
  //           Action: "kms:GenerateDataKey",
  //           Resource: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //           Condition: {
  //             StringEquals: {
  //               "kms:EncryptionContext:SourceArn": {
  //                 "Fn::Join": [
  //                   "",
  //                   [
  //                     "arn:",
  //                     {
  //                       Ref: "AWS::Partition",
  //                     },
  //                     ":logs:",
  //                     {
  //                       Ref: "AWS::Region",
  //                     },
  //                     ":",
  //                     {
  //                       Ref: "AWS::AccountId",
  //                     },
  //                     ":*",
  //                   ],
  //                 ],
  //               },
  //             },
  //           },
  //         },
  //         {
  //           Action: [
  //             "logs:CreateLogDelivery",
  //             "logs:GetLogDelivery",
  //             "logs:UpdateLogDelivery",
  //             "logs:DeleteLogDelivery",
  //             "logs:ListLogDeliveries",
  //             "logs:PutResourcePolicy",
  //             "logs:DescribeResourcePolicies",
  //             "logs:DescribeLogGroups",
  //           ],
  //           Effect: "Allow",
  //           Resource: "*",
  //         },
  //       ],
  //       Version: "2012-10-17",
  //     },
  //   });
  //   // Ensure log service delivery policy statement is set for kms key
  //   Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
  //     KeyPolicy: {
  //       Statement: [
  //         {
  //           Action: "kms:*",
  //           Effect: "Allow",
  //           Principal: {
  //             AWS: {
  //               "Fn::Join": [
  //                 "",
  //                 [
  //                   "arn:",
  //                   {
  //                     Ref: "AWS::Partition",
  //                   },
  //                   ":iam::",
  //                   {
  //                     Ref: "AWS::AccountId",
  //                   },
  //                   ":root",
  //                 ],
  //               ],
  //             },
  //           },
  //           Resource: "*",
  //         },
  //         {
  //           Action: "kms:Decrypt*",
  //           Effect: "Allow",
  //           Principal: {
  //             Service: "delivery.logs.amazonaws.com",
  //           },
  //           Resource: "*",
  //         },
  //       ],
  //       Version: "2012-10-17",
  //     },
  //   });
  // });

  // // TODO: Re-add KMS support
  // test("StateMachine execution role is granted permissions when activity uses KMS key", () => {
  //   // GIVEN
  //   const stateMachineKey = new kms.Key(stack, "Key used for encryption");
  //   const activityKey = new kms.Key(stack, "Activity Key");

  //   // WHEN
  //   const activity = new compute.Activity(stack, "TestActivity", {
  //     activityName: "TestActivity",
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(activityKey),
  //   });

  //   const stateMachine = new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       compute.Chain.start(
  //         new task.StepFunctionsInvokeActivity(stack, "Activity", {
  //           activity: activity,
  //         }),
  //       ),
  //     ),
  //     stateMachineType: compute.StateMachineType.STANDARD,
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(
  //         stateMachineKey,
  //         cdk.Duration.seconds(300),
  //       ),
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //     PolicyDocument: {
  //       Statement: [
  //         {
  //           Action: ["kms:Decrypt", "kms:GenerateDataKey"],
  //           Resource: { "Fn::GetAtt": ["ActivityKey371097A6", "Arn"] },
  //           Condition: {
  //             StringEquals: {
  //               "kms:EncryptionContext:aws:states:activityArn": {
  //                 Ref: "TestActivity37A985C9",
  //               },
  //             },
  //           },
  //         },
  //         {
  //           Action: ["kms:Decrypt", "kms:GenerateDataKey"],
  //           Resource: {
  //             "Fn::GetAtt": ["Keyusedforencryption980FC81C", "Arn"],
  //           },
  //           Condition: {
  //             StringEquals: {
  //               "kms:EncryptionContext:aws:states:stateMachineArn": {
  //                 "Fn::Join": [
  //                   "",
  //                   [
  //                     "arn:",
  //                     {
  //                       Ref: "AWS::Partition",
  //                     },
  //                     ":states:",
  //                     {
  //                       Ref: "AWS::Region",
  //                     },
  //                     ":",
  //                     {
  //                       Ref: "AWS::AccountId",
  //                     },
  //                     ":stateMachine:MyStateMachine",
  //                   ],
  //                 ],
  //               },
  //             },
  //           },
  //         },
  //       ],
  //       Version: "2012-10-17",
  //     },
  //   });
  // });

  // // TODO: Re-add KMS support
  // test("Instantiate StateMachine with EncryptionConfiguration using Customer Managed Key - defaults to 300 secs for KmsDataKeyReusePeriodSeconds", () => {
  //   // GIVEN
  //   const kmsKey = new kms.Key(stack, "Key");

  //   // WHEN
  //   new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       compute.Chain.start(new compute.Pass(stack, "Pass")),
  //     ),
  //     stateMachineType: compute.StateMachineType.STANDARD,
  //     encryptionConfiguration:
  //       new compute.CustomerManagedEncryptionConfiguration(kmsKey),
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachine",
  //     {
  //       StateMachineName: "MyStateMachine",
  //       StateMachineType: "STANDARD",
  //       DefinitionString:
  //         '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
  //       EncryptionConfiguration: Match.objectEquals({
  //         KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
  //         KmsDataKeyReusePeriodSeconds: 300,
  //         Type: "CUSTOMER_MANAGED_KMS_KEY",
  //       }),
  //     },
  //   );
  // });

  // // TODO: Re-add KMS support
  // test("Instantiate StateMachine with invalid KmsDataKeyReusePeriodSeconds throws error", () => {
  //   // GIVEN
  //   const kmsKey = new kms.Key(stack, "Key");

  //   // FAIL
  //   expect(() => {
  //     // WHEN
  //     new compute.StateMachine(stack, "MyStateMachine", {
  //       stateMachineName: "MyStateMachine",
  //       definitionBody: compute.DefinitionBody.fromChainable(
  //         compute.Chain.start(new compute.Pass(stack, "Pass")),
  //       ),
  //       stateMachineType: compute.StateMachineType.STANDARD,
  //       encryptionConfiguration:
  //         new compute.CustomerManagedEncryptionConfiguration(
  //           kmsKey,
  //           cdk.Duration.seconds(20),
  //         ),
  //     });
  //   }).toThrow(
  //     "kmsDataKeyReusePeriodSeconds must have a value between 60 and 900 seconds",
  //   );
  // });

  // // TODO: Re-add KMS support
  // test("Instantiate StateMachine with EncryptionConfiguration using AwsOwnedEncryptionConfiguration", () => {
  //   // WHEN
  //   new compute.StateMachine(stack, "MyStateMachine", {
  //     stateMachineName: "MyStateMachine",
  //     definitionBody: compute.DefinitionBody.fromChainable(
  //       compute.Chain.start(new compute.Pass(stack, "Pass")),
  //     ),
  //     stateMachineType: compute.StateMachineType.STANDARD,
  //     encryptionConfiguration: new compute.AwsOwnedEncryptionConfiguration(),
  //   });

  //   // THEN
  //   Template.fromStack(stack).hasResourceProperties(
  //     "AWS::StepFunctions::StateMachine",
  //     {
  //       StateMachineName: "MyStateMachine",
  //       StateMachineType: "STANDARD",
  //       DefinitionString:
  //         '{"StartAt":"Pass","States":{"Pass":{"Type":"Pass","End":true}}}',
  //       EncryptionConfiguration: Match.objectLike({
  //         Type: "AWS_OWNED_KEY",
  //       }),
  //     },
  //   );
  // });
});
