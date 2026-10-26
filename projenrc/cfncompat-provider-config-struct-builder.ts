import * as path from "path";
import { ProjenStruct, Struct } from "@mrgrain/jsii-struct-builder";
import { Component, typescript } from "projen";

/**
 * Cfncompat Provider Config without alias
 */
export class CfncompatProviderStructBuilder extends Component {
  constructor(project: typescript.TypeScriptProject) {
    super(project);
    const struct = new ProjenStruct(project, {
      name: "CfncompatProviderConfig",
      description: "Config for the Cfncompat Provider",
      filePath: path.join(
        project.srcdir,
        "aws",
        "cfncompat-provider-config.generated.ts",
      ),
    });

    struct
      .mixin(
        Struct.fromFqn(
          "@cdktn/provider-cfncompat.provider.CfncompatProviderConfig",
        ),
      )
      .omit("alias");
  }
}
