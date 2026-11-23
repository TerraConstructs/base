#!/usr/bin/env bash
# Run every AWS integ target through "<target>-emulator", skipping entries in the skip file.
#
# Usage: emulator-all.sh [--list]
# Environment: EMULATOR_SERVICE (one service directory), EMULATOR_SKIP_FILE,
# EMULATOR_EXTERNAL (use the emulator that AWS_ENDPOINT_URL points at; the targets do not start or stop one).

here="$(cd "$(dirname "$0")" && pwd)"
skip_file="${EMULATOR_SKIP_FILE:-$here/emulator-skip.txt}"
only_service="${EMULATOR_SERVICE:-}"
list_only=false
[ "${1:-}" = "--list" ] && list_only=true

is_skipped() {
  [ -f "$skip_file" ] || return 1
  sed 's/#.*//' "$skip_file" | awk -v s="$1" -v t="$2" '$1 == s && $2 == t { found = 1 } END { exit !found }'
}

targets_of() {
  awk -F: '/^[a-zA-Z0-9_.-]+:.*## Test/ && $1 != "all" { print $1 }' "$here/aws/$1/Makefile"
}

services=()
for makefile in "$here"/aws/*/Makefile; do
  services+=("$(basename "$(dirname "$makefile")")")
done

if [ -n "$only_service" ]; then
  found=false
  for s in "${services[@]}"; do [ "$s" = "$only_service" ] && found=true; done
  if ! $found; then
    echo "Unknown service '$only_service'. Available: ${services[*]}" >&2
    exit 2
  fi
  services=("$only_service")
fi

passed=()
failed=()
skipped=()
for service in "${services[@]}"; do
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    if is_skipped "$service" "$target"; then
      skipped+=("$service/$target")
      echo "SKIP $service/$target"
      continue
    fi
    if $list_only; then
      echo "RUN  $service/$target"
      continue
    fi
    echo "=== $service/$target"
    start=$SECONDS
    if make -C "$here/aws/$service" --no-print-directory "$target-emulator"; then
      passed+=("$service/$target ($((SECONDS - start))s)")
    else
      failed+=("$service/$target ($((SECONDS - start))s)")
    fi
  done < <(targets_of "$service")
done

$list_only && exit 0

echo
echo "Summary: ${#passed[@]} passed, ${#failed[@]} failed, ${#skipped[@]} skipped"
for item in "${passed[@]}"; do echo "  PASS $item"; done
for item in "${failed[@]}"; do echo "  FAIL $item"; done
for item in "${skipped[@]}"; do echo "  SKIP $item"; done
[ "${#failed[@]}" -eq 0 ]
