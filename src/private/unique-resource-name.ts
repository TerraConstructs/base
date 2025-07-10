import * as crypto from "crypto";
// import { Token } from "cdktf";
import { cannotCalcIdForEmptySetOfComponents } from "cdktf/lib/errors";
import {
  UniqueResourceNameOptions,
  UniqueResourceNamePrefixOptions,
} from "../stack-base";

// https://github.com/aws/aws-cdk/blob/v2.156.0/packages/aws-cdk-lib/core/lib/private/unique-resource-name.ts

/**
 * Resources with this ID are hidden from humans
 *
 * They do not appear in the human-readable part of the logical ID,
 * but they are included in the hash calculation.
 */
const HIDDEN_FROM_HUMAN_ID = "Resource";

/**
 * Resources with this ID are complete hidden from the logical ID calculation.
 */
const HIDDEN_ID = "Default";

const PATH_SEP = "/";

const MAX_LEN = 256;

const HASH_LEN = 8;

/**
 * Use path hash to generate a unique id from the set of components.
 */
export function makeUniqueResourceName(
  components: string[],
  options: UniqueResourceNameOptions,
) {
  const maxLength = options.maxLength ?? 256;
  const separator = options.separator ?? "";
  const prefix = options.prefix ?? "";
  const lowerCase = options.lowerCase ?? false;
  components = components.filter((x) => x !== HIDDEN_ID);

  if (components.length === 0) {
    throw cannotCalcIdForEmptySetOfComponents();
  }

  // top-level resources will simply use the `name` as-is if the name is also short enough.
  if (components.length === 1) {
    let topLevelResource =
      prefix +
      removeNonAllowedSpecialCharacters(
        components[0],
        options.allowedSpecialCharacters,
      );

    if (lowerCase) {
      topLevelResource = topLevelResource.toLowerCase();
    }

    if (topLevelResource.length <= maxLength) {
      return topLevelResource;
    }
  }

  // Calculate the hash from the full path, included unresolved tokens so the hash value is always unique
  let hash = pathHash(components);
  let human =
    prefix +
    removeDupes(components)
      .filter((pathElement) => pathElement !== HIDDEN_FROM_HUMAN_ID)
      .map((pathElement) =>
        removeNonAllowedSpecialCharacters(
          pathElement,
          options.allowedSpecialCharacters,
        ),
      )
      .filter((pathElement) => pathElement)
      .join(separator)
      .concat(separator);

  if (lowerCase) {
    human = human.toLowerCase();
    hash = hash.toLowerCase();
  }

  const maxhumanLength = maxLength - HASH_LEN;
  return human.length > maxhumanLength
    ? `${splitInMiddle(human, maxhumanLength)}${hash}`
    : `${human}${hash}`;
}

/**
 * Does not use Path Hash and relies on provider generated suffix instead
 */
export function makeUniqueResourceNamePrefix(
  components: string[],
  options: UniqueResourceNamePrefixOptions,
) {
  const suffixLength = options.suffixLength ?? 26; // terraform provider aws generates a 26 character suffix
  const maxLength = (options.maxLength ?? 256) - suffixLength;
  const separator = options.separator ?? "";
  const prefix = options.prefix ?? "";
  const lowerCase = options.lowerCase ?? false;
  components = components.filter((x) => x !== HIDDEN_ID);

  if (components.length === 0) {
    throw cannotCalcIdForEmptySetOfComponents();
  }

  // top-level resources will simply use the `name` as-is if the name is also short enough.
  if (components.length === 1) {
    let topLevelResource =
      prefix +
      removeNonAllowedSpecialCharacters(
        components[0],
        options.allowedSpecialCharacters,
      );

    if (lowerCase) {
      topLevelResource = topLevelResource.toLowerCase();
    }

    if (topLevelResource.length <= maxLength) {
      return topLevelResource;
    }
  }

  let human =
    prefix +
    removeDupes(components)
      .filter((pathElement) => pathElement !== HIDDEN_FROM_HUMAN_ID)
      .map((pathElement) =>
        removeNonAllowedSpecialCharacters(
          pathElement,
          options.allowedSpecialCharacters,
        ),
      )
      .filter((pathElement) => pathElement)
      .join(separator)
      .concat(separator);

  if (lowerCase) {
    human = human.toLowerCase();
  }

  // TODO: does it make sense to split in the middle for these?
  // Or try to presserve the passed in prefix at all times?
  return human.length > maxLength
    ? `${splitInMiddle(human, maxLength)}`
    : `${human}`;
}

/**
 * Take a hash of the given path.
 *
 * The hash is limited in size.
 */
function pathHash(path: string[]): string {
  const md5 = crypto
    .createHash("md5")
    .update(path.join(PATH_SEP))
    .digest("hex");
  return md5.slice(0, HASH_LEN).toUpperCase();
}

/**
 * Removes all non-allowed special characters in a string.
 */
function removeNonAllowedSpecialCharacters(
  s: string,
  allowedSpecialCharacters?: string,
) {
  const pattern = allowedSpecialCharacters
    ? `[^A-Za-z0-9${allowedSpecialCharacters}]`
    : "[^A-Za-z0-9]";
  const regex = new RegExp(pattern, "g");
  return s.replace(regex, "");
}

/**
 * Remove duplicate "terms" from the path list
 *
 * If the previous path component name ends with this component name, skip the
 * current component.
 */
function removeDupes(path: string[]): string[] {
  const ret = new Array<string>();

  for (const component of path) {
    if (ret.length === 0 || !ret[ret.length - 1].endsWith(component)) {
      ret.push(component);
    }
  }
  return ret;
}

function splitInMiddle(s: string, maxLength: number = MAX_LEN - HASH_LEN) {
  const half = maxLength / 2;
  return s.slice(0, half) + s.slice(-half);
}
