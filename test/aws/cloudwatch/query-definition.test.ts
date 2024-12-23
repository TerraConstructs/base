// https://github.com/aws/aws-cdk/blob/efbe6debaf1ccebbcd884912ccb38cb13a989061/packages/aws-cdk-lib/aws-logs/test/query-definition.test.ts

import { cloudwatchQueryDefinition } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  LogGroup,
  QueryDefinition,
  QueryString,
} from "../../../src/aws/cloudwatch";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const region = "us-east-1";
const providerConfig = { region };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("query definition", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props to match AWS CDK cross account support
      // account: "1234",
    });
  });
  test("create a query definition", () => {
    // WHEN
    new QueryDefinition(stack, "QueryDefinition", {
      queryDefinitionName: "MyQuery",
      queryString: new QueryString({
        fields: ["@timestamp", "@message"],
        sort: "@timestamp desc",
        limit: 20,
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchQueryDefinition.CloudwatchQueryDefinition,
      {
        name: "MyQuery",
        query_string:
          "fields @timestamp, @message\n| sort @timestamp desc\n| limit 20",
      },
    );
  });

  test("create a query definition against certain log groups", () => {
    // WHEN
    const logGroup = new LogGroup(stack, "MyLogGroup");

    new QueryDefinition(stack, "QueryDefinition", {
      queryDefinitionName: "MyQuery",
      queryString: new QueryString({
        fields: ["@timestamp", "@message"],
        sort: "@timestamp desc",
        limit: 20,
      }),
      logGroups: [logGroup],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchQueryDefinition.CloudwatchQueryDefinition,
      {
        name: "MyQuery",
        query_string:
          "fields @timestamp, @message\n| sort @timestamp desc\n| limit 20",
        log_group_names: [stack.resolve(logGroup.logGroupName)],
      },
    );
  });

  // TODO: deprecate this
  test("create a query definition with all commands", () => {
    // WHEN
    const logGroup = new LogGroup(stack, "MyLogGroup");

    new QueryDefinition(stack, "QueryDefinition", {
      queryDefinitionName: "MyQuery",
      queryString: new QueryString({
        fields: ["@timestamp", "@message"],
        parse: '@message "[*] *" as loggingType, loggingMessage',
        filter: 'loggingType = "ERROR"',
        sort: "@timestamp desc",
        limit: 20,
        display: "loggingMessage",
      }),
      logGroups: [logGroup],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchQueryDefinition.CloudwatchQueryDefinition,
      {
        name: "MyQuery",
        query_string:
          'fields @timestamp, @message\n| parse @message "[*] *" as loggingType, loggingMessage\n| filter loggingType = "ERROR"\n| sort @timestamp desc\n| limit 20\n| display loggingMessage',
      },
    );
  });

  test("create a query definition with multiple statements for supported commands", () => {
    // WHEN
    new QueryDefinition(stack, "QueryDefinition", {
      queryDefinitionName: "MyQuery",
      queryString: new QueryString({
        fields: ["@timestamp", "@message"],
        parseStatements: [
          '@message "[*] *" as loggingType, loggingMessage',
          '@message "<*>: *" as differentLoggingType, differentLoggingMessage',
        ],
        filterStatements: [
          'loggingType = "ERROR"',
          'loggingMessage = "A very strange error occurred!"',
        ],
        sort: "@timestamp desc",
        limit: 20,
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchQueryDefinition.CloudwatchQueryDefinition,
      {
        name: "MyQuery",
        query_string:
          'fields @timestamp, @message\n| parse @message "[*] *" as loggingType, loggingMessage\n| parse @message "<*>: *" as differentLoggingType, differentLoggingMessage\n| filter loggingType = "ERROR"\n| filter loggingMessage = "A very strange error occurred!"\n| sort @timestamp desc\n| limit 20',
      },
    );
  });

  // TODO: Deprecate this
  test("create a query with both single and multi statement properties for filtering and parsing", () => {
    // WHEN
    new QueryDefinition(stack, "QueryDefinition", {
      queryDefinitionName: "MyQuery",
      queryString: new QueryString({
        fields: ["@timestamp", "@message"],
        parse: '@message "[*] *" as loggingType, loggingMessage',
        parseStatements: [
          '@message "[*] *" as loggingType, loggingMessage',
          '@message "<*>: *" as differentLoggingType, differentLoggingMessage',
        ],
        filter: 'loggingType = "ERROR"',
        filterStatements: [
          'loggingType = "ERROR"',
          'loggingMessage = "A very strange error occurred!"',
        ],
        sort: "@timestamp desc",
        limit: 20,
      }),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudwatchQueryDefinition.CloudwatchQueryDefinition,
      {
        name: "MyQuery",
        query_string:
          'fields @timestamp, @message\n| parse @message "[*] *" as loggingType, loggingMessage\n| parse @message "<*>: *" as differentLoggingType, differentLoggingMessage\n| filter loggingType = "ERROR"\n| filter loggingMessage = "A very strange error occurred!"\n| sort @timestamp desc\n| limit 20',
      },
    );
  });
});
