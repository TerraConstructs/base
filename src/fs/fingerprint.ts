import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { IgnoreStrategy } from "./ignore";
import { FingerprintOptions } from "./options";

// Ported verbatim from cdktn's `private/fs.ts` `hashPath`/`legacyHashPath`
// (the scheme `TerraformAsset`/`AssetStaging` actually produce with no
// `cdktn:canonicalAssetHashes` context flag set), so TerraConstructs' own
// asset hashes line up with what consuming cdktn's native asset hashing
// would produce for the same source tree.

const HASH_LEN = 32;
const SYMLINK_HASH_TAG = "cdktn/asset-hash/symlinks/v1\0";

/**
 * Clears the fingerprint cache.
 *
 * @deprecated no-op: cdktn's hashing scheme streams raw file bytes through a
 * single ongoing digest, so there is no per-file hash to cache. Kept so
 * existing call sites don't need to change.
 */
export function clearLargeFileFingerprintCache() {
  // no-op
}

/**
 * Produces fingerprint based on the contents of a single file or an entire directory tree.
 *
 * Matches cdktn's `TerraformAsset`/`AssetStaging` default (legacy, non-canonical)
 * hash: MD5 over raw file bytes, walked in natural directory order, with
 * symlinks hashed by path+target into a separate digest folded in only when
 * the tree actually contains symlinks.
 *
 * The fingerprint will also include an extra string if defined in `options.extraHash`.
 *
 * @param fileOrDirectory The directory or file to fingerprint
 * @param options Fingerprinting options
 */
export function fingerprint(
  fileOrDirectory: string,
  options: FingerprintOptions = {},
) {
  // Resolve symlinks in the initial path (for example, the root directory
  // might be symlinked). It's important that we know the absolute path, so we
  // can judge if further symlinks inside the target directory are within the
  // target or not (if we don't resolve, we would test w.r.t. the wrong path).
  fileOrDirectory = fs.realpathSync(fileOrDirectory);

  const ignoreStrategy = IgnoreStrategy.fromCopyOptions(
    options,
    fileOrDirectory,
  );

  const content = crypto.createHash("md5");
  const links = crypto.createHash("md5");
  let linkCount = 0;

  _processFileOrDirectory(fileOrDirectory, "", true);

  const baseDigest =
    linkCount === 0
      ? content.digest("hex")
      : crypto
          .createHash("md5")
          .update(SYMLINK_HASH_TAG)
          .update(content.digest("hex"))
          .update(links.digest("hex"))
          .digest("hex");

  const baseHash = baseDigest.slice(0, HASH_LEN).toUpperCase();

  if (!options.extraHash) {
    return baseHash;
  }

  return crypto
    .createHash("md5")
    .update(baseHash)
    .update(options.extraHash)
    .digest("hex")
    .slice(0, HASH_LEN)
    .toUpperCase();

  // Walk `p`, feeding file contents and symlink metadata into the enclosing
  // accumulators. `relPath` is the `/`-separated path of `p` relative to
  // `fileOrDirectory`. A symlink is only followed at the root, matching how
  // the asset's own path is resolved when the artifact is read/emitted.
  function _processFileOrDirectory(
    p: string,
    relPath: string,
    isRoot: boolean = false,
  ) {
    const stat = isRoot ? fs.statSync(p) : fs.lstatSync(p);

    if (stat.isSymbolicLink()) {
      links.update(`${relPath}\0${fs.readlinkSync(p)}\0`);
      linkCount++;
    } else if (stat.isFile()) {
      content.update(fs.readFileSync(p));
    } else if (stat.isDirectory()) {
      for (const filename of fs.readdirSync(p)) {
        const entryRelPath = relPath ? `${relPath}/${filename}` : filename;
        const childPath = path.join(p, filename);
        if (!ignoreStrategy.ignores(path.join(fileOrDirectory, entryRelPath))) {
          _processFileOrDirectory(childPath, entryRelPath);
        }
      }
    } else {
      throw new Error(
        `Unable to hash ${p}: it is neither a file nor a directory`,
      );
    }
  }
}

/**
 * Content hash of a single file.
 *
 * @deprecated use `fingerprint()`. Kept for existing call sites that only
 * need a plain content digest.
 */
export function contentFingerprint(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}
