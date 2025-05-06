// https://github.com/aws/aws-cdk/blob/81cde0e2e1f83f80273d14724d5518cc20dc5a80/packages/aws-cdk-lib/aws-codestarnotifications/test/notification-rule.test.ts

import { codestarnotificationsNotificationRule } from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Construct } from "constructs";
import {
  FakeCodeBuild,
  FakeCodePipeline,
  FakeCodeCommit,
  FakeSlackTarget,
  FakeSnsTopicTarget,
} from "./helpers";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  DetailType,
  INotificationRuleSource,
  INotificationRuleTarget,
  NotificationRule,
  NotificationRuleSourceConfig,
  NotificationRuleTargetConfig,
} from "../../../src/aws/notify/";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("NotificationRule", () => {
  let stack: AwsStack;
  let projectSource: INotificationRuleSource;
  let repoSource: INotificationRuleSource;
  let pipelineSource: INotificationRuleSource;
  let project: FakeCodeBuild;

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    project = new FakeCodeBuild();
  });

  test("created new notification rule with source", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        detail_type: "FULL", // Default
        status: "ENABLED", // Default
      },
    );
  });

  test("created new notification rule from repository source", () => {
    const repository = new FakeCodeCommit();
    new NotificationRule(stack, "MyNotificationRule", {
      source: repository,
      events: [
        "codecommit-repository-pull-request-created",
        "codecommit-repository-pull-request-merged",
      ],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: repository.repositoryArn,
        event_type_ids: [
          "codecommit-repository-pull-request-created",
          "codecommit-repository-pull-request-merged",
        ],
      },
    );
  });

  test("created new notification rule with all parameters in constructor props", () => {
    const slack = new FakeSlackTarget();

    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName", // Use a different name to avoid conflict with id
      detailType: DetailType.FULL,
      events: [
        "codebuild-project-build-state-succeeded",
        "codebuild-project-build-state-failed",
      ],
      source: project,
      targets: [slack],
      // createdBy: 'Jone Doe', // Not supported in Terraform resource
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        detail_type: "FULL",
        event_type_ids: [
          "codebuild-project-build-state-succeeded",
          "codebuild-project-build-state-failed",
        ],
        resource: project.projectArn,
        target: [
          {
            address: slack.slackChannelConfigurationArn,
            type: "AWSChatbotSlack",
          },
        ],
        // CreatedBy: 'Jone Doe', // Not supported
      },
    );
  });

  test("created new notification rule without name and will generate from the `id`", () => {
    new NotificationRule(stack, "MyNotificationRuleGeneratedFromId", {
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "TestStackMyNotificationRuleGeneratedFromIdE450151A", // Name defaults to construct ID
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
      },
    );
  });

  test("generating name will cut if id length is over than 64 charts", () => {
    const longId =
      "MyNotificationRuleGeneratedFromIdIsToooooooooooooooooooooooooooooLong";
    new NotificationRule(stack, longId, {
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "TestStackMyNotificationRuleGooooooooooooooooooooooooLongC320B51B",
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
      },
    );
  });

  test("created new notification rule without detailType", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName",
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        detail_type: "FULL", // Default
      },
    );
  });

  test("created new notification rule with status DISABLED", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName",
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
      enabled: false,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        status: "DISABLED",
      },
    );
  });

  test("created new notification rule with status ENABLED", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName",
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
      enabled: true,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        status: "ENABLED",
      },
    );
  });

  test("notification added targets", () => {
    const topic = new FakeSnsTopicTarget();
    const slack = new FakeSlackTarget();

    const rule = new NotificationRule(stack, "MyNotificationRule", {
      source: project,
      events: ["codebuild-project-build-state-succeeded"],
    });

    rule.addTarget(slack);

    expect(rule.addTarget(topic)).toEqual(true);

    // The original test checked the return value of addTarget, which doesn't apply here.
    // We just check the final state.
    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: project.projectArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        target: [
          {
            address: slack.slackChannelConfigurationArn,
            type: "AWSChatbotSlack",
          },
          {
            address: topic.topicArn,
            type: "SNS",
          },
        ],
      },
    );
  });

  test("will not add if notification added duplicating event", () => {
    const pipeline = new FakeCodePipeline();

    // The NotificationRule construct should handle deduplication internally.
    new NotificationRule(stack, "MyNotificationRule", {
      source: pipeline,
      events: [
        "codepipeline-pipeline-pipeline-execution-succeeded",
        "codepipeline-pipeline-pipeline-execution-failed",
        "codepipeline-pipeline-pipeline-execution-succeeded", // Duplicate
        "codepipeline-pipeline-pipeline-execution-canceled",
      ],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: pipeline.pipelineArn,
        event_type_ids: [
          // Expect duplicates to be removed by the construct
          "codepipeline-pipeline-pipeline-execution-succeeded",
          "codepipeline-pipeline-pipeline-execution-failed",
          "codepipeline-pipeline-pipeline-execution-canceled",
        ],
      },
    );
  });
});

// describe('NotificationRule from imported', () => {
//   // TerraConstructs NotificationRule does not currently support fromNotificationRuleArn
//   // Skipping these tests.
// });
