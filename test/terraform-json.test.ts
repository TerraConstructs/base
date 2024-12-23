import {
  App,
  Fn,
  IPostProcessor,
  IResolvable,
  IResolveContext,
  Lazy,
  Token,
  ref,
} from "cdktf";
import {
  terraformFunction,
  asAny,
  stringValue,
  anyValue,
} from "cdktf/lib/functions/helpers";
import { Intrinsic } from "cdktf/lib/tokens/private/intrinsic";
import "cdktf/lib/testing/adapters/jest";
import { StackBase } from "../src";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};

let app: App;
let stack: MyStack;

beforeEach(() => {
  app = new App();
  stack = new MyStack(app, "TestStack", {
    environmentName,
    gridUUID,
    gridBackendConfig,
  });
});

test("JSONification of literals looks like JSON.stringify", () => {
  const structure = {
    undefinedProp: undefined,
    nestedObject: {
      prop1: undefined,
      prop2: "abc",
      prop3: 42,
      prop4: [1, 2, 3],
    },
  };

  expect(stack.resolve(stack.toJsonString(structure))).toEqual(
    JSON.stringify(structure),
  );
  expect(stack.resolve(stack.toJsonString(structure, 2))).toEqual(
    JSON.stringify(structure, undefined, 2),
  );
});

test("JSONification of undefined leads to undefined", () => {
  expect(stack.resolve(stack.toJsonString(undefined))).toEqual(undefined);
});

describe("tokens that return literals", () => {
  test("string tokens can be JSONified and JSONification can be reversed", () => {
    for (const token of tokensThatResolveTo("woof woof")) {
      // GIVEN
      const fido = { name: "Fido", speaks: token };

      // WHEN
      const resolved = stack.resolve(stack.toJsonString(fido));
      // expect(resolved).toMatchSnapshot();

      // THEN
      expect(resolved).toEqual('{"name":"Fido","speaks":"woof woof"}');
    }
  });

  test("string tokens can be embedded while being JSONified", () => {
    for (const token of tokensThatResolveTo("woof woof")) {
      // GIVEN
      const fido = { name: "Fido", speaks: `deep ${token}` };

      // WHEN
      const resolved = stack.resolve(stack.toJsonString(fido));

      // THEN
      expect(resolved).toEqual('{"name":"Fido","speaks":"deep woof woof"}');
    }
  });

  test("constant string has correct amount of quotes applied", () => {
    const inputString = 'Hello, "world"';

    // WHEN
    const resolved = stack.resolve(stack.toJsonString(inputString));

    // THEN
    expect(resolved).toEqual(JSON.stringify(inputString));
  });

  test("integer Tokens behave correctly in stringification and JSONification", () => {
    // GIVEN
    const num = new Intrinsic(1);
    const embedded = `the number is ${num}`;

    // WHEN
    expect(stack.resolve(embedded)).toEqual("the number is 1");
    expect(stack.resolve(stack.toJsonString({ embedded }))).toEqual(
      '{"embedded":"the number is 1"}',
    );
    expect(stack.resolve(stack.toJsonString({ num }))).toEqual('{"num":1}');
  });

  test("String-encoded lazies do not have quotes applied if they return objects", () => {
    // ref: https://github.com/aws/aws-cdk/blob/v2.162.1/packages/aws-cdk-lib/core/test/cloudformation-json.test.ts#L81
    // This is unfortunately crazy behavior, but we have some clients already taking a
    // dependency on the fact that `Lazy.stringValue({ produce: () => [...some list...] })`
    // does not apply quotes but just renders the list.

    // GIVEN
    const someList = Lazy.stringValue({ produce: () => [1, 2, 3] as any });

    // WHEN
    expect(stack.resolve(stack.toJsonString({ someList }))).toEqual(
      '{"someList":[1,2,3]}',
    );
  });

  test("Literal-resolving List Tokens do not have quotes applied", () => {
    // GIVEN
    const someList = Token.asList([1, 2, 3]);

    // WHEN
    expect(stack.resolve(stack.toJsonString({ someList }))).toEqual(
      '{"someList":[1,2,3]}',
    );
  });

  test("tokens in strings survive additional TokenJSON.stringification()", () => {
    // GIVEN
    for (const token of tokensThatResolveTo("pong!")) {
      // WHEN
      const stringified = stack.toJsonString(`ping? ${token}`);

      // THEN
      expect(stack.resolve(stringified)).toEqual('"ping? pong!"');
    }
  });

  test("Doubly nested strings evaluate correctly in JSON context", () => {
    // WHEN
    const fidoSays = Lazy.stringValue({ produce: () => "woof" });

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        information: `Did you know that Fido says: ${fidoSays}`,
      }),
    );

    // THEN
    expect(resolved).toEqual(
      '{"information":"Did you know that Fido says: woof"}',
    );
  });

  test("Quoted strings in embedded JSON context are escaped", () => {
    // GIVEN
    const fidoSays = Lazy.stringValue({ produce: () => '"woof"' });

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        information: `Did you know that Fido says: ${fidoSays}`,
      }),
    );

    // THEN
    expect(resolved).toEqual(
      '{"information":"Did you know that Fido says: \\"woof\\""}',
    );
  });
});

