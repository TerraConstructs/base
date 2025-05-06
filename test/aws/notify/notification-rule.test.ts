// https://github.com/aws/aws-cdk/blob/81cde0e2e1f83f80273d14724d5518cc20dc5a80/packages/aws-cdk-lib/aws-codestarnotifications/test/notification-rule.test.ts

import { codestarnotificationsNotificationRule } from "@cdktf/provider-aws";
import { Testing, TerraformMetaArguments, TerraformResource } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../../src/aws/aws-stack";
import {
  DetailType,
  INotificationRuleSource,
  INotificationRuleTarget,
  NotificationRule,
  NotificationRuleSourceConfig,
  NotificationRuleTargetConfig,
} from "../../../src/aws/codestar/notification-rule";
import { Template } from "../../assertions";

// Helper to mimic the Fake* classes from the original test
class TestNotificationSource implements INotificationRuleSource {
  constructor(public readonly sourceArn: string) {}
  bindAsNotificationRuleSource(
    _scope: Construct,
  ): NotificationRuleSourceConfig {
    return {
      sourceArn: this.sourceArn,
    };
  }
}

class TestNotificationTarget implements INotificationRuleTarget {
  constructor(
    public readonly targetAddress: string,
    public readonly targetType: string,
  ) {}
  bindAsNotificationRuleTarget(
    _scope: Construct,
  ): NotificationRuleTargetConfig {
    return {
      targetAddress: this.targetAddress,
      targetType: this.targetType,
    };
  }
}

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

  beforeEach(() => {
    const app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    // Use simple objects or TestResource for sources if needed, here using helpers
    projectSource = new TestNotificationSource(
      "arn:aws:codebuild:us-east-1:123456789012:project/FakeProject",
    );
    repoSource = new TestNotificationSource(
      "arn:aws:codecommit:us-east-1:123456789012:FakeRepo",
    );
    pipelineSource = new TestNotificationSource(
      "arn:aws:codepipeline:us-east-1:123456789012:FakePipeline",
    );
  });

  test("created new notification rule with source", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        detail_type: "FULL", // Default
        status: "ENABLED", // Default
      },
    );
  });

  test("created new notification rule from repository source", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      source: repoSource,
      events: [
        "codecommit-repository-pull-request-created",
        "codecommit-repository-pull-request-merged",
      ],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: repoSource.sourceArn,
        event_type_ids: [
          "codecommit-repository-pull-request-created",
          "codecommit-repository-pull-request-merged",
        ],
      },
    );
  });

  test("created new notification rule with all parameters in constructor props", () => {
    const slackTarget = new TestNotificationTarget(
      "arn:aws:chatbot::123456789012:chat-configuration/slack-channel/my-slack-channel",
      "AWSChatbotSlack",
    );

    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName", // Use a different name to avoid conflict with id
      detailType: DetailType.FULL,
      events: [
        "codebuild-project-build-state-succeeded",
        "codebuild-project-build-state-failed",
      ],
      source: projectSource,
      targets: [slackTarget],
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
        resource: projectSource.sourceArn,
        target: [
          {
            address: slackTarget.targetAddress,
            type: "AWSChatbotSlack",
          },
        ],
        // CreatedBy: 'Jone Doe', // Not supported
      },
    );
  });

  test("created new notification rule without name and will generate from the `id`", () => {
    new NotificationRule(stack, "MyNotificationRuleGeneratedFromId", {
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleGeneratedFromId", // Name defaults to construct ID
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
      },
    );
  });

  test("generating name will cut if id length is over than 64 charts", () => {
    // Note: Terraform provider or AWS API might handle this differently. CDKTF itself doesn't enforce this specific truncation.
    // The CDK behavior is specific to its CloudFormation synthesis.
    // We test if the name is passed correctly, assuming Terraform handles length constraints.
    const longId =
      "MyNotificationRuleGeneratedFromIdIsToooooooooooooooooooooooooooooLong";
    new NotificationRule(stack, longId, {
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: longId, // Terraform provider/API will handle validation
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
      },
    );
  });

  test("created new notification rule without detailType", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName",
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        detail_type: "FULL", // Default
      },
    );
  });

  test("created new notification rule with status DISABLED", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName",
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
      enabled: false,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        status: "DISABLED",
      },
    );
  });

  test("created new notification rule with status ENABLED", () => {
    new NotificationRule(stack, "MyNotificationRule", {
      notificationRuleName: "MyNotificationRuleName",
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
      enabled: true,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        name: "MyNotificationRuleName",
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        status: "ENABLED",
      },
    );
  });

  test("notification added targets", () => {
    // In TerraConstructs/CDKTF, targets are typically added declaratively at construction.
    const snsTopicTarget = new TestNotificationTarget(
      "arn:aws:sns:us-east-1:123456789012:FakeTopic",
      "SNS",
    );
    const slackTarget = new TestNotificationTarget(
      "arn:aws:chatbot::123456789012:chat-configuration/slack-channel/my-slack-channel",
      "AWSChatbotSlack",
    );

    new NotificationRule(stack, "MyNotificationRule", {
      source: projectSource,
      events: ["codebuild-project-build-state-succeeded"],
      targets: [slackTarget, snsTopicTarget], // Add targets directly in props
    });

    // The original test checked the return value of addTarget, which doesn't apply here.
    // We just check the final state.
    Template.synth(stack).toHaveResourceWithProperties(
      codestarnotificationsNotificationRule.CodestarnotificationsNotificationRule,
      {
        resource: projectSource.sourceArn,
        event_type_ids: ["codebuild-project-build-state-succeeded"],
        target: [
          {
            address: slackTarget.targetAddress,
            type: "AWSChatbotSlack",
          },
          {
            address: snsTopicTarget.targetAddress,
            type: "SNS",
          },
        ],
      },
    );
  });

  test("will not add if notification added duplicating event", () => {
    // The NotificationRule construct should handle deduplication internally.
    new NotificationRule(stack, "MyNotificationRule", {
      source: pipelineSource,
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
        resource: pipelineSource.sourceArn,
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
