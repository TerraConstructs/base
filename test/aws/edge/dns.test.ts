import * as fs from "fs";
import * as path from "path";
import {
  dataAwsIamPolicyDocument,
  iamRolePolicy,
  lambdaFunction,
} from "@cdktn/provider-aws";
import { customResource as cfncompatCustomResource } from "@cdktn/provider-cfncompat";
import { App, Testing, Token } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AssetStaging, Duration } from "../../../src";
import {
  edge,
  iam,
  storage,
  AwsStack,
  CustomResourceProviderBase,
} from "../../../src/aws";
import { Template } from "../../assertions";

const ipAddress = "123.123.123.0";
describe("DnsZone", () => {
  test("Create should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
      websiteConfig: {
        enabled: true,
      },
    });
    const distribution = new edge.Distribution(
      stack,
      "HelloWorldDistribution",
      {
        defaultBehavior: {
          origin: new edge.S3Origin(bucket),
        },
      },
    );
    // WHEN
    const zone = new edge.DnsZone(stack, "Zone", {
      zoneName: "example.com",
    });
    new edge.ARecord(stack, "ARecordApex", {
      zone,
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "ARecordBar", {
      zone,
      recordName: "bar",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "BucketAlias", {
      zone,
      recordName: "hello-world-bucket",
      target: edge.RecordTarget.fromAlias(new edge.BucketWebsiteTarget(bucket)),
    });
    new edge.ARecord(stack, "CdnAlias", {
      zone,
      recordName: "hello-world-cdn",
      target: edge.RecordTarget.fromAlias(
        new edge.DistributionTarget(distribution),
      ),
    });
    // Weighted routing policy
    new edge.ARecord(stack, "WeightedA", {
      zone,
      recordName: "weighted",
      weight: 80,
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "WeightedB", {
      zone,
      recordName: "weighted",
      weight: 20,
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    // Latency routing policy
    new edge.ARecord(stack, "LatencyA", {
      zone,
      recordName: "latency",
      region: "us-east-1",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "LatencyB", {
      zone,
      recordName: "latency",
      region: "ap-southeast-1",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Import should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    // WHEN
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    new edge.ARecord(stack, "ARecordApex", {
      zone, // without recordName should point to data source zoneName
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    new edge.ARecord(stack, "ARecordBar", {
      zone, // with recordName
      recordName: "bar",
      target: edge.RecordTarget.fromValues(ipAddress),
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
  test("Should throw error if bucket has no website config", () => {
    // GIVEN
    const stack = new AwsStack();
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    // WHEN
    const bucket = new storage.Bucket(stack, "HelloWorld", {
      namePrefix: "hello-world",
    });
    // THEN
    expect(() => {
      new edge.ARecord(stack, "HelloWorldAlias", {
        zone,
        target: edge.RecordTarget.fromAlias(
          new edge.BucketWebsiteTarget(bucket),
        ),
      });
    }).toThrow("Cannot use a non-website bucket");
  });
  test("Should throw error if multiple routing policies are provided", () => {
    // GIVEN
    const stack = new AwsStack();
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "Z1234567890");
    // THEN
    expect(() => {
      new edge.ARecord(stack, "HelloWorldRouting", {
        zone,
        weight: 80,
        region: "us-east-1",
        target: edge.RecordTarget.fromValues(ipAddress),
      });
    }).toThrow("Only one of");
  });
});

// AssetStaging stages next to cdktf.json (tcons-staging/ is gitignored).
const CDKTFJSON_PATH = path.join(__dirname, "fixtures", "cdktf.json");

function makeStack(): AwsStack {
  const app = Testing.stubVersion(
    new App({
      stackTraces: false,
      context: { cdktfJsonPath: CDKTFJSON_PATH },
    }),
  );
  return new AwsStack(app, "MyStack", {
    gridUUID: "g123e4567-e89b",
    providerConfig: { region: "us-east-1" },
  });
}

/**
 * Returns the statements of the first policy document whose id starts with
 * `idPrefix`.
 */
function policyDocumentStatements(stack: AwsStack, idPrefix: string): any[] {
  const docs = new Template(stack).dataSourcesByType(
    dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
  );
  const found = Object.entries(docs).find(([id]) => id.startsWith(idPrefix));
  expect(found).toBeDefined();
  return (found![1] as any).statement;
}

/**
 * Upstream asserts `statement.conditions` as a `{ [test]: { [variable]: values } }`
 * map; TerraConstructs' `PolicyStatement.conditions` is a list of
 * `{ test, variable, values }`, converted back to the map for comparison.
 */
function conditionMap(statement: iam.PolicyStatement | undefined): any {
  expect(statement).not.toBeUndefined();
  const map: any = {};
  for (const c of statement!.conditions) {
    map[c.test] = { ...(map[c.test] ?? {}), [c.variable]: c.values };
  }
  return map;
}

// ref: https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-route53/test/hosted-zone.test.ts
// ref: https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-route53/test/util.test.ts
describe("grantDelegation", () => {
  const DEFAULT_CONDITIONS = [
    {
      test: "ForAllValues:StringEquals",
      variable: "route53:ChangeResourceRecordSetsRecordTypes",
      values: ["NS"],
    },
    {
      test: "ForAllValues:StringEquals",
      variable: "route53:ChangeResourceRecordSetsActions",
      values: ["UPSERT", "DELETE"],
    },
  ];

  test("grantDelegation", () => {
    // GIVEN
    const stack = makeStack();
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountPrincipal("22222222222222"),
    });
    const zone = new edge.DnsZone(stack, "Zone", {
      zoneName: "banana.com",
    });

    // WHEN
    zone.grantDelegation(role);

    // THEN
    expect(policyDocumentStatements(stack, "Role_DefaultPolicy")).toEqual([
      {
        actions: ["route53:ChangeResourceRecordSets"],
        effect: "Allow",
        resources: [
          "arn:${data.aws_partition.Partitition.partition}:route53:::hostedzone/${aws_route53_zone.Zone_A5DE4B68.id}",
        ],
        condition: DEFAULT_CONDITIONS,
      },
      {
        actions: ["route53:ListHostedZonesByName"],
        effect: "Allow",
        resources: ["*"],
      },
    ]);
    // the grant is attached to the grantee role
    new Template(stack).expectResources(iamRolePolicy.IamRolePolicy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policy:
            "${data.aws_iam_policy_document.Role_DefaultPolicy_2E5E5E0B.json}",
          role: "${aws_iam_role.Role_1ABCC5F0.name}",
        }),
      ]),
    );
  });

  test("grantDelegation on imported zones", () => {
    // GIVEN
    const stack = makeStack();
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    // WHEN
    const zone = edge.DnsZone.fromZoneId(stack, "Zone", "hosted-id");
    zone.grantDelegation(role);

    // THEN
    expect(policyDocumentStatements(stack, "Role_DefaultPolicy")).toEqual([
      {
        actions: ["route53:ChangeResourceRecordSets"],
        effect: "Allow",
        resources: [
          "arn:${data.aws_partition.Partitition.partition}:route53:::hostedzone/hosted-id",
        ],
        condition: DEFAULT_CONDITIONS,
      },
      {
        actions: ["route53:ListHostedZonesByName"],
        effect: "Allow",
        resources: ["*"],
      },
    ]);
  });

  test("grantDelegation without delegatedZoneNames returns ChangeResourceRecordSets statement without normalized record names condition", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com" });

    // WHEN
    const actual = zone.grantDelegation(grantee);

    // THEN
    const statement = actual.principalStatements.find((x) =>
      x.actions.includes("route53:ChangeResourceRecordSets"),
    );
    expect(conditionMap(statement)).toEqual({
      "ForAllValues:StringEquals": {
        "route53:ChangeResourceRecordSetsRecordTypes": ["NS"],
        "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
      },
    });
  });

  test("grantDelegation with delegatedZoneNames returns ChangeResourceRecordSets statement with normalized record names condition", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com." });

    // WHEN
    const actual = zone.grantDelegation(grantee, {
      delegatedZoneNames: ["gamma.example.com", "beta.example.com"],
    });

    // THEN
    const statement = actual.principalStatements.find((x) =>
      x.actions.includes("route53:ChangeResourceRecordSets"),
    );
    expect(conditionMap(statement)).toEqual({
      "ForAllValues:StringEquals": {
        "route53:ChangeResourceRecordSetsRecordTypes": ["NS"],
        "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
        "route53:ChangeResourceRecordSetsNormalizedRecordNames": [
          "gamma.example.com",
          "beta.example.com",
        ],
      },
    });
  });

  test("grantDelegation with delegatedZoneNames returns ChangeResourceRecordSets statement with octal encoded zone name", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com" });

    // WHEN
    const actual = zone.grantDelegation(grantee, {
      // upstream literal '...@[\]^...' is '@[]^' (the backslash only escapes "]")
      delegatedZoneNames: ["!\"#$%&'()*+,-/:;<=>?@[]^_`{|}~.example.com"],
    });

    // THEN
    const statement = actual.principalStatements.find((x) =>
      x.actions.includes("route53:ChangeResourceRecordSets"),
    );
    expect(
      conditionMap(statement)["ForAllValues:StringEquals"][
        "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      ],
    ).toEqual([
      "\\041\\042\\043\\044\\045\\046\\047\\050\\051\\052\\053\\054-\\057\\072\\073\\074\\075\\076\\077\\100\\133\\135\\136_\\140\\173\\174\\175\\176.example.com",
    ]);
  });

  test("grantDelegation renders octal encoded names in the policy document", () => {
    // GIVEN (upstream integ.zone-delegation-iam-stack.ts names)
    const stack = makeStack();
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountRootPrincipal(),
    });
    const zone = new edge.DnsZone(stack, "Zone", {
      zoneName: "uniqueexample.com",
    });

    // WHEN
    zone.grantDelegation(role, {
      delegatedZoneNames: [
        "sub1.uniqueexample.com",
        "sub2_*$.uniqueexample.com",
      ],
    });

    // THEN
    const [changeStatement] = policyDocumentStatements(
      stack,
      "Role_DefaultPolicy",
    );
    expect(changeStatement.condition).toEqual([
      ...DEFAULT_CONDITIONS,
      {
        test: "ForAllValues:StringEquals",
        variable: "route53:ChangeResourceRecordSetsNormalizedRecordNames",
        values: ["sub1.uniqueexample.com", "sub2_\\052\\044.uniqueexample.com"],
      },
    ]);
  });

  test("grantDelegation with token in delegatedZoneNames bypasses validation", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com." });

    // WHEN
    const delegatedZoneName = Token.asString(Token.asAny("my-zone-name"));
    expect(Token.isUnresolved(delegatedZoneName)).toBe(true);
    const actual = zone.grantDelegation(grantee, {
      delegatedZoneNames: [delegatedZoneName],
    });

    // THEN
    const statement = actual.principalStatements.find((x) =>
      x.actions.includes("route53:ChangeResourceRecordSets"),
    );
    expect(conditionMap(statement)).toEqual({
      "ForAllValues:StringEquals": {
        "route53:ChangeResourceRecordSetsRecordTypes": ["NS"],
        "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
        "route53:ChangeResourceRecordSetsNormalizedRecordNames": [
          delegatedZoneName,
        ],
      },
    });
  });

  test("grantDelegation with token in delegatedZoneNames but suffixed with period fails validation", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com." });

    // THEN
    expect(() =>
      zone.grantDelegation(grantee, {
        delegatedZoneNames: [`${Token.asString(Token.asAny("my-zone-name"))}.`],
      }),
    ).toThrow(/delegated zone name cannot have a trailing period/);
  });

  test("grantDelegation with token in hosted zone partially bypasses validation", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = edge.DnsZone.fromZoneId(stack, "zone", "hosted-id");

    // WHEN
    const actual = zone.grantDelegation(grantee, {
      delegatedZoneNames: ["bob.example.com"],
    });

    // THEN
    const statement = actual.principalStatements.find((x) =>
      x.actions.includes("route53:ChangeResourceRecordSets"),
    );
    expect(
      conditionMap(statement)["ForAllValues:StringEquals"][
        "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      ],
    ).toEqual(["bob.example.com"]);
  });

  test.each([
    [" ", /Error while validating delegated zone name ' ': /],
    ["com", /must be suffixed by parent zone name/],
    ["notexample.org", /must be suffixed by parent zone name/],
    ["example.com", /cannot be the same as the parent zone name/],
    ["a.example.com.", /cannot have a trailing period/],
    ["A.example.com", /cannot contain uppercase characters/],
  ])(
    "grantDelegation with invalid delegated zone name '%s' throws",
    (invalidZoneName, expectedError) => {
      // GIVEN
      const stack = makeStack();
      const grantee = new iam.User(stack, "Grantee");
      const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com" });

      // THEN
      expect(() =>
        zone.grantDelegation(grantee, {
          delegatedZoneNames: [invalidZoneName],
        }),
      ).toThrow(expectedError);
    },
  );

  test("grantDelegation validates against the parent zone name without its trailing dot", () => {
    // GIVEN
    const stack = makeStack();
    const grantee = new iam.User(stack, "Grantee");
    const zone = new edge.DnsZone(stack, "zone", { zoneName: "example.com." });

    // THEN
    expect(() =>
      zone.grantDelegation(grantee, { delegatedZoneNames: ["example.com"] }),
    ).toThrow(/cannot be the same as the parent zone name/);
  });
});

