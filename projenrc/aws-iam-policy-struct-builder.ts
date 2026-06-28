import * as path from "path";
import {
  CollectionKind,
  //PrimitiveType,
} from "@jsii/spec";
import { ProjenStruct, Struct } from "@mrgrain/jsii-struct-builder";
import { Component, typescript } from "projen";

const namespace = "iam";

/**
 * IAM Policy document Statement with Enum for Effect
 */
export class PolicyDocumentStatementStructBuilder extends Component {
  constructor(project: typescript.TypeScriptProject) {
    super(project);
    const struct = new ProjenStruct(project, {
      name: "PolicyStatementProps",
      description: "Interface for creating a policy statement",
      filePath: path.join(
        project.srcdir,
        "aws",
        "iam",
        "policy-statement-props.generated.ts",
      ),
      importLocations: {
        [namespace]: "./",
      },
    });

    struct
      .mixin(
        Struct.fromFqn(
          "@cdktn/provider-aws.dataAwsIamPolicyDocument.DataAwsIamPolicyDocumentStatement",
        ),
      )
      .update("effect", {
        type: {
          // refer to enum instead of type unions with literals (JSII restriction)
          // ref: https://aws.github.io/jsii/specification/2-type-system/#type-unions
          fqn: `${namespace}.Effect`,
        },
        optional: true,
        docs: {
          summary: "Whether to allow or deny the actions in this statement.",
          default: "Effect.ALLOW",
        },
      })
      .update("principals", {
        type: {
          collection: {
            kind: CollectionKind.Array,
            elementtype: {
              fqn: `${namespace}.IPrincipal`,
            },
          },
        },
        optional: true,
        docs: {
          summary: "principals block.",
          see: "https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/data-sources/iam_policy_document#principals-and-not_principals",
        },
      })
      .update("notPrincipals", {
        type: {
          collection: {
            kind: CollectionKind.Array,
            elementtype: {
              fqn: `${namespace}.IPrincipal`,
            },
          },
        },
        optional: true,
        docs: {
          summary: "not_principals block.",
          see: "https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/data-sources/iam_policy_document#principals-and-not_principals",
        },
      })
      .update("condition", {
        type: {
          collection: {
            kind: CollectionKind.Array,
            elementtype: {
              fqn: `${namespace}.Condition`,
            },
          },
        },
        optional: true,
        docs: {
          summary: "condition block.",
          see: "https://registry.terraform.io/providers/hashicorp/aws/5.68.0/docs/data-sources/iam_policy_document#condition",
        },
      });
  }
}

/**
 * IAM Policy document
 */
export class PolicyDocumentConfigStructBuilder extends Component {
  constructor(project: typescript.TypeScriptProject) {
    super(project);
    const struct = new ProjenStruct(project, {
      name: "PolicyDocumentConfig",
      description: "IAM policy Document Config",
      filePath: path.join(
        project.srcdir,
        "aws",
        "iam",
        "policy-document-config.generated.ts",
      ),
      importLocations: {
        [namespace]: "./",
      },
    });

    struct
      .mixin(
        Struct.fromFqn(
          "@cdktn/provider-aws.dataAwsIamPolicyDocument.DataAwsIamPolicyDocumentConfig",
        ),
      )
      .update("statement", {
        type: {
          // union: {
          //   types: [
          //     { fqn: "cdktn.IResolvable" },
          //     {
          //     },
          //   ],
          // },
          collection: {
            kind: CollectionKind.Array,
            elementtype: {
              fqn: `${namespace}.PolicyStatement`,
            },
          },
        },
        optional: true,
        docs: {
          summary: "Configuration block for a policy statement",
        },
      });
    // .add({
    //   name: "assignSids",
    //   optional: true,
    //   docs: {
    //     summary: "Automatically assign Statement Ids to all statements.",
    //   },
    //   type: {
    //     primitive: PrimitiveType.Boolean,
    //   },
    // })
    // .add({
    //   name: "minimize",
    //   optional: true,
    //   docs: {
    //     summary: "Try to minimize the policy by merging statements.",
    //     remarks: [
    //       "To avoid overrunning the maximum policy size, combine statements if they produce",
    //       "the same result. Merging happens according to the following rules:",
    //       "",
    //       "- The Effect of both statements is the same",
    //       "- Neither of the statements have a 'Sid'",
    //       "- Combine Principals if the rest of the statement is exactly the same.",
    //       "- Combine Resources if the rest of the statement is exactly the same.",
    //       "- Combine Actions if the rest of the statement is exactly the same.",
    //       "- We will never combine NotPrincipals, NotResources or NotActions, because doing",
    //       "  so would change the meaning of the policy document.",
    //     ].join("\n"),
    //     default: "false",
    //   },
    //   type: {
    //     primitive: PrimitiveType.Boolean,
    //   },
    // });
  }
}
