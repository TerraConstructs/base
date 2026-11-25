# Encryption e2e tests

> [!IMPORTANT]
> Terratest uses compiled package from `lib` directory, run `pnpm compile` after making changes!

## Running Tests

Run terratest:

```console

Test Targets:
  all                        Test all Stepfunctions
  key                        Test AWS KMS Customer Master Key creation
  key-alias                  Test AWS KMS CMK + alias creation
  secret-attach              Test SecretsManager Secret.attach() against an RDS DbInstance
  secret.replica             Test AWS Secrets Manager Secret + replica region

Other Targets:
  help                       Print out every target with a description
  clean                      clean up temporary files (tf/*, apps/cdktf.out, /tmp/go-synth-*)

Special pattern targets:
  %-no-cleanup:              Skip cleanup step (i.e. foo-no-cleanup)
  %-synth-only:              Skip deploy, validate, and cleanup steps (i.e. foo-synth-only)
  %-validate-only:           Skip synth and cleanup steps (i.e. foo-validate-only)
  %-cleanup-only:            Skip synth, deploy, and validate steps (i.e. foo-cleanup-only)
```

## Running against the AWS emulator

The tests run against the [AWS emulator](https://github.com/TerraConstructs/aws-emulator-docker) without AWS credentials. Docker must run.

Run these commands in `integ/aws/encryption`. Add `-emulator` to a target name:

```console
make key-emulator
make key-alias-emulator
```

The target starts the emulator container, runs the test, and stops the container.
If the container already runs, the target reuses it and leaves it running.
Set `EMULATOR_PORT` and `EMULATOR_NAME` to change the port (default `9397`) and the container name.
Run all AWS targets with `make aws-emulator` in `integ`. Refer to the [integ README](../../README.md#run-against-the-aws-emulator).

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
