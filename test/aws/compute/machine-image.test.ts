// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/machine-image.test.ts

import { dataAwsAmi, dataAwsSsmParameter } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import * as ec2 from "../../../src/aws/compute";

import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "testregion" };

let app: App;
let stack: AwsStack;

beforeEach(() => {
  app = Testing.app();
  stack = new AwsStack(app, "IPAMTestStack", {
    environmentName,
    gridUUID,
    providerConfig,
    gridBackendConfig,
  });
});

test("can make and use a Linux image", () => {
  // WHEN
  const image = new ec2.GenericLinuxImage({
    testregion: "ami-1234",
  });

  // THEN
  const details = image.getImage(stack);
  expect(details.imageId).toEqual("ami-1234");
  expect(details.osType).toEqual(ec2.OperatingSystemType.LINUX);
});

// // TODO: TerraConstructs currently does not support "agnostic" stacks
// test("can make and use a Linux image in agnostic stack", () => {
//   // WHEN
//   const image = new ec2.GenericLinuxImage({
//     testregion: "ami-1234",
//   });

//   // THEN
//   const details = image.getImage(stack);
//   Template.fromStack(stack).toMatchObject({
//     locals: {
//       AmiMap: {
//         testregion: {
//           ami: "ami-1234",
//         },
//       },
//     },
//   });
//   expect(stack.resolve(details.imageId)).toEqual(
//     '${lookupNested(local.AmiMap,${AWS::Region},"ami"}',
//   );
//   expect(details.osType).toEqual(ec2.OperatingSystemType.LINUX);
// });

test("can make and use a Windows image", () => {
  // WHEN
  const image = new ec2.GenericWindowsImage({
    testregion: "ami-1234",
  });

  // THEN
  const details = image.getImage(stack);
  expect(details.imageId).toEqual("ami-1234");
  expect(details.osType).toEqual(ec2.OperatingSystemType.WINDOWS);
});

// // TODO: TerraConstructs currently does not support "agnostic" stacks
// test("can make and use a Windows image in agnostic stack", () => {
//   // WHEN
//   const image = new ec2.GenericWindowsImage({
//     testregion: "ami-1234",
//   });

//   // THEN
//   const details = image.getImage(stack);

//   Template.fromStack(stack).toMatchObject({
//     locals: {
//       AmiMap: {
//         testregion: {
//           ami: "ami-1234",
//         },
//       },
//     },
//   });
//   expect(stack.resolve(details.imageId)).toEqual(
//     '${lookupNested(local.AmiMap,${AWS::Region},"ami"}',
//   );
//   expect(details.osType).toEqual(ec2.OperatingSystemType.WINDOWS);
// });

test("can make and use a Generic SSM image", () => {
  // WHEN
  const image = new ec2.GenericSSMParameterImage(
    "testParam",
    ec2.OperatingSystemType.LINUX,
  );

  // THEN
  const details = image.getImage(stack);
  expect(details.imageId).toContain("TOKEN");
  expect(details.osType).toEqual(ec2.OperatingSystemType.LINUX);
});

// see: https://docs.aws.amazon.com/autoscaling/ec2/userguide/using-systems-manager-parameters.html
test("can make and use a SSM resolve image", () => {
  // WHEN
  const image = new ec2.ResolveSsmParameterAtLaunchImage("testParam");

  // THEN
  const details = image.getImage(stack);
  expect(details.imageId).toEqual("resolve:ssm:testParam");
  expect(details.osType).toEqual(ec2.OperatingSystemType.LINUX);
});

test("can make and use a SSM resolve image with parameter version", () => {
  // WHEN
  const image = new ec2.ResolveSsmParameterAtLaunchImage("testParam", {
    parameterVersion: "2",
  });

  // THEN
  const details = image.getImage(stack);
  expect(details.imageId).toEqual("resolve:ssm:testParam:2");
});

test("can make and use a SSM resolve image with resolveSsmParameterAtLaunch", () => {
  // WHEN
  const image = ec2.MachineImage.resolveSsmParameterAtLaunch("testParam", {
    parameterVersion: "2",
  });

  // THEN
  const details = image.getImage(stack);
  expect(details.imageId).toEqual("resolve:ssm:testParam:2");
});

test("WindowsImage retains userdata if given", () => {
  // WHEN
  const ud = ec2.UserData.forWindows();

  const image = new ec2.GenericWindowsImage(
    {
      testregion: "ami-1234",
    },
    {
      userData: ud,
    },
  );

  // THEN
  const details = image.getImage(stack);
  expect(details.userData).toEqual(ud);
});

test("WindowsImage creates UserData if not given", () => {
  // WHEN
  const image = new ec2.GenericWindowsImage({
    testregion: "ami-1234",
  });

  // THEN
  const details = image.getImage(stack);
  expect(isWindowsUserData(details.userData)).toBeTruthy();
});

