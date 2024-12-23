import {
  dataAwsIamPolicyDocument,
  iamRole,
  dataAwsServicePrincipal,
} from "@cdktf/provider-aws";
import { Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws/aws-stack";
import { OpenIdConnectProvider } from "../../../src/aws/iam/oidc-provider";
import { PolicyDocument } from "../../../src/aws/iam/policy-document";
import { PolicyStatement } from "../../../src/aws/iam/policy-statement";
import {
  PrincipalProps,
  fromPrincipalJson,
  PrincipalType,
  ServicePrincipal,
  FederatedPrincipal,
  WebIdentityPrincipal,
  OpenIdConnectPrincipal,
  StarPrincipal,
  PrincipalWithConditions,
  AccountPrincipal,
} from "../../../src/aws/iam/principals";
import { Role } from "../../../src/aws/iam/role";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};
test("cannot have multiple principals with different conditions in the same statement", () => {
  const stack = getAwsStack();
  const role = new Role(stack, "Role", {
    assumedBy: new ServicePrincipal("sns"),
  });

  expect(() => {
    role.addToPolicy(
      new PolicyStatement({
        principals: [
          new ServicePrincipal("myService.amazon.com", {
            conditions: [
              {
                test: "StringEquals",
                variable: "hairColor",
                values: ["blond"],
              },
            ],
          }),
          new ServicePrincipal("yourservice.amazon.com", {
            conditions: [
              {
                test: "StringEquals",
                variable: "hairColor",
                values: ["black"],
              },
            ],
          }),
        ],
      }),
    );
  }).toThrow(
    /All principals in a PolicyStatement must have the same Conditions/,
  );
});

test("can have multiple principals with the same conditions in the same statement", () => {
  const stack = getAwsStack();
  const role = new Role(stack, "Role", {
    assumedBy: new ServicePrincipal("sns"),
  });

  role.addToPolicy(
    new PolicyStatement({
      principals: [
        new ServicePrincipal("myService.amazon.com"),
        new ServicePrincipal("yourservice.amazon.com"),
      ],
    }),
  );

  role.addToPolicy(
    new PolicyStatement({
      principals: [
        new ServicePrincipal("myService.amazon.com", {
          conditions: [
            {
              test: "StringEquals",
              variable: "hairColor",
              values: ["blond"],
            },
          ],
        }),
        new ServicePrincipal("yourservice.amazon.com", {
          conditions: [
            {
              test: "StringEquals",
              variable: "hairColor",
              values: ["blond"],
            },
          ],
        }),
      ],
    }),
  );
});

test("use federated principal", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  const principal = new FederatedPrincipal("federated");

  // THEN
  expect(stack.resolve(principal.federated)).toStrictEqual("federated");
  expect(stack.resolve(principal.assumeRoleAction)).toStrictEqual(
    "sts:AssumeRole",
  );
  expect(stack.resolve(principal.conditions)).toStrictEqual([]);
});

test("use Web Identity principal", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  const principal = new WebIdentityPrincipal("cognito-identity.amazonaws.com");

  // THEN
  expect(stack.resolve(principal.federated)).toStrictEqual(
    "cognito-identity.amazonaws.com",
  );
  expect(stack.resolve(principal.assumeRoleAction)).toStrictEqual(
    "sts:AssumeRoleWithWebIdentity",
  );
});

test("use OpenID Connect principal from provider", () => {
  // GIVEN
  const stack = getAwsStack();
  const provider = new OpenIdConnectProvider(stack, "MyProvider", {
    url: "https://openid-endpoint",
    clientIds: ["266362248691-342342xasdasdasda-apps.googleusercontent.com"],
  });

  // WHEN
  const principal = new OpenIdConnectPrincipal(provider);

  // THEN
  expect(stack.resolve(principal.federated)).toStrictEqual(
    "${aws_iam_openid_connect_provider.MyProvider_730BA1C8.arn}",
  );
});

test("StarPrincipal", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  const pol = new PolicyDocument(stack, "doc", {
    statement: [
      new PolicyStatement({
        actions: ["service:action"],
        resources: ["*"],
        principals: [new StarPrincipal()],
      }),
    ],
  });

  // THEN
  expect(pol.toDocumentJson()).toEqual({
    Statement: [
      {
        Action: "service:action",
        Effect: "Allow",
        Principal: "*",
        Resource: "*",
      },
    ],
    Version: "2012-10-17",
  });
});

