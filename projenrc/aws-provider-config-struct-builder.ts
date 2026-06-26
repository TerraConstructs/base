import * as path from "path";
import { ProjenStruct, Struct } from "@mrgrain/jsii-struct-builder";
import { Component, typescript } from "projen";

/**
 * Aws Provider Config without alias
 */
export class AwsProviderStructBuilder extends Component {
  constructor(project: typescript.TypeScriptProject) {
    super(project);
    const struct = new ProjenStruct(project, {
      name: "AwsProviderConfig",
      description: "Config for the AWS Provider",
      filePath: path.join(
        project.srcdir,
        "aws",
        "provider-config.generated.ts",
      ),
    });

    struct
      .mixin(Struct.fromFqn("@cdktn/provider-aws.provider.AwsProviderConfig"))
      .omit("alias");
  }
}