test("LookupMachineImage default search", () => {
  // GIVEN

  // WHEN
  new ec2.LookupMachineImage({ name: "bla*", owners: ["amazon"] }).getImage(
    stack,
  );

  // THEN
  // filters.image-type.0=machine:filters.name.0=bla*:filters.state.0=available:owners.0=amazon:region=testregion
  Template.dataSources(stack, dataAwsAmi.DataAwsAmi).toMatchObject([
    {
      ami: "ami-1234",
      owners: ["amazon"],
      filter: [
        {
          name: "name",
          values: ["bla*"],
        },
        {
          name: "state",
          values: ["available"],
        },
        {
          name: "image-type",
          values: ["machine"],
        },
      ],
    },
  ]);
});

test("LookupMachineImage creates correct type of UserData", () => {
  // WHEN
  const linuxDetails = new ec2.LookupMachineImage({
    name: "bla*",
    owners: ["amazon"],
  }).getImage(stack);
  const windowsDetails = new ec2.LookupMachineImage({
    name: "bla*",
    owners: ["amazon"],
    windows: true,
  }).getImage(stack);

  // THEN
  expect(isWindowsUserData(windowsDetails.userData)).toBeTruthy();
  expect(isLinuxUserData(linuxDetails.userData)).toBeTruthy();
});

test("cached lookups of Amazon Linux", () => {
  // WHEN
  const ami = ec2.MachineImage.latestAmazonLinux({
    cachedInContext: true,
  }).getImage(stack).imageId;

  // THEN
  expect(ami).toEqual(
    // "${data.aws_ssm_parameter.awsserviceami-amazon-linux-latestamzn-ami-hvm-x86_64-gp2.insecure_value}",
    "dummy-value-for-/aws/service/ami-amazon-linux-latest/amzn-ami-hvm-x86_64-gp2",
  );
  Template.dataSources(
    stack,
    dataAwsSsmParameter.DataAwsSsmParameter,
  ).toMatchObject([
    {
      name: "/aws/service/ami-amazon-linux-latest/amzn-ami-hvm-x86_64-gp2",
    },
  ]);
});

test("cached lookups of Amazon Linux 2", () => {
  // WHEN
  const ami = ec2.MachineImage.latestAmazonLinux({
    cachedInContext: true,
    generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
  }).getImage(stack).imageId;

  // THEN
  expect(ami).toEqual(
    "dummy-value-for-/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2",
  );
  Template.dataSources(
    stack,
    dataAwsSsmParameter.DataAwsSsmParameter,
  ).toMatchObject([
    {
      name: "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2",
    },
  ]);
});

test("cached lookups of Amazon Linux 2 with kernel 5.x", () => {
  // WHEN
  const ami = ec2.MachineImage.latestAmazonLinux({
    cachedInContext: true,
    generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
    kernel: ec2.AmazonLinuxKernel.KERNEL5_X,
  }).getImage(stack).imageId;

  // THEN
  expect(ami).toEqual(
    "dummy-value-for-/aws/service/ami-amazon-linux-latest/amzn2-ami-kernel-5.10-hvm-x86_64-gp2",
  );
  Template.dataSources(
    stack,
    dataAwsSsmParameter.DataAwsSsmParameter,
  ).toMatchObject([
    {
      name: "/aws/service/ami-amazon-linux-latest/amzn2-ami-kernel-5.10-hvm-x86_64-gp2",
    },
  ]);
});

test("throw error if storage param is set for Amazon Linux 2022", () => {
  expect(() => {
    ec2.MachineImage.latestAmazonLinux({
      cachedInContext: true,
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2022,
      storage: ec2.AmazonLinuxStorage.GENERAL_PURPOSE,
    }).getImage(stack).imageId;
  }).toThrow(
    /Storage parameter does not exist in SSM parameter name for Amazon Linux 2022./,
  );
});

test("throw error if virtualization param is set for Amazon Linux 2022", () => {
  expect(() => {
    ec2.MachineImage.latestAmazonLinux({
      cachedInContext: true,
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2022,
      virtualization: ec2.AmazonLinuxVirt.HVM,
    }).getImage(stack).imageId;
  }).toThrow(
    /Virtualization parameter does not exist in SSM parameter name for Amazon Linux 2022./,
  );
});

test("cached lookups of Amazon Linux 2022 with kernel 5.x", () => {
  // WHEN
  const ami = ec2.MachineImage.latestAmazonLinux({
    cachedInContext: true,
    generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2022,
  }).getImage(stack).imageId;

  // THEN
  expect(ami).toEqual(
    "dummy-value-for-/aws/service/ami-amazon-linux-latest/al2022-ami-kernel-5.10-x86_64",
  );
  Template.dataSources(
    stack,
    dataAwsSsmParameter.DataAwsSsmParameter,
  ).toMatchObject([
    {
      name: "/aws/service/ami-amazon-linux-latest/al2022-ami-kernel-5.10-x86_64",
    },
  ]);
});

