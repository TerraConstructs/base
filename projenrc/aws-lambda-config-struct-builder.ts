import * as path from "path";
import { CollectionKind, PrimitiveType } from "@jsii/spec";
import { ProjenStruct, Struct } from "@mrgrain/jsii-struct-builder";
import { Component, typescript } from "projen";

/**
 * LambdaFunctionVpcConfig without functionName
 */
export class LambdaFunctionVpcConfigStructBuilder extends Component {
  constructor(project: typescript.TypeScriptProject) {
    super(project);
    const struct = new ProjenStruct(project, {
      name: "VpcConfig",
      description: [
        "Config for network connectivity to AWS resources in a VPC, specify a list",
        " * of security groups and subnets in the VPC.",
        " * When you connect a function to a VPC, it can only access resources and the internet through that VPC.",
        " *",
        " * See [VPC Settings](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).",
      ].join("\n"),
      filePath: path.join(
        project.srcdir,
        "aws",
        "compute",
        "function-vpc-config.generated.ts",
      ),
    });

    struct
      .mixin(
        Struct.fromFqn(
          "@cdktn/provider-aws.lambdaFunction.LambdaFunctionVpcConfig",
        ),
      )
      .add(
        {
          name: "vpcId",
          type: {
            primitive: PrimitiveType.String,
          },
          optional: true,
          docs: {
            summary:
              "The VPC ID, required if `securityGroupIds` are not provided",
          },
        },
        {
          name: "egress",
          optional: true,
          type: {
            collection: {
              kind: CollectionKind.Array,
              elementtype: {
                fqn: "@cdktn/provider-aws.securityGroup.SecurityGroupEgress",
              },
            },
          },
          docs: {
            summary:
              "Egress rules, used for created securityGroup if `securityGroupIds` are not provided",
            default: "egress world",
          },
        },
      )
      .update("securityGroupIds", {
        optional: true,
        docs: {
          default: "created",
        },
      });
  }
}