test("PrincipalWithConditions.addCondition should work", () => {
  // GIVEN
  const stack = getAwsStack();
  const basePrincipal = new ServicePrincipal("service.amazonaws.com");
  const principalWithConditions = new PrincipalWithConditions(basePrincipal, [
    {
      test: "StringEquals",
      variable: "aws:PrincipalOrgID",
      values: ["o-xxxxxxxxxxx"],
    },
  ]);

  // WHEN
  principalWithConditions.addConditionObject("StringEquals", {
    "aws:PrincipalTag/critical": "true",
  });
  new Role(stack, "Role", {
    assumedBy: principalWithConditions,
  });
  // Do prepare run to resolve all Terraform resources
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  // THEN
  expect(synthesized).toHaveDataSource(
    dataAwsServicePrincipal.DataAwsServicePrincipal,
  ); // NOTE: without prepareStack, the dataAwsServicePrincipal is missing
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          condition: [
            {
              test: "StringEquals",
              values: ["o-xxxxxxxxxxx"],
              variable: "aws:PrincipalOrgID",
            },
            {
              test: "StringEquals",
              values: ["true"],
              variable: "aws:PrincipalTag/critical",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_service.name}",
              ],
              type: "Service",
            },
          ],
        },
      ],
    },
  );
  expect(synthesized).toHaveResourceWithProperties(iamRole.IamRole, {
    assume_role_policy: expect.stringContaining(
      "data.aws_iam_policy_document.Role_AssumeRolePolicy",
    ),
  });
});

test("PrincipalWithConditions.addCondition with a new condition operator should work", () => {
  // GIVEN
  const stack = getAwsStack();
  const basePrincipal = new ServicePrincipal("service.amazonaws.com");
  const principalWithConditions = new PrincipalWithConditions(
    basePrincipal,
    [],
  );

  // WHEN
  principalWithConditions.addConditionObject("StringEquals", {
    "aws:PrincipalTag/critical": "true",
  });
  principalWithConditions.addConditionObject("IpAddress", {
    "aws:SourceIp": "0.0.0.0/0",
  });

  new Role(stack, "Role", {
    assumedBy: principalWithConditions,
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
          condition: [
            {
              test: "StringEquals",
              values: ["true"],
              variable: "aws:PrincipalTag/critical",
            },
            {
              test: "IpAddress",
              values: ["0.0.0.0/0"],
              variable: "aws:SourceIp",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "${data.aws_service_principal.aws_svcp_default_region_service.name}",
              ],
              type: "Service",
            },
          ],
        },
      ],
    },
  );
  expect(synthesized).toHaveResourceWithProperties(iamRole.IamRole, {
    assume_role_policy: expect.stringContaining(
      "data.aws_iam_policy_document.Role_AssumeRolePolicy",
    ),
  });
});

test("PrincipalWithConditions inherits principalAccount from AccountPrincipal ", () => {
  // GIVEN
  const accountPrincipal = new AccountPrincipal("123456789012");
  const principalWithConditions = accountPrincipal.withConditions({
    test: "StringEquals",
    variable: "hairColor",
    values: ["blond"],
  });

  // THEN
  expect(accountPrincipal.principalAccount).toStrictEqual("123456789012");
  expect(principalWithConditions.principalAccount).toStrictEqual(
    "123456789012",
  );
});

test("AccountPrincipal can specify an organization", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  const pol = new PolicyDocument(stack, "doc", {
    statement: [
      new PolicyStatement({
        actions: ["service:action"],
        resources: ["*"],
        principals: [
          new AccountPrincipal("123456789012").inOrganization("o-xxxxxxxxxx"),
        ],
      }),
    ],
  });

  // THEN
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        expect.objectContaining({
          actions: ["service:action"],
          condition: [
            {
              test: "StringEquals",
              values: ["o-xxxxxxxxxx"],
              variable: "aws:PrincipalOrgID",
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: [
                "arn:${data.aws_partition.Partitition.partition}:iam::123456789012:root",
              ],
              type: "AWS",
            },
          ],
          resources: ["*"],
        }),
      ],
    },
  );
  // get resolved Policy Document JSON
  expect(stack.resolve(pol.toDocumentJson())).toEqual({
    Statement: [
      {
        Action: "service:action",
        Effect: "Allow",
        Principal: {
          AWS: "arn:${data.aws_partition.Partitition.partition}:iam::123456789012:root",
        },
        Condition: {
          StringEquals: {
            "aws:PrincipalOrgID": "o-xxxxxxxxxx",
          },
        },
        Resource: "*",
      },
    ],
    Version: "2012-10-17",
  });
});

