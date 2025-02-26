import * as path from "path";
import { ProjenStruct, Struct } from "@mrgrain/jsii-struct-builder";
import { Component, typescript } from "projen";

/**
 * Aws Provider lb-listener without defaultAction
 */
export class LbListenerConfigStructBuilder extends Component {
  constructor(project: typescript.TypeScriptProject) {
    super(project);
    const struct = new ProjenStruct(project, {
      name: "LbListenerConfig",
      description: "Config for Load Balancer Listener without defaultAction",
      filePath: path.join(
        project.srcdir,
        "aws",
        "compute",
        "lb-shared",
        "lb-listener-config.generated.ts",
      ),
    });

    struct
      .mixin(Struct.fromFqn("@cdktf/provider-aws.lbListener.LbListenerConfig"))
      .omit("defaultAction");
  }
}
