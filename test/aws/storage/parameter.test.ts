// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ssm/test/parameter.test.ts

import {
  ssmParameter,
  dataAwsSsmParameter,
  dataAwsIamPolicyDocument,
} from "@cdktf/provider-aws";
import {
  App,
  Testing,
  // Fn,
  // TerraformOutput,
  TerraformVariable,
} from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import * as cdk from "cdktf";
import { AwsStack } from "../../../src/aws/aws-stack";
import * as kms from "../../../src/aws/encryption";
import * as iam from "../../../src/aws/iam";
import {
  // ParameterType,
  ParameterValueType,
  ParameterTier,
  StringParameter,
  StringListParameter,
  ParameterDataType,
} from "../../../src/aws/storage";
import {
  Template,
  //Annotations
} from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("parameter", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });

  test("creating a String SSM Parameter", () => {
    // WHEN
    new StringParameter(stack, "Parameter", {
      allowedPattern: ".*",
      description: "The value Foo",
      parameterName: "FooParameter",
      stringValue: "Foo",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ssmParameter.SsmParameter,
      {
        allowed_pattern: ".*",
        description: "The value Foo",
        name: "FooParameter",
        type: "String",
        insecure_value: "Foo",
      },
    );
  });

  test("creating a Sensitive String SSM Parameter", () => {
    // WHEN
    new StringParameter(stack, "Parameter", {
      allowedPattern: ".*",
      description: "The value Foo",
      parameterName: "FooParameter",
      sensitiveStringValue: "Foo",
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ssmParameter.SsmParameter,
      {
        allowed_pattern: ".*",
        description: "The value Foo",
        name: "FooParameter",
        type: "String",
        value: "Foo",
      },
    );
  });

  // testDeprecated("type cannot be specified as AWS_EC2_IMAGE_ID", () => {
  //   // GIVEN
  //   const stack = new AwsStack();

  //   // THEN
  //   expect(
  //     () =>
  //       new StringParameter(stack, "myParam", {
  //         stringValue: "myValue",
  //         type: ssm.ParameterType.AWS_EC2_IMAGE_ID,
  //       }),
  //   ).toThrow(
  //     "The type must either be ParameterType.STRING or ParameterType.STRING_LIST. Did you mean to set dataType: ParameterDataType.AWS_EC2_IMAGE instead?",
  //   );
  // });

  test("dataType can be specified", () => {
    // WHEN
    new StringParameter(stack, "myParam", {
      stringValue: "myValue",
      dataType: ParameterDataType.AWS_EC2_IMAGE,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ssmParameter.SsmParameter,
      {
        insecure_value: "myValue",
        data_type: "aws:ec2:image",
      },
    );
  });

  test("expect String SSM Parameter to have tier properly set", () => {
    // WHEN
    new StringParameter(stack, "Parameter", {
      allowedPattern: ".*",
      description: "The value Foo",
      parameterName: "FooParameter",
      stringValue: "Foo",
      tier: ParameterTier.ADVANCED,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ssmParameter.SsmParameter,
      {
        tier: "Advanced",
      },
    );
  });

  test("String SSM Parameter rejects invalid values", () => {
    // THEN
    expect(
      () =>
        new StringParameter(stack, "Parameter", {
          allowedPattern: "^Bar$",
          stringValue: "FooBar",
        }),
    ).toThrow(/does not match the specified allowedPattern/);
  });

  test("String SSM Parameter rejects if both stringValue and sensitiveStringValue is provided", () => {
    // THEN
    expect(
      () =>
        new StringParameter(stack, "Parameter", {
          allowedPattern: "^Bar$",
          stringValue: "FooBar",
          sensitiveStringValue: "BarBz",
        }),
    ).toThrow(/Cannot specify both 'stringValue' and 'sensitiveStringValue/);
  });

  test("String SSM Parameter rejects if neither stringValue or sensitiveStringValue is provided", () => {
    // THEN
    expect(
      () =>
        new StringParameter(stack, "Parameter", {
          allowedPattern: "^Bar$",
        }),
    ).toThrow(
      /Either 'stringValue' or 'sensitiveStringValue' must be specified/,
    );
  });

  test("String SSM Parameter allows unresolved tokens", () => {
    // THEN
    expect(() => {
      new StringParameter(stack, "Parameter", {
        allowedPattern: "^Bar$",
        stringValue: cdk.Lazy.stringValue({ produce: () => "Foo!" }),
      });
    }).not.toThrow();
  });

  test("creating a StringList SSM Parameter", () => {
    // WHEN
    new StringListParameter(stack, "Parameter", {
      allowedPattern: "(Foo|Bar)",
      description: "The values Foo and Bar",
      parameterName: "FooParameter",
      stringListValue: ["Foo", "Bar"],
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      ssmParameter.SsmParameter,
      {
        allowed_pattern: "(Foo|Bar)",
        description: "The values Foo and Bar",
        name: "FooParameter",
        type: "StringList",
        insecure_value: "Foo,Bar",
      },
    );
  });

  test("String SSM Parameter throws on long descriptions", () => {
    // THEN
    expect(() => {
      new StringParameter(stack, "Parameter", {
        stringValue: "Foo",
        description:
          "1024+ character long description: Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
      Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
      nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
      massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
      imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
      Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
      eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
      varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
      Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
      sem neque sed ipsum.",
      });
    }).toThrow(/Description cannot be longer than 1024 characters./);
  });

  test("String SSM Parameter throws on long names", () => {
    // THEN
    expect(() => {
      new StringParameter(stack, "Parameter", {
        stringValue: "Foo",
        parameterName:
          "2048+ character long name: Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
      Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
      nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
      massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
      imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
      Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
      eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
      varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
      Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
      sem neque sed ipsum. Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
      Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
      nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
      massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
      imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
      Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
      eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
      varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
      Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
      sem neque sed ipsum.",
      });
    }).toThrow(/name cannot be longer than 2048 characters./);
  });

  test.each([
    "/parameter/with spaces",
    "charactersOtherThan^allowed",
    "trying;this",
  ])("String SSM Parameter throws on invalid name %s", (parameterName) => {
    // THEN
    expect(() => {
      new StringParameter(stack, "Parameter", {
        stringValue: "Foo",
        parameterName,
      });
    }).toThrow(
      /name must only contain letters, numbers, and the following 4 symbols.*/,
    );
  });

  test("StringList SSM Parameter throws on long descriptions", () => {
    // THEN
    expect(() => {
      new StringListParameter(stack, "Parameter", {
        stringListValue: ["Foo", "Bar"],
        description:
          "1024+ character long description: Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
      Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
      nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
      massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
      imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
      Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
      eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
      varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
      Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
      sem neque sed ipsum.",
      });
    }).toThrow(/Description cannot be longer than 1024 characters./);
  });

  test("StringList SSM Parameter throws on long names", () => {
    // THEN
    expect(() => {
      new StringListParameter(stack, "Parameter", {
        stringListValue: ["Foo", "Bar"],
        parameterName:
          "2048+ character long name: Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
      Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
      nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
      massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
      imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
      Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
      eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
      varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
      Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
      sem neque sed ipsum. Lorem ipsum dolor sit amet, consectetuer adipiscing elit. \
      Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, \
      nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat \
      massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, \
      imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. \
      Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, \
      eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus \
      varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. \
      Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing \
      sem neque sed ipsum.",
      });
    }).toThrow(/name cannot be longer than 2048 characters./);
  });

  test.each([
    "/parameter/with spaces",
    "charactersOtherThan^allowed",
    "trying;this",
  ])("StringList SSM Parameter throws on invalid name %s", (parameterName) => {
    // THEN
    expect(() => {
      new StringListParameter(stack, "Parameter", {
        stringListValue: ["Foo"],
        parameterName,
      });
    }).toThrow(
      /name must only contain letters, numbers, and the following 4 symbols.*/,
    );
  });

  test("StringList SSM Parameter values cannot contain commas", () => {
    // THEN
    expect(
      () =>
        new StringListParameter(stack, "Parameter", {
          stringListValue: ["Foo,Bar"],
        }),
    ).toThrow(/cannot contain the ',' character/);
  });

  test("StringList SSM Parameter rejects invalid values", () => {
    // THEN
    expect(
      () =>
        new StringListParameter(stack, "Parameter", {
          allowedPattern: "^(Foo|Bar)$",
          stringListValue: ["Foo", "FooBar"],
        }),
    ).toThrow(/does not match the specified allowedPattern/);
  });

  test("StringList SSM Parameter allows unresolved tokens", () => {
    // THEN
    expect(
      () =>
        new StringListParameter(stack, "Parameter", {
          allowedPattern: "^(Foo|Bar)$",
          stringListValue: [
            "Foo",
            cdk.Lazy.stringValue({ produce: () => "Baz!" }),
          ],
        }),
    ).not.toThrow();
  });

  test("parameterArn is crafted correctly", () => {
    const param = new StringParameter(stack, "Parameter", {
      stringValue: "Foo",
    });

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${aws_ssm_parameter.Parameter_9E1B4FBA.name}",
    );
  });

  test('parameterName that includes a "/" must be fully qualified (i.e. begin with "/") as well', () => {
    // THEN
    expect(
      () =>
        new StringParameter(stack, "myParam", {
          stringValue: "myValue",
          parameterName: "path/to/parameter",
        }),
    ).toThrow(/Parameter names must be fully qualified/);

    expect(
      () =>
        new StringListParameter(stack, "myParam2", {
          stringListValue: ["foo", "bar"],
          parameterName: "path/to/parameter2",
        }),
    ).toThrow(
      /Parameter names must be fully qualified \(if they include \"\/\" they must also begin with a \"\/\"\)\: path\/to\/parameter2/,
    );
  });

  test("StringParameter.fromStringParameterName", () => {
    // WHEN
    const param = StringParameter.fromStringParameterName(
      stack,
      "MyParamName",
      "MyParamName",
    );

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
    );
    expect(stack.resolve(param.parameterName)).toEqual("MyParamName");
    expect(stack.resolve(param.parameterType)).toEqual("String");
    expect(stack.resolve(param.stringValue)).toEqual(
      "${data.aws_ssm_parameter.MyParamNameParameter.insecure_value}",
    );
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_ssm_parameter: {
          MyParamNameParameter: {
            // Type: "AWS::SSM::Parameter::Value<String>",
            name: "MyParamName",
          },
        },
      },
    });
  });

  test("fromStringParameterArn StringParameter.fromStringParameterArn", () => {
    const sharingParameterArn =
      "arn:aws:ssm:us-east-1:123456789012:parameter/dummyName";

    // WHEN
    const param = StringParameter.fromStringParameterArn(
      stack,
      "MyParamName",
      sharingParameterArn,
    );

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(sharingParameterArn);
    expect(stack.resolve(param.parameterName)).toEqual("dummyName");
    expect(stack.resolve(param.parameterType)).toEqual("String");
    expect(stack.resolve(param.stringValue)).toEqual(
      "${data.aws_ssm_parameter.MyParamNameParameter.insecure_value}",
    );
    Template.fromStack(stack).toMatchObject({
      data: {
        aws_ssm_parameter: {
          MyParamNameParameter: {
            // Type: "AWS::SSM::Parameter::Value<String>",
            name: "dummyName",
          },
        },
      },
    });
  });

  test("fromStringParameterArn throws when StringParameter.fromStringParameterArn is called with a token ARN", () => {
    const tokenizedParam = new TerraformVariable(stack, "TokenParam", {
      type: "string",
    }).stringValue;

    // THEN
    expect(() => {
      StringParameter.fromStringParameterArn(
        stack,
        "MyParamName",
        tokenizedParam,
      );
    }).toThrow(/stringParameterArn cannot be an unresolved token/);
  });

  test("fromStringParameterArn throws error when StringParameterArn has unexpected format", () => {
    const invalidArn = "invalid:arn:format";

    // THEN
    expect(() => {
      StringParameter.fromStringParameterArn(stack, "MyParamName", invalidArn);
    }).toThrow("unexpected StringParameterArn format");
  });

  test("fromStringParameterArn throws error when StringParameterArn is in a different region than the stack", () => {
    // GIVEN
    const differentRegionArn =
      "arn:aws:ssm:us-west-2:123456789012:parameter/dummyName";

    // THEN
    expect(() => {
      StringParameter.fromStringParameterArn(
        stack,
        "MyParamName",
        differentRegionArn,
      );
    }).toThrow("stringParameterArn must be in the same region as the stack");
  });

  test("fromStringParameterArn does not throw error when StringParameterArn is in the same region as the stack", () => {
    // GIVEN
    const sameRegionArn =
      "arn:aws:ssm:us-east-1:123456789012:parameter/dummyName";

    // THEN
    expect(() => {
      StringParameter.fromStringParameterArn(
        stack,
        "MyParamName",
        sameRegionArn,
      );
    }).not.toThrow();
  });

  // // TODO: Region tokens?
  // test("fromStringParameterArn emits an annotation when stack region is unresolved", () => {
  //   // GIVEN
  //   const sameRegionArn =
  //     "arn:aws:ssm:us-east-1:123456789012:parameter/dummyName";

  //   // WHEN
  //   StringParameter.fromStringParameterArn(stack, "MyParamName", sameRegionArn);

  //   // THEN
  //   // Region is never a token in AwsStack
  //   Annotations.fromStack(stack).hasWarnings({
  //     constructPath: "/Stack",
  //     message: /Cross-account references will only work within the same region/,
  //   });
  // });

  test("StringParameter.fromStringParameterAttributes", () => {
    // WHEN
    const param = StringParameter.fromStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
        version: 2,
      },
    );

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
    );
    expect(stack.resolve(param.parameterName)).toEqual("MyParamName");
    expect(stack.resolve(param.parameterType)).toEqual("String");
    expect(stack.resolve(param.stringValue)).toEqual(
      //"{{resolve:ssm:MyParamName:2}}",
      "${data.aws_ssm_parameter.MyParamNameParameter.insecure_value}",
    );
  });

  test("StringParameter.fromStringParameterAttributes with version from token", () => {
    // WHEN
    const param = StringParameter.fromStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
        version: cdk.Token.asNumber("${var.version}"),
      },
    );

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
    );
    expect(stack.resolve(param.parameterName)).toEqual("MyParamName");
    expect(stack.resolve(param.parameterType)).toEqual("String");
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "MyParamName:${var.version}",
      },
    );
    expect(stack.resolve(param.stringValue)).toEqual(
      //"{{resolve:ssm:MyParamName:", {"Ref": "version"}, "}}"
      "${data.aws_ssm_parameter.MyParamNameParameter.insecure_value}",
    );
  });

  test("StringParameter.fromSecureStringParameterAttributes", () => {
    // WHEN
    const param = StringParameter.fromSecureStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
        version: 2,
      },
    );

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
    );
    expect(stack.resolve(param.parameterName)).toEqual("MyParamName");
    expect(stack.resolve(param.parameterType)).toEqual("SecureString");
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "MyParamName:2",
      },
    );
    expect(stack.resolve(param.stringValue)).toEqual(
      // "{{resolve:ssm-secure:MyParamName:2}}",
      "${data.aws_ssm_parameter.MyParamNameParameter.value}",
    );
  });

  test("StringParameter.fromSecureStringParameterAttributes with version from token", () => {
    // WHEN
    const param = StringParameter.fromSecureStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
        version: cdk.Token.asNumber("${var.version}"),
      },
    );

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "MyParamName:${var.version}",
      },
    );
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
    );
    expect(stack.resolve(param.parameterName)).toEqual("MyParamName");
    expect(stack.resolve(param.parameterType)).toEqual("SecureString");
    expect(stack.resolve(param.stringValue)).toEqual(
      // "{{resolve:ssm-secure:MyParamName:", { Ref: "version" }, "}}"
      "${data.aws_ssm_parameter.MyParamNameParameter.value}",
    );
  });

  test("StringParameter.fromSecureStringParameterAttributes with encryption key creates the correct policy for grantRead", () => {
    const key = kms.Key.fromKeyArn(
      stack,
      "CustomKey",
      "arn:aws:kms:us-east-1:123456789012:key/xyz",
    );
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    // WHEN
    const param = StringParameter.fromSecureStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
        version: 2,
        encryptionKey: key,
      },
    );
    param.grantRead(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kms:Decrypt"],
            effect: "Allow",
            resources: ["arn:aws:kms:us-east-1:123456789012:key/xyz"],
          },
          {
            actions: [
              "ssm:DescribeParameters",
              "ssm:GetParameters",
              "ssm:GetParameter",
              "ssm:GetParameterHistory",
            ],
            effect: "Allow",
            resources: [
              "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
            ],
          },
        ],
      },
    );
  });

  test("StringParameter.fromSecureStringParameterAttributes with encryption key creates the correct policy for grantWrite", () => {
    const key = kms.Key.fromKeyArn(
      stack,
      "CustomKey",
      "arn:aws:kms:us-east-1:123456789012:key/xyz",
    );
    const role = new iam.Role(stack, "Role", {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    // WHEN
    const param = StringParameter.fromSecureStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
        version: 2,
        encryptionKey: key,
      },
    );
    param.grantWrite(role);

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
            effect: "Allow",
            resources: ["arn:aws:kms:us-east-1:123456789012:key/xyz"],
          },
          {
            actions: ["ssm:PutParameter"],
            effect: "Allow",
            resources: [
              "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
            ],
          },
        ],
      },
    );
  });

  test("StringParameter.fromSecureStringParameterAttributes without version", () => {
    // WHEN
    const param = StringParameter.fromSecureStringParameterAttributes(
      stack,
      "MyParamName",
      {
        parameterName: "MyParamName",
      },
    );

    // THEN
    Template.synth(stack).toHaveDataSourceWithProperties(
      dataAwsSsmParameter.DataAwsSsmParameter,
      {
        name: "MyParamName",
      },
    );
    expect(stack.resolve(param.stringValue)).toEqual(
      // "{{resolve:ssm-secure:MyParamName}}",
      "${data.aws_ssm_parameter.MyParamNameParameter.value}",
    );
  });

  test("StringListParameter.fromName", () => {
    // WHEN
    const param = StringListParameter.fromStringListParameterName(
      stack,
      "MyParamName",
      "MyParamName",
    );

    // THEN
    expect(stack.resolve(param.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/MyParamName",
    );
    expect(stack.resolve(param.parameterName)).toEqual("MyParamName");
    expect(stack.resolve(param.parameterType)).toEqual("List<String>");
    expect(stack.resolve(param.stringListValue)).toEqual(
      '${split(",", data.aws_ssm_parameter.MyParamNameParameter.insecure_value)}',
      // {
      // "Fn::Split": [",", "{{resolve:ssm:MyParamName}}"],
      // }
    );
  });

  // test("fromLookup will use the SSM context provider to read value during synthesis", () => {
  //   // GIVEN
  //   const app = new cdk.App({
  //     context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
  //   });
  //   const stack = new AwsStack(app, "my-staq", {
  //     env: { region: "us-east-1", account: "12344" },
  //   });

  //   // WHEN
  //   const value = StringParameter.valueFromLookup(stack, "my-param-name");

  //   // THEN
  //   expect(value).toEqual("dummy-value-for-my-param-name");
  //   expect(app.synth().manifest.missing).toEqual([
  //     {
  //       key: "ssm:account=12344:parameterName=my-param-name:region=us-east-1",
  //       props: {
  //         account: "12344",
  //         ignoreErrorOnMissingContext: false,
  //         dummyValue: "dummy-value-for-my-param-name",
  //         region: "us-east-1",
  //         parameterName: "my-param-name",
  //       },
  //       provider: "ssm",
  //     },
  //   ]);
  // });

  // test("fromLookup will return defaultValue when it is provided", () => {
  //   // GIVEN
  //   const app = new cdk.App({
  //     context: { [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false },
  //   });
  //   const stack = new AwsStack(app, "my-staq", {
  //     env: { region: "us-east-1", account: "12344" },
  //   });

  //   // WHEN
  //   const value = StringParameter.valueFromLookup(
  //     stack,
  //     "my-param-name",
  //     "some-default-value",
  //   );

  //   // THEN
  //   expect(value).toEqual("some-default-value");
  //   expect(app.synth().manifest.missing).toEqual([
  //     {
  //       key: "ssm:account=12344:parameterName=my-param-name:region=us-east-1",
  //       props: {
  //         account: "12344",
  //         ignoreErrorOnMissingContext: true,
  //         dummyValue: "some-default-value",
  //         region: "us-east-1",
  //         parameterName: "my-param-name",
  //       },
  //       provider: "ssm",
  //     },
  //   ]);
  // });

  describe("from string list parameter", () => {
    // testDeprecated("valueForTypedStringParameter list type throws error", () => {
    //   // GIVEN
    //   const stack = new AwsStack();

    //   // THEN
    //   expect(() => {
    //     StringParameter.valueForTypedStringParameter(
    //       stack,
    //       "my-param-name",
    //       ParameterType.STRING_LIST,
    //     );
    //   }).toThrow(/use valueForTypedListParameter instead/);
    // });

    // testDeprecated("fromStringParameterAttributes list type throws error", () => {
    //   // GIVEN
    //   const stack = new AwsStack();

    //   // THEN
    //   expect(() => {
    //     StringParameter.fromStringParameterAttributes(
    //       stack,
    //       "my-param-name",
    //       {
    //         parameterName: "my-param-name",
    //         type: ParameterType.STRING_LIST,
    //       },
    //     );
    //   }).toThrow(/fromStringParameterAttributes does not support StringList/);
    // });

    // testDeprecated("fromStringParameterAttributes returns correct value", () => {
    //   // GIVEN
    //   const stack = new AwsStack();

    //   // WHEN
    //   StringParameter.fromStringParameterAttributes(stack, "my-param-name", {
    //     parameterName: "my-param-name",
    //     type: ParameterType.STRING,
    //   });

    //   // THEN
    //   Template.fromStack(stack).templateMatches({
    //     Parameters: {
    //       myparamnameParameter: {
    //         Type: "AWS::SSM::Parameter::Value<String>",
    //         Default: "my-param-name",
    //       },
    //     },
    //   });
    // });

    test("fromStringParameterAttributes returns correct value with valueType", () => {
      // WHEN
      StringParameter.fromStringParameterAttributes(stack, "my-param-name", {
        parameterName: "my-param-name",
        valueType: ParameterValueType.STRING,
      });

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "my-param-nameParameter": {
              // Type: "AWS::SSM::Parameter::Value<String>",
              name: "my-param-name",
            },
          },
        },
      });
    });

    test("valueForTypedListParameter returns correct value", () => {
      // WHEN
      StringListParameter.valueForTypedListParameter(stack, "my-param-name");

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "SsmParameterValuemy-param-nameC96584B6-F00A-464E-AD19-53AFF4B05118Parameter":
              {
                // Type: "AWS::SSM::Parameter::Value<List<String>>",
                name: "my-param-name",
              },
          },
        },
      });
    });

    test("valueForTypedListParameter returns correct value with type", () => {
      // WHEN
      StringListParameter.valueForTypedListParameter(
        stack,
        "my-param-name",
        ParameterValueType.AWS_EC2_INSTANCE_ID,
      );

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "SsmParameterValuemy-param-nameC96584B6-F00A-464E-AD19-53AFF4B05118Parameter":
              {
                // Type: "AWS::SSM::Parameter::Value<List<AWS::EC2::Instance::Id>>",
                name: "my-param-name",
              },
          },
        },
      });
    });

    test("fromStringListParameterAttributes returns correct value", () => {
      // WHEN
      StringListParameter.fromListParameterAttributes(stack, "my-param-name", {
        parameterName: "my-param-name",
      });

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "my-param-nameParameter": {
              // Type: "AWS::SSM::Parameter::Value<List<String>>",
              name: "my-param-name",
            },
          },
        },
      });
    });

    // testDeprecated("string type returns correct value", () => {
    //   // GIVEN
    //   const stack = new AwsStack();

    //   // WHEN
    //   StringParameter.valueForTypedStringParameter(
    //     stack,
    //     "my-param-name",
    //     ParameterType.STRING,
    //   );

    //   // THEN
    //   Template.fromStack(stack).templateMatches({
    //     Parameters: {
    //       SsmParameterValuemyparamnameC96584B6F00A464EAD1953AFF4B05118Parameter: {
    //         Type: "AWS::SSM::Parameter::Value<String>",
    //         Default: "my-param-name",
    //       },
    //     },
    //   });
    // });

    test("string valueType returns correct value", () => {
      // WHEN
      StringParameter.valueForTypedStringParameterV2(
        stack,
        "my-param-name",
        ParameterValueType.AWS_EC2_IMAGE_ID,
      );

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "SsmParameterValuemy-param-nameC96584B6-F00A-464E-AD19-53AFF4B05118Parameter":
              {
                // Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',
                name: "my-param-name",
              },
          },
        },
      });
    });
  });

  describe("valueForStringParameter", () => {
    test("returns a token that represents the SSM parameter value", () => {
      // WHEN
      const value = StringParameter.valueForStringParameter(
        stack,
        "my-param-name",
      );

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "SsmParameterValuemy-param-nameC96584B6-F00A-464E-AD19-53AFF4B05118Parameter":
              {
                // Type: 'AWS::SSM::Parameter::Value<String>',
                name: "my-param-name",
              },
          },
        },
      });
      expect(stack.resolve(value)).toEqual(
        "${data.aws_ssm_parameter.SsmParameterValuemy-param-nameC96584B6-F00A-464E-AD19-53AFF4B05118Parameter.insecure_value}",
      );
    });

    test("de-dup based on parameter name", () => {
      // WHEN
      StringParameter.valueForStringParameter(stack, "my-param-name");
      StringParameter.valueForStringParameter(stack, "my-param-name");
      StringParameter.valueForStringParameter(stack, "my-param-name-2");
      StringParameter.valueForStringParameter(stack, "my-param-name");

      // THEN
      Template.fromStack(stack).toMatchObject({
        data: {
          aws_ssm_parameter: {
            "SsmParameterValuemy-param-nameC96584B6-F00A-464E-AD19-53AFF4B05118Parameter":
              {
                // Type: 'AWS::SSM::Parameter::Value<String>',
                name: "my-param-name",
              },
            "SsmParameterValuemy-param-name-2C96584B6-F00A-464E-AD19-53AFF4B05118Parameter":
              {
                // Type: 'AWS::SSM::Parameter::Value<String>',
                name: "my-param-name-2",
              },
          },
        },
      });
    });

    test("can query actual SSM Parameter Names, multiple times", () => {
      // WHEN
      StringParameter.valueForStringParameter(stack, "/my/param/name");
      StringParameter.valueForStringParameter(stack, "/my/param/name");
    });
  });

  test("rendering of parameter arns", () => {
    // const param = new TerraformVariable(stack, "param", {});
    const expectedA =
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/bam";
    // const expectedB =
    //   "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${var.param}";

    // const expectedC =
    //   "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${var.param}";

    let i = 0;

    // WHEN
    const case1 = StringParameter.fromStringParameterName(
      stack,
      `p${i++}`,
      "bam",
    );
    const case2 = StringParameter.fromStringParameterName(
      stack,
      `p${i++}`,
      "/bam",
    );
    const case4 = StringParameter.fromStringParameterAttributes(
      stack,
      `p${i++}`,
      { parameterName: "bam" },
    );
    const case5 = StringParameter.fromStringParameterAttributes(
      stack,
      `p${i++}`,
      { parameterName: "/bam" },
    );
    i++;
    // TODO: Throws parameterName cannot be an unresolved token
    // const case6 = StringParameter.fromStringParameterAttributes(
    //   stack,
    //   `p${i++}`,
    //   { parameterName: param.stringValue, simpleName: true },
    // );
    const case7 = StringParameter.fromSecureStringParameterAttributes(
      stack,
      `p${i++}`,
      { parameterName: "bam", version: 10 },
    );
    const case8 = StringParameter.fromSecureStringParameterAttributes(
      stack,
      `p${i++}`,
      { parameterName: "/bam", version: 10 },
    );
    i++;
    // TODO: Throws parameterName cannot be an unresolved token
    // const case9 = StringParameter.fromSecureStringParameterAttributes(
    //   stack,
    //   `p${i++}`,
    //   { parameterName: param.stringValue, version: 10, simpleName: false },
    // );

    // auto-generated name is always generated as a "simple name" (not/a/path)
    const case10 = new StringParameter(stack, `p${i++}`, {
      stringValue: "value",
    });

    // explicitly named physical name gives us a hint on how to render the ARN
    const case11 = new StringParameter(stack, `p${i++}`, {
      parameterName: "/foo/bar",
      stringValue: "hello",
    });
    const case12 = new StringParameter(stack, `p${i++}`, {
      parameterName: "simple-name",
      stringValue: "hello",
    });

    const case13 = new StringListParameter(stack, `p${i++}`, {
      stringListValue: ["hello", "world"],
    });
    const case14 = new StringListParameter(stack, `p${i++}`, {
      parameterName: "/not/simple",
      stringListValue: ["hello", "world"],
    });
    const case15 = new StringListParameter(stack, `p${i++}`, {
      parameterName: "simple",
      stringListValue: ["hello", "world"],
    });

    // THEN
    expect(stack.resolve(case1.parameterArn)).toEqual(expectedA);
    expect(stack.resolve(case2.parameterArn)).toEqual(expectedA);
    expect(stack.resolve(case4.parameterArn)).toEqual(expectedA);
    expect(stack.resolve(case5.parameterArn)).toEqual(expectedA);
    // expect(stack.resolve(case6.parameterArn)).toEqual(expectedB);
    expect(stack.resolve(case7.parameterArn)).toEqual(expectedA);
    expect(stack.resolve(case8.parameterArn)).toEqual(expectedA);
    // expect(stack.resolve(case9.parameterArn)).toEqual(expectedC);

    // new ssm.Parameters determine if "/" is needed based on the posture of `parameterName`.
    expect(stack.resolve(case10.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${aws_ssm_parameter.p8_1BB0F6FE.name}",
    );
    expect(stack.resolve(case11.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${aws_ssm_parameter.p9_7A508212.name}",
    );
    expect(stack.resolve(case12.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${aws_ssm_parameter.p10_7D6B8AB0.name}",
    );
    expect(stack.resolve(case13.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${aws_ssm_parameter.p11_8A9CB02C.name}",
    );
    expect(stack.resolve(case14.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${aws_ssm_parameter.p12_9BE4CE91.name}",
    );
    expect(stack.resolve(case15.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${aws_ssm_parameter.p13_26A2AEC4.name}",
    );
  });

  test("if parameterName is a token separator must be specified", () => {
    const param = new TerraformVariable(stack, "param", {});
    let i = 0;

    // WHEN
    const p1 = new StringParameter(stack, `p${i++}`, {
      parameterName: param.stringValue,
      stringValue: "foo",
      simpleName: true,
    });
    const p2 = new StringParameter(stack, `p${i++}`, {
      parameterName: param.stringValue,
      stringValue: "foo",
      simpleName: false,
    });
    const p3 = new StringListParameter(stack, `p${i++}`, {
      parameterName: param.stringValue,
      stringListValue: ["foo"],
      simpleName: false,
    });

    // THEN
    expect(stack.resolve(p1.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter/${aws_ssm_parameter.p0_B02A8F65.name}",
    );
    expect(stack.resolve(p2.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${aws_ssm_parameter.p1_E43AD5AC.name}",
    );
    expect(stack.resolve(p3.parameterArn)).toEqual(
      "arn:${data.aws_partition.Partitition.partition}:ssm:us-east-1:${data.aws_caller_identity.CallerIdentity.account_id}:parameter${aws_ssm_parameter.p2_C1903AEB.name}",
    );
  });

  test("fails if name is a token and no explicit separator", () => {
    const param = new TerraformVariable(stack, "param", {});
    let i = 0;

    // THEN
    const expected =
      /Unable to determine ARN separator for SSM parameter since the parameter name is an unresolved token. Use "fromAttributes" and specify "simpleName" explicitly/;
    expect(() =>
      StringParameter.fromStringParameterName(
        stack,
        `p${i++}`,
        param.stringValue,
      ),
    ).toThrow(expected);
    expect(() =>
      StringParameter.fromSecureStringParameterAttributes(stack, `p${i++}`, {
        parameterName: param.stringValue,
        version: 1,
      }),
    ).toThrow(expected);
    expect(
      () =>
        new StringParameter(stack, `p${i++}`, {
          parameterName: param.stringValue,
          stringValue: "foo",
        }),
    ).toThrow(expected);
    expect(
      () =>
        new StringParameter(stack, `p${i++}`, {
          parameterName: param.stringValue,
          stringValue: "foo",
        }),
    ).toThrow(expected);
  });

  test("fails if simpleName is wrong based on a concrete physical name", () => {
    let i = 0;

    // THEN
    expect(() =>
      StringParameter.fromStringParameterAttributes(stack, `p${i++}`, {
        parameterName: "simple",
        simpleName: false,
      }),
    ).toThrow(
      /Parameter name "simple" is a simple name, but "simpleName" was explicitly set to false. Either omit it or set it to true/,
    );
    expect(() =>
      StringParameter.fromStringParameterAttributes(stack, `p${i++}`, {
        parameterName: "/foo/bar",
        simpleName: true,
      }),
    ).toThrow(
      /Parameter name "\/foo\/bar" is not a simple name, but "simpleName" was explicitly set to true. Either omit it or set it to false/,
    );
  });

  test('fails if parameterName is undefined and simpleName is "false"', () => {
    // THEN
    expect(
      () =>
        new StringParameter(stack, "p", {
          simpleName: false,
          stringValue: "foo",
        }),
    ).toThrow(
      // /If "parameterName" is not explicitly defined, "simpleName" must be "true" or undefined since auto-generated parameter names always have simple names/,
      /Parameter name \"123e4567-e89b-12d3MyStackp702649D0\" is a simple name, but \"simpleName\" was explicitly set to false. Either omit it or set it to true/,
    );
  });

  // test("When a parameter name contains a CFn intrinsic, use dynamic reference instead", () => {
  //   // WHEN
  //   const param = StringParameter.fromStringParameterAttributes(
  //     stack,
  //     "import-string-param1",
  //     {
  //       simpleName: true,
  //       parameterName: Fn.importValue("some-exported-value"),
  //     },
  //   );
  //   new TerraformOutput(stack, "OutputParamValue", {
  //     value: param.stringValue,
  //   });

  //   // THEN
  //   Template.expectOutput(stack, "OutputParamValue").toMatchObject({
  //     value: "{{resolve:ssm:{{resolve:Fn::ImportValue:some-exported-value}}}}",
  //   });
  // });

  // // TODO: throws parameterName cannot be an unresolved token
  // test("When a parameter representation overridden, use dynamic reference", () => {
  //   const paramA = new StringParameter(stack, "StringParameter", {
  //     stringValue: "Initial parameter value",
  //   });

  //   // WHEN
  //   const paramB = StringParameter.fromStringParameterAttributes(
  //     stack,
  //     "import-string-param",
  //     {
  //       simpleName: true,
  //       parameterName: paramA.parameterName,
  //       // forceDynamicReference: true, // TODO: uncomment when forceDynamicReference is implemented
  //     },
  //   );
  //   new TerraformOutput(stack, "OutputParamValue", {
  //     value: paramB.stringValue,
  //   });

  //   // THEN
  //   Template.expectOutput(stack, "OutputParamValue").toMatchObject({
  //     value: `\${${stack.resolve(paramB.stringValue)}}`,
  //   });
  // });
});
