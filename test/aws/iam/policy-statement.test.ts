import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { PolicyStatement, Effect } from "../../../src/aws/iam/policy-statement";
import { AnyPrincipal } from "../../../src/aws/iam/principals";
import { AwsSpec } from "../../../src/aws/spec";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
describe("IAM policy statement", () => {
  describe("from JSON", () => {
    test("parses with no principal", () => {
      // GIVEN
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addActions("service:action1", "service:action2");
      s.addAllResources();
      s.addConditionObject("test", { key: "value" });

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      // when
      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      // then
      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("parses a given Principal", () => {
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addActions("service:action1", "service:action2");
      s.addAllResources();
      s.addArnPrincipal("somearn");
      s.addConditionObject("equals", { key: "value" });

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("should not convert `Principal: *` to `Principal: { AWS: * }`", () => {
      const spec = getAwsSpec();
      const s = PolicyStatement.fromJson({
        Action: ["service:action1"],
        Principal: "*",
        Resource: "*",
      });

      const doc1 = new PolicyDocument(spec, "doc");
      doc1.addStatements(s);

      const rendered = doc1.toDocumentJson();

      expect(rendered).toEqual({
        Statement: [
          {
            Action: "service:action1",
            Effect: "Allow",
            Principal: "*",
            Resource: "*",
          },
        ],
        Version: "2012-10-17",
      });
      expect(Testing.synth(spec)).toMatchSnapshot();
    });

    test("parses a given notPrincipal", () => {
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addActions("service:action1", "service:action2");
      s.addAllResources();
      s.addNotPrincipals(new AnyPrincipal());
      s.addConditionObject("equals", { key: "value" });

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("parses with notAction", () => {
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addNotActions("service:action3");
      s.addAllResources();

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("parses with notActions", () => {
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addNotActions("service:action3", "service:action4");
      s.addAllResources();

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("parses with notResource", () => {
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addActions("service:action3", "service:action4");
      s.addNotResources("resource1");

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("parses with notResources", () => {
      const spec1 = getAwsSpec();
      const spec2 = getAwsSpec();

      const s = new PolicyStatement();
      s.addActions("service:action3", "service:action4");
      s.addNotResources("resource1", "resource2");

      const doc1 = new PolicyDocument(spec1, "doc");
      doc1.addStatements(s);

      PolicyDocument.fromJson(spec2, "doc", doc1.toDocumentJson());

      const doc1Synth = Testing.synth(spec1);
      expect(doc1Synth).toEqual(Testing.synth(spec2));
      expect(doc1Synth).toMatchSnapshot();
    });

    test("the kitchen sink", () => {
      const spec = getAwsSpec();

      const policyDocument = {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "FirstStatement",
            Effect: "Allow",
            Action: "iam:ChangePassword",
            Resource: "*",
          },
          {
            Sid: "SecondStatement",
            Effect: "Allow",
            Action: "s3:ListAllMyBuckets",
            Resource: "*",
          },
          {
            Sid: "ThirdStatement",
            Effect: "Allow",
            Action: ["s3:List*", "s3:Get*"],
            Resource: [
              "arn:aws:s3:::confidential-data",
              "arn:aws:s3:::confidential-data/*",
            ],
            Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } },
          },
        ],
      };

      const doc = PolicyDocument.fromJson(spec, "doc", policyDocument);

      expect(doc.toDocumentJson()).toEqual(policyDocument);
      expect(Testing.synth(spec)).toMatchSnapshot();
    });

    test("throws error with field data being object", () => {
      expect(() => {
        PolicyStatement.fromJson({
          Action: {},
        });
      }).toThrow(/Fields must be either a string or an array of strings/);
    });

    test("throws error with field data being array of non-strings", () => {
      expect(() => {
        PolicyStatement.fromJson({
          Action: [{}],
        });
      }).toThrow(/Fields must be either a string or an array of strings/);
    });
  });

  // test("throws error when group is specified for 'Principal' or 'NotPrincipal'", () => {
  //   const spec = getAwsSpec();
  //   const group = new Group(spec, "groupId");
  //   const policyStatement = new PolicyStatement();

  //   expect(() => policyStatement.addPrincipals(group)).toThrow(
  //     /Cannot use an IAM Group as the 'Principal' or 'NotPrincipal' in an IAM Policy/,
  //   );
  //   expect(() => policyStatement.addNotPrincipals(group)).toThrow(
  //     /Cannot use an IAM Group as the 'Principal' or 'NotPrincipal' in an IAM Policy/,
  //   );
  // });

  test("throws error when an invalid 'Action' or 'NotAction' is added", () => {
    const policyStatement = new PolicyStatement();
    const invalidAction = "xyz";
    expect(() => policyStatement.addActions(invalidAction)).toThrow(
      `Action '${invalidAction}' is invalid. An action string consists of a service namespace, a colon, and the name of an action. Action names can include wildcards.`,
    );
    expect(() => policyStatement.addNotActions(invalidAction)).toThrow(
      `Action '${invalidAction}' is invalid. An action string consists of a service namespace, a colon, and the name of an action. Action names can include wildcards.`,
    );
  });

  test("multiple identical entries render to a scalar (instead of a singleton list)", () => {
    const policyStatement = new PolicyStatement({
      actions: ["aws:Action"],
    });

    policyStatement.addResources("asdf");
    policyStatement.addResources("asdf");
    policyStatement.addResources("asdf");

    expect(policyStatement.toStatementJson()).toEqual({
      Effect: "Allow",
      Action: "aws:Action",
      Resource: "asdf",
    });
  });

  test("a frozen policy statement cannot be modified any more", () => {
    // GIVEN
    const statement = new PolicyStatement({
      actions: ["action:a"],
      resources: ["*"],
    });
    statement.freeze();

    // WHEN
    const modifications = [
      () => (statement.sid = "asdf"),
      () => (statement.effect = Effect.DENY),
      () => statement.addActions("abc:def"),
      () => statement.addNotActions("abc:def"),
      () => statement.addResources("*"),
      () => statement.addNotResources("*"),
      () => statement.addPrincipals(new AnyPrincipal()),
      () => statement.addNotPrincipals(new AnyPrincipal()),
      () => statement.addConditionObject("equals", "value"),
    ];

    for (const mod of modifications) {
      expect(mod).toThrow(/can no longer be modified/);
    }
  });
});

function getAwsSpec(): AwsSpec {
  const app = Testing.app();
  return new AwsSpec(app, "TestSpec", {
    environmentName,
    gridUUID,
    providerConfig,
  });
}
