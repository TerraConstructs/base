// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-events/test/connection.test.ts

import { cloudwatchEventConnection } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import { AwsStack } from "../../../src/aws/aws-stack";
import "cdktf/lib/testing/adapters/jest";
import * as notify from "../../../src/aws/notify";
// import { SecretValue, Stack } from "../../core";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let app: App;
let stack: AwsStack;
beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "TestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

test("basic connection", () => {
  // WHEN
  new notify.Connection(stack, "Connection", {
    authorization: notify.Authorization.basic(
      "username",
      "password", // TODO: should be sensitive
    ),
    connectionName: "testConnection",
    description: "ConnectionDescription",
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    cloudwatchEventConnection.CloudwatchEventConnection,
    {
      name: "testConnection",
      description: "ConnectionDescription",
      authorization_type: "BASIC",
      auth_parameters: {
        basic: {
          password: "password",
          username: "username",
        },
      },
    },
  );
});

test("API key connection", () => {
  // WHEN
  new notify.Connection(stack, "Connection", {
    authorization: notify.Authorization.apiKey(
      "keyname",
      "keyvalue", // TODO: should be sensitive
    ),
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    cloudwatchEventConnection.CloudwatchEventConnection,
    {
      authorization_type: "API_KEY",
      auth_parameters: {
        api_key: {
          key: "keyname",
          value: "keyvalue",
        },
      },
    },
  );
});

test("oauth connection", () => {
  // WHEN
  new notify.Connection(stack, "Connection", {
    authorization: notify.Authorization.oauth({
      authorizationEndpoint: "authorizationEndpoint",
      clientId: "clientID",
      clientSecret: "clientSecret", // TODO: should be sensitive
      httpMethod: notify.HttpMethod.GET,
      headerParameters: {
        oAuthHeaderKey: notify.HttpParameter.fromString("oAuthHeaderValue"),
      },
    }),
    headerParameters: {
      invocationHeaderKey: notify.HttpParameter.fromString(
        "invocationHeaderValue",
      ),
    },
    connectionName: "testConnection",
    description: "ConnectionDescription",
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    cloudwatchEventConnection.CloudwatchEventConnection,
    {
      authorization_type: "OAUTH_CLIENT_CREDENTIALS",
      auth_parameters: {
        oauth: {
          authorization_endpoint: "authorizationEndpoint",
          client_parameters: {
            client_id: "clientID",
            client_secret: "clientSecret",
          },
          http_method: "GET",
          oauth_http_parameters: {
            header: [
              {
                is_value_secret: false,
                key: "oAuthHeaderKey",
                value: "oAuthHeaderValue",
              },
            ],
          },
        },
        invocation_http_parameters: {
          header: [
            {
              is_value_secret: false,
              key: "invocationHeaderKey",
              value: "invocationHeaderValue",
            },
          ],
        },
      },
      description: "ConnectionDescription",
      name: "testConnection",
    },
  );
});

test("Additional plaintext headers", () => {
  // WHEN
  new notify.Connection(stack, "Connection", {
    authorization: notify.Authorization.apiKey(
      "keyname",
      "keyvalue", // TODO: should be sensitive
    ),
    headerParameters: {
      "content-type": notify.HttpParameter.fromString("application/json"),
    },
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    cloudwatchEventConnection.CloudwatchEventConnection,
    {
      authorization_type: "API_KEY",
      auth_parameters: {
        api_key: {
          key: "keyname",
          value: "keyvalue",
        },
        invocation_http_parameters: {
          header: [
            {
              key: "content-type",
              value: "application/json",
              is_value_secret: false,
            },
          ],
        },
      },
    },
  );
});

test("Additional secret headers", () => {
  // WHEN
  new notify.Connection(stack, "Connection", {
    authorization: notify.Authorization.apiKey(
      "keyname",
      "keyvalue", // TODO: should be sensitive
    ),
    headerParameters: {
      "client-secret": notify.HttpParameter.fromSecret(
        "apiSecret", // TODO: should be sensitive
      ),
    },
  });

  // THEN
  const t = new Template(stack);
  t.expect.toHaveResourceWithProperties(
    cloudwatchEventConnection.CloudwatchEventConnection,
    {
      authorization_type: "API_KEY",
      auth_parameters: {
        api_key: {
          key: "keyname",
          value: "keyvalue",
        },
        invocation_http_parameters: {
          header: [
            {
              key: "client-secret",
              value: "apiSecret",
              is_value_secret: true,
            },
          ],
        },
      },
    },
  );
});
