// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/core/lib/fs/copy.ts

import * as fs from "fs";
import * as path from "path";
import { IgnoreStrategy } from "./ignore";
import { CopyOptions, SymlinkFollowMode } from "./options";
import { shouldFollow } from "./utils";

export function copyDirectory(
  srcDir: string,
  destDir: string,
  options: CopyOptions = {},
  rootDir?: string,
) {
  const follow = options.follow ?? SymlinkFollowMode.EXTERNAL;

  rootDir = rootDir || srcDir;

  // ensure the destination directory exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const ignoreStrategy = IgnoreStrategy.fromCopyOptions(options, rootDir);

  if (!fs.statSync(srcDir).isDirectory()) {
    throw new Error(`${srcDir} is not a directory`);
  }

  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    let sourceFilePath = path.join(srcDir, file);

    if (ignoreStrategy.ignores(sourceFilePath)) {
      continue;
    }

    const destFilePath = path.join(destDir, file);

    let stat: fs.Stats | undefined =
      follow === SymlinkFollowMode.ALWAYS
        ? fs.statSync(sourceFilePath)
        : fs.lstatSync(sourceFilePath);

    if (stat && stat.isSymbolicLink()) {
      const target = fs.readlinkSync(sourceFilePath);

      // determine if this is an external link (i.e. the target's absolute path
      // is outside of the root directory).
      const targetPath = path.normalize(path.resolve(srcDir, target));

      if (shouldFollow(follow, rootDir, targetPath)) {
        stat = fs.statSync(targetPath);
        // Update sourceFilePath to be the resolved target path
        sourceFilePath = targetPath;
      } else {
        fs.symlinkSync(target, destFilePath);
        stat = undefined;
      }
    }

    if (stat && stat.isDirectory()) {
      fs.mkdirSync(destFilePath);
      copyDirectory(sourceFilePath, destFilePath, options, rootDir);
      stat = undefined;
    }

    if (stat && stat.isFile()) {
      fs.copyFileSync(sourceFilePath, destFilePath);
      stat = undefined;
    }
  }
}
