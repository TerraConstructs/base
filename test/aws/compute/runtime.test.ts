import * as lambda from "../../../src/aws/compute";

describe("runtime", () => {
  test("runtimes are equal for different instances", () => {
    // GIVEN
    const runtime1 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );
    const runtime2 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );

    // WHEN
    expect(runtime1.runtimeEquals(runtime2)).toBe(true);
  });

  test("runtimes are equal for same instance", () => {
    const runtime = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );

    expect(runtime.runtimeEquals(runtime)).toBe(true);
  });

  test("unequal when name changes", () => {
    const runtime1 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );
    const runtime2 = new lambda.Runtime(
      "python3.6",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );

    expect(runtime1.runtimeEquals(runtime2)).toBe(false);
  });

  test("unequal when family changes", () => {
    const runtime1 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );
    const runtime2 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.JAVA,
      { supportsInlineCode: true },
    );

    expect(runtime1.runtimeEquals(runtime2)).toBe(false);
  });

  test("unequal when supportsInlineCode changes", () => {
    const runtime1 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: true },
    );
    const runtime2 = new lambda.Runtime(
      "python3.7",
      lambda.RuntimeFamily.PYTHON,
      { supportsInlineCode: false },
    );

    expect(runtime1.runtimeEquals(runtime2)).toBe(false);
  });

  test("bundlingDockerImage points to AWS SAM build image", () => {
    // GIVEN
    const runtime = new lambda.Runtime("my-runtime-name");

    // THEN
    expect(runtime.bundlingImage.image).toEqual(
      "public.ecr.aws/sam/build-my-runtime-name",
    );
  });

  test("override to bundlingDockerImage points to the correct image", () => {
    // GIVEN
    const runtime = new lambda.Runtime("my-runtime-name", undefined, {
      bundlingDockerImage: "my-docker-image",
    });

    // THEN
    expect(runtime.bundlingImage.image).toEqual("my-docker-image");
  });
});
