import * as fs from "fs";
import * as path from "path";
import { cloudfrontFunction } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { edge, AwsStack } from "../../../src/aws";
import { Template } from "../../assertions";

describe("FunctionCode", () => {
  test("FileCode escapes ${ to $${ when rendering", () => {
    // GIVEN
    const filePath = path.join(__dirname, "fixtures", "function-code.js");
    const original = fs.readFileSync(filePath, { encoding: "utf-8" });
    // sanity check the fixture actually contains an unescaped `${`
    expect(original).toContain("${request.uri}");
    // WHEN
    const rendered = edge.FunctionCode.fromFile({ filePath }).render();
    // THEN
    expect(rendered).toBe(original.replace(/\$\{/g, "$$${"));
    expect(rendered).toContain("$${request.uri}");
  });

  test("InlineCode passes content through unchanged", () => {
    // GIVEN
    const code = "Hello, ${request.uri}! And a newline.\n";
    // WHEN
    const rendered = edge.FunctionCode.fromInline(code).render();
    // THEN
    expect(rendered).toBe(code);
  });
});

describe("Function", () => {
  test("Should set create_before_destroy lifecycle on the resource", () => {
    // GIVEN
    const stack = new AwsStack();
    // WHEN
    new edge.Function(stack, "Function", {
      nameSuffix: "hello-world",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudfrontFunction.CloudfrontFunction,
      {
        lifecycle: {
          create_before_destroy: true,
        },
      },
    );
  });

  test("Should keep FileCode `${` escaped as `$${` in the synthesized code", () => {
    // GIVEN
    const stack = new AwsStack();
    // WHEN
    new edge.Function(stack, "Function", {
      nameSuffix: "hello-world",
      code: edge.FunctionCode.fromFile({
        filePath: path.join(__dirname, "fixtures", "function-code.js"),
      }),
    });
    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      cloudfrontFunction.CloudfrontFunction,
      {
        code: expect.stringContaining("$${request.uri}"),
      },
    );
  });

  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = new AwsStack();
    // WHEN
    new edge.Function(stack, "Function", {
      nameSuffix: "hello-world",
      comment: "Hello World",
      code: edge.FunctionCode.fromInline("whatever"),
    });
    // THEN
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});
