// import { LogGroup } from '../../../aws-logs';
import { dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import "cdktf/lib/testing/adapters/jest";
import { Testing, TerraformVariable, Lazy } from "cdktf";
import { AwsStack } from "../../../../../src/aws/aws-stack";
import * as compute from "../../../../../src/aws/compute";
import * as iam from "../../../../../src/aws/iam";

let stack: AwsStack;

beforeEach(() => {
  // GIVEN
  const app = Testing.app();
  stack = new AwsStack(app, "TestStack", {
    environmentName: "Test",
    gridUUID: "123e4567-e89b-12d3",
    providerConfig: { region: "us-east-1" },
    gridBackendConfig: {
      address: "http://localhost:3000",
    },
  });
});

test("CallAwsService task", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "GetObject", {
    service: "s3",
    action: "getObject",
    parameters: {
      Bucket: "my-bucket",
      Key: compute.JsonPath.stringAt("$.key"),
    },
    iamResources: ["*"],
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  // THEN
  expect(stack.resolve(task.toStateJson())).toEqual({
    Type: "Task",
    Resource:
      "arn:${data.aws_partition.Partitition.partition}:states:::aws-sdk:s3:getObject",
    // Resource: {
    //   "Fn::Join": [
    //     "",
    //     [
    //       "arn:",
    //       {
    //         Ref: "AWS::Partition",
    //       },
    //       ":states:::aws-sdk:s3:getObject",
    //     ],
    //   ],
    // },
    End: true,
    Parameters: {
      Bucket: "my-bucket",
      "Key.$": "$.key",
    },
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
          actions: ["s3:getObject"],
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
  //         Action: "s3:getObject",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("with custom IAM action", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "ListBuckets", {
    service: "s3",
    action: "listBuckets",
    iamResources: ["*"],
    iamAction: "s3:ListAllMyBuckets",
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  // THEN
  expect(stack.resolve(task.toStateJson())).toEqual({
    Type: "Task",
    Resource:
      "arn:${data.aws_partition.Partitition.partition}:states:::aws-sdk:s3:listBuckets",
    // Resource: {
    //   "Fn::Join": [
    //     "",
    //     [
    //       "arn:",
    //       {
    //         Ref: "AWS::Partition",
    //       },
    //       ":states:::aws-sdk:s3:listBuckets",
    //     ],
    //   ],
    // },
    End: true,
    Parameters: {},
  });

  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["s3:ListAllMyBuckets"],
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
  //         Action: "s3:ListAllMyBuckets",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("with unresolved tokens", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "ListBuckets", {
    service: new TerraformVariable(stack, "Service", {}).stringValue,
    action: new TerraformVariable(stack, "Action", {}).stringValue,
    iamResources: ["*"],
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
  });

  // THEN
  expect(stack.resolve(task.toStateJson())).toEqual({
    Type: "Task",
    Resource:
      "arn:${data.aws_partition.Partitition.partition}:states:::aws-sdk:${var.Service}:${var.Action}",
    // Resource: {
    //   "Fn::Join": [
    //     "",
    //     [
    //       "arn:",
    //       {
    //         Ref: "AWS::Partition",
    //       },
    //       ":states:::aws-sdk:",
    //       {
    //         Ref: "Service",
    //       },
    //       ":",
    //       {
    //         Ref: "Action",
    //       },
    //     ],
    //   ],
    // },
    End: true,
    Parameters: {},
  });
});

test("throws with invalid integration pattern", () => {
  expect(
    () =>
      new compute.tasks.CallAwsService(stack, "GetObject", {
        integrationPattern: compute.IntegrationPattern.RUN_JOB,
        service: "s3",
        action: "getObject",
        parameters: {
          Bucket: "my-bucket",
          Key: compute.JsonPath.stringAt("$.key"),
        },
        iamResources: ["*"],
      }),
  ).toThrow(
    /The RUN_JOB integration pattern is not supported for CallAwsService/,
  );
});

test("throws if action is not camelCase", () => {
  expect(
    () =>
      new compute.tasks.CallAwsService(stack, "GetObject", {
        service: "s3",
        action: "GetObject",
        parameters: {
          Bucket: "my-bucket",
          Key: compute.JsonPath.stringAt("$.key"),
        },
        iamResources: ["*"],
      }),
  ).toThrow(/action must be camelCase, got: GetObject/);
});

test("throws if parameters has keys as not PascalCase", () => {
  expect(
    () =>
      new compute.tasks.CallAwsService(stack, "GetObject", {
        service: "s3",
        action: "getObject",
        parameters: {
          bucket: "my-bucket",
          key: compute.JsonPath.stringAt("$.key"),
        },
        iamResources: ["*"],
      }),
  ).toThrow(/parameter names must be PascalCase, got: bucket, key/);
});

test("can pass additional IAM statements", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "DetectLabels", {
    service: "rekognition",
    action: "detectLabels",
    iamResources: ["*"],
    additionalIamStatements: [
      new iam.PolicyStatement({
        actions: ["s3:getObject"],
        resources: ["arn:aws:s3:::my-bucket/*"],
      }),
    ],
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
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
          actions: ["rekognition:detectLabels"],
          effect: "Allow",
          resources: ["*"],
        },
        {
          actions: ["s3:getObject"],
          effect: "Allow",
          resources: ["arn:aws:s3:::my-bucket/*"],
        },
      ],
    },
  );
  // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "rekognition:detectLabels",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //       {
  //         Action: "s3:getObject",
  //         Effect: "Allow",
  //         Resource: "arn:aws:s3:::my-bucket/*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("IAM policy for sfn", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "SendTaskSuccess", {
    service: "sfn",
    action: "sendTaskSuccess",
    iamResources: ["*"],
    parameters: {
      Output: compute.JsonPath.objectAt("$.output"),
      TaskToken: compute.JsonPath.stringAt("$.taskToken"),
    },
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
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
          actions: ["states:sendTaskSuccess"],
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
  //         Action: "states:sendTaskSuccess",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("IAM policy for cloudwatchlogs", () => {
  // WHEN
  // const myLogGroup = new LogGroup(stack, "MyLogGroup");
  const task = new compute.tasks.CallAwsService(stack, "SendTaskSuccess", {
    service: "cloudwatchlogs",
    action: "createLogStream",
    parameters: {
      LogGroupName: Lazy.stringValue({
        produce: () => "MyLogGroup",
      }),
      LogStreamName: compute.JsonPath.stringAt("$$.Execution.Name"),
    },
    resultPath: compute.JsonPath.DISCARD,
    iamResources: [
      Lazy.stringValue({
        produce: () =>
          "arn:aws:logs:us-east-1:123456789012:log-group:MyLogGroup",
      }),
    ], // myLogGroup.logGroupArn],
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
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
          actions: ["logs:createLogStream"],
          effect: "Allow",
          resources: [
            "arn:aws:logs:us-east-1:123456789012:log-group:MyLogGroup",
          ],
        },
      ],
    },
  );
  // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
  //   PolicyDocument: {
  //     Statement: [
  //       {
  //         Action: "logs:createLogStream",
  //         Effect: "Allow",
  //         Resource: {
  //           "Fn::GetAtt": ["MyLogGroup5C0DAD85", "Arn"],
  //         },
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("IAM policy for mediapackagevod", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(
    stack,
    "ListMediaPackageVoDPackagingGroups",
    {
      service: "mediapackagevod",
      action: "listPackagingGroups",
      resultPath: compute.JsonPath.DISCARD,
      iamResources: ["*"],
    },
  );

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
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
          actions: ["mediapackage-vod:listPackagingGroups"],
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
  //         Action: "mediapackage-vod:listPackagingGroups",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("IAM policy for mwaa", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "ListMWAAEnvironments", {
    service: "mwaa",
    action: "listEnvironments",
    resultPath: compute.JsonPath.DISCARD,
    iamResources: ["*"],
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
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
          actions: ["airflow:listEnvironments"],
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
  //         Action: "airflow:listEnvironments",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});

test("IAM policy for efs", () => {
  // WHEN
  const task = new compute.tasks.CallAwsService(stack, "TagEfsAccessPoint", {
    service: "efs",
    action: "tagResource",
    iamResources: ["*"],
    parameters: {
      ResourceId: compute.JsonPath.stringAt("$.pathToArn"),
      Tags: [
        {
          Key: "MYTAGNAME",
          Value: compute.JsonPath.stringAt("$.pathToId"),
        },
      ],
    },
    resultPath: compute.JsonPath.DISCARD,
  });

  new compute.StateMachine(stack, "StateMachine", {
    definitionBody: compute.DefinitionBody.fromChainable(task),
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
          actions: ["elasticfilesystem:tagResource"],
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
  //         Action: "elasticfilesystem:tagResource",
  //         Effect: "Allow",
  //         Resource: "*",
  //       },
  //     ],
  //     Version: "2012-10-17",
  //   },
  // });
});