test("Can enable session tags", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new Role(stack, "Role", {
    assumedBy: new WebIdentityPrincipal("cognito-identity.amazonaws.com", [
      {
        test: "StringEquals",
        variable: "cognito-identity.amazonaws.com:aud",
        values: ["asdf"],
      },
      {
        test: "ForAnyValue:StringLike",
        variable: "cognito-identity.amazonaws.com:amr",
        values: ["authenticated"],
      },
    ]).withSessionTags(),
  });

  // THEN
  const synthesized = Testing.synth(stack);
  expect(synthesized).toHaveDataSourceWithProperties(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
    {
      statement: [
        {
          actions: ["sts:AssumeRoleWithWebIdentity", "sts:TagSession"],
          condition: [
            {
              test: "StringEquals",
              variable: "cognito-identity.amazonaws.com:aud",
              values: ["asdf"],
            },
            {
              test: "ForAnyValue:StringLike",
              variable: "cognito-identity.amazonaws.com:amr",
              values: ["authenticated"],
            },
          ],
          effect: "Allow",
          principals: [
            {
              identifiers: ["cognito-identity.amazonaws.com"],
              type: "Federated",
            },
          ],
        },
      ],
    },
  );
});

test("Can enable session tags with conditions (order of calls is irrelevant)", () => {
  // GIVEN
  const stack = getAwsStack();

  // WHEN
  new Role(stack, "Role", {
    assumedBy: new ServicePrincipal("s3")
      .withConditions({
        test: "StringEquals",
        variable: "hairColor",
        values: ["blond"],
      })
      .withSessionTags(),
  });

  new Role(stack, "Role2", {
    assumedBy: new ServicePrincipal("s3").withSessionTags().withConditions({
      test: "StringEquals",
      variable: "hairColor",
      values: ["blond"],
    }),
  });

  // THEN
  stack.prepareStack();
  const synthesized = Testing.synth(stack);
  // expect(synthesized).toMatchSnapshot();
  const assumeRolePolicies = Object.values(
    JSON.parse(synthesized).data.aws_iam_policy_document,
  );
  expect(assumeRolePolicies.length).toStrictEqual(2);
  expect(assumeRolePolicies[0]).toEqual(assumeRolePolicies[1]);
  // expect(synthesized).toHaveDataSourceWithProperties(
  //   dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
  //   {
  //     statement: [
  //       {
  //         actions: ["sts:AssumeRole", "sts:TagSession"],
  //         condition: [
  //           {
  //             test: "StringEquals",
  //             variable: "hairColor",
  //             values: ["blond"],
  //           },
  //         ],
  //         effect: "Allow",
  //         principals: [
  //           {
  //             identifiers: [
  //               "${data.aws_service_principal.aws_svcp_default_region_s3.id}",
  //             ],
  //             type: "Service",
  //           },
  //         ],
  //       },
  //     ],
  //   },
  // );
});

describe("fromPrincipalJson", () => {
  it("should handle empty condition JSON", () => {
    const expected = new Array<PrincipalProps>();

    const result = fromPrincipalJson({});

    expect(result).toEqual(expected);
  });
  it("should convert from AWS account Principal JSON", () => {
    const principalJson = {
      AWS: ["123456789012", "555555555555"],
    };

    const expected: PrincipalProps[] = [
      {
        type: PrincipalType.AWS,
        identifiers: ["123456789012", "555555555555"],
      },
    ];

    const result = fromPrincipalJson(principalJson);

    expect(result).toEqual(expected);
  });
  it("should convert from account with cannonical user AWS Principal JSON", () => {
    const principalJson = {
      AWS: ["arn:aws:iam::123456789012:root", "999999999999"],
      CanonicalUser:
        "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be",
    };

    const expected: PrincipalProps[] = [
      {
        type: PrincipalType.AWS,
        identifiers: ["arn:aws:iam::123456789012:root", "999999999999"],
      },
      {
        type: PrincipalType.CANONICALUSER,
        identifiers: [
          "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be",
        ],
      },
    ];

    const result = fromPrincipalJson(principalJson);

    expect(result).toEqual(expected);
  });
  it("should convert OIDC session principals JSON", () => {
    const principalJson = { Federated: "cognito-identity.amazonaws.com" };

    const expected: PrincipalProps[] = [
      {
        type: PrincipalType.FEDERATED,
        identifiers: ["cognito-identity.amazonaws.com"],
      },
    ];

    const result = fromPrincipalJson(principalJson);

    expect(result).toEqual(expected);
  });
  it("should convert AWS service principals JSON", () => {
    const principalJson = {
      Service: ["ecs.amazonaws.com", "elasticloadbalancing.amazonaws.com"],
    };

    const expected: PrincipalProps[] = [
      {
        type: PrincipalType.SERVICE,
        identifiers: [
          "ecs.amazonaws.com",
          "elasticloadbalancing.amazonaws.com",
        ],
      },
    ];

    const result = fromPrincipalJson(principalJson);

    expect(result).toEqual(expected);
  });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
}
