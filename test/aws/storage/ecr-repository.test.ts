// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-ecr/test/repository.test.ts

import { EOL } from "os";
import {
  ecrRepository,
  ecrRepositoryPolicy,
  cloudwatchEventRule,
  // lambdaFunction,
  dataAwsIamPolicyDocument,
  iamRolePolicy,
  ecrLifecyclePolicy,
} from "@cdktf/provider-aws";
import { App, Testing, Lazy, TerraformOutput, ref, Token } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as kms from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import { IRuleTarget } from "../../../src/aws/notify";
import {
  Repository,
  TagStatus,
  TagMutability,
  RepositoryEncryption,
} from "../../../src/aws/storage";
import { Duration } from "../../../src/duration";
// TODO: Implement removal policy?
// import { RemovalPolicy } from "../../../src/removal-policy";
import { Annotations, Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("repository", () => {
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

  test("construct repository", () => {
    // WHEN
    new Repository(stack, "Repo");

    // THEN
    const template = new Template(stack);
    template.resourceCountIs(ecrRepository.EcrRepository, 1);
    // TODO: implement retain policy by default?
    // template.expect.toHaveResourceWithProperties(ecrRepository.EcrRepository, {
    //   lifecycle: {
    //     prevent_destroy: true,
    //   },
    // });
  });

  test("repository creation with imageScanOnPush", () => {
    // GIVEN
    const noScanStack = new AwsStack(app, "NoScanStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const scanStack = new AwsStack(app, "ScanStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });

    // WHEN
    new Repository(noScanStack, "NoScanRepo", { imageScanOnPush: false });
    new Repository(scanStack, "ScanRepo", { imageScanOnPush: true });

    // THEN
    Template.synth(noScanStack).toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        image_scanning_configuration: {
          scan_on_push: false,
        },
      },
    );
    Template.synth(scanStack).toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        image_scanning_configuration: {
          scan_on_push: true,
        },
      },
    );
  });

  test("tag-based lifecycle policy with tagPrefixList", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({ tagPrefixList: ["abc"], maxImageCount: 1 });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "tagged",
                tagPrefixList: ["abc"],
                countType: "imageCountMoreThan",
                countNumber: 1,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("tag-based lifecycle policy with tagPatternList", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({ tagPatternList: ["abc*"], maxImageCount: 1 });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "tagged",
                tagPatternList: ["abc*"],
                countType: "imageCountMoreThan",
                countNumber: 1,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("both tagPrefixList and tagPatternList cannot be specified together in a rule", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // THEN
    expect(() => {
      repo.addLifecycleRule({
        tagPrefixList: ["abc"],
        tagPatternList: ["abc*"],
        maxImageCount: 1,
      });
    }).toThrow(
      /Both tagPrefixList and tagPatternList cannot be specified together in a rule/,
    );
  });

  test("tagPrefixList can only be specified when tagStatus is set to Tagged", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // THEN
    expect(() => {
      repo.addLifecycleRule({
        tagStatus: TagStatus.ANY,
        tagPrefixList: ["abc"],
        maxImageCount: 1,
      });
    }).toThrow(
      /tagPrefixList and tagPatternList can only be specified when tagStatus is set to Tagged/,
    );
  });

  test("tagPatternList can only be specified when tagStatus is set to Tagged", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // THEN
    expect(() => {
      repo.addLifecycleRule({
        tagStatus: TagStatus.ANY,
        tagPatternList: ["abc*"],
        maxImageCount: 1,
      });
    }).toThrow(
      /tagPrefixList and tagPatternList can only be specified when tagStatus is set to Tagged/,
    );
  });

  test("TagStatus.Tagged requires the specification of a tagPrefixList or a tagPatternList", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // THEN
    expect(() => {
      repo.addLifecycleRule({ tagStatus: TagStatus.TAGGED, maxImageCount: 1 });
    }).toThrow(
      /TagStatus.Tagged requires the specification of a tagPrefixList or a tagPatternList/,
    );
  });

  test("A tag pattern can contain four wildcard characters", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({ tagPatternList: ["abc*d*e*f*"], maxImageCount: 1 });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "tagged",
                tagPatternList: ["abc*d*e*f*"],
                countType: "imageCountMoreThan",
                countNumber: 1,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("A tag pattern cannot contain more than four wildcard characters", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // THEN
    expect(() => {
      repo.addLifecycleRule({
        tagPatternList: ["abc*d*e*f*g*h"],
        maxImageCount: 1,
      });
    }).toThrow(
      /A tag pattern cannot contain more than four wildcard characters/,
    );
  });

  test("image tag mutability can be set", () => {
    // GIVEN
    new Repository(stack, "Repo", {
      imageTagMutability: TagMutability.IMMUTABLE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        image_tag_mutability: "IMMUTABLE",
      },
    );
  });

  test("emptyOnDelete can be set", () => {
    // GIVEN
    new Repository(stack, "Repo", {
      emptyOnDelete: true,
      // removalPolicy: RemovalPolicy.DESTROY,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        force_delete: true,
      },
    );
  });

  // TODO: implement removal policy
  // test("emptyOnDelete requires 'RemovalPolicy.DESTROY'", () => {
  //   // THEN
  //   expect(() => {
  //     new Repository(stack, "Repo", { emptyOnDelete: true });
  //   }).toThrow(
  //     "Cannot use 'emptyOnDelete' property on a repository without setting removal policy to 'DESTROY'.",
  //   );
  // });

  test("add day-based lifecycle policy", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({
      maxImageAge: Duration.days(5),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "any",
                countType: "sinceImagePushed",
                countNumber: 5,
                countUnit: "days",
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("add count-based lifecycle policy", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({
      maxImageCount: 5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "any",
                countType: "imageCountMoreThan",
                countNumber: 5,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("mixing numbered and unnumbered rules", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({
      tagStatus: TagStatus.TAGGED,
      tagPrefixList: ["a"],
      maxImageCount: 5,
    });
    repo.addLifecycleRule({
      rulePriority: 10,
      tagStatus: TagStatus.TAGGED,
      tagPrefixList: ["b"],
      maxImageCount: 5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 10,
              selection: {
                tagStatus: "tagged",
                tagPrefixList: ["b"],
                countType: "imageCountMoreThan",
                countNumber: 5,
              },
              action: { type: "expire" },
            },
            {
              rulePriority: 11,
              selection: {
                tagStatus: "tagged",
                tagPrefixList: ["a"],
                countType: "imageCountMoreThan",
                countNumber: 5,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("tagstatus Any is automatically sorted to the back", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addLifecycleRule({ maxImageCount: 5 });
    repo.addLifecycleRule({
      tagStatus: TagStatus.TAGGED,
      tagPrefixList: ["important"],
      maxImageCount: 999,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "tagged",
                tagPrefixList: ["important"],
                countType: "imageCountMoreThan",
                countNumber: 999,
              },
              action: { type: "expire" },
            },
            {
              rulePriority: 2,
              selection: {
                tagStatus: "any",
                countType: "imageCountMoreThan",
                countNumber: 5,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  test("lifecycle rules can be added upon initialization", () => {
    // WHEN
    const repo = new Repository(stack, "Repo", {
      lifecycleRules: [{ maxImageCount: 3 }],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrLifecyclePolicy.EcrLifecyclePolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              selection: {
                tagStatus: "any",
                countType: "imageCountMoreThan",
                countNumber: 3,
              },
              action: { type: "expire" },
            },
          ],
        }),
      },
    );
  });

  // TODO: Does returning a token instead of an Arn like string cause issues with other Constructs?
  test("calculate repository URI", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    new TerraformOutput(stack, "RepoUri", {
      value: repo.repositoryUri,
    });

    // THEN
    const template = new Template(stack);
    expect(template.outputByName("RepoUri")).toMatchObject({
      value: "${aws_ecr_repository.Repo_02AC86CF.repository_url}",
      // value:
      //   '${element(split(":", aws_ecr_repository.Repo_02AC86CF.arn), 4)}.dkr.ecr.${element(split(":", aws_ecr_repository.Repo_02AC86CF.arn), 3)}.${data.aws_partition.Partitition.dns_suffix}/${aws_ecr_repository.Repo_02AC86CF.name}',
    });
  });

  // TODO: Does returning a token instead of an Arn like string cause issues with other Constructs?
  test("calculate registry URI", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    new TerraformOutput(stack, "RegistryUri", {
      value: repo.registryUri,
    });

    // THEN
    const template = new Template(stack);
    expect(template.outputByName("RegistryUri")).toMatchObject({
      value: "${aws_ecr_repository.Repo_02AC86CF.registry_id}",
      // '${"${data.aws_caller_identity.CallerIdentity.account_id}.dkr.ecr.${providerConfig.region}.${stack.urlSuffix}}',
      // value:
      //   '${element(split(":", aws_ecr_repository.Repo_02AC86CF.arn), 4)}.dkr.ecr.${element(split(":", aws_ecr_repository.Repo_02AC86CF.arn), 3)}.${data.aws_partition.Partitition.dns_suffix}',
    });
  });

  test("import with concrete arn", () => {
    // WHEN
    const repo2 = Repository.fromRepositoryArn(
      stack,
      "repo",
      "arn:aws:ecr:us-east-1:585695036304:repository/foo/bar/foo/fooo",
    );

    // THEN
    expect(stack.resolve(repo2.repositoryArn)).toBe(
      "arn:aws:ecr:us-east-1:585695036304:repository/foo/bar/foo/fooo",
    );
    expect(stack.resolve(repo2.repositoryName)).toBe("foo/bar/foo/fooo");
  });

  test("import with arn without /repository", () => {
    // GIVEN
    const invalidArn = "arn:aws:ecr:us-east-1:123456789012:foo-ecr-repo-name";

    // THEN
    expect(() => {
      Repository.fromRepositoryArn(stack, "repo", invalidArn);
    }).toThrow(
      `Repository arn should be in the format 'arn:<PARTITION>:ecr:<REGION>:<ACCOUNT>:repository/<NAME>', got ${invalidArn}.`,
    );
  });

  test("fails if importing with token arn and no name", () => {
    // WHEN/THEN
    expect(() => {
      Repository.fromRepositoryArn(
        stack,
        "arn",
        Token.asString(ref("Boom.boom")),
      );
    }).toThrow(
      '"repositoryArn" is a late-bound value, and therefore "repositoryName" is required. Use `fromRepositoryAttributes` instead',
    );
  });

  test("import with token arn and repository name", () => {
    // WHEN
    const repo = Repository.fromRepositoryAttributes(stack, "Repo", {
      repositoryArn: Token.asString(ref("Boom.arn")),
      repositoryName: Token.asString(ref("Boom.name")),
    });
    new TerraformOutput(stack, "RepoArn", {
      value: repo.repositoryArn,
    });
    new TerraformOutput(stack, "RepoName", {
      value: repo.repositoryName,
    });

    // THEN
    const template = new Template(stack);
    expect(template.outputByName("RepoArn")).toMatchObject({
      value: "${Boom.arn}",
    });
    expect(template.outputByName("RepoName")).toMatchObject({
      value: "${Boom.name}",
    });
  });

  test("import only with a repository name (arn is deduced)", () => {
    // WHEN
    const repo = Repository.fromRepositoryName(stack, "just-name", "my-repo");
    new TerraformOutput(stack, "RepoArn", {
      value: repo.repositoryArn,
    });
    new TerraformOutput(stack, "RepoName", {
      value: repo.repositoryName,
    });

    // THEN
    const template = new Template(stack);
    expect(template.outputByName("RepoArn")).toMatchObject({
      value:
        "arn:${data.aws_partition.Partitition.partition}:ecr:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:repository/my-repo",
    });
    expect(template.outputByName("RepoName")).toMatchObject({
      value: "my-repo",
    });
  });

  test("arnForLocalRepository can be used to render an ARN for a local repository", () => {
    // GIVEN
    const repoName = Token.asString(ref("Boom.Name"));

    // WHEN
    const repo = Repository.fromRepositoryAttributes(stack, "Repo", {
      repositoryArn: Repository.arnForLocalRepository(repoName, stack),
      repositoryName: repoName,
    });
    new TerraformOutput(stack, "RepoArn", {
      value: repo.repositoryArn,
    });
    new TerraformOutput(stack, "RepoName", {
      value: repo.repositoryName,
    });

    // THEN
    const template = new Template(stack);
    expect(template.outputByName("RepoName")).toMatchObject({
      value: "${Boom.Name}",
    });
    expect(template.outputByName("RepoArn")).toMatchObject({
      value:
        "arn:${data.aws_partition.Partitition.partition}:ecr:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:repository/${Boom.Name}",
    });
  });

  test("resource policy", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["*"],
        principals: [new iam.AnyPrincipal()],
      }),
    );

    // THEN
    const template = new Template(stack);
    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["*"],
            effect: "Allow",
            principals: [
              {
                type: "AWS",
                identifiers: ["*"], // AnyPrincipal
              },
            ],
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(
      ecrRepositoryPolicy.EcrRepositoryPolicy,
      {
        repository: stack.resolve(repo.repositoryName),
        policy:
          "${data.aws_iam_policy_document.Repo_PolicyDocument_F9E32824.json}",
      },
    );
  });

  test("fails if repository policy has no actions", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ArnPrincipal("arn")],
      }),
    );

    // THEN
    expect(() => app.synth()).toThrow(
      /A PolicyStatement must specify at least one 'action' or 'notAction'./,
    );
  });

  test("fails if repository policy has no IAM principals", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["ecr:*"],
      }),
    );

    // THEN
    expect(() => app.synth()).toThrow(
      /A PolicyStatement used in a resource-based policy must specify at least one IAM principal/,
    );
  });

  test("warns if repository policy has resources", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["ecr:*"],
        principals: [new iam.AnyPrincipal()],
      }),
    );

    // THEN
    Annotations.fromStack(stack).hasWarnings({
      message:
        // todo: addWarningV2 - [ack: @terraform-cdk-constructs/constructs:noResourceStatements]
        "ECR resource policy does not allow resource statements.",
    });
  });

  test("does not warn if repository policy does not have resources", () => {
    // GIVEN
    const repo = new Repository(stack, "Repo");

    // WHEN
    repo.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["ecr:*"],
        principals: [new iam.AnyPrincipal()],
      }),
    );

    // THEN
    Annotations.fromStack(stack).hasNoWarnings({
      message:
        "ECR resource policy does not allow resource statements. [ack: @terraform-cdk-constructs/constructs:noResourceStatements]",
    });
  });

  test("default encryption configuration", () => {
    // WHEN
    new Repository(stack, "Repo", {
      encryption: RepositoryEncryption.AES_256,
    });

    // THEN
    Template.synth(stack).not.toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        encryption_configuration: expect.anything(),
        // // AES256 is set to undefined on purpose...
        // [
        //   {
        //     encryption_type: "AES256",
        //   },
        // ],
      },
    );
  });

  test("kms encryption configuration", () => {
    // WHEN
    new Repository(stack, "Repo", { encryption: RepositoryEncryption.KMS });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        encryption_configuration: [
          {
            encryption_type: "KMS",
          },
        ],
      },
    );
  });

  test("kms encryption with custom kms configuration", () => {
    // GIVEN
    const custom_key = new kms.Key(stack, "Key");

    // WHEN
    new Repository(stack, "Repo", { encryptionKey: custom_key });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecrRepository.EcrRepository,
      {
        encryption_configuration: [
          {
            encryption_type: "KMS",
            kms_key: stack.resolve(custom_key.keyArn),
          },
        ],
      },
    );
  });

  test("fails if with custom kms key and AES256 as encryption", () => {
    // GIVEN
    const custom_key = new kms.Key(stack, "Key");

    // THEN
    expect(() => {
      new Repository(stack, "Repo", {
        encryption: RepositoryEncryption.AES_256,
        encryptionKey: custom_key,
      });
    }).toThrow(
      "encryptionKey is specified, so 'encryption' must be set to KMS (value: AES256)",
    );
  });

  // TODO: implement retain policy  by default?
  // test('removal policy is "Retain" by default', () => {
  //   // GIVEN
  //   new Repository(stack, "Repo");

  //   // THEN
  //   Template.synth(stack).toHaveResourceWithProperties(
  //     ecrRepository.EcrRepository,
  //     {
  //       lifecycle: {
  //         prevent_destroy: true,
  //       },
  //     },
  //   );
  // });

  // // TODO: Re-enable this test when RemovalPolicy is implemented
  // test('"Delete" removal policy can be set explicitly', () => {
  //   // GIVEN
  //   new Repository(stack, "Repo", {
  //     // removalPolicy: RemovalPolicy.DESTROY,
  //   });

  //   // THEN
  //   Template.synth(stack).toHaveResourceWithProperties(
  //     ecrRepository.EcrRepository,
  //     {
  //       lifecycle: {
  //         prevent_destroy: false,
  //       },
  //     },
  //   );
  // });

  describe("events", () => {
    const mockTarget: IRuleTarget = {
      bind: () => ({ arn: "ARN", id: "" }),
    };

    test("onImagePushed without imageTag creates the correct event", () => {
      const repo = new Repository(stack, "Repo");

      repo.onCloudTrailImagePushed("EventRule", {
        target: mockTarget,
      });

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: JSON.stringify({
            source: ["aws.ecr"],
            "detail-type": ["AWS API Call via CloudTrail"],
            detail: {
              requestParameters: {
                repositoryName: [stack.resolve(repo.repositoryName)],
              },
              eventName: ["PutImage"],
            },
          }),
          state: "ENABLED",
        },
      );
    });

    test("onImageScanCompleted without imageTags creates the correct event", () => {
      const repo = new Repository(stack, "Repo");

      repo.onImageScanCompleted("EventRule", {
        target: mockTarget,
      });

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: JSON.stringify({
            source: ["aws.ecr"],
            "detail-type": ["ECR Image Scan"],
            detail: {
              "repository-name": [stack.resolve(repo.repositoryName)],
              "scan-status": ["COMPLETE"],
            },
          }),
          state: "ENABLED",
        },
      );
    });

    test("onImageScanCompleted with one imageTag creates the correct event", () => {
      const repo = new Repository(stack, "Repo");

      repo.onImageScanCompleted("EventRule", {
        imageTags: ["some-tag"],
        target: mockTarget,
      });

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: JSON.stringify({
            source: ["aws.ecr"],
            "detail-type": ["ECR Image Scan"],
            detail: {
              "repository-name": [stack.resolve(repo.repositoryName)],
              "scan-status": ["COMPLETE"],
              "image-tags": ["some-tag"],
            },
          }),
          state: "ENABLED",
        },
      );
    });

    test("onImageScanCompleted with multiple imageTags creates the correct event", () => {
      const repo = new Repository(stack, "Repo");

      repo.onImageScanCompleted("EventRule", {
        imageTags: ["tag1", "tag2", "tag3"],
        target: mockTarget,
      });

      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: JSON.stringify({
            source: ["aws.ecr"],
            "detail-type": ["ECR Image Scan"],
            detail: {
              "repository-name": [stack.resolve(repo.repositoryName)],
              "scan-status": ["COMPLETE"],
              "image-tags": ["tag1", "tag2", "tag3"],
            },
          }),
          state: "ENABLED",
        },
      );
    });

    test("grant adds appropriate resource-*", () => {
      // GIVEN
      const repo = new Repository(stack, "TestHarnessRepo");

      // WHEN
      repo.grantPull(new iam.AnyPrincipal());

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
              ],
              effect: "Allow",
              resources: [stack.resolve(repo.repositoryArn)],
              principals: [
                {
                  type: "AWS",
                  identifiers: ["*"], // AnyPrincipal
                },
              ],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        ecrRepositoryPolicy.EcrRepositoryPolicy,
        {
          policy:
            "${data.aws_iam_policy_document.TestHarnessRepo_PolicyDocument_97B0BDFA.json}",
        },
      );
    });

    test("grant push", () => {
      // GIVEN
      const repo = new Repository(stack, "TestHarnessRepo");

      // WHEN
      repo.grantPush(new iam.AnyPrincipal());

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:CompleteLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:InitiateLayerUpload",
                "ecr:BatchCheckLayerAvailability",
                "ecr:PutImage",
              ],
              effect: "Allow",
              resources: [stack.resolve(repo.repositoryArn)],
              principals: [
                {
                  type: "AWS",
                  identifiers: ["*"], // AnyPrincipal
                },
              ],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        ecrRepositoryPolicy.EcrRepositoryPolicy,
        {
          policy:
            "${data.aws_iam_policy_document.TestHarnessRepo_PolicyDocument_97B0BDFA.json}",
        },
      );
    });

    test("grant pull for role", () => {
      // GIVEN
      const repo = new Repository(stack, "TestHarnessRepo");

      // WHEN
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      });
      repo.grantPull(role);

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
              ],
              effect: "Allow",
              resources: [stack.resolve(repo.repositoryArn)],
            },
            {
              actions: ["ecr:GetAuthorizationToken"],
              effect: "Allow",
              resources: ["*"],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        iamRolePolicy.IamRolePolicy,
        {
          policy:
            "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
        },
      );
    });

    test("grant push for role", () => {
      // GIVEN
      const repo = new Repository(stack, "TestHarnessRepo");

      // WHEN
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      });
      repo.grantPush(role);

      // THEN
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:CompleteLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:InitiateLayerUpload",
                "ecr:BatchCheckLayerAvailability",
                "ecr:PutImage",
              ],
              resources: [stack.resolve(repo.repositoryArn)],
              effect: "Allow",
            },
            {
              actions: ["ecr:GetAuthorizationToken"],
              resources: ["*"],
              effect: "Allow",
            },
          ],
        },
      );
    });

    test("grant pullpush for role", () => {
      // GIVEN
      const repo = new Repository(stack, "TestHarnessRepo");

      // WHEN
      const role = new iam.Role(stack, "Role", {
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      });
      repo.grantPullPush(role);

      // THEN
      Template.synth(stack).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:CompleteLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:InitiateLayerUpload",
                "ecr:PutImage",
              ],
              effect: "Allow",
              resources: [stack.resolve(repo.repositoryArn)],
            },
            {
              actions: ["ecr:GetAuthorizationToken"],
              resources: ["*"],
              effect: "Allow",
            },
          ],
        },
      );
    });

    test("grant read adds appropriate permissions", () => {
      // GIVEN
      const repo = new Repository(stack, "TestRepo");

      // WHEN
      repo.grantRead(new iam.AnyPrincipal());

      // THEN
      const template = new Template(stack);
      template.expect.toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["ecr:DescribeRepositories", "ecr:DescribeImages"],
              effect: "Allow",
              resources: [stack.resolve(repo.repositoryArn)],
              principals: [
                {
                  type: "AWS",
                  identifiers: ["*"], // AnyPrincipal
                },
              ],
            },
          ],
        },
      );
      template.expect.toHaveResourceWithProperties(
        ecrRepositoryPolicy.EcrRepositoryPolicy,
        {
          policy:
            "${data.aws_iam_policy_document.TestRepo_PolicyDocument_52E0A085.json}",
        },
      );
    });

    test("onEvent adds a rule for the repository", () => {
      // GIVEN
      const repo = new Repository(stack, "TestRepo");

      // WHEN
      repo.onEvent("EcrOnEventRule", {
        target: mockTarget,
      });

      // THEN
      Template.synth(stack).toHaveResourceWithProperties(
        cloudwatchEventRule.CloudwatchEventRule,
        {
          event_pattern: JSON.stringify({
            source: ["aws.ecr"],
            detail: {
              "repository-name": [
                "${aws_ecr_repository.TestRepo_08D311A0.name}",
              ],
            },
          }),
        },
      );
    });
  });

  describe("repository name validation", () => {
    test("repository name validations", () => {
      expect(
        () =>
          new Repository(stack, "Repo1", {
            repositoryName: "abc-xyz-34ab",
          }),
      ).not.toThrow();

      expect(
        () =>
          new Repository(stack, "Repo2", {
            repositoryName: "124/pp-33",
          }),
      ).not.toThrow();
    });

    test("repository name validation skips tokenized values", () => {
      expect(
        () =>
          new Repository(stack, "Repo", {
            repositoryName: Lazy.stringValue({ produce: () => "_REPO" }),
          }),
      ).not.toThrow();
    });

    test("fails with message on invalid repository names", () => {
      const repositoryName = `-repositoRy.--${new Array(256).join("$")}`;
      const expectedErrors = [
        `Invalid ECR repository name (value: ${repositoryName})`,
        "Repository name must be at least 2 and no more than 256 characters",
        "Repository name must start with a letter and can only contain lowercase letters, numbers, hyphens, underscores, periods and forward slashes",
      ].join(EOL);

      expect(
        () =>
          new Repository(stack, "Repo", {
            repositoryName,
          }),
      ).toThrow(expectedErrors);
    });

    test("fails if repository name has less than 2 or more than 256 characters", () => {
      expect(
        () =>
          new Repository(stack, "Repo1", {
            repositoryName: "a",
          }),
      ).toThrow(/at least 2/);

      expect(
        () =>
          new Repository(stack, "Repo2", {
            repositoryName: new Array(258).join("x"),
          }),
      ).toThrow(/no more than 256/);
    });

    test("fails if repository name does not follow the specified pattern", () => {
      const errorMsg =
        "Repository name must start with a letter and can only contain lowercase letters, numbers, hyphens, underscores, periods and forward slashes";
      expect(
        () => new Repository(stack, "Repo1", { repositoryName: "aAa" }),
      ).toThrow(errorMsg);
      expect(
        () => new Repository(stack, "Repo2", { repositoryName: "a--a" }),
      ).toThrow(errorMsg);
      expect(
        () => new Repository(stack, "Repo3", { repositoryName: "a./a-a" }),
      ).toThrow(errorMsg);
      expect(
        () => new Repository(stack, "Repo4", { repositoryName: "a//a-a" }),
      ).toThrow(errorMsg);
    });

    test("return value addToResourcePolicy", () => {
      // GIVEN
      const policyStmt1 = new iam.PolicyStatement({
        actions: ["*"],
        principals: [new iam.AnyPrincipal()],
      });
      const policyStmt2 = new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
        principals: [new iam.AnyPrincipal()],
      });
      const policyText1 = {
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "*", Principal: { AWS: "*" } }],
      };
      const policyText2 = {
        Version: "2012-10-17",
        Statement: [
          { Effect: "Allow", Action: "*", Principal: { AWS: "*" } },
          {
            Effect: "Deny",
            Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
            Principal: { AWS: "*" },
          },
        ],
      };

      // WHEN
      const artifact1 = new Repository(stack, "Repo1").addToResourcePolicy(
        policyStmt1,
      );
      const repo = new Repository(stack, "Repo2");
      repo.addToResourcePolicy(policyStmt1);
      const artifact2 = repo.addToResourcePolicy(policyStmt2);

      // THEN
      expect(stack.resolve(artifact1.statementAdded)).toEqual(true);
      expect(
        stack.resolve((artifact1.policyDependable as any).toDocumentJson()),
      ).toEqual(policyText1);
      Template.synth(stack).toHaveResourceWithProperties(
        ecrRepositoryPolicy.EcrRepositoryPolicy,
        {
          repository: "${aws_ecr_repository.Repo1_DBD717D9.name}",
          policy:
            "${data.aws_iam_policy_document.Repo1_PolicyDocument_DA6A2ABC.json}",
        },
      );

      expect(stack.resolve(artifact2.statementAdded)).toEqual(true);
      expect(
        stack.resolve((artifact2.policyDependable as any).toDocumentJson()),
      ).toEqual(policyText2);
      Template.synth(stack).toHaveResourceWithProperties(
        ecrRepositoryPolicy.EcrRepositoryPolicy,
        {
          repository: "${aws_ecr_repository.Repo2_730A8200.name}",
          policy:
            "${data.aws_iam_policy_document.Repo2_PolicyDocument_4C64DACD.json}",
        },
      );
    });
  });

  // describe("when auto delete images is set to true", () => {
  //   test("it is ignored if emptyOnDelete is set", () => {
  //     new Repository(stack, "Repo1", {
  //       autoDeleteImages: true,
  //       emptyOnDelete: true,
  //       // removalPolicy: RemovalPolicy.DESTROY,
  //     });
  //     new Repository(stack, "Repo2", {
  //       autoDeleteImages: true,
  //       emptyOnDelete: false,
  //       // removalPolicy: RemovalPolicy.DESTROY,
  //     });
  //     const template = new Template(stack);
  //     template.resourceCountIs(lambdaFunction.LambdaFunction, 1);
  //   });
  //   // TerraConstructs does not use custom resources for auto-deleting images
  //   test("permissions are correctly for multiple ecr repos", () => {
  //     new Repository(stack, "Repo1", {
  //       autoDeleteImages: true,
  //       // removalPolicy: RemovalPolicy.DESTROY,
  //     });
  //     new Repository(stack, "Repo2", {
  //       autoDeleteImages: true,
  //       // removalPolicy: RemovalPolicy.DESTROY,
  //     });
  //     Template.synth(stack).toHaveResourceWithProperties(iamRole.IamRole, {
  //       inline_policy: [
  //         {
  //           name: "Inline",
  //           policy: expect.stringContaining(
  //             `"Action\":[\"ecr:BatchDeleteImage\",\"ecr:DescribeRepositories\",\"ecr:ListImages\",\"ecr:ListTagsForResource\"],\"Condition\":{\"StringEquals\":{\"ecr:ResourceTag/aws-cdk:auto-delete-images\":\"true\"}},\"Effect\":\"Allow\",\"Resource\":[\"arn:${stack.partition}:ecr:${stack.region}:${stack.account}:repository/*\"]`,
  //           ),
  //         },
  //       ],
  //     });
  //   });
  //   test("synth fails when removal policy is not DESTROY", () => {
  //     expect(() => {
  //       new Repository(stack, "Repo", {
  //         autoDeleteImages: true,
  //         removalPolicy: RemovalPolicy.RETAIN,
  //       });
  //     }).toThrow(
  //       "Cannot use 'autoDeleteImages' property on a repository without setting removal policy to 'DESTROY'.",
  //     );
  //   });
  // });

  // test("repo name is embedded in CustomResourceProvider description", () => {
  //   new Repository(stack, "Repo", {
  //     autoDeleteImages: true,
  //     removalPolicy: RemovalPolicy.DESTROY,
  //   });

  //   Template.synth(stack).toHaveResourceWithProperties(
  //     lambdaFunction.LambdaFunction,
  //     {
  //       description: `Lambda function for auto-deleting images in ${"${aws_ecr_repository.Repo_02AC86CF.name}"} repository.`,
  //     },
  //   );
  // });
});
