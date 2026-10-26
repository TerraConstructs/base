// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk/custom-resource-handlers/test/aws-route53/cross-account-zone-delegation-handler.test.ts

// The handler is vendored as pre-transpiled CommonJS (no type declarations).
const HANDLER_PATH =
  "../../../src/aws/custom-resource-handlers/aws-route53/cross-account-zone-delegation-handler/index.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require(HANDLER_PATH);

// Minimal local stand-in for the `aws-lambda` type used upstream.
type CloudFormationCustomResourceEvent = { [key: string]: any };

const mockChangeResourceRecordSets = jest.fn();
const mockListHostedZonesByName = jest.fn();
const mockFromTemporaryCredentials = jest.fn();

const mockRoute53Client = {
  changeResourceRecordSets: mockChangeResourceRecordSets,
  listHostedZonesByName: mockListHostedZonesByName,
};

// TERRACONSTRUCTS DEVIATION: the AWS SDK v3 clients are not dev dependencies
// (the handler uses the SDK shipped in the Lambda Node.js runtime), so they are
// mocked as virtual modules. Upstream also mocks `@aws-sdk/client-sts`, which
// the handler does not import (credentials come from
// `@aws-sdk/credential-providers`), so that mock is replaced by one for
// `fromTemporaryCredentials`.
jest.mock(
  "@aws-sdk/client-route-53",
  () => {
    return {
      Route53: jest.fn().mockImplementation(() => {
        return mockRoute53Client;
      }),
    };
  },
  { virtual: true },
);

jest.mock(
  "@aws-sdk/credential-providers",
  () => {
    return {
      // lazy: the handler module (and so this factory) loads before
      // `mockFromTemporaryCredentials` is initialized
      fromTemporaryCredentials: (...args: any[]) =>
        mockFromTemporaryCredentials(...args),
    };
  },
  { virtual: true },
);

beforeEach(() => {
  mockRoute53Client.changeResourceRecordSets.mockClear();
  mockRoute53Client.listHostedZonesByName.mockClear();
  mockFromTemporaryCredentials.mockClear();
});

afterAll(() => {
  jest.resetAllMocks();
});

test("throws error if both ParentZoneId and ParentZoneName are not provided", async () => {
  // WHEN
  const event = getCfnEvent(
    {},
    {
      ParentZoneId: undefined,
      ParentZoneName: undefined,
    },
  );

  // THEN
  await expect(invokeHandler(event)).rejects.toThrow(
    /One of ParentZoneId or ParentZoneName must be specified/,
  );
});

test("calls create resource record set with Upsert for Create event", async () => {
  // GIVEN
  mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

  // WHEN
  const event = getCfnEvent();
  await invokeHandler(event);

  // THEN
  expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledTimes(1);
  expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledWith({
    HostedZoneId: "1",
    ChangeBatch: {
      Changes: [
        {
          Action: "UPSERT",
          ResourceRecordSet: {
            Name: "recordName",
            Type: "NS",
            TTL: 172800,
            ResourceRecords: [{ Value: "one" }, { Value: "two" }],
          },
        },
      ],
    },
  });
  // TerraConstructs addition: credentials are obtained by assuming the role
  expect(mockFromTemporaryCredentials).toHaveBeenCalledWith({
    clientConfig: { region: expect.any(String) },
    params: {
      RoleArn: "roleArn",
      RoleSessionName: expect.stringMatching(
        /^cross-account-zone-delegation-\d+$/,
      ),
    },
  });
});

test("calls create resource record set with DELETE for Delete event", async () => {
  // GIVEN
  mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

  // WHEN
  const event = getCfnEvent({ RequestType: "Delete" });
  await invokeHandler(event);

  // THEN
  expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledTimes(1);
  expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledWith({
    HostedZoneId: "1",
    ChangeBatch: {
      Changes: [
        {
          Action: "DELETE",
          ResourceRecordSet: {
            Name: "recordName",
            Type: "NS",
            TTL: 172800,
            ResourceRecords: [{ Value: "one" }, { Value: "two" }],
          },
        },
      ],
    },
  });
});

