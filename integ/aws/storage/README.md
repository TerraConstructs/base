# Storage e2e tests

> [!IMPORTANT]
> Terratest uses compiled package from `lib` directory, run `pnpm compile` after making changes!

## Running Tests

Run terratest:

```console
$ make

Test Targets:
  bucket-notifications       Test S3 Bucket with EventBridge Notifications
  bucket-notifications-cross-stack
                             Test cross-stack S3 notifications via the cfncompat custom resource

Other Targets:
  help                       Print out every target with a description
  clean                      clean up temporary files (tf/*, apps/cdktf.out, /tmp/go-synth-*)

Special pattern targets:
  %-no-cleanup:              Skip cleanup step (i.e. foo-no-cleanup)
  %-synth-only:              Skip deploy, validate, and cleanup steps (i.e. foo-synth-only)
  %-validate-only:           Skip synth and cleanup steps (i.e. foo-validate-only)
  %-cleanup-only:            Skip synth, deploy, and validate steps (i.e. foo-cleanup-only)
```

## Clean

To clean up after running tests

> [!WARNING]
> This will remove TF State, preventing easy clean up of Cloud Resources

```console
make clean
```

## `bucket-notifications-cross-stack`

Three stacks (`a`, `b`, `c`) add their own prefix-filtered notification entry to one
shared bucket: `a` owns the bucket, `b` and `c` only import it by name. Every entry is
provisioned by the `Custom::S3BucketNotifications` custom resource, so each apply merges
with the other stacks' entries instead of overwriting them.

The `%-no-cleanup` / `%-synth-only` / `%-validate-only` / `%-cleanup-only` patterns do not
apply here: this test names its own stages (`deploy_a`, `validate_ab`, ...). Use the
explicit `bucket-notifications-cross-stack-synth-only` and
`bucket-notifications-cross-stack-cleanup-only` targets instead.

> [!IMPORTANT]
> This target needs the `cdktn-io/cfncompat` Terraform provider, which
> `registry.opentofu.org` does not serve. Terratest runs `tofu` (hardcoded in
> `integ/aws/util.go`), so an unmodified run fails at init with
> `Failed to query available provider packages`. To run it today, add a
> `filesystem_mirror` for `cdktn-io/cfncompat` to the OpenTofu CLI configuration
> (`~/.tofurc`), or point the terratest options at a `terraform` binary locally. The
> durable fix is publishing the provider to the OpenTofu registry.
