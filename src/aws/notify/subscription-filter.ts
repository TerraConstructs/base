/**
 * A subscription filter for an attribute.
 */
export class SubscriptionFilter {
  /**
   * Creates a new string filter.
   */
  public static stringFilter(options: StringFilterOptions): SubscriptionFilter {
    const conditions: any[] = [];

    if (options.allowlist) {
      conditions.push(...options.allowlist);
    }

    if (options.denylist) {
      options.denylist.forEach((value) => {
        conditions.push({ "anything-but": value });
      });
    }

    if (options.matchPrefixes) {
      options.matchPrefixes.forEach((value) => {
        conditions.push({ prefix: value });
      });
    }

    if (options.matchSuffixes) {
      options.matchSuffixes.forEach((value) => {
        conditions.push({ suffix: value });
      });
    }

    if (options.exists !== undefined) {
      conditions.push({ exists: options.exists });
    }

    return new SubscriptionFilter(conditions);
  }

  /**
   * Creates a new numeric filter.
   */
  public static numericFilter(
    options: NumericFilterOptions,
  ): SubscriptionFilter {
    const conditions: any[] = [];

    if (options.allowlist) {
      conditions.push(...options.allowlist);
    }

    if (options.denylist) {
      options.denylist.forEach((value) => {
        conditions.push({ "anything-but": value });
      });
    }

    if (options.greaterThan !== undefined) {
      conditions.push({ numeric: [">", options.greaterThan] });
    }

    if (options.greaterThanOrEqualTo !== undefined) {
      conditions.push({ numeric: [">=", options.greaterThanOrEqualTo] });
    }

    if (options.lessThan !== undefined) {
      conditions.push({ numeric: ["<", options.lessThan] });
    }

    if (options.lessThanOrEqualTo !== undefined) {
      conditions.push({ numeric: ["<=", options.lessThanOrEqualTo] });
    }

    if (options.between !== undefined) {
      conditions.push({ numeric: [">=", options.between.start] });
      conditions.push({ numeric: ["<=", options.between.stop] });
    }

    if (options.exists !== undefined) {
      conditions.push({ exists: options.exists });
    }

    return new SubscriptionFilter(conditions);
  }

  /**
   * Creates a new filter for key matching.
   */
  public static existsFilter(exists: boolean = true): SubscriptionFilter {
    return new SubscriptionFilter([{ exists }]);
  }

  /**
   * @param conditions The conditions for this filter.
   */
  private constructor(public readonly conditions: any[]) {}
}

/**
 * Options for a string filter.
 */
export interface StringFilterOptions {
  /**
   * A list of strings that will be allowed.
   *
   * @default - No allow list.
   */
  readonly allowlist?: string[];

  /**
   * A list of strings that will be denied.
   *
   * @default - No deny list.
   */
  readonly denylist?: string[];

  /**
   * A list of prefixes to match.
   *
   * @default - No prefix matching.
   */
  readonly matchPrefixes?: string[];

  /**
   * A list of suffixes to match.
   *
   * @default - No suffix matching.
   */
  readonly matchSuffixes?: string[];

  /**
   * Whether the attribute being checked must exist or not.
   *
   * @default - No existence check.
   */
  readonly exists?: boolean;
}

/**
 * Options for a numeric filter.
 */
export interface NumericFilterOptions {
  /**
   * A list of numbers that will be allowed.
   *
   * @default - No allow list.
   */
  readonly allowlist?: number[];

  /**
   * A list of numbers that will be denied.
   *
   * @default - No deny list.
   */
  readonly denylist?: number[];

  /**
   * Only allow values greater than this number.
   *
   * @default - No minimum value.
   */
  readonly greaterThan?: number;

  /**
   * Only allow values greater than or equal to this number.
   *
   * @default - No minimum value.
   */
  readonly greaterThanOrEqualTo?: number;

  /**
   * Only allow values less than this number.
   *
   * @default - No maximum value.
   */
  readonly lessThan?: number;

  /**
   * Only allow values less than or equal to this number.
   *
   * @default - No maximum value.
   */
  readonly lessThanOrEqualTo?: number;

  /**
   * Only allow values between the start and stop values.
   *
   * @default - No range check.
   */
  readonly between?: BetweenRange;

  /**
   * Whether the attribute being checked must exist or not.
   *
   * @default - No existence check.
   */
  readonly exists?: boolean;
}

/**
 * A range of numbers.
 */
export interface BetweenRange {
  /**
   * The start of the range.
   */
  readonly start: number;

  /**
   * The end of the range.
   */
  readonly stop: number;
}