test("calls listHostedZonesByName to get public zoneId if ParentZoneId is not provided", async () => {
  // GIVEN
  const parentZoneName = "some.zone";
  const parentZoneId = "zone-id";

  mockRoute53Client.listHostedZonesByName.mockResolvedValueOnce({
    HostedZones: [
      { Name: `${parentZoneName}.`, Id: parentZoneId },
      {
        Name: `${parentZoneName}.`,
        Id: parentZoneId,
        Config: { PrivateZone: true },
      },
    ],
  });
  mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

  // WHEN
  const event = getCfnEvent(
    {},
    {
      ParentZoneId: undefined,
      ParentZoneName: parentZoneName,
    },
  );
  await invokeHandler(event);

  // THEN
  expect(mockRoute53Client.listHostedZonesByName).toHaveBeenCalledTimes(1);
  expect(mockRoute53Client.listHostedZonesByName).toHaveBeenCalledWith({
    DNSName: parentZoneName,
  });

  expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledTimes(1);
  expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledWith({
    HostedZoneId: parentZoneId,
    ChangeBatch: {
      Changes: [
        {
          Action: "UPSERT",
          ResourceRecordSet: {
            Name: "recordName",
            Type: "NS",
            TTL: 172800,
            ResourceRecords: [{ Value: "one" }, { Value: "two" }],
          },
        },
      ],
    },
  });
});

test("throws if more than one HostedZones are returned for the provided ParentHostedZone", async () => {
  // GIVEN
  const parentZoneName = "some.zone";
  const parentZoneId = "zone-id";

  mockRoute53Client.listHostedZonesByName.mockResolvedValueOnce({
    HostedZones: [
      { Name: `${parentZoneName}.`, Id: parentZoneId },
      { Name: `${parentZoneName}.`, Id: parentZoneId },
    ],
  });

  // WHEN
  const event = getCfnEvent(
    {},
    {
      ParentZoneId: undefined,
      ParentZoneName: parentZoneName,
    },
  );

  // THEN
  await expect(invokeHandler(event)).rejects.toThrow(
    /Expected one hosted zone to match the given name but found 2/,
  );
  expect(mockRoute53Client.listHostedZonesByName).toHaveBeenCalledTimes(1);
  expect(mockRoute53Client.listHostedZonesByName).toHaveBeenCalledWith({
    DNSName: parentZoneName,
  });
});

// TerraConstructs additions (not in the upstream handler test file).

describe("Update events", () => {
  test("renaming the delegated zone deletes the old record before upserting the new one", async () => {
    // GIVEN
    mockRoute53Client.changeResourceRecordSets.mockResolvedValue({});

    // WHEN
    const event = getCfnEvent(
      {
        RequestType: "Update",
        OldResourceProperties: {
          ServiceToken: "Foo",
          AssumeRoleArn: "oldRoleArn",
          ParentZoneId: "1",
          DelegatedZoneName: "oldRecordName",
          DelegatedZoneNameServers: ["three"],
          TTL: 60,
        },
      },
      { DelegatedZoneName: "newRecordName" },
    );
    await invokeHandler(event);

    // THEN
    const calls = mockRoute53Client.changeResourceRecordSets.mock.calls;
    expect(calls).toHaveLength(2);
    // old record removed with the old properties (and the old role)
    expect(calls[0][0]).toEqual({
      HostedZoneId: "1",
      ChangeBatch: {
        Changes: [
          {
            Action: "DELETE",
            ResourceRecordSet: {
              Name: "oldRecordName",
              Type: "NS",
              TTL: 60,
              ResourceRecords: [{ Value: "three" }],
            },
          },
        ],
      },
    });
    expect(mockFromTemporaryCredentials.mock.calls[0][0].params.RoleArn).toBe(
      "oldRoleArn",
    );
    // new record upserted with the new properties
    expect(calls[1][0]).toEqual({
      HostedZoneId: "1",
      ChangeBatch: {
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: "newRecordName",
              Type: "NS",
              TTL: 172800,
              ResourceRecords: [{ Value: "one" }, { Value: "two" }],
            },
          },
        ],
      },
    });
    expect(mockFromTemporaryCredentials.mock.calls[1][0].params.RoleArn).toBe(
      "roleArn",
    );
    mockRoute53Client.changeResourceRecordSets.mockReset();
  });

  test("an update that keeps the delegated zone name only upserts", async () => {
    // GIVEN
    mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

    // WHEN
    const event = getCfnEvent(
      {
        RequestType: "Update",
        OldResourceProperties: {
          ServiceToken: "Foo",
          AssumeRoleArn: "roleArn",
          ParentZoneId: "1",
          DelegatedZoneName: "recordName",
          DelegatedZoneNameServers: ["one", "two"],
          TTL: 60,
        },
      },
      { TTL: 300 },
    );
    await invokeHandler(event);

    // THEN
    expect(mockRoute53Client.changeResourceRecordSets).toHaveBeenCalledTimes(1);
    expect(
      mockRoute53Client.changeResourceRecordSets.mock.calls[0][0].ChangeBatch
        .Changes,
    ).toEqual([
      {
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: "recordName",
          Type: "NS",
          TTL: 300,
          ResourceRecords: [{ Value: "one" }, { Value: "two" }],
        },
      },
    ]);
  });
});

