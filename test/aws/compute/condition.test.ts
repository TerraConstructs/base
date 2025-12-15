import { compute } from "../../../src/aws";

describe("Condition Variables", () => {
  (test("Condition variables must start with $. or $[", () => {
    expect(() => compute.Condition.stringEquals("a", "b")).toThrow();
  }),
    test("Condition variables can start with $.", () => {
      expect(() => compute.Condition.stringEquals("$.a", "b")).not.toThrow();
    }),
    test("Condition variables can start with $[", () => {
      expect(() => compute.Condition.stringEquals("$[0]", "a")).not.toThrow();
    }),
    test("Condition variables can reference the state input $", () => {
      expect(() => compute.Condition.stringEquals("$", "a")).not.toThrow();
    }),
    test("NotConditon must render properly", () => {
      assertRendersTo(
        compute.Condition.not(compute.Condition.stringEquals("$.a", "b")),
        { Not: { Variable: "$.a", StringEquals: "b" } },
      );
    }),
    test("CompoundCondition must render properly", () => {
      assertRendersTo(
        compute.Condition.and(
          compute.Condition.booleanEquals("$.a", true),
          compute.Condition.numberGreaterThan("$.b", 3),
        ),
        {
          And: [
            { Variable: "$.a", BooleanEquals: true },
            { Variable: "$.b", NumericGreaterThan: 3 },
          ],
        },
      );
    }),
    test("Exercise a number of other conditions", () => {
      const cases: Array<[compute.Condition, object]> = [
        [
          compute.Condition.stringLessThan("$.a", "foo"),
          { Variable: "$.a", StringLessThan: "foo" },
        ],
        [
          compute.Condition.stringLessThanEquals("$.a", "foo"),
          { Variable: "$.a", StringLessThanEquals: "foo" },
        ],
        [
          compute.Condition.stringGreaterThan("$.a", "foo"),
          { Variable: "$.a", StringGreaterThan: "foo" },
        ],
        [
          compute.Condition.stringGreaterThanEquals("$.a", "foo"),
          { Variable: "$.a", StringGreaterThanEquals: "foo" },
        ],
        [
          compute.Condition.numberEquals("$.a", 5),
          { Variable: "$.a", NumericEquals: 5 },
        ],
      ];

      for (const [cond, expected] of cases) {
        assertRendersTo(cond, expected);
      }
    }),
    test("Exercise string conditions", () => {
      const cases: Array<[compute.Condition, object]> = [
        [
          compute.Condition.stringEquals("$.a", "foo"),
          { Variable: "$.a", StringEquals: "foo" },
        ],
        [
          compute.Condition.stringEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", StringEqualsPath: "$.b" },
        ],
        [
          compute.Condition.stringLessThan("$.a", "foo"),
          { Variable: "$.a", StringLessThan: "foo" },
        ],
        [
          compute.Condition.stringLessThanJsonPath("$.a", "$.b"),
          { Variable: "$.a", StringLessThanPath: "$.b" },
        ],
        [
          compute.Condition.stringLessThanEquals("$.a", "foo"),
          { Variable: "$.a", StringLessThanEquals: "foo" },
        ],
        [
          compute.Condition.stringLessThanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", StringLessThanEqualsPath: "$.b" },
        ],
        [
          compute.Condition.stringGreaterThan("$.a", "foo"),
          { Variable: "$.a", StringGreaterThan: "foo" },
        ],
        [
          compute.Condition.stringGreaterThanJsonPath("$.a", "$.b"),
          { Variable: "$.a", StringGreaterThanPath: "$.b" },
        ],
        [
          compute.Condition.stringGreaterThanEquals("$.a", "foo"),
          { Variable: "$.a", StringGreaterThanEquals: "foo" },
        ],
        [
          compute.Condition.stringGreaterThanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", StringGreaterThanEqualsPath: "$.b" },
        ],
      ];

      for (const [cond, expected] of cases) {
        assertRendersTo(cond, expected);
      }
    }),
    test("Exercise number conditions", () => {
      const cases: Array<[compute.Condition, object]> = [
        [
          compute.Condition.numberEquals("$.a", 5),
          { Variable: "$.a", NumericEquals: 5 },
        ],
        [
          compute.Condition.numberEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", NumericEqualsPath: "$.b" },
        ],
        [
          compute.Condition.numberLessThan("$.a", 5),
          { Variable: "$.a", NumericLessThan: 5 },
        ],
        [
          compute.Condition.numberLessThanJsonPath("$.a", "$.b"),
          { Variable: "$.a", NumericLessThanPath: "$.b" },
        ],
        [
          compute.Condition.numberGreaterThan("$.a", 5),
          { Variable: "$.a", NumericGreaterThan: 5 },
        ],
        [
          compute.Condition.numberGreaterThanJsonPath("$.a", "$.b"),
          { Variable: "$.a", NumericGreaterThanPath: "$.b" },
        ],
        [
          compute.Condition.numberLessThanEquals("$.a", 5),
          { Variable: "$.a", NumericLessThanEquals: 5 },
        ],
        [
          compute.Condition.numberLessThanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", NumericLessThanEqualsPath: "$.b" },
        ],
        [
          compute.Condition.numberGreaterThanEquals("$.a", 5),
          { Variable: "$.a", NumericGreaterThanEquals: 5 },
        ],
        [
          compute.Condition.numberGreaterThanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", NumericGreaterThanEqualsPath: "$.b" },
        ],
      ];

      for (const [cond, expected] of cases) {
        assertRendersTo(cond, expected);
      }
    }),
    test("Exercise type conditions", () => {
      const cases: Array<[compute.Condition, object]> = [
        [
          compute.Condition.isString("$.a"),
          { Variable: "$.a", IsString: true },
        ],
        [
          compute.Condition.isNotString("$.a"),
          { Variable: "$.a", IsString: false },
        ],
        [
          compute.Condition.isNumeric("$.a"),
          { Variable: "$.a", IsNumeric: true },
        ],
        [
          compute.Condition.isNotNumeric("$.a"),
          { Variable: "$.a", IsNumeric: false },
        ],
        [
          compute.Condition.isBoolean("$.a"),
          { Variable: "$.a", IsBoolean: true },
        ],
        [
          compute.Condition.isNotBoolean("$.a"),
          { Variable: "$.a", IsBoolean: false },
        ],
        [
          compute.Condition.isTimestamp("$.a"),
          { Variable: "$.a", IsTimestamp: true },
        ],
        [
          compute.Condition.isNotTimestamp("$.a"),
          { Variable: "$.a", IsTimestamp: false },
        ],
      ];

      for (const [cond, expected] of cases) {
        assertRendersTo(cond, expected);
      }
    }),
    test("Exercise timestamp conditions", () => {
      const cases: Array<[compute.Condition, object]> = [
        [
          compute.Condition.timestampEquals("$.a", "timestamp"),
          { Variable: "$.a", TimestampEquals: "timestamp" },
        ],
        [
          compute.Condition.timestampEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", TimestampEqualsPath: "$.b" },
        ],
        [
          compute.Condition.timestampLessThan("$.a", "timestamp"),
          { Variable: "$.a", TimestampLessThan: "timestamp" },
        ],
        [
          compute.Condition.timestampLessThanJsonPath("$.a", "$.b"),
          { Variable: "$.a", TimestampLessThanPath: "$.b" },
        ],
        [
          compute.Condition.timestampGreaterThan("$.a", "timestamp"),
          { Variable: "$.a", TimestampGreaterThan: "timestamp" },
        ],
        [
          compute.Condition.timestampGreaterThanJsonPath("$.a", "$.b"),
          { Variable: "$.a", TimestampGreaterThanPath: "$.b" },
        ],
        [
          compute.Condition.timestampLessThanEquals("$.a", "timestamp"),
          { Variable: "$.a", TimestampLessThanEquals: "timestamp" },
        ],
        [
          compute.Condition.timestampLessThanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", TimestampLessThanEqualsPath: "$.b" },
        ],
        [
          compute.Condition.timestampGreaterThanEquals("$.a", "timestamp"),
          { Variable: "$.a", TimestampGreaterThanEquals: "timestamp" },
        ],
        [
          compute.Condition.timestampGreaterThanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", TimestampGreaterThanEqualsPath: "$.b" },
        ],
      ];

      for (const [cond, expected] of cases) {
        assertRendersTo(cond, expected);
      }
    }),
    test("Exercise other conditions", () => {
      const cases: Array<[compute.Condition, object]> = [
        [
          compute.Condition.booleanEqualsJsonPath("$.a", "$.b"),
          { Variable: "$.a", BooleanEqualsPath: "$.b" },
        ],
        [
          compute.Condition.booleanEquals("$.a", true),
          { Variable: "$.a", BooleanEquals: true },
        ],
        [
          compute.Condition.isPresent("$.a"),
          { Variable: "$.a", IsPresent: true },
        ],
        [
          compute.Condition.isNotPresent("$.a"),
          { Variable: "$.a", IsPresent: false },
        ],
        [
          compute.Condition.stringMatches("$.a", "foo"),
          { Variable: "$.a", StringMatches: "foo" },
        ],
      ];

      for (const [cond, expected] of cases) {
        assertRendersTo(cond, expected);
      }
    }));
});

function assertRendersTo(cond: compute.Condition, expected: any) {
  expect(cond.renderCondition()).toStrictEqual(expected);
}
