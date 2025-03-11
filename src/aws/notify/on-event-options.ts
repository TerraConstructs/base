// https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/aws-events/lib/on-event-options.ts

import { IRuleTarget, EventPattern } from ".";

/**
 * Common options for Events.
 */
export interface EventCommonOptions {
  /**
   * A description of the rule's purpose.
   *
   * @default - No description
   */
  readonly description?: string;

  /**
   * A name for the rule.
   *
   * Length Constraints: Minimum length of 1. Maximum length of 64.
   * Pattern: [\.\-_A-Za-z0-9]+
   *
   * @see https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutRule.html#eventbridge-PutRule-request-Name
   *
   * @default - If omitted, Refer to `ruleNamePrefix`.
   */
  readonly ruleName?: string;

  /**
   * Creates a unique name beginning with the specified prefix.
   * Conflicts with `ruleName`.
   *
   * @default - If omitted, ET will assign a random, unique name prefixed by GridUUID.
   */
  readonly ruleNamePrefix?: string;

  /**
   * Additional restrictions for the event to route to the specified target
   *
   * The method that generates the rule probably imposes some type of event
   * filtering. The filtering implied by what you pass here is added
   * on top of that filtering.
   *
   * @default - No additional filtering based on an event pattern.
   *
   * @see
   * https://docs.aws.amazon.com/eventbridge/latest/userguide/eventbridge-and-event-patterns.html
   */
  readonly eventPattern?: EventPattern;

  // /**
  //  * The scope to use if the source of the rule and its target are in different Stacks
  //  * (but in the same account & region).
  //  * This helps dealing with cycles that often arise in these situations.
  //  *
  //  * @default - none (the main scope will be used, even for cross-stack Events)
  //  */
  // readonly crossStackScope?: Construct;
}

/**
 * Standard set of options for `onXxx` event handlers on construct
 */
export interface OnEventOptions extends EventCommonOptions {
  /**
   * The target to register for the event
   *
   * @default - No target is added to the rule. Use `addTarget()` to add a target.
   */
  readonly target?: IRuleTarget;
}
