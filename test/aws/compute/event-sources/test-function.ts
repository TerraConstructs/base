import * as constructs from "constructs";
import { compute } from "../../../../src/aws";

export class TestFunction extends compute.LambdaFunction {
  constructor(scope: constructs.Construct, id: string) {
    super(scope, id, {
      handler: "index.handler",
      code: compute.Code.fromInline(`exports.handler = ${handler.toString()}`),
      runtime: compute.Runtime.NODEJS_LATEST,
    });
  }
}

/* eslint-disable no-console */
async function handler(event: any) {
  console.log("event:", JSON.stringify(event, undefined, 2));
  return { event };
}
