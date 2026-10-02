#!/usr/bin/env node
// @cdktn/bundler-docker and @cdktn/bundler-local are consumed from GitHub
// release tarballs (see pnpm-workspace.yaml) because they aren't published
// to npm yet. Their own package.json/.jsii declare a `cdktn: ^0.0.0` peer
// dependency (their own placeholder version), which jsii's dependency
// validator rejects against the real cdktn version this repo uses.
//
// This used to be a `pnpm patch`, but that release's tarball content churns
// under the same URL/tag as the upstream package evolves, and pnpm's patch
// apply is a strict git-blob-hash match against the exact bytes recorded
// when the patch was generated -- a byte-identical-looking re-fetch can
// still fail to apply (ERR_PNPM_PATCH_FAILED) if anything about how it was
// extracted differs. Patching node_modules directly after every install
// sidesteps that entirely. Delete this script (and its call site in
// .projenrc.ts) once both packages are published with a real peer range.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CDKTN_VERSION = "0.25.0-pre.40";
const PACKAGES = ["@cdktn/bundler-docker", "@cdktn/bundler-local"];

for (const pkg of PACKAGES) {
  const dir = join("node_modules", pkg);
  if (!existsSync(dir)) continue;

  const pkgJsonPath = join(dir, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (pkgJson.peerDependencies?.cdktn) {
    pkgJson.peerDependencies.cdktn = CDKTN_VERSION;
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
  }

  const jsiiPath = join(dir, ".jsii");
  if (existsSync(jsiiPath)) {
    const jsii = JSON.parse(readFileSync(jsiiPath, "utf8"));
    if (jsii.dependencies?.cdktn) {
      jsii.dependencies.cdktn = CDKTN_VERSION;
    }
    jsii.fingerprint = "*".repeat(10);
    writeFileSync(jsiiPath, JSON.stringify(jsii, null, 2) + "\n");
  }
}
