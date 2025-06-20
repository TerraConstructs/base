// https://github.com/aws/aws-cdk/blob/7452462550a100f5bd2dcab6f495c9f68bf0db4a/packages/aws-cdk-lib/aws-sns/lib/subscription-filter.ts

// TODO: Adopt UnscopedValidationError
// - https://github.com/aws/aws-cdk/pull/33382/
// - https://github.com/aws/aws-cdk/pull/33045
// import { UnscopedValidationError } from "../../core/lib/errors";

/**
 * Conditions that can be applied to string attributes.
 */
export interface StringConditions {
  /**
   * Match one or more values.
   *
   * @deprecated use `allowlist`
   * @default - None
   */
  readonly whitelist?: string[];

  /**
   * Match any value that doesn't include any of the specified values.
   * @deprecated use `denylist`
   * @default - None
   */
  readonly blacklist?: string[];

  /**
   * Match one or more values.
   * @default - None
   */
  readonly allowlist?: string[];

  /**
   * Match any value that doesn't include any of the specified values.
   * @default - None
   */
  readonly denylist?: string[];

  /**
   * Matches values that begins with the specified prefixes.
   *
   * @default - None
   */
  readonly matchPrefixes?: string[];

  /**
   * Matches values that end with the specified suffixes.
   *
   * @default - None
   */
  readonly matchSuffixes?: string[];
}

/**
 * Between condition for a numeric attribute.
 */
export interface BetweenCondition {
  /**
   * The start value.
   */
  readonly start: number;

  /**
   * The stop value.
   */
  readonly stop: number;
}

/**
 * Conditions that can be applied to numeric attributes.
 */
export interface NumericConditions {
  /**
   * Match one or more values.
   * @deprecated use `allowlist`
   * @default - None
   */
  readonly whitelist?: number[];

  /**
   * Match one or more values.
   *
   * @default - None
   */
  readonly allowlist?: number[];

  /**
   * Match values that are greater than the specified value.
   *
   * @default - None
   */
  readonly greaterThan?: number;

  /**
   * Match values that are greater than or equal to the specified value.
   *
   * @default - None
   */
  readonly greaterThanOrEqualTo?: number;

  /**
   * Match values that are less than the specified value.
   *
   * @default - None
   */
  readonly lessThan?: number;

  /**
   * Match values that are less than or equal to the specified value.
   *
   * @default - None
   */
  readonly lessThanOrEqualTo?: number;

  /**
   * Match values that are between the specified values.
   *
   * @default - None
   */
  readonly between?: BetweenCondition;

  /**
   * Match values that are strictly between the specified values.
   *
   * @default - None
   */
  readonly betweenStrict?: BetweenCondition;
}

/**
 * A subscription filter for an attribute.
 */
export class SubscriptionFilter {
  /**
   * Returns a subscription filter for a string attribute.
   */
  public static stringFilter(stringConditions: StringConditions) {
    const conditions = new Array<any>();

    if (stringConditions.whitelist && stringConditions.allowlist) {
      // TODO: Adopt UnscopedValidationError
      throw new Error(
        "`whitelist` is deprecated; please use `allowlist` instead",
      );
    }
    if (stringConditions.blacklist && stringConditions.denylist) {
      // TODO: Adopt UnscopedValidationError
      throw new Error(
        "`blacklist` is deprecated; please use `denylist` instead",
      );
    }
    const allowlist = stringConditions.allowlist ?? stringConditions.whitelist;
    const denylist = stringConditions.denylist ?? stringConditions.blacklist;

    if (allowlist) {
      conditions.push(...allowlist);
    }

    if (denylist) {
      conditions.push({ "anything-but": denylist });
    }

    if (stringConditions.matchPrefixes) {
      conditions.push(
        ...stringConditions.matchPrefixes.map((p) => ({ prefix: p })),
      );
    }

    if (stringConditions.matchSuffixes) {
      conditions.push(
        ...stringConditions.matchSuffixes.map((s) => ({ suffix: s })),
      );
    }

    return new SubscriptionFilter(conditions);
  }

  /**
   * Returns a subscription filter for a numeric attribute.
   */
  public static numericFilter(numericConditions: NumericConditions) {
    const conditions = new Array<any>();

    if (numericConditions.whitelist && numericConditions.allowlist) {
      // TODO: Adopt UnscopedValidationError
      throw new Error(
        "`whitelist` is deprecated; please use `allowlist` instead",
      );
    }
    const allowlist =
      numericConditions.allowlist ?? numericConditions.whitelist;

    if (allowlist) {
      conditions.push(...allowlist.map((v) => ({ numeric: ["=", v] })));
    }

    if (numericConditions.greaterThan !== undefined) {
      conditions.push({ numeric: [">", numericConditions.greaterThan] });
    }

    if (numericConditions.greaterThanOrEqualTo !== undefined) {
      conditions.push({
        numeric: [">=", numericConditions.greaterThanOrEqualTo],
      });
    }

    if (numericConditions.lessThan !== undefined) {
      conditions.push({ numeric: ["<", numericConditions.lessThan] });
    }

    if (numericConditions.lessThanOrEqualTo !== undefined) {
      conditions.push({ numeric: ["<=", numericConditions.lessThanOrEqualTo] });
    }

    if (numericConditions.between) {
      conditions.push({
        numeric: [
          ">=",
          numericConditions.between.start,
          "<=",
          numericConditions.between.stop,
        ],
      });
    }

    if (numericConditions.betweenStrict) {
      conditions.push({
        numeric: [
          ">",
          numericConditions.betweenStrict.start,
          "<",
          numericConditions.betweenStrict.stop,
        ],
      });
    }

    return new SubscriptionFilter(conditions);
  }

  /**
   * Returns a subscription filter for attribute key matching.
   */
  public static existsFilter() {
    return new SubscriptionFilter([{ exists: true }]);
  }

  /**
   *
   * @param conditions conditions that specify the message attributes that should be included, excluded, matched, etc.
   */
  constructor(public readonly conditions: any[] = []) {}
}
