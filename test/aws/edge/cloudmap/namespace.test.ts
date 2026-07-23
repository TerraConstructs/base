// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-servicediscovery/test/namespace.test.ts

import {
  serviceDiscoveryHttpNamespace,
  serviceDiscoveryPublicDnsNamespace,
  serviceDiscoveryPrivateDnsNamespace,
} from "@cdktn/provider-aws";
import { HttpBackend, Testing, TerraformOutput } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws";
import * as compute from "../../../../src/aws/compute";
import * as cloudmap from "../../../../src/aws/edge/cloudmap";
import { Template } from "../../../assertions";

// snapshot tests must not use the default local backend - its state file path
// is machine-dependent and would leak into the snapshot
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("namespace", () => {
  test("HTTP namespace", () => {
    const stack = new AwsStack();

    new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "foobar.com",
    });

    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryHttpNamespace.ServiceDiscoveryHttpNamespace,
      {
        name: "foobar.com",
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::HttpNamespace',
    //       Properties: {
    //         Name: 'foobar.com',
    //       },
    //     },
    //   },
    // });
  });

  test("Public DNS namespace", () => {
    const stack = new AwsStack();

    new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "foobar.com",
    });

    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPublicDnsNamespace.ServiceDiscoveryPublicDnsNamespace,
      {
        name: "foobar.com",
      },
    );
    // Template.fromStack(stack).templateMatches({
    //   Resources: {
    //     MyNamespaceD0BB8558: {
    //       Type: 'AWS::ServiceDiscovery::PublicDnsNamespace',
    //       Properties: {
    //         Name: 'foobar.com',
    //       },
    //     },
    //   },
    // });
  });

  test("Private DNS namespace", () => {
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");

    new cloudmap.PrivateDnsNamespace(stack, "MyNamespace", {
      name: "foobar.com",
      vpc,
    });

    Template.synth(stack).toHaveResourceWithProperties(
      serviceDiscoveryPrivateDnsNamespace.ServiceDiscoveryPrivateDnsNamespace,
      {
        name: "foobar.com",
        vpc: stack.resolve(vpc.vpcId),
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ServiceDiscovery::PrivateDnsNamespace', {
    //   Name: 'foobar.com',
    //   Vpc: {
    //     Ref: 'MyVpcF9F0CA6F',
    //   },
    // });
  });

  test("CloudFormation attributes", () => {
    const stack = new AwsStack();
    const vpc = new compute.Vpc(stack, "MyVpc");

    // NOTE: upstream constructs both "private" and "public" namespaces as
    // PrivateDnsNamespace verbatim (this looks like an upstream copy/paste
    // typo, preserved here as-is).
    const privateNs = new cloudmap.PrivateDnsNamespace(
      stack,
      "MyPrivateNamespace",
      {
        name: "foobar.com",
        vpc,
      },
    );
    const publicNs = new cloudmap.PrivateDnsNamespace(
      stack,
      "MyPublicNamespace",
      {
        name: "foobar.com",
        vpc,
      },
    );
    new TerraformOutput(stack, "PrivateNsId", { value: privateNs.namespaceId });
    new TerraformOutput(stack, "PrivateNsArn", {
      value: privateNs.namespaceArn,
    });
    new TerraformOutput(stack, "PrivateHostedZoneId", {
      value: privateNs.namespaceHostedZoneId,
    });
    new TerraformOutput(stack, "PublicNsId", { value: publicNs.namespaceId });
    new TerraformOutput(stack, "PublicNsArn", { value: publicNs.namespaceArn });
    new TerraformOutput(stack, "PublicHostedZoneId", {
      value: publicNs.namespaceHostedZoneId,
    });

    Template.fromStack(stack).toMatchObject({
      output: {
        PrivateNsId: {
          value: stack.resolve(privateNs.namespaceId),
        },
        PrivateNsArn: {
          value: stack.resolve(privateNs.namespaceArn),
        },
        PrivateHostedZoneId: {
          value: stack.resolve(privateNs.namespaceHostedZoneId),
        },
        PublicNsId: {
          value: stack.resolve(publicNs.namespaceId),
        },
        PublicNsArn: {
          value: stack.resolve(publicNs.namespaceArn),
        },
        PublicHostedZoneId: {
          value: stack.resolve(publicNs.namespaceHostedZoneId),
        },
      },
    });
    // Template.fromStack(stack).hasOutput('PrivateNsId', {
    //   Value: {
    //     'Fn::GetAtt': [
    //       'MyPrivateNamespace8CB3AE39',
    //       'Id',
    //     ],
    //   },
    // });
    // Template.fromStack(stack).hasOutput('PrivateNsArn', {
    //   Value: {
    //     'Fn::GetAtt': [
    //       'MyPrivateNamespace8CB3AE39',
    //       'Arn',
    //     ],
    //   },
    // });
    // Template.fromStack(stack).hasOutput('PrivateHostedZoneId', {
    //   Value: {
    //     'Fn::GetAtt': [
    //       'MyPrivateNamespace8CB3AE39',
    //       'HostedZoneId',
    //     ],
    //   },
    // });
    // Template.fromStack(stack).hasOutput('PublicNsId', {
    //   Value: {
    //     'Fn::GetAtt': [
    //       'MyPublicNamespaceAB66AFAC',
    //       'Id',
    //     ],
    //   },
    // });
    // Template.fromStack(stack).hasOutput('PublicNsArn', {
    //   Value: {
    //     'Fn::GetAtt': [
    //       'MyPublicNamespaceAB66AFAC',
    //       'Arn',
    //     ],
    //   },
    // });
    // Template.fromStack(stack).hasOutput('PublicHostedZoneId', {
    //   Value: {
    //     'Fn::GetAtt': [
    //       'MyPublicNamespaceAB66AFAC',
    //       'HostedZoneId',
    //     ],
    //   },
    // });
  });
});

describe("namespace snapshots", () => {
  test("HTTP namespace should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    // WHEN
    new cloudmap.HttpNamespace(stack, "MyNamespace", {
      name: "foobar.com",
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Public DNS namespace should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    // WHEN
    new cloudmap.PublicDnsNamespace(stack, "MyNamespace", {
      name: "foobar.com",
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });

  test("Private DNS namespace should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    new HttpBackend(stack, gridBackendConfig);
    const vpc = new compute.Vpc(stack, "MyVpc");
    // WHEN
    new cloudmap.PrivateDnsNamespace(stack, "MyNamespace", {
      name: "foobar.com",
      vpc,
    });
    // THEN
    stack.prepareStack();
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
