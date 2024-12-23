import { dataAwsIamPolicyDocument } from "@cdktf/provider-aws";
import { Testing, Token, Lazy } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { PolicyStatement, Effect } from "../../../src/aws/iam/policy-statement";
import {
  IPrincipal,
  PrincipalPolicyFragment,
  PrincipalType,
  ServicePrincipal,
  FederatedPrincipal,
  AccountPrincipal,
  CanonicalUserPrincipal,
  CompositePrincipal,
  ArnPrincipal,
  AnyPrincipal,
} from "../../../src/aws/iam/principals";
import { Role } from "../../../src/aws/iam/role";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};
describe("IAM policy document", () => {
  test("the Permission class is a programming model for iam", () => {
    const stack = getAwsStack();

    const p = new PolicyStatement();
    p.addActions("sqs:SendMessage");
    p.addActions("dynamodb:CreateTable", "dynamodb:DeleteTable");
    p.addResources("myQueue");
    p.addResources("yourQueue");

    p.addAllResources();
    p.addAwsAccountPrincipal(`my${Token.asString("account")}name`);
    p.addAccountCondition("12221121221");

    expect(stack.resolve(p.toStatementJson())).toEqual({
      Action: [
        "sqs:SendMessage",
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
      ],
      Resource: ["myQueue", "yourQueue", "*"],
      Effect: "Allow",
      Principal: {
        AWS: "arn:${data.aws_partition.Partitition.partition}:iam::myaccountname:root",
        // {
        //   "Fn::Join": [
        //     "",
        //     [
        //       "arn:",
        //       { Ref: "AWS::Partition" },
        //       ":iam::my",
        //       { account: "account" },
        //       "name:root",
        //     ],
        //   ],
        // },
      },
      Condition: { StringEquals: { "sts:ExternalId": "12221121221" } },
    });
  });

  test("addSourceAccountCondition and addSourceArnCondition for cross-service resource access", () => {
    const stack = getAwsStack();

    const p = new PolicyStatement();
    p.addActions("sns:Publish");
    p.addResources("myTopic");
    p.addAllResources();
    p.addServicePrincipal("s3.amazonaws.com");
    p.addSourceAccountCondition("12221121221");
    p.addSourceArnCondition("bucketArn");

    expect(stack.resolve(p.toStatementJson())).toEqual({
      Action: "sns:Publish",
      Resource: ["myTopic", "*"],
      Effect: "Allow",
      Principal: {
        Service:
          "${data.aws_service_principal.aws_svcp_default_region_s3.name}",
      },
      Condition: {
        StringEquals: { "aws:SourceAccount": "12221121221" },
        ArnEquals: { "aws:SourceArn": "bucketArn" },
      },
    });
  });

  test("the PolicyDocument class is a dom for iam policy documents", () => {
    const stack = getAwsStack();
    const doc = new PolicyDocument(stack, "doc");
    const p1 = new PolicyStatement();
    p1.addActions("sqs:SendMessage");
    p1.addNotResources("arn:aws:sqs:us-east-1:123456789012:forbidden_queue");

    const p2 = new PolicyStatement();
    p2.effect = Effect.DENY;
    p2.addActions("cloudformation:CreateStack");

    const p3 = new PolicyStatement();
    p3.effect = Effect.ALLOW;
    p3.addNotActions("cloudformation:UpdateTerminationProtection");

    const p4 = new PolicyStatement();
    p4.effect = Effect.DENY;
    p4.addNotPrincipals(new CanonicalUserPrincipal("OnlyAuthorizedUser"));

    doc.addStatements(p1);
    doc.addStatements(p2);
    doc.addStatements(p3);
    doc.addStatements(p4);

    expect(stack.resolve(doc.toDocumentJson())).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "sqs:SendMessage",
          NotResource: "arn:aws:sqs:us-east-1:123456789012:forbidden_queue",
        },
        { Effect: "Deny", Action: "cloudformation:CreateStack" },
        {
          Effect: "Allow",
          NotAction: "cloudformation:UpdateTerminationProtection",
        },
        {
          Effect: "Deny",
          NotPrincipal: { CanonicalUser: "OnlyAuthorizedUser" },
        },
      ],
    });
  });

  test("Cannot combine Actions and NotActions", () => {
    expect(() => {
      new PolicyStatement({
        actions: ["abc:def"],
        notActions: ["abc:def"],
      });
    }).toThrow(
      /Cannot add 'NotActions' to policy statement if 'Actions' have been added/,
    );
  });

  test("Throws with invalid actions", () => {
    expect(() => {
      new PolicyStatement({
        actions: ["service:action", "*", "service:acti*", "in:val:id"],
      });
    }).toThrow(/Action 'in:val:id' is invalid/);
  });

  test("Throws with invalid not actions", () => {
    expect(() => {
      new PolicyStatement({
        notActions: ["service:action", "*", "service:acti*", "in:val:id"],
      });
    }).toThrow(/Action 'in:val:id' is invalid/);
  });

  // https://github.com/aws/aws-cdk/issues/13479
  test("Does not validate unresolved tokens", () => {
    const stack = getAwsStack();
    const perm = new PolicyStatement({
      actions: [`${Lazy.stringValue({ produce: () => "sqs:sendMessage" })}`],
    });

    expect(stack.resolve(perm.toStatementJson())).toEqual({
      Effect: "Allow",
      Action: "sqs:sendMessage",
    });
  });

  test("Cannot combine Resources and NotResources", () => {
    expect(() => {
      new PolicyStatement({
        resources: ["abc"],
        notResources: ["def"],
      });
    }).toThrow(
      /Cannot add 'NotResources' to policy statement if 'Resources' have been added/,
    );
  });

  test("Cannot add NotPrincipals when Principals exist", () => {
    const stmt = new PolicyStatement({
      principals: [new CanonicalUserPrincipal("abc")],
    });
    expect(() => {
      stmt.addNotPrincipals(new CanonicalUserPrincipal("def"));
    }).toThrow(
      /Cannot add 'NotPrincipals' to policy statement if 'Principals' have been added/,
    );
  });

  test("Cannot add Principals when NotPrincipals exist", () => {
    const stmt = new PolicyStatement({
      notPrincipals: [new CanonicalUserPrincipal("abc")],
    });
    expect(() => {
      stmt.addPrincipals(new CanonicalUserPrincipal("def"));
    }).toThrow(
      /Cannot add 'Principals' to policy statement if 'NotPrincipals' have been added/,
    );
  });

  test("Permission allows specifying multiple actions upon construction", () => {
    const stack = getAwsStack();
    const perm = new PolicyStatement();
    perm.addResources("MyResource");
    perm.addActions("service:Action1", "service:Action2", "service:Action3");

    expect(stack.resolve(perm.toStatementJson())).toEqual({
      Effect: "Allow",
      Action: ["service:Action1", "service:Action2", "service:Action3"],
      Resource: "MyResource",
    });
  });

  // TODO: Make sure policy doc is not added to the stack if it is empty?
  // SHould probably Throw error if empty policy doc is added to the stack...
  test.skip("PolicyDoc resolves to undefined if there are no permissions", () => {
    const stack = getAwsStack();
    const p = new PolicyDocument(stack, "doc");
    expect(stack.resolve(p.toDocumentJson())).toBeUndefined();
    // TODO: synth should not contain policy doc...
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    const docs = getDataSources(synthesized, "aws_iam_policy_document");
    expect(docs).toHaveLength(0);
  });

  test("canonicalUserPrincipal adds a principal to a policy with the passed canonical user id", () => {
    const stack = getAwsStack();
    const p = new PolicyStatement();
    const canoncialUser = "averysuperduperlongstringfor";
    p.addPrincipals(new CanonicalUserPrincipal(canoncialUser));
    expect(stack.resolve(p.toStatementJson())).toEqual({
      Effect: "Allow",
      Principal: {
        CanonicalUser: canoncialUser,
      },
    });
  });

  test("addAccountRootPrincipal adds a principal with the current account root", () => {
    const stack = getAwsStack();

    const p = new PolicyStatement();
    p.addAccountRootPrincipal();
    expect(stack.resolve(p.toStatementJson())).toEqual({
      Effect: "Allow",
      Principal: {
        AWS: "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
      },
    });
  });

  test("addFederatedPrincipal adds a Federated principal with the passed value", () => {
    const stack = getAwsStack();
    const p = new PolicyStatement();
    p.addFederatedPrincipal("com.amazon.cognito", [
      {
        test: "StringEquals",
        variable: "key",
        values: ["value"],
      },
    ]);
    expect(stack.resolve(p.toStatementJson())).toEqual({
      Effect: "Allow",
      Principal: {
        Federated: "com.amazon.cognito",
      },
      Condition: {
        StringEquals: { key: "value" },
      },
    });
  });

  test("addAwsAccountPrincipal can be used multiple times", () => {
    const stack = getAwsStack();

    const p = new PolicyStatement();
    p.addAwsAccountPrincipal("1234");
    p.addAwsAccountPrincipal("5678");
    expect(stack.resolve(p.toStatementJson())).toEqual({
      Effect: "Allow",
      Principal: {
        AWS: [
          "arn:${data.aws_partition.Partitition.partition}:iam::1234:root",
          "arn:${data.aws_partition.Partitition.partition}:iam::5678:root",
        ],
      },
    });
  });

  describe("hasResource", () => {
    test("false if there are no resources", () => {
      expect(new PolicyStatement().hasResource).toEqual(false);
    });

    test("true if there is one resource", () => {
      expect(
        new PolicyStatement({ resources: ["one-resource"] }).hasResource,
      ).toEqual(true);
    });

    test("true for multiple resources", () => {
      const p = new PolicyStatement();
      p.addResources("r1");
      p.addResources("r2");
      expect(p.hasResource).toEqual(true);
    });
  });

  describe("hasPrincipal", () => {
    test("false if there is no principal", () => {
      expect(new PolicyStatement().hasPrincipal).toEqual(false);
    });

    test("true if there is a principal", () => {
      const p = new PolicyStatement();
      p.addArnPrincipal("bla");
      expect(p.hasPrincipal).toEqual(true);
    });

    test("true if there is a notPrincipal", () => {
      const p = new PolicyStatement();
      p.addNotPrincipals(new CanonicalUserPrincipal("test"));
      expect(p.hasPrincipal).toEqual(true);
    });
  });

  test("statementCount returns the number of statement in the policy document", () => {
    const stack = getAwsStack();
    const p = new PolicyDocument(stack, "doc");
    expect(p.statementCount).toEqual(0);
    p.addStatements(new PolicyStatement({ actions: ["service:action1"] }));
    expect(p.statementCount).toEqual(1);
    p.addStatements(new PolicyStatement({ actions: ["service:action2"] }));
    expect(p.statementCount).toEqual(2);
  });

  describe('{ AWS: "*" } principal', () => {
    test("is represented as `AnyPrincipal`", () => {
      const stack = getAwsStack();
      const p = new PolicyDocument(stack, "doc");

      p.addStatements(
        new PolicyStatement({ principals: [new AnyPrincipal()] }),
      );

      expect(stack.resolve(p.toDocumentJson())).toEqual({
        Statement: [{ Effect: "Allow", Principal: { AWS: "*" } }],
        Version: "2012-10-17",
      });
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      expect(synthesized).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: ["*"],
                },
              ],
            },
          ],
        },
      );
    });

    test("is represented as `addAnyPrincipal`", () => {
      const stack = getAwsStack();
      const p = new PolicyDocument(stack, "doc");

      const s = new PolicyStatement();
      s.addAnyPrincipal();
      p.addStatements(s);

      expect(stack.resolve(p.toDocumentJson())).toEqual({
        Statement: [{ Effect: "Allow", Principal: { AWS: "*" } }],
        Version: "2012-10-17",
      });
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      expect(synthesized).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: ["*"],
                },
              ],
            },
          ],
        },
      );
    });
  });

  test("addResources() will not break a list-encoded Token", () => {
    const stack = getAwsStack();

    const statement = new PolicyStatement();
    statement.addActions(
      ...Lazy.listValue({
        produce: () => ["service:a", "service:b", "service:c"],
      }),
    );
    statement.addResources(
      ...Lazy.listValue({ produce: () => ["x", "y", "z"] }),
    );

    expect(stack.resolve(statement.toStatementJson())).toEqual({
      Effect: "Allow",
      Action: ["service:a", "service:b", "service:c"],
      Resource: ["x", "y", "z"],
    });
  });

  test("addResources()/addActions() will not add duplicates", () => {
    const stack = getAwsStack();

    const statement = new PolicyStatement();
    statement.addActions("service:a");
    statement.addActions("service:a");

    statement.addResources("x");
    statement.addResources("x");

    expect(stack.resolve(statement.toStatementJson())).toEqual({
      Effect: "Allow",
      Action: "service:a",
      Resource: "x",
    });
  });

  test("addNotResources()/addNotActions() will not add duplicates", () => {
    const stack = getAwsStack();

    const statement = new PolicyStatement();
    statement.addNotActions("service:a");
    statement.addNotActions("service:a");

    statement.addNotResources("x");
    statement.addNotResources("x");

    expect(stack.resolve(statement.toStatementJson())).toEqual({
      Effect: "Allow",
      NotAction: "service:a",
      NotResource: "x",
    });
  });

  test("addCanonicalUserPrincipal can be used to add cannonical user principals", () => {
    const stack = getAwsStack();
    const p = new PolicyDocument(stack, "doc");

    const s1 = new PolicyStatement();
    s1.addCanonicalUserPrincipal("cannonical-user-1");

    const s2 = new PolicyStatement();
    s2.addPrincipals(new CanonicalUserPrincipal("cannonical-user-2"));

    p.addStatements(s1);
    p.addStatements(s2);

    expect(stack.resolve(p.toDocumentJson())).toEqual({
      Statement: [
        { Effect: "Allow", Principal: { CanonicalUser: "cannonical-user-1" } },
        { Effect: "Allow", Principal: { CanonicalUser: "cannonical-user-2" } },
      ],
      Version: "2012-10-17",
    });
    // Do prepare run to resolve all Terraform resources
    stack.prepareStack();
    const synthesized = Testing.synth(stack);
    expect(synthesized).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          expect.objectContaining({
            effect: "Allow",
            principals: [
              {
                type: "CanonicalUser",
                identifiers: ["cannonical-user-1"],
              },
            ],
          }),
          expect.objectContaining({
            effect: "Allow",
            principals: [
              {
                type: "CanonicalUser",
                identifiers: ["cannonical-user-2"],
              },
            ],
          }),
        ],
      },
    );
  });

  test("addPrincipal correctly merges array in", () => {
    const stack = getAwsStack();
    const arrayPrincipal: IPrincipal = {
      get grantPrincipal() {
        return this;
      },
      assumeRoleAction: "sts:AssumeRole",
      policyFragment: new PrincipalPolicyFragment([
        { type: PrincipalType.AWS, identifiers: ["foo", "bar"] },
      ]),
      addToPolicy() {
        return false;
      },
      addToPrincipalPolicy() {
        return { statementAdded: false };
      },
    };
    const s = new PolicyStatement();
    s.addAccountRootPrincipal();
    s.addPrincipals(arrayPrincipal);
    expect(stack.resolve(s.toStatementJson())).toEqual({
      Effect: "Allow",
      Principal: {
        AWS: [
          "arn:${data.aws_partition.Partitition.partition}:iam::${data.aws_caller_identity.CallerIdentity.account_id}:root",
          "foo",
          "bar",
        ],
      },
    });
  });

  // https://github.com/aws/aws-cdk/issues/1201
  test("policy statements with multiple principal types can be created using multiple addPrincipal calls", () => {
    const stack = getAwsStack();
    const s = new PolicyStatement();
    s.addArnPrincipal("349494949494");
    s.addServicePrincipal("test.service");
    s.addResources("resource");
    s.addActions("service:action");

    expect(stack.resolve(s.toStatementJson())).toEqual({
      Action: "service:action",
      Effect: "Allow",
      Principal: {
        AWS: "349494949494",
        Service:
          "${data.aws_service_principal.aws_svcp_default_region_testservice.name}",
      },
      Resource: "resource",
    });
  });

  // describe("Service principals", () => {
  //   test("regional service principals resolve appropriately", () => {
  //     const stack = new Stack(undefined, undefined, {
  //       env: { region: "cn-north-1" },
  //     });
  //     const s = new PolicyStatement();
  //     s.addActions("test:Action");
  //     s.addServicePrincipal("codedeploy.amazonaws.com");

  //     expect(stack.resolve(s.toStatementJson())).toEqual({
  //       Effect: "Allow",
  //       Action: "test:Action",
  //       Principal: { Service: "codedeploy.amazonaws.com" },
  //     });
  //   });

  //   test("obscure service principals resolve to the user-provided value", () => {
  //     const stack = new Stack(undefined, undefined, {
  //       env: { region: "cn-north-1" },
  //     });
  //     const s = new PolicyStatement();
  //     s.addActions("test:Action");
  //     s.addServicePrincipal("test.service-principal.dev");

  //     expect(stack.resolve(s.toStatementJson())).toEqual({
  //       Effect: "Allow",
  //       Action: "test:Action",
  //       Principal: { Service: "test.service-principal.dev" },
  //     });
  //   });
  // });

  describe("CompositePrincipal can be used to represent a principal that has multiple types", () => {
    test("with a single principal", () => {
      const stack = getAwsStack();
      const p = new CompositePrincipal(new ArnPrincipal("i:am:an:arn"));
      const statement = new PolicyStatement();
      statement.addPrincipals(p);
      expect(stack.resolve(statement.toStatementJson())).toEqual({
        Effect: "Allow",
        Principal: { AWS: "i:am:an:arn" },
      });
    });

    test("conditions are allowed in an assumerolepolicydocument", () => {
      const stack = getAwsStack();
      new Role(stack, "Role", {
        assumedBy: new CompositePrincipal(
          new ArnPrincipal("i:am"),
          new FederatedPrincipal("federated", [
            {
              test: "StringEquals",
              variable: "aws:some-key",
              values: ["some-value"],
            },
          ]),
        ),
      });

      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // verify assume role policy document
      expect(synthesized).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["sts:AssumeRole"],
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: ["i:am"],
                },
              ],
            },
            {
              actions: ["sts:AssumeRole"],
              effect: "Allow",
              principals: [
                {
                  type: "Federated",
                  identifiers: ["federated"],
                },
              ],
              condition: [
                {
                  test: "StringEquals",
                  variable: "aws:some-key",
                  values: ["some-value"],
                },
              ],
            },
          ],
        },
      );
      // expect(synthesized).toHaveResourceWithProperties(iamRole.IamRole, {
      //   AssumeRolePolicyDocument: {
      //     Statement: [
      //       {
      //         Action: "sts:AssumeRole",
      //         Effect: "Allow",
      //         Principal: { AWS: "i:am" },
      //       },
      //       {
      //         Action: "sts:AssumeRole",
      //         Condition: {
      //           StringEquals: { "aws:some-key": "some-value" },
      //         },
      //         Effect: "Allow",
      //         Principal: { Federated: "federated" },
      //       },
      //     ],
      //   },
      // });
    });

    test("conditions are not allowed when used in a single statement", () => {
      expect(() => {
        new PolicyStatement({
          actions: ["s3:test"],
          principals: [
            new CompositePrincipal(
              new ArnPrincipal("i:am"),
              new FederatedPrincipal("federated", [
                {
                  test: "StringEquals",
                  variable: "aws:some-key",
                  values: ["some-value"],
                },
              ]),
            ),
          ],
        });
      }).toThrow(/Components of a CompositePrincipal must not have conditions/);
    });

    test("principals and conditions are a big nice merge", () => {
      const stack = getAwsStack();
      // add via ctor
      const p = new CompositePrincipal(
        new ArnPrincipal("i:am:an:arn"),
        new ServicePrincipal("amazon.com"),
      );

      // add via `addPrincipals` (with condition)
      p.addPrincipals(
        new AnyPrincipal(),
        new ServicePrincipal("another.service"),
      );

      const statement = new PolicyStatement();
      statement.addPrincipals(p);

      // add via policy statement
      statement.addArnPrincipal("aws-principal-3");
      statement.addConditionObject("cond2", { boom: "123" });

      expect(stack.resolve(statement.toStatementJson())).toEqual({
        Condition: {
          cond2: { boom: "123" },
        },
        Effect: "Allow",
        Principal: {
          AWS: ["i:am:an:arn", "*", "aws-principal-3"],
          Service: [
            "${data.aws_service_principal.aws_svcp_default_region_amazoncom.name}",
            "${data.aws_service_principal.aws_svcp_default_region_anotherservice.name}",
          ],
        },
      });
    });

    test("can mix types of assumeRoleAction in a single composite", () => {
      const stack = getAwsStack();

      // WHEN
      new Role(stack, "Role", {
        assumedBy: new CompositePrincipal(
          new ArnPrincipal("arn"),
          new FederatedPrincipal("fed", [], "sts:Boom"),
        ),
      });

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      expect(synthesized).toHaveDataSourceWithProperties(
        dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
        {
          statement: [
            {
              actions: ["sts:AssumeRole"],
              effect: "Allow",
              principals: [
                {
                  type: "AWS",
                  identifiers: ["arn"],
                },
              ],
            },
            {
              actions: ["sts:Boom"],
              effect: "Allow",
              principals: [
                {
                  type: "Federated",
                  identifiers: ["fed"],
                },
              ],
            },
          ],
        },
      );
      // Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
      //   AssumeRolePolicyDocument: {
      //     Statement: [
      //       {
      //         Action: "sts:AssumeRole",
      //         Effect: "Allow",
      //         Principal: { AWS: "arn" },
      //       },
      //       {
      //         Action: "sts:Boom",
      //         Effect: "Allow",
      //         Principal: { Federated: "fed" },
      //       },
      //     ],
      //   },
      // });
    });
  });

  describe("PrincipalWithConditions can be used to add a principal with conditions", () => {
    test("includes conditions from both the wrapped principal and the wrapper", () => {
      const stack = getAwsStack();
      const principalOpts = {
        conditions: [
          {
            test: "BinaryEquals",
            variable: "principal-key",
            values: ["SGV5LCBmcmllbmQh"],
          },
        ],
      };
      const p = new ServicePrincipal(
        "s3.amazonaws.com",
        principalOpts,
      ).withConditions({
        test: "StringEquals",
        variable: "wrapper-key",
        values: ["val-1", "val-2"],
      });
      const statement = new PolicyStatement();
      statement.addPrincipals(p);
      expect(stack.resolve(statement.toStatementJson())).toEqual({
        Condition: {
          BinaryEquals: { "principal-key": "SGV5LCBmcmllbmQh" },
          StringEquals: { "wrapper-key": ["val-1", "val-2"] },
        },
        Effect: "Allow",
        Principal: {
          Service:
            "${data.aws_service_principal.aws_svcp_default_region_s3.name}",
        },
      });
    });

    test("conditions from addCondition are merged with those from the principal", () => {
      const stack = getAwsStack();
      const p = new AccountPrincipal("012345678900").withConditions({
        test: "StringEquals",
        variable: "key",
        values: ["val"],
      });
      const statement = new PolicyStatement();
      statement.addPrincipals(p);
      statement.addConditionObject("Null", { "banned-key": "true" });
      expect(stack.resolve(statement.toStatementJson())).toEqual({
        Effect: "Allow",
        Principal: {
          AWS: "arn:${data.aws_partition.Partitition.partition}:iam::012345678900:root",
        },
        Condition: {
          StringEquals: { key: "val" },
          Null: { "banned-key": "true" },
        },
      });
    });

    test("adding conditions via `withConditions` does not affect the original principal", () => {
      const originalPrincipal = new ArnPrincipal("iam:an:arn");
      const principalWithConditions = originalPrincipal.withConditions({
        test: "StringEquals",
        variable: "key",
        values: ["val"],
      });
      expect(originalPrincipal.policyFragment.conditions).toEqual([]);
      expect(principalWithConditions.policyFragment.conditions).toEqual([
        {
          test: "StringEquals",
          variable: "key",
          values: ["val"],
        },
      ]);
    });

    test("conditions are merged when operators conflict", () => {
      const p = new FederatedPrincipal("fed", [
        { test: "OperatorOne", variable: "fed-key", values: ["fed-val"] },
        { test: "OperatorTwo", variable: "fed-key", values: ["fed-val"] },
        { test: "OperatorThree", variable: "fed-key", values: ["fed-val"] },
      ]).withConditions(
        { test: "OperatorTwo", variable: "with-key", values: ["with-val"] },
        { test: "OperatorThree", variable: "with-key", values: ["with-val"] },
      );
      const statement = new PolicyStatement();
      statement.addConditionObject("OperatorThree", { "add-key": "add-val" });
      statement.addPrincipals(p);
      expect(statement.toStatementJson()).toEqual({
        Effect: "Allow",
        Principal: { Federated: "fed" },
        Condition: {
          OperatorOne: { "fed-key": "fed-val" },
          OperatorTwo: { "fed-key": "fed-val", "with-key": "with-val" },
          OperatorThree: {
            "fed-key": "fed-val",
            "with-key": "with-val",
            "add-key": "add-val",
          },
        },
      });
      expect(statement.toJSON()).toEqual({
        effect: "Allow",
        principals: [
          {
            type: "Federated",
            identifiers: ["fed"],
          },
        ],
        condition: expect.arrayContaining([
          {
            test: "OperatorOne",
            variable: "fed-key",
            values: ["fed-val"],
          },
          { test: "OperatorTwo", variable: "fed-key", values: ["fed-val"] },
          { test: "OperatorTwo", variable: "with-key", values: ["with-val"] },
          { test: "OperatorThree", variable: "fed-key", values: ["fed-val"] },
          { test: "OperatorThree", variable: "with-key", values: ["with-val"] },
          { test: "OperatorThree", variable: "add-key", values: ["add-val"] },
        ]),
      });
    });

    // // TODO: Allow IResolvable to be used in Conditions?
    // test("tokens can be used in conditions", () => {
    //   // GIVEN
    //   const stack = getAwsStack();
    //   const statement = new PolicyStatement();

    //   // WHEN
    //   const p = new ArnPrincipal("arn:of:principal").withConditions(
    //     ...Lazy.listValue({
    //       produce: () => {
    //         test: "StringEquals",
    //         variable: "goo",
    //         values: ["zar"],
    //       },
    //     }),
    //   );

    //   statement.addPrincipals(p);

    //   // THEN
    //   const resolved = stack.resolve(statement.toStatementJson());
    //   expect(resolved).toEqual({
    //     Condition: {
    //       StringEquals: {
    //         goo: "zar",
    //       },
    //     },
    //     Effect: "Allow",
    //     Principal: {
    //       AWS: "arn:of:principal",
    //     },
    //   });
    // });

    // test("conditions cannot be merged if they include tokens", () => {
    //   const p = new FederatedPrincipal("fed", {
    //     StringEquals: { foo: "bar" },
    //   }).withConditions({
    //     StringEquals: Lazy.anyValue({ produce: () => ({ goo: "zar" }) }),
    //   });

    //   const statement = new PolicyStatement();

    //   expect(() => statement.addPrincipals(p)).toThrow(
    //     /multiple "StringEquals" conditions cannot be merged if one of them contains an unresolved token/,
    //   );
    // });

    // test(
    //   "values passed to `withConditions` overwrite values from the wrapped principal " +
    //     "when keys conflict within an operator",
    //   () => {
    //     const p = new FederatedPrincipal("fed", {
    //       Operator: { key: "p-val" },
    //     }).withConditions({
    //       Operator: { key: "with-val" },
    //     });
    //     const statement = new PolicyStatement();
    //     statement.addPrincipals(p);
    //     expect(statement.toStatementJson()).toEqual({
    //       Effect: "Allow",
    //       Principal: { Federated: "fed" },
    //       Condition: {
    //         Operator: { key: "with-val" },
    //       },
    //     });
    //   },
    // );
  });

  describe("duplicate statements", () => {
    test("without tokens", () => {
      // GIVEN
      const stack = getAwsStack();
      const p = new PolicyDocument(stack, "doc", {
        minimize: true,
      });

      const statement = new PolicyStatement();
      statement.addResources("resource1", "resource2");
      statement.addActions("service:action1", "service:action2");
      statement.addServicePrincipal("service");
      statement.addConditions(
        {
          test: "a",
          variable: "b",
          values: ["c"],
        },
        {
          test: "d",
          variable: "e",
          values: ["f"],
        },
      );

      // WHEN
      p.addStatements(statement);
      p.addStatements(statement);
      p.addStatements(statement);

      // THEN
      const stmtJson = stack.resolve(p.toDocumentJson()).Statement;
      // expect(stmtJson).toMatchSnapshot();
      expect(stmtJson).toHaveLength(1);
    });

    // TODO: Fix merge Statements
    test("with tokens", () => {
      // GIVEN
      const stack = getAwsStack();
      const p = new PolicyDocument(stack, "doc", {
        minimize: true,
      });

      const statement1 = new PolicyStatement();
      statement1.addResources(Lazy.stringValue({ produce: () => "resource" }));
      statement1.addActions(
        Lazy.stringValue({ produce: () => "service:action" }),
      );

      const statement2 = new PolicyStatement();
      statement2.addResources(Lazy.stringValue({ produce: () => "resource" }));
      statement2.addActions(
        Lazy.stringValue({ produce: () => "service:action" }),
      );

      // WHEN
      p.addStatements(statement1);
      p.addStatements(statement2);

      // THEN
      // Do prepare run to resolve all Terraform resources
      stack.prepareStack();
      const synthesized = Testing.synth(stack);
      // expect(synthesized).toMatchSnapshot();
      const template = JSON.parse(synthesized);
      expect(template).toMatchObject({
        data: {
          aws_iam_policy_document: {
            doc_138423F6: {
              statement: [
                {
                  actions: ["service:action"],
                  effect: "Allow",
                  resources: ["resource"],
                },
              ],
            },
          },
        },
      });
      // expect(stmtJson).toHaveLength(1);
    });
  });

  // test("autoAssignSids enables auto-assignment of a unique SID for each statement", () => {
  //   // GIVEN
  //   const doc = new PolicyDocument({
  //     assignSids: true,
  //   });

  //   // WHEN
  //   doc.addStatements(
  //     new PolicyStatement({
  //       actions: ["service:action1"],
  //       resources: ["resource1"],
  //     }),
  //   );
  //   doc.addStatements(
  //     new PolicyStatement({
  //       actions: ["service:action1"],
  //       resources: ["resource1"],
  //     }),
  //   );
  //   doc.addStatements(
  //     new PolicyStatement({
  //       actions: ["service:action1"],
  //       resources: ["resource1"],
  //     }),
  //   );
  //   doc.addStatements(
  //     new PolicyStatement({
  //       actions: ["service:action1"],
  //       resources: ["resource1"],
  //     }),
  //   );
  //   doc.addStatements(
  //     new PolicyStatement({
  //       actions: ["service:action2"],
  //       resources: ["resource2"],
  //     }),
  //   );

  //   // THEN
  //   const stack = getAwsStack();
  //   expect(stack.resolve(doc)).toEqual({
  //     Version: "2012-10-17",
  //     Statement: [
  //       {
  //         Action: "service:action1",
  //         Effect: "Allow",
  //         Resource: "resource1",
  //         Sid: "0",
  //       },
  //       {
  //         Action: "service:action2",
  //         Effect: "Allow",
  //         Resource: "resource2",
  //         Sid: "1",
  //       },
  //     ],
  //   });
  // });

  test("constructor args are equivalent to mutating in-place", () => {
    const stack1 = getAwsStack();
    const stack2 = getAwsStack();

    const s = new PolicyStatement();
    s.addActions("service:action1", "service:action2");
    s.addAllResources();
    s.addArnPrincipal("arn");
    s.addConditionObject("key", { equals: "value" });

    const doc1 = new PolicyDocument(stack1, "doc");
    doc1.addStatements(s);

    const doc2 = new PolicyDocument(stack2, "doc");
    doc2.addStatements(
      new PolicyStatement({
        actions: ["service:action1", "service:action2"],
        resources: ["*"],
        principals: [new ArnPrincipal("arn")],
        condition: [
          {
            test: "key",
            variable: "equals",
            values: ["value"],
          },
        ],
      }),
    );

    expect(stack1.resolve(doc1.toDocumentJson())).toEqual(
      stack2.resolve(doc2.toDocumentJson()),
    );
    // Do prepare run to resolve all Terraform resources
    stack1.prepareStack();
    stack2.prepareStack();
    expect(Testing.synth(stack1)).toEqual(Testing.synth(stack2));
  });

  describe("fromJson", () => {
    test("throws error when Statement isn't an array", () => {
      const stack = getAwsStack();
      expect(() => {
        PolicyDocument.fromJson(stack, "doc", {
          Statement: "asdf",
        });
      }).toThrow(/Statement must be an array/);
    });
  });

  test("adding another condition with the same operator does not delete the original", () => {
    const stack = getAwsStack();

    const p = new PolicyStatement();

    p.addConditionObject("StringEquals", { "kms:ViaService": "service" });

    p.addAccountCondition("12221121221");

    expect(stack.resolve(p.toStatementJson())).toEqual({
      Effect: "Allow",
      Condition: {
        StringEquals: {
          "kms:ViaService": "service",
          "sts:ExternalId": "12221121221",
        },
      },
    });
  });

  test("validation error if policy statement has no actions", () => {
    const policyStatement = new PolicyStatement({
      principals: [new AnyPrincipal()],
    });

    // THEN
    const validationErrorsForResourcePolicy: string[] =
      policyStatement.validateForResourcePolicy();
    // const validationErrorsForIdentityPolicy: string[] = policyStatement.validateForIdentityPolicy();
    expect(validationErrorsForResourcePolicy).toEqual([
      "A PolicyStatement must specify at least one 'action' or 'notAction'.",
    ]);
  });

  test("validation error if policy statement for resource-based policy has no principals specified", () => {
    const policyStatement = new PolicyStatement({
      actions: ["*"],
    });

    // THEN
    const validationErrors: string[] =
      policyStatement.validateForResourcePolicy();
    expect(validationErrors).toEqual([
      "A PolicyStatement used in a resource-based policy must specify at least one IAM principal.",
    ]);
  });
});

/**
 * Get all data of a given type from a synthesized stack
 */
function getDataSources(synthesized: string, resourceType: string): any[] {
  // HACK HACK - this is a workaround for CDKTF Matchers not providing resourceCount matchers
  const parsed = JSON.parse(synthesized);
  if (!parsed.data || !parsed.data[resourceType]) {
    return [];
  }
  return Object.values(parsed.data[resourceType]) as any[];
}

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
