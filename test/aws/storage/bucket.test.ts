import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { App, Testing, TerraformLocal } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as iam from "../../../src/aws/iam";
import * as storage from "../../../src/aws/storage";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("Bucket", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
      // TODO: Should support passing account via Stack props?
      // account: "1234",
      // region: "us-east-1",
    });
  });

  // test("With KMS_MANAGED encryption", () => {
  //   new storage.Bucket(stack, "MyBucket", {
  //     encryption: storage.BucketEncryption.KMS_MANAGED,
  //   });

  //   Template.fromStack(stack, {snapshot: true})..toMatchObject({});
  //   // Template.fromStack(stack).templateMatches({
  //   //   Resources: {
  //   //     MyBucketF68F3FF0: {
  //   //       Type: "AWS::S3::Bucket",
  //   //       Properties: {
  //   //         BucketEncryption: {
  //   //           ServerSideEncryptionConfiguration: [
  //   //             {
  //   //               ServerSideEncryptionByDefault: {
  //   //                 SSEAlgorithm: "aws:kms",
  //   //               },
  //   //             },
  //   //           ],
  //   //         },
  //   //       },
  //   //       DeletionPolicy: "Retain",
  //   //       UpdateReplacePolicy: "Retain",
  //   //     },
  //   //   },
  //   // });
  // });

  test("enforceSsl can be enabled", () => {
    new storage.Bucket(stack, "MyBucket", { enforceSSL: true });

    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyBucket_Policy_F89E7330: {
            statement: [
              {
                actions: ["s3:*"],
                condition: [
                  {
                    test: "Bool",
                    values: ["false"],
                    variable: "aws:SecureTransport",
                  },
                ],
                effect: "Deny",
                principals: [
                  {
                    identifiers: ["*"],
                    type: "AWS",
                  },
                ],
                resources: [
                  "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                  "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                ],
              },
            ],
          },
        },
      },
      resource: {
        aws_s3_bucket: {
          MyBucket_F68F3FF0: {
            bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
          },
        },
        aws_s3_bucket_policy: {
          MyBucket_Policy_E7FBAC7B: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            policy:
              "${data.aws_iam_policy_document.MyBucket_Policy_F89E7330.json}",
          },
        },
      },
    });
  });

  test("with minimumTLSVersion", () => {
    new storage.Bucket(stack, "MyBucket", {
      enforceSSL: true,
      minimumTLSVersion: 1.2,
    });

    Template.fromStack(stack).toMatchObject({
      data: {
        aws_iam_policy_document: {
          MyBucket_Policy_F89E7330: {
            statement: [
              {
                actions: ["s3:*"],
                condition: [
                  {
                    test: "Bool",
                    values: ["false"],
                    variable: "aws:SecureTransport",
                  },
                ],
                effect: "Deny",
                principals: [
                  {
                    identifiers: ["*"],
                    type: "AWS",
                  },
                ],
                resources: [
                  "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                  "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                ],
              },
              {
                actions: ["s3:*"],
                condition: [
                  {
                    test: "NumericLessThan",
                    values: ["1.2"],
                    variable: "s3:TlsVersion",
                  },
                ],
                effect: "Deny",
                principals: [
                  {
                    identifiers: ["*"],
                    type: "AWS",
                  },
                ],
                resources: [
                  "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                  "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                ],
              },
            ],
          },
        },
      },
      resource: {
        aws_s3_bucket: {
          MyBucket_F68F3FF0: {
            bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
          },
        },
        aws_s3_bucket_policy: {
          MyBucket_Policy_E7FBAC7B: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            policy:
              "${data.aws_iam_policy_document.MyBucket_Policy_F89E7330.json}",
          },
        },
      },
    });
  });

  test("enforceSSL must be enabled for minimumTLSVersion to work", () => {
    expect(() => {
      new storage.Bucket(stack, "MyBucket1", {
        enforceSSL: false,
        minimumTLSVersion: 1.2,
      });
    }).toThrow(
      /'enforceSSL' must be enabled for 'minimumTLSVersion' to be applied/,
    );

    expect(() => {
      new storage.Bucket(stack, "MyBucket2", {
        minimumTLSVersion: 1.2,
      });
    }).toThrow(
      /'enforceSSL' must be enabled for 'minimumTLSVersion' to be applied/,
    );
  });

  test("with versioning turned on", () => {
    new storage.Bucket(stack, "MyBucket", {
      versioned: true,
    });

    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_s3_bucket: {
          MyBucket_F68F3FF0: {
            bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
          },
        },
        aws_s3_bucket_versioning: {
          MyBucket_Versioning_A456CB1B: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            versioning_configuration: {
              status: "Enabled",
            },
          },
        },
      },
    });
  });

  test("Should synth and match SnapShot", () => {
    // WHEN
    new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      sources: path.join(__dirname, "fixtures", "site"),
      websiteConfig: {
        enabled: true,
      },
      public: true,
    });
    // THEN
    // Template synth calls prepareStack -> required to generate S3Objects
    Template.synth(stack).toMatchSnapshot();
  });

  test("Should support multiple sources", () => {
    // WHEN
    const tempfile = new TempFile("sample.html", "sample");
    new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      sources: [path.join(__dirname, "fixtures", "site"), tempfile.dir],
      websiteConfig: {
        enabled: true,
      },
      versioned: true,
      registerOutputs: true,
    });
    // THEN
    // Template synth calls prepareStack -> required to generate S3Objects
    Template.synth(stack).toMatchSnapshot();
  });

  test("Should throw error if bucket source is a file", () => {
    // WHEN
    const tempfile = new TempFile("sample.html", "sample");
    // THEN
    new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      sources: tempfile.path,
    });
    expect(() => {
      stack.prepareStack();
    }).toThrow("expects path to point to a directory");
  });

  test("Should sleep on versioning if enabled", () => {
    // WHEN
    new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      sources: path.join(__dirname, "fixtures", "site"),
      websiteConfig: {
        enabled: true,
      },
      versioned: true,
    });
    // THEN
    // Template synth calls prepareStack -> required to generate S3Objects
    const expected = Template.synth(stack);
    expected.toHaveResource({
      tfResourceType: "time_sleep",
    });
    expected.toHaveResourceWithProperties(
      {
        tfResourceType: "aws_s3_object",
      },
      {
        depends_on: expect.arrayContaining([
          expect.stringContaining("time_sleep"),
        ]),
      },
    );
  });

  describe("permissions", () => {
    // TODO: Deprecated? Buckets should always have encryption?
    test("addPermission creates a bucket policy for an UNENCRYPTED bucket", () => {
      const bucket = new storage.Bucket(stack, "MyBucket", {
        // encryption: storage.BucketEncryption.UNENCRYPTED,
      });

      bucket.addToResourcePolicy(
        new iam.PolicyStatement({
          resources: ["foo"],
          actions: ["bar:baz"],
          principals: [new iam.AnyPrincipal()],
        }),
      );

      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            MyBucket_Policy_F89E7330: {
              statement: [
                {
                  actions: ["bar:baz"],
                  effect: "Allow",
                  principals: [
                    {
                      identifiers: ["*"],
                      type: "AWS",
                    },
                  ],
                  resources: ["foo"],
                },
              ],
            },
          },
        },
        resource: {
          aws_s3_bucket: {
            MyBucket_F68F3FF0: {
              bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
            },
          },
          aws_s3_bucket_policy: {
            MyBucket_Policy_E7FBAC7B: {
              bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
              policy:
                "${data.aws_iam_policy_document.MyBucket_Policy_F89E7330.json}",
            },
          },
        },
      });
    });
    test("arnForObjects returns a permission statement associated with objects in an S3_MANAGED bucket", () => {
      const bucket = new storage.Bucket(stack, "MyBucket", {});

      const p = new iam.PolicyStatement({
        resources: [bucket.arnForObjects("hello/world")],
        actions: ["s3:GetObject"],
        principals: [new iam.AnyPrincipal()],
      });

      expect(stack.resolve(p.toStatementJson())).toEqual({
        Action: "s3:GetObject",
        Effect: "Allow",
        Principal: { AWS: "*" },
        Resource: "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/hello/world",
      });
    });
    test("forBucket returns a permission statement associated with an S3_MANAGED bucket's ARN", () => {
      const bucket = new storage.Bucket(stack, "MyBucket", {
        // encryption: storage.BucketEncryption.S3_MANAGED,
      });

      const x = new iam.PolicyStatement({
        resources: [bucket.bucketArn],
        actions: ["s3:ListBucket"],
        principals: [new iam.AnyPrincipal()],
      });

      expect(stack.resolve(x.toStatementJson())).toEqual({
        Action: "s3:ListBucket",
        Effect: "Allow",
        Principal: { AWS: "*" },
        Resource: "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
      });
    });
    test("arnForObjects accepts multiple arguments and FnConcats them an S3_MANAGED bucket", () => {
      const bucket = new storage.Bucket(stack, "MyBucket", {
        // encryption: storage.BucketEncryption.S3_MANAGED
      });

      // new iam.User(stack, "MyUser");
      const user = new TerraformLocal(stack, "MyUser", {
        expression: "MyUser",
      });
      // new iam.Group(stack, "MyTeam");
      const team = new TerraformLocal(stack, "MyTeam", {
        expression: "MyTeam",
      });

      const resource = bucket.arnForObjects(
        // `home/${team.groupName}/${user.userName}/*`,
        `home/${team.asString}/${user.asString}/*`,
      );
      const p = new iam.PolicyStatement({
        resources: [resource],
        actions: ["s3:GetObject"],
        principals: [new iam.AnyPrincipal()],
      });

      expect(stack.resolve(p.toStatementJson())).toEqual({
        Action: "s3:GetObject",
        Effect: "Allow",
        Principal: { AWS: "*" },
        Resource:
          "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/home/${local.MyTeam}/${local.MyUser}/*",
      });
    });
  });

  describe("grant method", () => {
    test("grantRead adds read permissions to principal policy", () => {
      // GIVEN
      const role = new iam.Role(stack, "MyRole", {
        assumedBy: new iam.ServicePrincipal("test.service"),
      });
      const bucket = new storage.Bucket(stack, "MyBucket");

      // WHEN
      bucket.grantRead(role);

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_iam_policy_document: {
            MyRole_DefaultPolicy_6017B917: {
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
          },
        },
        resource: {
          aws_iam_role: {
            MyRole_F48FFE04: {
              assume_role_policy:
                "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
              name_prefix: "123e4567-e89b-12d3-TestStackMyRole",
            },
          },
          aws_iam_role_policy: {
            MyRole_DefaultPolicy_ResourceRoles0_B7F96EAE: {
              name: "TestStackMyRoleDefaultPolicy70AEE1C2",
              policy:
                "${data.aws_iam_policy_document.MyRole_DefaultPolicy_6017B917.json}",
              role: "${aws_iam_role.MyRole_F48FFE04.name}",
            },
          },
          aws_s3_bucket: {
            MyBucket_F68F3FF0: {
              bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
            },
          },
        },
      });
    });

    describe("grantReadWrite", () => {
      test("can be used to grant reciprocal permissions to an identity", () => {
        // GIVEN
        const bucket = new storage.Bucket(stack, "MyBucket");
        const role = new iam.Role(stack, "MyRole", {
          assumedBy: new iam.ServicePrincipal("test.service"),
        });

        // WHEN
        bucket.grantReadWrite(role);

        // THEN
        Template.fromStack(stack).toMatchObject({
          data: {
            aws_iam_policy_document: {
              MyRole_DefaultPolicy_6017B917: {
                statement: [
                  {
                    actions: [
                      "s3:GetObject*",
                      "s3:GetBucket*",
                      "s3:List*",
                      "s3:DeleteObject*",
                      "s3:PutObject",
                      "s3:PutObjectLegalHold",
                      "s3:PutObjectRetention",
                      "s3:PutObjectTagging",
                      "s3:PutObjectVersionTagging",
                      "s3:Abort*",
                    ],
                    effect: "Allow",
                    resources: [
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                    ],
                  },
                ],
              },
            },
          },
          resource: {
            aws_iam_role: {
              MyRole_F48FFE04: {
                assume_role_policy:
                  "${data.aws_iam_policy_document.MyRole_AssumeRolePolicy_4BED951C.json}",
                name_prefix: "123e4567-e89b-12d3-TestStackMyRole",
              },
            },
            aws_iam_role_policy: {
              MyRole_DefaultPolicy_ResourceRoles0_B7F96EAE: {
                name: "TestStackMyRoleDefaultPolicy70AEE1C2",
                policy:
                  "${data.aws_iam_policy_document.MyRole_DefaultPolicy_6017B917.json}",
                role: "${aws_iam_role.MyRole_F48FFE04.name}",
              },
            },
            aws_s3_bucket: {
              MyBucket_F68F3FF0: {
                bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
              },
            },
          },
        });
      });

      test("grant permissions to non-identity principal", () => {
        // GIVEN
        const bucket = new storage.Bucket(stack, "MyBucket", {
          // encryption: storage.BucketEncryption.KMS,
        });

        // WHEN
        bucket.grantRead(new iam.OrganizationPrincipal("o-1234"));

        // THEN
        Template.fromStack(stack).toMatchObject({
          data: {
            aws_iam_policy_document: {
              MyBucket_Policy_F89E7330: {
                statement: [
                  {
                    actions: ["s3:GetObject*", "s3:GetBucket*", "s3:List*"],
                    condition: [
                      {
                        test: "StringEquals",
                        values: ["o-1234"],
                        variable: "aws:PrincipalOrgID",
                      },
                    ],
                    effect: "Allow",
                    principals: [
                      {
                        identifiers: ["*"],
                        type: "AWS",
                      },
                    ],
                    resources: [
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                    ],
                  },
                ],
              },
            },
          },
          resource: {
            aws_s3_bucket: {
              MyBucket_F68F3FF0: {
                bucket_prefix: "123e4567-e89b-12d3-teststackmybucket",
              },
            },
            aws_s3_bucket_policy: {
              MyBucket_Policy_E7FBAC7B: {
                bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
                policy:
                  "${data.aws_iam_policy_document.MyBucket_Policy_F89E7330.json}",
              },
            },
          },
        });
        // // TODO: Re-add KMS encryption support
        // Template.fromStack(stack).hasResourceProperties("AWS::KMS::Key", {
        //   KeyPolicy: {
        //     Statement: Match.arrayWith([
        //       {
        //         Action: ["kms:Decrypt", "kms:DescribeKey"],
        //         Effect: "Allow",
        //         Resource: "*",
        //         Principal: { AWS: "*" },
        //         Condition: { StringEquals: { "aws:PrincipalOrgID": "o-1234" } },
        //       },
        //     ]),
        //     Version: "2012-10-17",
        //   },
        // });
      });

      // NOTE: in TerraConstructs S3_GRANT_WRITE_WITHOUT_ACL is always enabled
      // ref: https://github.com/aws/aws-cdk/pull/12391
      test("does not grant PutObjectAcl when the S3_GRANT_WRITE_WITHOUT_ACL feature is enabled", () => {
        // GIVEN
        const bucket = new storage.Bucket(stack, "MyBucket");
        const role = new iam.Role(stack, "MyRole", {
          assumedBy: new iam.ServicePrincipal("test.service"),
        });

        // WHEN
        bucket.grantReadWrite(role);

        // THEN

        Template.fromStack(stack).toMatchObject({
          data: {
            aws_iam_policy_document: {
              MyRole_DefaultPolicy_6017B917: {
                statement: [
                  {
                    // TODO: does this fail if PutObjectAcl is present
                    actions: [
                      "s3:GetObject*",
                      "s3:GetBucket*",
                      "s3:List*",
                      "s3:DeleteObject*",
                      "s3:PutObject",
                      "s3:PutObjectLegalHold",
                      "s3:PutObjectRetention",
                      "s3:PutObjectTagging",
                      "s3:PutObjectVersionTagging",
                      "s3:Abort*",
                    ],
                    effect: "Allow",
                    resources: [
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                    ],
                  },
                ],
              },
            },
          },
        });
      });
    });

    describe("grantWrite", () => {
      test("grant only allowedActionPatterns when specified", () => {
        // GIVEN
        const bucket = new storage.Bucket(stack, "MyBucket");
        const role = new iam.Role(stack, "MyRole", {
          assumedBy: new iam.ServicePrincipal("test.service"),
        });

        // WHEN
        bucket.grantWrite(role, "*", ["s3:PutObject", "s3:DeleteObject*"]);

        // THEN
        Template.fromStack(stack).toMatchObject({
          data: {
            aws_iam_policy_document: {
              MyRole_DefaultPolicy_6017B917: {
                statement: [
                  {
                    actions: ["s3:PutObject", "s3:DeleteObject*"], // should match only these
                    effect: "Allow",
                    resources: [
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}",
                      "${aws_s3_bucket.MyBucket_F68F3FF0.arn}/*",
                    ],
                  },
                ],
              },
            },
          },
        });
      });
    });

    test("more grants", () => {
      // GIVEN
      const bucket = new storage.Bucket(stack, "MyBucket", {
        // encryption: storage.BucketEncryption.KMS,
      });
      const putter = new iam.Role(stack, "Putter", {
        assumedBy: new iam.ServicePrincipal("test.service"),
      });
      const writer = new iam.Role(stack, "Writer", {
        assumedBy: new iam.ServicePrincipal("test.service"),
      });
      const deleter = new iam.Role(stack, "Deleter", {
        assumedBy: new iam.ServicePrincipal("test.service"),
      });

      // WHEN
      bucket.grantPut(putter);
      bucket.grantWrite(writer);
      bucket.grantDelete(deleter);

      // THEN
      // Do prepare run to resolve/add all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // refer to full snapshot to debug
      // expect(synthesized).toMatchSnapshot();
      const policyDocs = JSON.parse(synthesized).data.aws_iam_policy_document;
      const actions = (id: string) => policyDocs[id].statement[0].actions;

      expect(actions("Writer_DefaultPolicy_35568C2F")).toEqual([
        "s3:DeleteObject*",
        "s3:PutObject",
        "s3:PutObjectLegalHold",
        "s3:PutObjectRetention",
        "s3:PutObjectTagging",
        "s3:PutObjectVersionTagging",
        "s3:Abort*",
      ]);
      expect(actions("Putter_DefaultPolicy_6DEE740F")).toEqual([
        "s3:PutObject",
        "s3:PutObjectLegalHold",
        "s3:PutObjectRetention",
        "s3:PutObjectTagging",
        "s3:PutObjectVersionTagging",
        "s3:Abort*",
      ]);
      expect(actions("Deleter_DefaultPolicy_C788953C")).toEqual([
        "s3:DeleteObject*",
      ]);
    });
  });

  test("Event Bridge notification can be enabled after the bucket is created", () => {
    const bucket = new storage.Bucket(stack, "MyBucket");
    bucket.enableEventBridgeNotification();

    Template.fromStack(stack).toMatchObject({
      resource: {
        aws_s3_bucket_notification: {
          MyBucket_Notifications_46AC0CD2: {
            bucket: "${aws_s3_bucket.MyBucket_F68F3FF0.bucket}",
            eventbridge: true,
          },
        },
      },
    });
  });
});

export class TempFile {
  public readonly path: string;
  public readonly dir: string;
  public constructor(filename: string, content: string) {
    this.dir = mkdtempSync(path.join(tmpdir(), "chtempfile"));
    this.path = path.join(this.dir, filename);
    writeFileSync(this.path, content);
  }
}