describe("latest amazon linux", () => {
  test("latestAmazonLinux2", () => {
    // WHEN
    ec2.MachineImage.latestAmazonLinux2().getImage(stack);

    // THEN
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/amzn2-ami-kernel-5.10-hvm-x86_64-gp2",
      },
    ]);
    // Template.fromStack(stack).hasParameter("*", {
    //   Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
    //   Default:
    //     "/aws/service/ami-amazon-linux-latest/amzn2-ami-kernel-5.10-hvm-x86_64-gp2",
    // });
  });

  test("AmazonLinux2ImageSsmParameter", () => {
    // WHEN
    const ami = new ec2.AmazonLinux2ImageSsmParameter({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      edition: ec2.AmazonLinuxEdition.MINIMAL,
      virtualization: ec2.AmazonLinuxVirt.PV,
      storage: ec2.AmazonLinuxStorage.EBS,
      kernel: ec2.AmazonLinux2Kernel.DEFAULT,
    }).getImage(stack).imageId;

    // THEN
    expect(ami).toEqual(
      "dummy-value-for-/aws/service/ami-amazon-linux-latest/amzn2-ami-minimal-pv-arm64-ebs",
    );
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/amzn2-ami-minimal-pv-arm64-ebs",
      },
    ]);
  });

  test("latestAmazonLinux2022", () => {
    // WHEN
    ec2.MachineImage.latestAmazonLinux2022().getImage(stack);

    // THEN
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/al2022-ami-kernel-5.15-x86_64",
      },
    ]);
    // Template.fromStack(stack).hasParameter("*", {
    //   Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
    //   Default:
    //     "/aws/service/ami-amazon-linux-latest/al2022-ami-kernel-5.15-x86_64",
    // });
  });

  test("AmazonLinux2022ImageSsmParameter", () => {
    // WHEN
    const ami = new ec2.AmazonLinux2022ImageSsmParameter({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      edition: ec2.AmazonLinuxEdition.MINIMAL,
      kernel: ec2.AmazonLinux2022Kernel.DEFAULT,
    }).getImage(stack).imageId;

    // THEN
    expect(ami).toEqual(
      "dummy-value-for-/aws/service/ami-amazon-linux-latest/al2022-ami-minimal-kernel-default-arm64",
    );
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/al2022-ami-minimal-kernel-default-arm64",
      },
    ]);
  });

  test("latestAmazonLinux2023", () => {
    // WHEN
    ec2.MachineImage.latestAmazonLinux2023().getImage(stack);

    // THEN
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64",
      },
    ]);
    // Template.fromStack(stack).hasParameter("*", {
    //   Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
    //   Default:
    //     "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64",
    // });
  });

  test("AmazonLinux2023ImageSsmParameter", () => {
    // WHEN
    const ami = new ec2.AmazonLinux2023ImageSsmParameter({
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      edition: ec2.AmazonLinuxEdition.MINIMAL,
      kernel: ec2.AmazonLinux2023Kernel.DEFAULT,
    }).getImage(stack).imageId;

    // THEN
    expect(ami).toEqual(
      "dummy-value-for-/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-arm64",
    );
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-arm64",
      },
    ]);
  });

  test("AmazonLinuxImage with AMAZON_LINUX_2023", () => {
    // WHEN
    new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
    }).getImage(stack);

    // THEN
    Template.dataSources(
      stack,
      dataAwsSsmParameter.DataAwsSsmParameter,
    ).toMatchObject([
      {
        name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64",
      },
    ]);
    // Template.fromStack(stack).hasParameter("*", {
    //   Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
    //   Default:
    //     "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64",
    // });
  });
});

test("throw error if storage param is set for Amazon Linux 2023", () => {
  expect(() => {
    new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      storage: ec2.AmazonLinuxStorage.GENERAL_PURPOSE,
    }).getImage(stack);
  }).toThrow(
    /Storage parameter does not exist in SSM parameter name for Amazon Linux 2023./,
  );
});

test("throw error if virtualization param is set for Amazon Linux 2023", () => {
  expect(() => {
    new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      virtualization: ec2.AmazonLinuxVirt.HVM,
    }).getImage(stack);
  }).toThrow(
    /Virtualization parameter does not exist in SSM parameter name for Amazon Linux 2023./,
  );
});

function isWindowsUserData(ud: ec2.UserData) {
  return ud.render().indexOf("powershell") > -1;
}

function isLinuxUserData(ud: ec2.UserData) {
  return ud.render().indexOf("bash") > -1;
}