// ref: https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-route53/test/record-set.test.ts
describe("CrossAccountZoneDelegationRecord", () => {
  const PROVIDER_PREFIX =
    "CustomCrossAccountZoneDelegationCustomResourceProvider";

  function setup() {
    const stack = makeStack();
    const parentZone = new edge.DnsZone(stack, "ParentHostedZone", {
      zoneName: "myzone.com",
    });
    const delegationRole = new iam.Role(stack, "DelegationRole", {
      assumedBy: new iam.AccountPrincipal("123456789012"),
    });
    parentZone.grantDelegation(delegationRole);
    const childZone = new edge.DnsZone(stack, "ChildHostedZone", {
      zoneName: "sub.myzone.com",
    });
    return { stack, parentZone, delegationRole, childZone };
  }

  function customResources(stack: AwsStack): Record<string, any> {
    return new Template(stack).resourcesByType(
      cfncompatCustomResource.CustomResource,
    ) as Record<string, any>;
  }

  test("Cross account zone delegation record with parentHostedZoneId", () => {
    // GIVEN
    const { stack, parentZone, delegationRole, childZone } = setup();

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneId: parentZone.zoneId,
      delegationRole,
      ttl: Duration.seconds(60),
    });

    // THEN
    const crs = Object.values(customResources(stack));
    expect(crs).toHaveLength(1);
    expect(crs[0]).toMatchObject({
      resource_type: "Custom::CrossAccountZoneDelegation",
      service_token: `\${aws_lambda_function.${PROVIDER_PREFIX}_Handler_44A84265.arn}`,
      resource_properties: {
        AssumeRoleArn: "${aws_iam_role.DelegationRole_33FED156.arn}",
        ParentZoneId: "${aws_route53_zone.ParentHostedZone_C2BD86E1.id}",
        DelegatedZoneName: "sub.myzone.com",
        DelegatedZoneNameServers:
          "${aws_route53_zone.ChildHostedZone_4B14AC71.name_servers}",
        TTL: 60,
      },
    });
    expect(crs[0].resource_properties).not.toHaveProperty("ParentZoneName");
    expect(crs[0].resource_properties).not.toHaveProperty("AssumeRoleRegion");
  });

  test("Cross account zone delegation record with stsRegion", () => {
    // GIVEN
    const { stack, parentZone, delegationRole, childZone } = setup();

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneId: parentZone.zoneId,
      delegationRole,
      ttl: Duration.seconds(60),
      assumeRoleRegion: "fake-region-1",
    });

    // THEN
    const crs = Object.values(customResources(stack));
    expect(crs[0].resource_properties).toMatchObject({
      ParentZoneId: "${aws_route53_zone.ParentHostedZone_C2BD86E1.id}",
      TTL: 60,
      AssumeRoleRegion: "fake-region-1",
    });
  });

  test("Cross account zone delegation record with parentHostedZoneName and default TTL", () => {
    // GIVEN
    const { stack, delegationRole, childZone } = setup();

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneName: "myzone.com",
      delegationRole,
    });

    // THEN
    const crs = Object.values(customResources(stack));
    expect(crs[0].resource_properties).toMatchObject({
      ParentZoneName: "myzone.com",
      DelegatedZoneName: "sub.myzone.com",
      TTL: 172800, // Duration.days(2)
    });
    expect(crs[0].resource_properties).not.toHaveProperty("ParentZoneId");
  });

  test("Cross account zone delegation record throws when parent id and name both/nither are supplied", () => {
    // GIVEN
    const { stack, parentZone, delegationRole, childZone } = setup();

    // THEN
    expect(() => {
      new edge.CrossAccountZoneDelegationRecord(stack, "Delegation1", {
        delegatedZone: childZone,
        delegationRole,
        ttl: Duration.seconds(60),
      });
    }).toThrow(
      /At least one of parentHostedZoneName or parentHostedZoneId is required/,
    );

    expect(() => {
      new edge.CrossAccountZoneDelegationRecord(stack, "Delegation2", {
        delegatedZone: childZone,
        parentHostedZoneId: parentZone.zoneId,
        parentHostedZoneName: parentZone.zoneName,
        delegationRole,
        ttl: Duration.seconds(60),
      });
    }).toThrow(
      /Only one of parentHostedZoneName and parentHostedZoneId is supported/,
    );
  });

  test("Multiple cross account zone delegation records share one provider", () => {
    // GIVEN
    const { stack, delegationRole, childZone } = setup();

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneName: "myzone.com",
      delegationRole,
      ttl: Duration.seconds(60),
    });
    const childZone2 = new edge.DnsZone(stack, "ChildHostedZone2", {
      zoneName: "anothersub.myzone.com",
    });
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation2", {
      delegatedZone: childZone2,
      parentHostedZoneName: "myzone.com",
      delegationRole,
      ttl: Duration.seconds(60),
    });

    // THEN
    // stack-level singleton with the upstream uniqueid
    const provider = stack.node.tryFindChild(
      "Custom::CrossAccountZoneDelegationCustomResourceProvider",
    ) as CustomResourceProviderBase;
    expect(provider).toBeInstanceOf(CustomResourceProviderBase);
    expect(provider.codeHash).toMatch(/^[0-9a-f]{64}$/);
    const template = new Template(stack);
    template.resourceCountIs(lambdaFunction.LambdaFunction, 1);
    template.expectResources(lambdaFunction.LambdaFunction).toEqual([
      expect.objectContaining({
        handler: "__entrypoint__.handler",
        runtime: "nodejs22.x", // LATEST_NODE_RUNTIME regional fact for us-east-1
      }),
    ]);

    const rolePolicyIds = Object.keys(
      template.resourcesByType(iamRolePolicy.IamRolePolicy),
    );
    const crs = customResources(stack);
    const findId = (ids: string[], prefix: string) => {
      const found = ids.filter((id) => id.startsWith(prefix));
      expect(found).toHaveLength(1);
      return found[0];
    };
    const childHostedZones = ["Delegation", "Delegation2"].map(
      (recordId, i) => ({
        cr: findId(
          Object.keys(crs),
          `${recordId}_CrossAccountZoneDelegationCustomResource_`,
        ),
        name: i === 0 ? "sub.myzone.com" : "anothersub.myzone.com",
        id: i === 0 ? "ChildHostedZone_4B14AC71" : "ChildHostedZone2_A37198F0",
        dependsOn: `aws_iam_role_policy.${findId(
          rolePolicyIds,
          `${recordId}_cross-account-zone-delegation-handler-role_Policy_ResourceRoles0_`,
        )}`,
      }),
    );
    expect(Object.keys(crs)).toHaveLength(2);
    for (const childHostedZone of childHostedZones) {
      const cr = crs[childHostedZone.cr];
      expect(cr).toMatchObject({
        service_token: `\${aws_lambda_function.${PROVIDER_PREFIX}_Handler_44A84265.arn}`,
        resource_properties: {
          AssumeRoleArn: "${aws_iam_role.DelegationRole_33FED156.arn}",
          ParentZoneName: "myzone.com",
          DelegatedZoneName: childHostedZone.name,
          DelegatedZoneNameServers: `\${aws_route53_zone.${childHostedZone.id}.name_servers}`,
          TTL: 60,
        },
      });
      // the custom resource depends on its own AssumeRole grant
      expect(cr.depends_on).toEqual(
        expect.arrayContaining([childHostedZone.dependsOn]),
      );
    }
  });

  test("Provider stages the vendored delegation handler behind the entrypoint wrapper", () => {
    // GIVEN
    const { stack, delegationRole, childZone } = setup();

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneName: "myzone.com",
      delegationRole,
    });

    // THEN
    const provider = stack.node.tryFindChild(
      "Custom::CrossAccountZoneDelegationCustomResourceProvider",
    ) as CustomResourceProviderBase;
    const staging = provider.node.tryFindChild("Staging") as AssetStaging;
    expect(staging).toBeInstanceOf(AssetStaging);
    expect(fs.readdirSync(staging.absoluteStagedPath).sort()).toEqual([
      "__entrypoint__.js",
      "index.js",
    ]);
    const handlerCode = fs.readFileSync(
      path.join(staging.absoluteStagedPath, "index.js"),
      "utf-8",
    );
    expect(handlerCode).toContain("cross-account-zone-delegation-");
    expect(handlerCode).toContain("exports.handler");
  });

  test("Cross account zone delegation policies", () => {
    // GIVEN
    const { stack, delegationRole, childZone } = setup();

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneName: "myzone.com",
      delegationRole,
      ttl: Duration.seconds(60),
    });
    const childZone2 = new edge.DnsZone(stack, "ChildHostedZone2", {
      zoneName: "anothersub.myzone.com",
    });
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation2", {
      delegatedZone: childZone2,
      parentHostedZoneName: "myzone.com",
      delegationRole,
      ttl: Duration.seconds(60),
    });

    // THEN
    const template = new Template(stack);
    const rolePolicies = template.resourcesByType(
      iamRolePolicy.IamRolePolicy,
    ) as Record<string, any>;
    for (const recordId of ["Delegation", "Delegation2"]) {
      const prefix = `${recordId}_cross-account-zone-delegation-handler-role_Policy`;
      const [policyId, policy] = Object.entries(rolePolicies).find(([id]) =>
        id.startsWith(`${prefix}_ResourceRoles0`),
      )!;
      expect(policyId).toBeDefined();
      // attached to the singleton provider role (role name parsed from its ARN)
      expect(policy.role).toEqual(
        `\${element(split("/", element(split(":", aws_iam_role.${PROVIDER_PREFIX}_Role_ED64687B.arn), 5)), 1)}`,
      );
      expect(policyDocumentStatements(stack, `${prefix}_`)).toEqual([
        {
          actions: ["sts:AssumeRole"],
          effect: "Allow",
          resources: ["${aws_iam_role.DelegationRole_33FED156.arn}"],
        },
      ]);
    }
  });

  // upstream integ.zone-delegation-iam-stack.ts: `record.node.addDependency(delegationGrant)`
  test("Cross account zone delegation record can depend on the parent zone delegation grant", () => {
    // GIVEN
    const stack = makeStack();
    const parentZone = new edge.DnsZone(stack, "ParentHostedZone", {
      zoneName: "myzone.com",
    });
    const delegationRole = new iam.Role(stack, "DelegationRole", {
      assumedBy: new iam.AccountRootPrincipal(),
    });
    const delegationGrant = parentZone.grantDelegation(delegationRole, {
      delegatedZoneNames: ["sub.myzone.com"],
    });
    const childZone = new edge.DnsZone(stack, "ChildHostedZone", {
      zoneName: "sub.myzone.com",
    });

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneId: parentZone.zoneId,
      delegationRole,
    }).node.addDependency(delegationGrant);

    // THEN
    const template = new Template(stack);
    const rolePolicyIds = Object.keys(
      template.resourcesByType(iamRolePolicy.IamRolePolicy),
    );
    const grantPolicy = rolePolicyIds.filter((id) =>
      id.startsWith("DelegationRole_DefaultPolicy_"),
    );
    const assumeRolePolicy = rolePolicyIds.filter((id) =>
      id.startsWith(
        "Delegation_cross-account-zone-delegation-handler-role_Policy_",
      ),
    );
    expect(grantPolicy).toHaveLength(1);
    expect(assumeRolePolicy).toHaveLength(1);
    const [cr] = Object.values(customResources(stack));
    // the NS record is only UPSERTed once the delegation role may change the
    // parent zone, and DELETEd before that permission is removed
    expect(cr.depends_on).toEqual(
      expect.arrayContaining([
        `aws_iam_role_policy.${grantPolicy[0]}`,
        `aws_iam_role_policy.${assumeRolePolicy[0]}`,
      ]),
    );
  });

  test("Cross account zone delegation record with an imported delegated zone", () => {
    // GIVEN
    const { stack, delegationRole } = setup();
    const childZone = edge.DnsZone.fromZoneId(stack, "ImportedChild", "Z1234");

    // WHEN
    new edge.CrossAccountZoneDelegationRecord(stack, "Delegation", {
      delegatedZone: childZone,
      parentHostedZoneName: "myzone.com",
      delegationRole,
    });

    // THEN
    // TERRACONSTRUCTS DEVIATION: imported zones read name and name servers from
    // `data.aws_route53_zone` (upstream imports have no name servers)
    const [cr] = Object.values(customResources(stack));
    expect(cr.resource_properties).toMatchObject({
      DelegatedZoneName: expect.stringMatching(
        /^\$\{data\.aws_route53_zone\.ImportedChild_[0-9A-F]+\.name\}$/,
      ),
      DelegatedZoneNameServers: expect.stringMatching(
        /^\$\{data\.aws_route53_zone\.ImportedChild_[0-9A-F]+\.name_servers\}$/,
      ),
    });
  });
});
