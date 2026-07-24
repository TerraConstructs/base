// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/test/app-mesh-proxy-configuration.test.ts

import { ecsTaskDefinition } from "@cdktn/provider-aws";
import { App, HttpBackend, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as compute from "../../../../src/aws/compute";
import { Template } from "../../../assertions";

const ecs = compute.ecs;

describe("app mesh proxy configuration", () => {
  test("correctly sets all appMeshProxyConfiguration", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
      proxyConfiguration: ecs.ProxyConfigurations.appMeshProxyConfiguration({
        containerName: "envoy",
        properties: {
          ignoredUID: 1337,
          ignoredGID: 1338,
          appPorts: [80, 81],
          proxyIngressPort: 80,
          proxyEgressPort: 81,
          egressIgnoredPorts: [8081],
          egressIgnoredIPs: ["169.254.170.2", "169.254.169.254"],
        },
      }),
    });
    taskDefinition.addContainer("web", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    taskDefinition.addContainer("envoy", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("envoyproxy/envoy"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsTaskDefinition.EcsTaskDefinition,
      {
        proxy_configuration: {
          container_name: "envoy",
          properties: {
            IgnoredUID: "1337",
            IgnoredGID: "1338",
            AppPorts: "80,81",
            ProxyIngressPort: "80",
            ProxyEgressPort: "81",
            EgressIgnoredPorts: "8081",
            EgressIgnoredIPs: "169.254.170.2,169.254.169.254",
          },
          type: "APPMESH",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ProxyConfiguration: {
    //     ContainerName: 'envoy',
    //     ProxyConfigurationProperties: [
    //       {
    //         Name: 'IgnoredUID',
    //         Value: '1337',
    //       },
    //       {
    //         Name: 'IgnoredGID',
    //         Value: '1338',
    //       },
    //       {
    //         Name: 'AppPorts',
    //         Value: '80,81',
    //       },
    //       {
    //         Name: 'ProxyIngressPort',
    //         Value: '80',
    //       },
    //       {
    //         Name: 'ProxyEgressPort',
    //         Value: '81',
    //       },
    //       {
    //         Name: 'EgressIgnoredPorts',
    //         Value: '8081',
    //       },
    //       {
    //         Name: 'EgressIgnoredIPs',
    //         Value: '169.254.170.2,169.254.169.254',
    //       },
    //     ],
    //     Type: 'APPMESH',
    //   },
    // });
  });

  test("correctly sets appMeshProxyConfiguration with default properties set", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
      proxyConfiguration: ecs.ProxyConfigurations.appMeshProxyConfiguration({
        containerName: "envoy",
        properties: {
          ignoredUID: 1337,
          appPorts: [80, 81],
          proxyIngressPort: 80,
          proxyEgressPort: 81,
        },
      }),
    });
    taskDefinition.addContainer("web", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    taskDefinition.addContainer("envoy", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("envoyproxy/envoy"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsTaskDefinition.EcsTaskDefinition,
      {
        proxy_configuration: {
          container_name: "envoy",
          properties: {
            IgnoredUID: "1337",
            AppPorts: "80,81",
            ProxyIngressPort: "80",
            ProxyEgressPort: "81",
          },
          type: "APPMESH",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ProxyConfiguration: {
    //     ContainerName: 'envoy',
    //     ProxyConfigurationProperties: [
    //       {
    //         Name: 'IgnoredUID',
    //         Value: '1337',
    //       },
    //       {
    //         Name: 'AppPorts',
    //         Value: '80,81',
    //       },
    //       {
    //         Name: 'ProxyIngressPort',
    //         Value: '80',
    //       },
    //       {
    //         Name: 'ProxyEgressPort',
    //         Value: '81',
    //       },
    //     ],
    //     Type: 'APPMESH',
    //   },
    // });
  });

  test("correctly sets appMeshProxyConfiguration with empty egressIgnoredPorts and egressIgnoredIPs", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
      proxyConfiguration: ecs.ProxyConfigurations.appMeshProxyConfiguration({
        containerName: "envoy",
        properties: {
          ignoredUID: 1337,
          appPorts: [80, 81],
          proxyIngressPort: 80,
          proxyEgressPort: 81,
          egressIgnoredIPs: [],
          egressIgnoredPorts: [],
        },
      }),
    });
    taskDefinition.addContainer("web", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    taskDefinition.addContainer("envoy", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("envoyproxy/envoy"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsTaskDefinition.EcsTaskDefinition,
      {
        proxy_configuration: {
          container_name: "envoy",
          properties: {
            IgnoredUID: "1337",
            AppPorts: "80,81",
            ProxyIngressPort: "80",
            ProxyEgressPort: "81",
          },
          type: "APPMESH",
        },
      },
    );
    // Template.fromStack(stack).hasResourceProperties('AWS::ECS::TaskDefinition', {
    //   ProxyConfiguration: {
    //     ContainerName: 'envoy',
    //     ProxyConfigurationProperties: [
    //       {
    //         Name: 'IgnoredUID',
    //         Value: '1337',
    //       },
    //       {
    //         Name: 'AppPorts',
    //         Value: '80,81',
    //       },
    //       {
    //         Name: 'ProxyIngressPort',
    //         Value: '80',
    //       },
    //       {
    //         Name: 'ProxyEgressPort',
    //         Value: '81',
    //       },
    //     ],
    //     Type: 'APPMESH',
    //   },
    // });
  });

  test("accepts ignoredUID value of 0", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
      proxyConfiguration: ecs.ProxyConfigurations.appMeshProxyConfiguration({
        containerName: "envoy",
        properties: {
          ignoredUID: 0,
          appPorts: [80, 81],
          proxyIngressPort: 80,
          proxyEgressPort: 81,
        },
      }),
    });
    taskDefinition.addContainer("web", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    taskDefinition.addContainer("envoy", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("envoyproxy/envoy"),
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ecsTaskDefinition.EcsTaskDefinition,
      {
        proxy_configuration: {
          container_name: "envoy",
          properties: {
            IgnoredUID: "0",
            AppPorts: "80,81",
            ProxyIngressPort: "80",
            ProxyEgressPort: "81",
          },
          type: "APPMESH",
        },
      },
    );
  });

  test("throws when neither of IgnoredUID and IgnoredGID is set", () => {
    // GIVEN
    const stack = getAwsStack();

    // THEN
    expect(() => {
      new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
        networkMode: ecs.NetworkMode.AWS_VPC,
        proxyConfiguration: ecs.ProxyConfigurations.appMeshProxyConfiguration({
          containerName: "envoy",
          properties: {
            appPorts: [80, 81],
            proxyIngressPort: 80,
            proxyEgressPort: 81,
          },
        }),
      });
    }).toThrow(/At least one of ignoredUID or ignoredGID should be specified./);
  });
});

describe("AppMeshProxyConfiguration", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const app = Testing.app();
    const stack = new AwsStack(app);
    // snapshot tests must not use the default local backend - its state file
    // path is machine-dependent and would leak into the snapshot
    new HttpBackend(stack, { address: "http://localhost:3000" });

    // WHEN
    const taskDefinition = new ecs.Ec2TaskDefinition(stack, "Ec2TaskDef", {
      networkMode: ecs.NetworkMode.AWS_VPC,
      proxyConfiguration: ecs.ProxyConfigurations.appMeshProxyConfiguration({
        containerName: "envoy",
        properties: {
          ignoredUID: 1337,
          ignoredGID: 1338,
          appPorts: [80, 81],
          proxyIngressPort: 80,
          proxyEgressPort: 81,
          egressIgnoredPorts: [8081],
          egressIgnoredIPs: ["169.254.170.2", "169.254.169.254"],
        },
      }),
    });
    taskDefinition.addContainer("web", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
    });
    taskDefinition.addContainer("envoy", {
      memoryLimitMiB: 1024,
      image: ecs.ContainerImage.fromRegistry("envoyproxy/envoy"),
    });

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

function getAwsStack(): AwsStack {
  const app: App = Testing.app();
  return new AwsStack(app);
}