describe("STS region", () => {
  const savedRegion = process.env.AWS_REGION;
  const savedDefaultRegion = process.env.AWS_DEFAULT_REGION;
  afterEach(() => {
    if (savedRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = savedRegion;
    if (savedDefaultRegion === undefined) delete process.env.AWS_DEFAULT_REGION;
    else process.env.AWS_DEFAULT_REGION = savedDefaultRegion;
  });

  test("AssumeRoleRegion overrides the partition's Route53 region", async () => {
    // GIVEN
    process.env.AWS_REGION = "af-south-1";
    mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

    // WHEN
    await invokeHandler(getCfnEvent({}, { AssumeRoleRegion: "eu-central-1" }));

    // THEN
    expect(
      mockFromTemporaryCredentials.mock.calls[0][0].clientConfig.region,
    ).toBe("eu-central-1");
  });

  test.each([
    ["af-south-1", "us-east-1"],
    ["us-west-2", "us-east-1"],
    ["cn-north-1", "cn-northwest-1"],
    ["us-gov-east-1", "us-gov-west-1"],
    ["us-iso-west-1", "us-iso-east-1"],
    ["us-isob-east-1", "us-isob-east-1"],
    ["eu-isoe-west-1", "eu-isoe-west-1"],
    ["us-isof-east-1", "us-isof-south-1"],
    ["eusc-de-east-1", "eusc-de-east-1"],
  ])(
    "Lambda region %s assumes the role via the Route53 region %s",
    async (lambdaRegion, expected) => {
      // GIVEN
      process.env.AWS_REGION = lambdaRegion;
      mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

      // WHEN
      await invokeHandler(getCfnEvent());

      // THEN
      expect(
        mockFromTemporaryCredentials.mock.calls[0][0].clientConfig.region,
      ).toBe(expected);
    },
  );

  test("falls back to AWS_DEFAULT_REGION when AWS_REGION is unset", async () => {
    // GIVEN
    delete process.env.AWS_REGION;
    process.env.AWS_DEFAULT_REGION = "cn-northwest-1";
    mockRoute53Client.changeResourceRecordSets.mockResolvedValueOnce({});

    // WHEN
    await invokeHandler(getCfnEvent());

    // THEN
    expect(
      mockFromTemporaryCredentials.mock.calls[0][0].clientConfig.region,
    ).toBe("cn-northwest-1");
  });
});

function getCfnEvent(
  event?: Partial<CloudFormationCustomResourceEvent>,
  resourceProps?: any,
): Partial<CloudFormationCustomResourceEvent> {
  return {
    RequestType: "Create",
    ResourceProperties: {
      ServiceToken: "Foo",
      AssumeRoleArn: "roleArn",
      ParentZoneId: "1",
      DelegatedZoneName: "recordName",
      DelegatedZoneNameServers: ["one", "two"],
      TTL: 172800,
      ...resourceProps,
    },
    ...event,
  };
}

// helper function to get around TypeScript expecting a complete event object,
// even though our tests only need some of the fields
async function invokeHandler(
  event: Partial<CloudFormationCustomResourceEvent>,
) {
  return handler(event);
}
