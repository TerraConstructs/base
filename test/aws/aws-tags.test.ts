import { autoscalingGroup, s3Bucket } from "@cdktn/provider-aws";
import { Lazy, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { Construct } from "constructs";
import { AwsStack } from "../../src/aws";
import { Tags } from "../../src/aws/aws-tags";
import { Template } from "../assertions";

const environmentName = "Test";
const gridUUID = "a123e456-e89b-12d3";

describe("Tags", () => {
  describe("aws_autoscaling_group", () => {
    // Terraform deviation: `aws_autoscaling_group` renders tags as repeated
    // `tag { key, value, propagate_at_launch }` blocks rather than the flat
    // `tags` map most provider resources expose.
    test("adds a structured tag block that propagates at launch by default", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope);

      // WHEN
      Tags.of(scope).add("superfood", "acai");

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingGroup.AutoscalingGroup,
        {
          tag: [
            {
              key: "superfood",
              value: "acai",
              propagate_at_launch: true,
            },
          ],
        },
      );
    });

    test("applyToLaunchedInstances false renders propagate_at_launch false", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope);

      // WHEN
      Tags.of(scope).add("notsuper", "caramel", {
        applyToLaunchedInstances: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingGroup.AutoscalingGroup,
        {
          tag: [
            {
              key: "notsuper",
              value: "caramel",
              propagate_at_launch: false,
            },
          ],
        },
      );
    });

    test("two writes for the same key emit a single tag block", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope);

      // WHEN
      Tags.of(scope).add("superfood", "acai");
      Tags.of(scope).add("superfood", "durian", {
        applyToLaunchedInstances: false,
      });

      // THEN - the last write wins, in the position of the first
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingGroup.AutoscalingGroup,
        {
          tag: [
            {
              key: "superfood",
              value: "durian",
              propagate_at_launch: false,
            },
          ],
        },
      );
    });

    test("preserves unrelated tag blocks set on the L1 resource", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope, {
        tag: [
          {
            key: "AmazonECSManaged",
            value: "",
            propagateAtLaunch: true,
          },
        ],
      });

      // WHEN
      Tags.of(scope).add("superfood", "acai");

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingGroup.AutoscalingGroup,
        {
          tag: [
            {
              key: "AmazonECSManaged",
              value: "",
              propagate_at_launch: true,
            },
            {
              key: "superfood",
              value: "acai",
              propagate_at_launch: true,
            },
          ],
        },
      );
    });

    test("a Tags.of() write replaces a pre-existing L1 tag block for the same key", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope, {
        tag: [
          {
            key: "superfood",
            value: "caramel",
            propagateAtLaunch: false,
          },
          {
            key: "AmazonECSManaged",
            value: "",
            propagateAtLaunch: true,
          },
        ],
      });

      // WHEN
      Tags.of(scope).add("superfood", "acai");

      // THEN - one block per key, aspect wins, unrelated entry survives
      Template.synth(stack).toHaveResourceWithProperties(
        autoscalingGroup.AutoscalingGroup,
        {
          tag: [
            {
              key: "superfood",
              value: "acai",
              propagate_at_launch: true,
            },
            {
              key: "AmazonECSManaged",
              value: "",
              propagate_at_launch: true,
            },
          ],
        },
      );
    });

    test("throws rather than discarding an unresolved tag list", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope, {
        tag: Lazy.anyValue({
          produce: () => [
            { key: "AmazonECSManaged", value: "", propagate_at_launch: true },
          ],
        }) as any,
      });

      // WHEN
      Tags.of(scope).add("superfood", "acai");

      // THEN
      expect(() => Template.synth(stack)).toThrow(
        /Cannot add tag "superfood" to .*unresolved value \(IResolvable\)/s,
      );
    });

    test("includeResourceTypes tags the ASG without tagging descendants", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope);
      new s3Bucket.S3Bucket(scope, "Bucket", {});

      // WHEN
      Tags.of(scope).add("superfood", "acai", {
        includeResourceTypes: ["aws_autoscaling_group"],
      });

      // THEN
      const template = Template.synth(stack);
      template.toHaveResourceWithProperties(autoscalingGroup.AutoscalingGroup, {
        tag: [
          {
            key: "superfood",
            value: "acai",
            propagate_at_launch: true,
          },
        ],
      });
      Template.resources(stack, s3Bucket.S3Bucket).toEqual([
        expect.not.objectContaining({ tags: expect.anything() }),
      ]);
    });

    test("excludeResourceTypes skips the ASG but still tags descendants", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope);
      new s3Bucket.S3Bucket(scope, "Bucket", {});

      // WHEN
      Tags.of(scope).add("superfood", "acai", {
        excludeResourceTypes: ["aws_autoscaling_group"],
      });

      // THEN
      Template.resources(stack, autoscalingGroup.AutoscalingGroup).toEqual([
        expect.not.objectContaining({ tag: expect.anything() }),
      ]);
      Template.synth(stack).toHaveResourceWithProperties(s3Bucket.S3Bucket, {
        tags: { superfood: "acai" },
      });
    });

    test("tags the whole subtree by default", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      minimalAsg(scope);
      new s3Bucket.S3Bucket(scope, "Bucket", {});

      // WHEN
      Tags.of(scope).add("superfood", "acai");

      // THEN
      const template = Template.synth(stack);
      template.toHaveResourceWithProperties(autoscalingGroup.AutoscalingGroup, {
        tag: [
          {
            key: "superfood",
            value: "acai",
            propagate_at_launch: true,
          },
        ],
      });
      template.toHaveResourceWithProperties(s3Bucket.S3Bucket, {
        tags: { superfood: "acai" },
      });
    });
  });

  describe("flat tags map resources", () => {
    test("merges into the existing tags map", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      new s3Bucket.S3Bucket(scope, "Bucket", {
        tags: { existing: "kept" },
      });

      // WHEN
      Tags.of(scope).add("superfood", "acai");

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(s3Bucket.S3Bucket, {
        tags: { existing: "kept", superfood: "acai" },
      });
    });

    test("applyToLaunchedInstances does not affect the flat tags map", () => {
      // GIVEN
      const stack = getStack();
      const scope = new Construct(stack, "Scope");
      new s3Bucket.S3Bucket(scope, "Bucket", {});

      // WHEN
      Tags.of(scope).add("superfood", "acai", {
        applyToLaunchedInstances: false,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(s3Bucket.S3Bucket, {
        tags: { superfood: "acai" },
      });
    });
  });
});

function getStack(): AwsStack {
  return new AwsStack(Testing.app(), "TestStack", {
    environmentName,
    gridUUID,
  });
}

function minimalAsg(
  scope: Construct,
  config: Partial<autoscalingGroup.AutoscalingGroupConfig> = {},
): autoscalingGroup.AutoscalingGroup {
  return new autoscalingGroup.AutoscalingGroup(scope, "Asg", {
    name: "my-asg",
    minSize: 0,
    maxSize: 1,
    ...config,
  });
}
