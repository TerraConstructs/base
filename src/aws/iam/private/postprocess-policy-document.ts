import {
  IPostProcessor,
  IResolveContext,
  //Token
} from "cdktn";
import { PolicyStatement } from "../policy-statement";
/**
 * A Token postprocesser for policy documents
 *
 * Removes duplicate statements, and assign Sids if necessary
 *
 * Because policy documents can contain all kinds of crazy things,
 * we do all the necessary work here after the document has been mostly resolved
 * into a predictable Terraform form.
 */
export class PostProcessPolicyDocument implements IPostProcessor {
  constructor(
    private readonly autoAssignSids: boolean,
    // private readonly sort: boolean,
  ) {}

  // this is called with an array of statements
  public postProcess(input: any, _context: IResolveContext): any {
    if (!input || !Array.isArray(input)) {
      return input;
    }

    // Also remove full-on duplicates (this will not be necessary if
    // we minimized, but it might still dedupe statements we didn't
    // minimize like if they contained tokens, and definitely is still necessary
    // if we didn't minimize)
    const jsonStatements = new Set<string>();
    const uniqueStatements: PolicyStatement[] = [];

    for (const statement of input) {
      const jsonStatement = JSON.stringify(statement);
      if (!jsonStatements.has(jsonStatement)) {
        uniqueStatements.push(statement);
        jsonStatements.add(jsonStatement);
      }
    }

    // assign unique SIDs (the statement index) if `autoAssignSids` is enabled
    const statements = uniqueStatements.map((s, i) => {
      if (this.autoAssignSids && !s.sid) {
        s.sid = i.toString();
      }

      // TODO: re-add sorting support
      // ref: https://github.com/aws/aws-cdk/tree/v2.161.1/packages/aws-cdk-lib/aws-iam/lib/private/postprocess-policy-document.ts
      // if (this.sort) {
      //   // Don't act on the values if they are 'undefined'
      //   s = s.copy({
      //     sid: s.sid,
      //     actions: s.actions ? sortByJson(s.actions) : undefined,
      //     resources: s.resources ? sortByJson(s.resources) : undefined,
      //     condition: s.conditions,
      //     effect: s.effect,
      //     notActions: s.notActions,
      //     notResources: s.notResources,
      //     principals: s.principals ? sortPrincipals(s.principals) : undefined,
      //     notPrincipals: s.notPrincipals,
      //   }
      // }

      return s;
    });

    return statements;
  }
}

// function noUndef(x: any): any {
//   const ret: any = {};
//   for (const [key, value] of Object.entries(x)) {
//     if (value !== undefined) {
//       ret[key] = value;
//     }
//   }
//   return ret;
// }

// function sortPrincipals<A>(
//   xs?: string | string[] | Record<string, A | A[]>,
// ): typeof xs {
//   if (!xs || Array.isArray(xs) || typeof xs !== "object") {
//     return xs;
//   }

//   const ret: NonNullable<typeof xs> = {};
//   for (const k of Object.keys(xs).sort()) {
//     ret[k] = sortByJson(xs[k]);
//   }

//   return ret;
// }

// /**
//  * Sort the values in the list by the JSON representation, removing duplicates.
//  *
//  * Mutates in place AND returns the mutated list.
//  */
// function sortByJson<B, A extends B | B[] | undefined>(xs: A): A {
//   if (!Array.isArray(xs)) {
//     return xs;
//   }

//   const intermediate = new Map<string, A>();
//   for (const x of xs) {
//     intermediate.set(JSON.stringify(x), x);
//   }

//   const sorted = Array.from(intermediate.keys())
//     .sort()
//     .map((k) => intermediate.get(k)!);
//   xs.splice(0, xs.length, ...sorted);
//   return xs.length !== 1 ? xs : xs[0];
// }
