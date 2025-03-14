import { ViaServicePrincipal } from "../../../src/aws/encryption/via-service-principal";
import * as iam from "../../../src/aws/iam";

test("Via service, any principal", () => {
  // WHEN
  const statement = new iam.PolicyStatement({
    actions: ["abc:call"],
    principals: [new ViaServicePrincipal("bla.amazonaws.com")],
    resources: ["*"],
  });

  // THEN
  expect(statement.toStatementJson()).toEqual({
    Action: "abc:call",
    Condition: { StringEquals: { "kms:ViaService": "bla.amazonaws.com" } },
    Effect: "Allow",
    Principal: { AWS: "*" },
    Resource: "*",
  });
});

test("Via service, principal with conditions", () => {
  // WHEN
  const statement = new iam.PolicyStatement({
    actions: ["abc:call"],
    principals: [
      new ViaServicePrincipal(
        "bla.amazonaws.com",
        new iam.OrganizationPrincipal("o-1234"),
      ),
    ],
    resources: ["*"],
  });

  // THEN
  expect(statement.toStatementJson()).toEqual({
    Action: "abc:call",
    Condition: {
      StringEquals: {
        "kms:ViaService": "bla.amazonaws.com",
        "aws:PrincipalOrgID": "o-1234",
      },
    },
    Effect: "Allow",
    Principal: { AWS: "*" },
    Resource: "*",
  });
});