describe("tokens returning TF intrinsics", () => {
  test("intrinsic Tokens embed correctly in JSONification", () => {
    // GIVEN
    const bucketName = ref("MyBucket");

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({ theBucket: bucketName }),
    );

    // THEN
    // TODO: Doesn't work because we don't have a "Ref" Intrinsic
    // const context = { MyBucket: 'TheName' };
    // expect(evaluateTF(resolved, context)).toEqual('{"theBucket":"TheName"}');
    expect(resolved).toEqual('{"theBucket":"${MyBucket}"}');
  });

  test("embedded string literals in intrinsics are escaped when calling TokenJSON.stringify()", () => {
    // GIVEN
    const token = Fn.join("", [
      "Hello ",
      Token.asString(ref("Planet")), // a ref in a join function is unquoted
      ", this\nIs",
      'Very "cool"',
    ]);

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        literal: 'I can also "contain" quotes',
        token,
      }),
    );
    // expect(resolved).toMatchSnapshot();

    // THEN
    const expected =
      '{"literal":"I can also \\"contain\\" quotes","token":"${join(\\"\\", [\\"Hello \\", Planet, \\", this\\\\nIs\\", \\"Very \\"cool\\"\\"])}"}';
    expect(resolved).toEqual(expected);
  });

  // test("embedded string literals are escaped in Fn.sub (implicit references)", () => {
  //   // GIVEN
  //   const token = Fn.sub('I am in account "${AWS::AccountId}"');

  //   // WHEN
  //   const resolved = stack.resolve(stack.toJsonString({ token }));

  //   // THEN
  //   const context = { "AWS::AccountId": "1234" };
  //   const expected = '{"token":"I am in account \\"1234\\""}';
  //   expect(evaluateTF(resolved, context)).toEqual(expected);
  // });

  test("embedded string literals are escaped in Fn.templatestring (explicit references)", () => {
    // GIVEN
    const token = templatestring(
      Fn.rawString('I am in account "${Acct}", also wanted to say: ${Also}'),
      {
        Acct: "1234",
        Also: "hello world",
      },
    );

    // WHEN
    const resolved = stack.resolve(stack.toJsonString({ token }));

    // THEN
    // const context = { "AWS::AccountId": "1234" };
    const expected =
      '{"token":"${templatestring(\\"I am in account \\\\\\"$${Acct}\\\\\\", also wanted to say: $${Also}\\", {\\"Acct\\" = \\"1234\\", \\"Also\\" = \\"hello world\\"})}"}';
    expect(resolved).toEqual(expected);
  });

  test("Tokens in Tokens are handled correctly", () => {
    // GIVEN
    const bucketName = ref("MyBucket.name");
    const combinedName = Fn.join("", [
      "The bucket name is ",
      bucketName.toString(),
    ]);

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({ theBucket: combinedName }),
    );
    // expect(resolved).toMatchSnapshot();

    // THEN
    // const context = { MyBucket: "TheName" };
    expect(resolved).toEqual(
      '{"theBucket":"${join(\\"\\", [\\"The bucket name is \\", MyBucket.name])}"}',
    );
  });

  test("Intrinsics in postprocessors are handled correctly", () => {
    // GIVEN
    const bucketName = ref("MyBucket");
    const combinedName = new DummyPostProcessor(["this", "is", bucketName]);

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({ theBucket: combinedName }),
    );
    // expect(resolved).toMatchSnapshot();

    // THEN
    expect(resolved).toEqual('{"theBucket":["this","is","${MyBucket}"]}');
  });

  test("Doubly nested strings evaluate correctly in JSON context", () => {
    // WHEN
    const fidoSays = Lazy.stringValue({ produce: () => "woof" });

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        information: `Did you know that Fido says: ${fidoSays}`,
      }),
    );
    // expect(resolved).toMatchSnapshot();

    // THEN;
    expect(resolved).toEqual(
      '{"information":"Did you know that Fido says: woof"}',
    );
  });

  test("Doubly nested intrinsics evaluate correctly in JSON context", () => {
    // GIVEN
    const fidoSays = Lazy.anyValue({ produce: () => ref("Something") });

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        information: `Did you know that Fido says: ${fidoSays}`,
      }),
    );
    // expect(resolved).toMatchSnapshot();

    // THEN
    // const context = { Something: "woof woof" };
    expect(resolved).toEqual(
      '{"information":"Did you know that Fido says: ${Something}"}',
    );
  });

  test("Nested strings are quoted correctly", () => {
    const fidoSays = Lazy.stringValue({ produce: () => '"woof"' });

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        information: `Did you know that Fido says: ${fidoSays}`,
      }),
    );

    // expect(resolved).toMatchSnapshot();
    // THEN
    expect(resolved).toEqual(
      '{"information":"Did you know that Fido says: \\"woof\\""}',
    );
  });

  test("Intrinsics can occur in key position", () => {
    // GIVEN
    const bucketName = Token.asString(ref("MyBucket"));

    // WHEN
    const resolved = stack.resolve(
      stack.toJsonString({
        [bucketName]: "Is Cool",
        [`${bucketName} Is`]: "Cool",
      }),
    );
    // expect(resolved).toMatchSnapshot();

    // THEN
    expect(resolved).toEqual(
      '{"${MyBucket}":"Is Cool","${MyBucket} Is":"Cool"}',
    );
  });

  test("toJsonString() can be used recursively", () => {
    // GIVEN
    const bucketName = Token.asString(ref("MyBucket"));

    // WHEN
    const embeddedJson = stack.toJsonString({
      message: `the bucket name is ${bucketName}`,
    });
    const outerJson = stack.toJsonString({ embeddedJson });

    // THEN
    // const evaluatedJson = evaluateTF(stack.resolve(outerJson), {
    //   MyBucket: "Bucky",
    // });
    // expect(evaluatedJson).toEqual(
    //   '{"embeddedJson":"{\\"message\\":\\"the bucket name is Bucky\\"}"}',
    // );
    expect(
      JSON.parse(JSON.parse(stack.resolve(outerJson)).embeddedJson).message,
    ).toEqual("the bucket name is ${MyBucket}");
  });

  test("Every Token used inside a JSONified string is given an opportunity to be uncached", () => {
    // Check that tokens aren't accidentally fully resolved by the first invocation/resolution
    // of toJsonString(). On every evaluation, Tokens referenced inside the structure should be
    // given a chance to be either cached or uncached.
    //
    // (NOTE: This does not check whether the implementation of toJsonString() itself is cached or
    // not; that depends on aws/aws-cdk#11224 and should be done in a different PR).

    // WHEN
    let counter = 0;
    const counterString = Token.asString({ resolve: () => `${++counter}` });
    const jsonString = stack.toJsonString({ counterString });

    // THEN
    expect(stack.resolve(jsonString)).toEqual('{"counterString":"1"}');
    expect(stack.resolve(jsonString)).toEqual('{"counterString":"2"}');
  });
});

