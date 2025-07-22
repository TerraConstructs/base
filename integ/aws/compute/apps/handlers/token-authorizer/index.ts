// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/@aws-cdk-testing/framework-integ/test/aws-apigateway/test/authorizers/integ.token-authorizer.handler/index.ts

/* eslint-disable no-console */

export const handler = async (event: any, _context: any = {}): Promise<any> => {
  const authToken: string = event.authorizationToken;
  console.log(`event.authorizationToken = ${authToken}`);
  if (authToken === "allow" || authToken === "deny") {
    return {
      principalId: "user",
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: authToken,
            Resource: event.methodArn,
          },
        ],
      },
    };
  } else {
    throw new Error("Unauthorized");
  }
};
