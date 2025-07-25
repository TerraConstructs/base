#!/bin/bash
set -euo pipefail
# stub for the `docker` executable. it is used as CDK_DOCKER when executing unit
# tests in `test.staging.ts` This variant is specific for tests that use the docker copy method for files, instead of bind mounts

echo "$@" >> /tmp/docker-stub-cp.input.concat
echo "$@" > /tmp/docker-stub-cp.input

# create a file without extension to emulate created files, fetch the target path from the "docker cp" command
if cat /tmp/docker-stub-cp.input.concat | grep "DOCKER_STUB_SINGLE_FILE_WITHOUT_EXT"; then
  if echo "$@" | grep "cp"| grep "/asset-output"; then
    outdir=$(echo "$@" | grep cp | grep "/asset-output" | xargs -n1 | grep "tcons-staging" | head -n1 | cut -d":" -f1)
    if [ -n "$outdir" ]; then
      touch "${outdir}/test" # create a file witout extension
      exit 0
    fi
  fi
fi

# create a fake zip to emulate created files, fetch the target path from the "docker cp" command
if echo "$@" | grep "cp"| grep "/asset-output"; then
  outdir=$(echo "$@" | grep cp | grep "/asset-output" | xargs -n1 | grep "tcons-staging" | head -n1 | cut -d":" -f1)
  if [ -n "$outdir" ]; then
    touch "${outdir}/test.zip"
  fi
fi
