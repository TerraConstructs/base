# Notify e2e tests

> [!IMPORTANT]
> Terratest uses compiled package from `lib` directory, run `pnpm compile` after making changes!

Run terratest:

```console
$  make

Test Targets:
  fifo-queue                 Test Queue with FIFO semantics
  dlq-queue                  Test DLQ Queue
  stream                     Test Kinesis Data Stream
  stream-dashboard           Test Kinesis Data Stream Dashboard
  stream-resource-policy     Test Kinesis Data Stream Resource Policy

Other Targets:
  help                       Print out every target with a description
  clean                      clean up temporary files (tf/*, apps/cdktf.out, /tmp/go-synth-*)

Special pattern targets:
  %-no-cleanup:              Skip cleanup step (i.e. foo-no-cleanup)
  %-synth-only:              Skip deploy, validate, and cleanup steps (i.e. foo-synth-only)
  %-validate-only:           Skip synth and cleanup steps (i.e. foo-validate-only)
  %-cleanup-only:            Skip synth, deploy, and validate steps (i.e. foo-cleanup-only)
```

## Debug with Snapshots

Use the `WRITE_SNAPSHOTS` environment variable to write cloud resources to disk and troubleshoot test assertions.

```console
# run synth, tf apply and validate (snapshot only) without tf destroy
WRITE_SNAPSHOTS=true make stream-resource-policy-no-cleanup
```

## Clean

To clean up after running tests

> [!WARNING]
> This will remove TF State, preventing easy clean up of Cloud Resources

```console
make clean
```
