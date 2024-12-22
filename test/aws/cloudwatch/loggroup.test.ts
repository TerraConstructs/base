// https://github.com/aws/aws-cdk/blob/1222aaac57a48113a52347a99e41af59236c0aef/packages/aws-cdk-lib/aws-logs/test/loggroup.test.ts

import {
  cloudwatchLogGroup,
  cloudwatchLogStream,
  dataAwsIamPolicyDocument,
  cloudwatchLogMetricFilter,
  cloudwatchLogDataProtectionPolicy,
  cloudwatchLogSubscriptionFilter,
} from "@cdktf/provider-aws";
import { App, Testing, TerraformVariable } from "cdktf";
import { Construct } from "constructs";
import "cdktf/lib/testing/adapters/jest";
import { AwsSpec, RetentionDays } from "../../../src/aws";
import {
  LogGroup,
  LogGroupClass,
  DataProtectionPolicy,
  DataIdentifier,
  CustomDataIdentifier,
  ILogGroup,
  ILogSubscriptionDestination,
  FilterPattern,
} from "../../../src/aws/cloudwatch";
import * as kms from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import { Bucket } from "../../../src/aws/storage";
import { Annotations, Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("log group", () => {
  let app: App;
  let stack: AwsSpec;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsSpec(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Spec props to match AWS CDK cross account support
      // account: "1234",
    });
  });

  test("set kms key when provided", () => {
    // GIVEN
    const encryptionKey = new kms.Key(stack, "Key");

    // WHEN
    new LogGroup(stack, "LogGroup", {
      encryptionKey,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        kms_key_id: stack.resolve(encryptionKey.keyArn),
      },
    );
    // Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
    //   KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
    // });
  });

  test("fixed retention", () => {
    // WHEN
    new LogGroup(stack, "LogGroup", {
      retention: RetentionDays.ONE_WEEK,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        retention_in_days: 7,
      },
    );
  });

  test("default retention", () => {
    // WHEN
    new LogGroup(stack, "LogGroup");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        retention_in_days: 731,
      },
    );
  });

  test("infinite retention/dont delete log group by default", () => {
    // WHEN
    new LogGroup(stack, "LogGroup", {
      retention: RetentionDays.INFINITE,
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_cloudwatch_log_group: {
          LogGroup_F5B46931: {
            skip_destroy: true,
          },
        },
      },
    });
  });

  test("infinite retention via legacy method", () => {
    // WHEN
    new LogGroup(stack, "LogGroup", {
      // Don't know why TypeScript doesn't complain about passing Infinity to
      // something where an enum is expected, but better keep this behavior for
      // existing clients.
      retention: Infinity,
    });

    // THEN
    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_cloudwatch_log_group: {
          LogGroup_F5B46931: {
            skip_destroy: true,
          },
        },
      },
    });
  });

  test("unresolved retention", () => {
    // GIVEN
    const parameter = new TerraformVariable(stack, "RetentionInDays", {
      default: 30,
      type: "Number",
    });

    // WHEN
    new LogGroup(stack, "LogGroup", {
      retention: parameter.numberValue,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        retention_in_days: stack.resolve(parameter.numberValue),
      },
    );
  });

  test("with INFREQUENT_ACCESS log group class", () => {
    // WHEN
    new LogGroup(stack, "LogGroup", {
      logGroupClass: LogGroupClass.INFREQUENT_ACCESS,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        log_group_class: LogGroupClass.INFREQUENT_ACCESS,
      },
    );
  });

  test("with STANDARD log group class", () => {
    // WHEN
    new LogGroup(stack, "LogGroup", {
      logGroupClass: LogGroupClass.STANDARD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        log_group_class: LogGroupClass.STANDARD,
      },
    );
  });

  // when LogGroupClass is not specified, leave it to terraform-provider-aws and/or backend to default to STANDARD
  test("with default log group class", () => {
    // WHEN
    new LogGroup(stack, "LogGroup");

    // THEN
    Template.resources(stack, cloudwatchLogGroup.CloudwatchLogGroup).toEqual(
      expect.arrayContaining([
        expect.not.objectContaining({
          log_group_class: expect.anything(),
        }),
      ]),
    );
    // (
    //   // https://stackoverflow.com/a/73189248/138469
    //   expect.objectContaining({
    //     log_group_class: expect.anything(),
    //   }),
    // );

    // Template.fromStack(stack).resourcePropertiesCountIs('AWS::Logs::LogGroup', {
    //   LogGroupClass: LogGroupClass.STANDARD,
    // }, 0);
    // Template.fromStack(stack).resourcePropertiesCountIs('AWS::Logs::LogGroup', {
    //   LogGroupClass: LogGroupClass.INFREQUENT_ACCESS,
    // }, 0);
  });

  test("with log group class in a non-supported region", () => {
    // GIVEN
    const stack2 = new AwsSpec(app, "TestStack", {
      environmentName,
      gridUUID,
      gridBackendConfig,
      providerConfig: {
        region: "us-isob-east-1",
      },
    });

    // WHEN
    new LogGroup(stack2, "LogGroup", {
      logGroupClass: LogGroupClass.STANDARD,
    });

    // THEN
    Annotations.fromStack(stack2).hasWarnings({
      message:
        /The LogGroupClass property is not supported in the following regions.+us-isob-east-1/,
    });
    // Annotations.fromStack(stack2).hasWarning(
    //   "*",
    //   Match.stringLikeRegexp(
    //     /The LogGroupClass property is not supported in the following regions.+us-isob-east-1/,
    //   ),
    // );
  });

  // test("will delete log group if asked to", () => {
  //   // WHEN
  //   new LogGroup(stack, "LogGroup", {
  //     retention: Infinity,
  //     removalPolicy: RemovalPolicy.DESTROY,
  //   });

  //   // THEN
  //   Template.fromStack(stack).templateMatches({
  //     Resources: {
  //       LogGroupF5B46931: {
  //         Type: "AWS::Logs::LogGroup",
  //         DeletionPolicy: "Delete",
  //         UpdateReplacePolicy: "Delete",
  //       },
  //     },
  //   });
  // });

  test("import from ARN, same region", () => {
    // GIVEN
    const stack2 = new AwsSpec(app, "MyStack2", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    // WHEN
    const imported = LogGroup.fromLogGroupArn(
      stack2,
      "lg",
      "arn:aws:logs:us-east-1:123456789012:log-group:my-log-group",
    );
    imported.addStream("MakeMeAStream");

    // THEN
    expect(imported.logGroupName).toEqual("my-log-group");
    expect(imported.logGroupArn).toEqual(
      "arn:aws:logs:us-east-1:123456789012:log-group:my-log-group:*",
    );
    Template.synth(stack2).toHaveResourceWithProperties(
      cloudwatchLogStream.CloudwatchLogStream,
      {
        log_group_name: "my-log-group",
      },
    );
  });

  test("import from ARN, different region", () => {
    // GIVEN
    const importRegion = "asgard-1";

    // WHEN
    const imported = LogGroup.fromLogGroupArn(
      stack,
      "lg",
      `arn:aws:logs:${importRegion}:123456789012:log-group:my-log-group`,
    );
    imported.addStream("MakeMeAStream");

    // THEN
    expect(imported.logGroupName).toEqual("my-log-group");
    expect(imported.logGroupArn).toEqual(
      `arn:aws:logs:${importRegion}:123456789012:log-group:my-log-group:*`,
    );
    expect(imported.env.region).not.toEqual(stack.region);
    expect(imported.env.region).toEqual(importRegion);

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogStream.CloudwatchLogStream,
      {
        log_group_name: "my-log-group",
      },
    );
    Template.resources(
      stack,
      cloudwatchLogGroup.CloudwatchLogGroup,
    ).toHaveLength(0);
    // Template.fromStack(stack).resourceCountIs("AWS::Logs::LogGroup", 0);
  });

  test("import from name", () => {
    // WHEN
    const imported = LogGroup.fromLogGroupName(stack, "lg", "my-log-group");
    imported.addStream("MakeMeAStream");

    // THEN
    expect(imported.logGroupName).toEqual("my-log-group");
    expect(imported.logGroupArn).toMatch(
      /^arn:.+:logs:.+:.+:log-group:my-log-group:\*$/,
    );

    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogStream.CloudwatchLogStream,
      {
        log_group_name: "my-log-group",
      },
    );
  });

  describe("loggroups imported by name have stream wildcard appended to grant ARN", () =>
    void dataDrivenTests(
      [
        // Regardless of whether the user put :* there already because of this bug, we
        // don't want to append it twice.
        "",
        ":*",
      ],
      (suffix: string) => {
        // GIVEN
        const role = new iam.Role(stack, "Role", {
          assumedBy: new iam.ServicePrincipal("sns"),
        });
        const imported = LogGroup.fromLogGroupName(
          stack,
          "lg",
          `my-log-group${suffix}`,
        );

        // WHEN
        imported.grantWrite(role);

        // THEN
        Template.synth(stack).toHaveDataSourceWithProperties(
          dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
          {
            statement: [
              {
                actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
                effect: "Allow",
                resources: [
                  "arn:${data.aws_partition.Partitition.partition}:logs:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:log-group:my-log-group:*",
                ],
              },
            ],
          },
        );
        // .toHaveDataSourceWithProperties(
        //   dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        //   {
        //     PolicyDocument: {
        //       Version: "2012-10-17",
        //       Statement: [
        //         {
        //           Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        //           Effect: "Allow",
        //           Resource: {
        //             "Fn::Join": [
        //               "",
        //               [
        //                 "arn:",
        //                 { Ref: "AWS::Partition" },
        //                 ":logs:",
        //                 { Ref: "AWS::Region" },
        //                 ":",
        //                 { Ref: "AWS::AccountId" },
        //                 ":log-group:my-log-group:*",
        //               ],
        //             ],
        //           },
        //         },
        //       ],
        //     },
        //   },
        // );

        expect(imported.logGroupName).toEqual("my-log-group");
      },
    ));

  describe("loggroups imported by ARN have stream wildcard appended to grant ARN", () =>
    void dataDrivenTests(
      [
        // Regardless of whether the user put :* there already because of this bug, we
        // don't want to append it twice.
        "",
        ":*",
      ],
      (suffix: string) => {
        // GIVEN
        const role = new iam.Role(stack, "Role", {
          assumedBy: new iam.ServicePrincipal("sns"),
        });
        const imported = LogGroup.fromLogGroupArn(
          stack,
          "lg",
          `arn:aws:logs:us-west-1:123456789012:log-group:my-log-group${suffix}`,
        );

        // WHEN
        imported.grantWrite(role);

        // THEN
        Template.synth(stack).toHaveDataSourceWithProperties(
          dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
          {
            statement: [
              {
                actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
                effect: "Allow",
                resources: [
                  "arn:aws:logs:us-west-1:123456789012:log-group:my-log-group:*",
                ],
              },
            ],
          },
        );
        // .hasResourceProperties("AWS::IAM::Policy", {
        //   PolicyDocument: {
        //     Version: "2012-10-17",
        //     Statement: [
        //       {
        //         Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        //         Effect: "Allow",
        //         Resource:
        //           "arn:aws:logs:us-west-1:123456789012:log-group:my-log-group:*",
        //       },
        //     ],
        //   },
        // });

        expect(imported.logGroupName).toEqual("my-log-group");
      },
    ));

  test("extractMetric", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");

    // WHEN
    const metric = lg.extractMetric("$.myField", "MyService", "Field");

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogMetricFilter.CloudwatchLogMetricFilter,
      {
        pattern: '{ $.myField = "*" }',
        log_group_name: stack.resolve(lg.logGroupName),
        metric_transformation: {
          name: "Field",
          namespace: "MyService",
          value: "$.myField",
        },
      },
    );
    // .hasResourceProperties("AWS::Logs::MetricFilter", {
    //   FilterPattern: '{ $.myField = "*" }',
    //   LogGroupName: { Ref: "LogGroupF5B46931" },
    //   MetricTransformations: [
    //     {
    //       MetricName: "Field",
    //       MetricNamespace: "MyService",
    //       MetricValue: "$.myField",
    //     },
    //   ],
    // });

    expect(metric.namespace).toEqual("MyService");
    expect(metric.metricName).toEqual("Field");
  });

  test('extractMetric allows passing in namespaces with "/"', () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");

    // WHEN
    const metric = lg.extractMetric(
      "$.myField",
      "MyNamespace/MyService",
      "Field",
    );

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogMetricFilter.CloudwatchLogMetricFilter,
      {
        pattern: '{ $.myField = "*" }',
        log_group_name: stack.resolve(lg.logGroupName),
        metric_transformation: {
          name: "Field",
          namespace: "MyNamespace/MyService",
          value: "$.myField",
        },
      },
    );
    // .hasResourceProperties("AWS::Logs::MetricFilter", {
    //   FilterPattern: '{ $.myField = "*" }',
    //   MetricTransformations: [
    //     {
    //       MetricName: "Field",
    //       MetricNamespace: "MyNamespace/MyService",
    //       MetricValue: "$.myField",
    //     },
    //   ],
    // });

    expect(metric.namespace).toEqual("MyNamespace/MyService");
    expect(metric.metricName).toEqual("Field");
  });

  test("grant write", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("sns"),
    });

    // WHEN
    lg.grantWrite(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [stack.resolve(lg.logGroupArn)],
          },
        ],
      },
    );
    // .hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
    //         Effect: "Allow",
    //         Resource: { "Fn::GetAtt": ["LogGroupF5B46931", "Arn"] },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    // });
  });

  test("grant read", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.ServicePrincipal("sns"),
    });

    // WHEN
    lg.grantRead(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: [
              "logs:FilterLogEvents",
              "logs:GetLogEvents",
              "logs:GetLogGroupFields",
              "logs:DescribeLogGroups",
              "logs:DescribeLogStreams",
            ],
            effect: "Allow",
            resources: [stack.resolve(lg.logGroupArn)],
          },
        ],
      },
    );
    // .hasResourceProperties("AWS::IAM::Policy", {
    //   PolicyDocument: {
    //     Statement: [
    //       {
    //         Action: [
    //           "logs:FilterLogEvents",
    //           "logs:GetLogEvents",
    //           "logs:GetLogGroupFields",
    //           "logs:DescribeLogGroups",
    //           "logs:DescribeLogStreams",
    //         ],
    //         Effect: "Allow",
    //         Resource: { "Fn::GetAtt": ["LogGroupF5B46931", "Arn"] },
    //       },
    //     ],
    //     Version: "2012-10-17",
    //   },
    // });
  });

  test("grant to service principal", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");
    const sp = new iam.ServicePrincipal("es.amazonaws.com");

    // WHEN
    lg.grantWrite(sp);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            effect: "Allow",
            resources: [stack.resolve(lg.logGroupArn)],
            principals: [
              {
                identifiers: [
                  "${data.aws_service_principal.aws_svcp_default_region_es.name}",
                ],
                type: "Service",
              },
            ],
          },
        ],
      },
    );
    // .hasResourceProperties(
    //   "AWS::Logs::ResourcePolicy",
    //   {
    //     PolicyDocument: {
    //       "Fn::Join": [
    //         "",
    //         [
    //           '{"Statement":[{"Action":["logs:CreateLogStream","logs:PutLogEvents"],"Effect":"Allow","Principal":{"Service":"es.amazonaws.com"},"Resource":"',
    //           {
    //             "Fn::GetAtt": ["LogGroupF5B46931", "Arn"],
    //           },
    //           '"}],"Version":"2012-10-17"}',
    //         ],
    //       ],
    //     },
    //     PolicyName: "LogGroupPolicy643B329C",
    //   },
    // );
  });

  test("when added to log groups, IAM users are converted into account IDs in the resource policy", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");

    // WHEN
    lg.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["logs:PutLogEvents"],
        principals: [
          new iam.ArnPrincipal("arn:aws:iam::123456789012:user/user-name"),
        ],
      }),
    );

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:PutLogEvents"],
            effect: "Allow",
            resources: ["*"],
            principals: [
              {
                identifiers: ["123456789012"],
                type: "AWS",
              },
            ],
          },
        ],
      },
    );
    // .hasResourceProperties(
    //   "AWS::Logs::ResourcePolicy",
    //   {
    //     PolicyDocument:
    //       '{"Statement":[{"Action":"logs:PutLogEvents","Effect":"Allow","Principal":{"AWS":"123456789012"},"Resource":"*"}],"Version":"2012-10-17"}',
    //     PolicyName: "LogGroupPolicy643B329C",
    //   },
    // );
  });

  test("log groups accept the AnyPrincipal policy", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");

    // WHEN
    lg.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["logs:PutLogEvents"],
        principals: [new iam.AnyPrincipal()],
      }),
    );

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:PutLogEvents"],
            effect: "Allow",
            resources: ["*"],
            principals: [
              {
                identifiers: ["*"],
                type: "AWS",
              },
            ],
          },
        ],
      },
    );
    // .hasResourceProperties(
    //   "AWS::Logs::ResourcePolicy",
    //   {
    //     PolicyDocument: JSON.stringify({
    //       Statement: [
    //         {
    //           Action: "logs:PutLogEvents",
    //           Effect: "Allow",
    //           Principal: { AWS: "*" },
    //           Resource: "*",
    //         },
    //       ],
    //       Version: "2012-10-17",
    //     }),
    //   },
    // );
  });

  test("imported values are treated as if they are ARNs and converted to account IDs via CFN pseudo parameters", () => {
    // GIVEN
    const lg = new LogGroup(stack, "LogGroup");
    const variable = new TerraformVariable(stack, "SomeRole", {});

    // WHEN
    lg.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["logs:PutLogEvents"],
        principals: [iam.Role.fromRoleArn(stack, "Role", variable.stringValue)],
      }),
    );

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["logs:PutLogEvents"],
            effect: "Allow",
            resources: ["*"],
            principals: [
              {
                identifiers: ['${element(split(":", var.SomeRole), 4)}'],
                type: "AWS",
              },
            ],
          },
        ],
      },
    );
    // .hasResourceProperties(
    //   "AWS::Logs::ResourcePolicy",
    //   {
    //     PolicyDocument: {
    //       "Fn::Join": [
    //         "",
    //         [
    //           '{"Statement":[{"Action":"logs:PutLogEvents","Effect":"Allow","Principal":{"AWS":"',
    //           {
    //             "Fn::Select": [
    //               4,
    //               { "Fn::Split": [":", { "Fn::ImportValue": "SomeRole" }] },
    //             ],
    //           },
    //           '"},"Resource":"*"}],"Version":"2012-10-17"}',
    //         ],
    //       ],
    //     },
    //   },
    // );
  });

  test("correctly returns physical name of the log group", () => {
    // WHEN
    new LogGroup(stack, "LogGroup", {
      logGroupName: "my-log-group",
    });

    // THEN
    // CDKTF Returns token for getAttribute of the resource
    // expect(logGroup.logGroupPhysicalName()).toEqual("my-log-group");
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogGroup.CloudwatchLogGroup,
      {
        name: "my-log-group",
      },
    );
  });

  test("set data protection policy with custom name and description and no audit destinations", () => {
    const dataProtectionPolicy = new DataProtectionPolicy({
      name: "test-policy-name",
      description: "test description",
      identifiers: [DataIdentifier.EMAILADDRESS],
    });

    // WHEN
    const logGroupName = "test-log-group";
    const lg = new LogGroup(stack, "LogGroup", {
      logGroupName: logGroupName,
      dataProtectionPolicy: dataProtectionPolicy,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogDataProtectionPolicy.CloudwatchLogDataProtectionPolicy,
      {
        log_group_name: stack.resolve(lg.logGroupName),
        policy_document: JSON.stringify({
          name: "test-policy-name",
          description: "test description",
          version: "2021-06-01",
          configuration: {
            customDataIdentifier: [],
          },
          statement: [
            {
              sid: "audit-statement-cdk",
              dataIdentifier: [
                `arn:\${data.aws_partition.Partitition.partition}:dataprotection::aws:data-identifier/EmailAddress`,
              ],
              operation: {
                audit: {
                  findingsDestination: {},
                },
              },
            },
            {
              sid: "redact-statement-cdk",
              dataIdentifier: [
                `arn:\${data.aws_partition.Partitition.partition}:dataprotection::aws:data-identifier/EmailAddress`,
              ],
              operation: {
                deidentify: {
                  maskConfig: {},
                },
              },
            },
          ],
        }),
      },
    );
    // .hasResourceProperties("AWS::Logs::LogGroup", {
    //   LogGroupName: logGroupName,
    //   DataProtectionPolicy: {
    //     name: "test-policy-name",
    //     description: "test description",
    //     version: "2021-06-01",
    //     statement: [
    //       {
    //         sid: "audit-statement-cdk",
    //         dataIdentifier: [
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/EmailAddress",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           audit: {
    //             findingsDestination: {},
    //           },
    //         },
    //       },
    //       {
    //         sid: "redact-statement-cdk",
    //         dataIdentifier: [
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/EmailAddress",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           deidentify: {
    //             maskConfig: {},
    //           },
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("set data protection policy string-based data identifier", () => {
    // GIVEN
    const dataProtectionPolicy = new DataProtectionPolicy({
      name: "test-policy-name",
      description: "test description",
      identifiers: [new DataIdentifier("NewIdentifier")],
    });

    // WHEN
    const logGroupName = "test-log-group";
    const lg = new LogGroup(stack, "LogGroup", {
      logGroupName: logGroupName,
      dataProtectionPolicy: dataProtectionPolicy,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogDataProtectionPolicy.CloudwatchLogDataProtectionPolicy,
      {
        log_group_name: stack.resolve(lg.logGroupName),
        policy_document: JSON.stringify({
          name: "test-policy-name",
          description: "test description",
          version: "2021-06-01",
          configuration: {
            customDataIdentifier: [],
          },
          statement: [
            {
              sid: "audit-statement-cdk",
              dataIdentifier: [
                `arn:\${data.aws_partition.Partitition.partition}:dataprotection::aws:data-identifier/NewIdentifier`,
              ],
              operation: {
                audit: {
                  findingsDestination: {},
                },
              },
            },
            {
              sid: "redact-statement-cdk",
              dataIdentifier: [
                `arn:\${data.aws_partition.Partitition.partition}:dataprotection::aws:data-identifier/NewIdentifier`,
              ],
              operation: {
                deidentify: {
                  maskConfig: {},
                },
              },
            },
          ],
        }),
      },
    );
    // .hasResourceProperties("AWS::Logs::LogGroup", {
    //   LogGroupName: logGroupName,
    //   DataProtectionPolicy: {
    //     name: "test-policy-name",
    //     description: "test description",
    //     version: "2021-06-01",
    //     statement: [
    //       {
    //         sid: "audit-statement-cdk",
    //         dataIdentifier: [
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/NewIdentifier",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           audit: {
    //             findingsDestination: {},
    //           },
    //         },
    //       },
    //       {
    //         sid: "redact-statement-cdk",
    //         dataIdentifier: [
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/NewIdentifier",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           deidentify: {
    //             maskConfig: {},
    //           },
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("set data protection policy with audit destinations", () => {
    // GIVEN
    const auditLogGroup = new LogGroup(stack, "LogGroupAudit", {
      logGroupName: "audit-log-group",
    });
    const auditS3Bucket = new Bucket(stack, "BucketAudit", {
      bucketName: "audit-bucket",
    });
    const auditDeliveryStreamName = "delivery-stream-name";

    const dataProtectionPolicy = new DataProtectionPolicy({
      identifiers: [DataIdentifier.EMAILADDRESS],
      logGroupAuditDestination: auditLogGroup,
      s3BucketAuditDestination: auditS3Bucket,
      deliveryStreamNameAuditDestination: auditDeliveryStreamName,
    });

    // WHEN
    const logGroupName = "test-log-group";
    const lg = new LogGroup(stack, "LogGroup", {
      logGroupName: logGroupName,
      dataProtectionPolicy: dataProtectionPolicy,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogDataProtectionPolicy.CloudwatchLogDataProtectionPolicy,
      {
        log_group_name: stack.resolve(lg.logGroupName),
        policy_document: JSON.stringify({
          name: "data-protection-policy-cdk",
          description: "cdk generated data protection policy",
          version: "2021-06-01",
          configuration: {
            customDataIdentifier: [],
          },
          statement: [
            {
              sid: "audit-statement-cdk",
              dataIdentifier: [
                "arn:${data.aws_partition.Partitition.partition}:dataprotection::aws:data-identifier/EmailAddress",
              ],
              operation: {
                audit: {
                  findingsDestination: {
                    cloudWatchLogs: {
                      logGroup: stack.resolve(auditLogGroup.logGroupName),
                    },
                    s3: {
                      bucket: stack.resolve(auditS3Bucket.bucketName),
                    },
                    firehose: {
                      deliveryStream: auditDeliveryStreamName,
                    },
                  },
                },
              },
            },
            {
              sid: "redact-statement-cdk",
              dataIdentifier: [
                "arn:${data.aws_partition.Partitition.partition}:dataprotection::aws:data-identifier/EmailAddress",
              ],
              operation: {
                deidentify: {
                  maskConfig: {},
                },
              },
            },
          ],
        }),
      },
    );
    // .hasResourceProperties("AWS::Logs::LogGroup", {
    //   LogGroupName: logGroupName,
    //   DataProtectionPolicy: {
    //     name: "data-protection-policy-cdk",
    //     description: "cdk generated data protection policy",
    //     version: "2021-06-01",
    //     statement: [
    //       {
    //         sid: "audit-statement-cdk",
    //         dataIdentifier: [
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/EmailAddress",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           audit: {
    //             findingsDestination: {
    //               cloudWatchLogs: {
    //                 logGroup: {
    //                   Ref: "LogGroupAudit2C8B7F73",
    //                 },
    //               },
    //               firehose: {
    //                 deliveryStream: auditDeliveryStreamName,
    //               },
    //               s3: {
    //                 bucket: {
    //                   Ref: "BucketAudit1DED3529",
    //                 },
    //               },
    //             },
    //           },
    //         },
    //       },
    //       {
    //         sid: "redact-statement-cdk",
    //         dataIdentifier: [
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/EmailAddress",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           deidentify: {
    //             maskConfig: {},
    //           },
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("set data protection policy with custom data identifier", () => {
    // GIVEN
    const dataProtectionPolicy = new DataProtectionPolicy({
      name: "test-policy-name",
      description: "test description",
      identifiers: [
        new CustomDataIdentifier("EmployeeId", "EmployeeId-\\d{9}"),
      ],
    });

    // WHEN
    const logGroupName = "test-log-group";
    const lg = new LogGroup(stack, "LogGroup", {
      logGroupName: logGroupName,
      dataProtectionPolicy: dataProtectionPolicy,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogDataProtectionPolicy.CloudwatchLogDataProtectionPolicy,
      {
        log_group_name: stack.resolve(lg.logGroupName),
        policy_document: JSON.stringify({
          name: "test-policy-name",
          description: "test description",
          version: "2021-06-01",
          configuration: {
            customDataIdentifier: [
              {
                name: "EmployeeId",
                regex: "EmployeeId-\\d{9}",
              },
            ],
          },
          statement: [
            {
              sid: "audit-statement-cdk",
              dataIdentifier: ["EmployeeId"],
              operation: {
                audit: {
                  findingsDestination: {},
                },
              },
            },
            {
              sid: "redact-statement-cdk",
              dataIdentifier: ["EmployeeId"],
              operation: {
                deidentify: {
                  maskConfig: {},
                },
              },
            },
          ],
        }),
      },
    );
    // .hasResourceProperties("AWS::Logs::LogGroup", {
    //   LogGroupName: logGroupName,
    //   DataProtectionPolicy: {
    //     name: "test-policy-name",
    //     description: "test description",
    //     version: "2021-06-01",
    //     configuration: {
    //       customDataIdentifier: [
    //         {
    //           name: "EmployeeId",
    //           regex: "EmployeeId-\\d{9}",
    //         },
    //       ],
    //     },
    //     statement: [
    //       {
    //         sid: "audit-statement-cdk",
    //         dataIdentifier: ["EmployeeId"],
    //         operation: {
    //           audit: {
    //             findingsDestination: {},
    //           },
    //         },
    //       },
    //       {
    //         sid: "redact-statement-cdk",
    //         dataIdentifier: ["EmployeeId"],
    //         operation: {
    //           deidentify: {
    //             maskConfig: {},
    //           },
    //         },
    //       },
    //     ],
    //   },
    // });
  });

  test("set data protection policy with mix of managed and custom data identifiers", () => {
    // GIVEN
    const dataProtectionPolicy = new DataProtectionPolicy({
      name: "test-policy-name",
      description: "test description",
      identifiers: [
        new CustomDataIdentifier("EmployeeId", "EmployeeId-\\d{9}"),
        DataIdentifier.EMAILADDRESS,
      ],
    });

    // WHEN
    const lg = new LogGroup(stack, "LogGroup", {
      logGroupName: "test-log-group",
      dataProtectionPolicy: dataProtectionPolicy,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogDataProtectionPolicy.CloudwatchLogDataProtectionPolicy,
      {
        log_group_name: stack.resolve(lg.logGroupName),
        policy_document: JSON.stringify({
          name: "test-policy-name",
          description: "test description",
          version: "2021-06-01",
          configuration: {
            customDataIdentifier: [
              {
                name: "EmployeeId",
                regex: "EmployeeId-\\d{9}",
              },
            ],
          },
          statement: [
            {
              sid: "audit-statement-cdk",
              dataIdentifier: [
                "EmployeeId",
                `arn:${stack.resolve(stack.partition)}:dataprotection::aws:data-identifier/EmailAddress`,
              ],
              operation: {
                audit: {
                  findingsDestination: {},
                },
              },
            },
            {
              sid: "redact-statement-cdk",
              dataIdentifier: [
                "EmployeeId",
                `arn:${stack.resolve(stack.partition)}:dataprotection::aws:data-identifier/EmailAddress`,
              ],
              operation: {
                deidentify: {
                  maskConfig: {},
                },
              },
            },
          ],
        }),
      },
    );
    // .hasResourceProperties("AWS::Logs::LogGroup", {
    //   LogGroupName: logGroupName,
    //   DataProtectionPolicy: {
    //     name: "test-policy-name",
    //     description: "test description",
    //     version: "2021-06-01",
    //     configuration: {
    //       customDataIdentifier: [
    //         {
    //           name: "EmployeeId",
    //           regex: "EmployeeId-\\d{9}",
    //         },
    //       ],
    //     },
    //     statement: [
    //       {
    //         sid: "audit-statement-cdk",
    //         dataIdentifier: [
    //           "EmployeeId",
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/EmailAddress",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           audit: {
    //             findingsDestination: {},
    //           },
    //         },
    //       },
    //       {
    //         sid: "redact-statement-cdk",
    //         dataIdentifier: [
    //           "EmployeeId",
    //           {
    //             "Fn::Join": [
    //               "",
    //               [
    //                 "arn:",
    //                 { Ref: "AWS::Partition" },
    //                 ":dataprotection::aws:data-identifier/EmailAddress",
    //               ],
    //             ],
    //           },
    //         ],
    //         operation: {
    //           deidentify: {
    //             maskConfig: {},
    //           },
    //         },
    //       },
    //     ],
    //   },
    // });
  });
});

describe("subscription filter", () => {
  test("add subscription filter with custom name", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsSpec(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    // WHEN
    const logGroup = new LogGroup(stack, "LogGroup");
    logGroup.addSubscriptionFilter("Subscription", {
      destination: new FakeDestination(),
      filterPattern: FilterPattern.literal("some pattern"),
      filterName: "CustomSubscriptionFilterName",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchLogSubscriptionFilter.CloudwatchLogSubscriptionFilter,
      {
        destination_arn: "arn:bogus",
        filter_pattern: "some pattern",
        log_group_name: stack.resolve(logGroup.logGroupName),
        name: "CustomSubscriptionFilterName",
      },
    );
    // .hasResourceProperties(
    //   "AWS::Logs::SubscriptionFilter",
    //   {
    //     DestinationArn: "arn:bogus",
    //     FilterPattern: "some pattern",
    //     LogGroupName: { Ref: "LogGroupF5B46931" },
    //     FilterName: "CustomSubscriptionFilterName",
    //   },
    // );
  });
});

function dataDrivenTests(
  cases: string[],
  body: (suffix: string) => void,
): void {
  for (let i = 0; i < cases.length; i++) {
    const args = cases[i]; // Need to capture inside loop for safe use inside closure.
    test(`case ${i + 1}`, () => {
      body(args);
    });
  }
}

class FakeDestination implements ILogSubscriptionDestination {
  public bind(_scope: Construct, _sourceLogGroup: ILogGroup) {
    return {
      arn: "arn:bogus",
    };
  }
}