// test("JSON strings nested inside JSON strings have correct quoting", () => {
//   // GIVEN
//   const payload = stack.toJsonString({
//     message: Fn.sub('I am in account "${AWS::AccountId}"'),
//   });

//   // WHEN
//   const resolved = stack.resolve(stack.toJsonString({ payload }));

//   // THEN
//   const context = { "AWS::AccountId": "1234" };
//   const expected =
//     '{"payload":"{\\"message\\":\\"I am in account \\\\\\"1234\\\\\\"\\"}"}';
//   const evaluated = evaluateTF(resolved, context);
//   expect(evaluated).toEqual(expected);

//   // Is this even correct? Let's ask JavaScript because I have trouble reading this many backslashes.
//   expect(JSON.parse(JSON.parse(evaluated).payload).message).toEqual(
//     'I am in account "1234"',
//   );
// });

/**
 * Return two Tokens, one of which evaluates to a Token directly, one which evaluates to it lazily
 */
function tokensThatResolveTo(value: any): Token[] {
  return [new Intrinsic(value), Lazy.anyValue({ produce: () => value })];
}

class DummyPostProcessor implements IResolvable, IPostProcessor {
  public readonly creationStack: string[];

  constructor(private readonly value: any) {
    this.creationStack = ["test"];
  }

  public resolve(context: IResolveContext) {
    context.registerPostProcessor(this);
    return context.resolve(this.value);
  }

  public postProcess(o: any, _context: IResolveContext): any {
    return o;
  }
}

class MyStack extends StackBase {}

// HACK: missing function introduced in Terraform but not in CDKTF
/**
 * {@link https://developer.hashicorp.com/terraform/language/functions/templatestring templatestring} processes the provided string as a template using a supplied set of template variables.
 * @param {string} reference
 * @param {any} vars
 */
function templatestring(reference: string, vars: any) {
  return asAny(
    terraformFunction("templatestring", [stringValue, anyValue])(
      reference,
      vars,
    ),
  );
}
