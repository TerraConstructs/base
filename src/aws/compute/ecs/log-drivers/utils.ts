// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-ecs/lib/log-drivers/utils.ts

import { Token } from "cdktn";
import { BaseLogDriverProps } from "./base-log-driver";
import { Duration } from "../../../../duration";
import { UnscopedValidationError } from "../../../../errors";
import { TaskDefinition } from "../base/task-definition";
import { Secret, SecretConfig } from "../container-definition";

/**
 * Remove undefined values from a dictionary
 */
export function removeEmpty<T>(x: { [key: string]: T | undefined | string }): {
  [key: string]: string;
} {
  for (const key of Object.keys(x)) {
    if (x[key] === undefined) {
      delete x[key];
    }
  }
  return x as any;
}

/**
 * Checks that a value is a positive integer
 */
export function ensurePositiveInteger(val: number) {
  if (!Token.isUnresolved(val) && Number.isInteger(val) && val < 0) {
    throw new UnscopedValidationError(`\`${val}\` must be a positive integer.`);
  }
}

/**
 * Checks that a value is contained in a range of two other values
 */
export function ensureInRange(val: number, start: number, end: number) {
  if (!Token.isUnresolved(val) && !(val >= start && val <= end)) {
    throw new UnscopedValidationError(
      `\`${val}\` must be within range ${start}:${end}`,
    );
  }
}

/**
 * // TERRACONSTRUCTS DEVIATION: upstream's options union also includes `SecretValue`
 * (aws-cdk-lib/core), unwrapped here via `SecretValue.unsafeUnwrap()` so a driver option can be
 * sourced from a Secrets Manager / SSM secret. `SecretValue` has not been ported to
 * terraconstructs yet (same gap noted in `compute/vpn.ts` and
 * `compute/alb/application-listener-action.ts`) -- callers needing a secret-backed driver option
 * must pass a plain string for now.
 */
export function stringifyOptions(options: {
  [key: string]: Duration | string | string[] | number | boolean | undefined;
}) {
  const _options: { [key: string]: string } = {};
  const filteredOptions = removeEmpty(options);

  for (const [key, value] of Object.entries(filteredOptions)) {
    // Convert value to string
    _options[key] = `${value}`;
  }

  return _options;
}

export function renderCommonLogDriverOptions(opts: BaseLogDriverProps) {
  return {
    tag: opts.tag,
    labels: joinWithCommas(opts.labels),
    env: joinWithCommas(opts.env),
    "env-regex": opts.envRegex,
  };
}

export function joinWithCommas(xs?: string[]): string | undefined {
  return xs && xs.join(",");
}

export function renderLogDriverSecretOptions(
  secretValue: { [key: string]: Secret },
  taskDefinition: TaskDefinition,
): SecretConfig[] {
  const secrets = [];
  for (const [name, secret] of Object.entries(secretValue)) {
    secret.grantRead(taskDefinition.obtainExecutionRole());
    secrets.push({
      name,
      valueFrom: secret.arn,
    });
  }
  return secrets;
}
