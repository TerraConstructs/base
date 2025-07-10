import * as compute from "../../../src/aws/compute";

describe("access log", () => {
  test("if jsonWithStandardFields method called with no parameter", () => {
    const testFormat = compute.AccessLogFormat.jsonWithStandardFields();
    expect(testFormat.toString()).toEqual(
      '{"requestId":"$context.requestId","ip":"$context.identity.sourceIp","user":"$context.identity.user","caller":"$context.identity.caller","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength"}',
    );
  });

  test("if jsonWithStandardFields method called with all parameters false", () => {
    const testFormat = compute.AccessLogFormat.jsonWithStandardFields({
      caller: false,
      httpMethod: false,
      ip: false,
      protocol: false,
      requestTime: false,
      resourcePath: false,
      responseLength: false,
      status: false,
      user: false,
    });
    expect(testFormat.toString()).toEqual('{"requestId":"$context.requestId"}');
  });

  test("if clf method called", () => {
    const testFormat = compute.AccessLogFormat.clf();
    expect(testFormat.toString()).toEqual(
      '$context.identity.sourceIp $context.identity.caller $context.identity.user [$context.requestTime] "$context.httpMethod $context.resourcePath $context.protocol" $context.status $context.responseLength $context.requestId',
    );
  });

  test("if custom method called", () => {
    const testFormat = compute.AccessLogFormat.custom(
      JSON.stringify({
        requestId: compute.AccessLogField.contextRequestId(),
        sourceIp: compute.AccessLogField.contextIdentitySourceIp(),
        method: compute.AccessLogField.contextHttpMethod(),
        callerAccountId: compute.AccessLogField.contextCallerAccountId(),
        ownerAccountId: compute.AccessLogField.contextOwnerAccountId(),
        userContext: {
          sub: compute.AccessLogField.contextAuthorizerClaims("sub"),
          email: compute.AccessLogField.contextAuthorizerClaims("email"),
        },
        clientCertPem: compute.AccessLogField.contextIdentityClientCertPem(),
        subjectDN: compute.AccessLogField.contextIdentityClientCertSubjectDN(),
        issunerDN: compute.AccessLogField.contextIdentityClientCertIssunerDN(),
        serialNumber:
          compute.AccessLogField.contextIdentityClientCertSerialNumber(),
        validityNotBefore:
          compute.AccessLogField.contextIdentityClientCertValidityNotBefore(),
        validityNotAfter:
          compute.AccessLogField.contextIdentityClientCertValidityNotAfter(),
      }),
    );
    expect(testFormat.toString()).toEqual(
      '{"requestId":"$context.requestId","sourceIp":"$context.identity.sourceIp","method":"$context.httpMethod","callerAccountId":"$context.identity.accountId","ownerAccountId":"$context.accountId","userContext":{"sub":"$context.authorizer.claims.sub","email":"$context.authorizer.claims.email"},"clientCertPem":"$context.identity.clientCert.clientCertPem","subjectDN":"$context.identity.clientCert.subjectDN","issunerDN":"$context.identity.clientCert.issuerDN","serialNumber":"$context.identity.clientCert.serialNumber","validityNotBefore":"$context.identity.clientCert.validity.notBefore","validityNotAfter":"$context.identity.clientCert.validity.notAfter"}',
    );
  });
});
