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

Stages, in order:

1. `synth_app` - synth all three stacks (saves the random bucket suffix under `tf/`)
2. `deploy_a` / `validate_a`, `deploy_b` / `validate_ab`, `deploy_c` / `validate_abc` -
   each validator asserts exactly one entry per deployed owner, with the owner's key
   prefix and an Id starting with the owner's `<stack_id>-`; `validate_abc` records the
   Ids and checks delivery to each owner's Lambda
3. `update_a` - re-synth stack `a` with `A_PREFIX=a-updated/` and re-apply it, so the
   handler runs an unmanaged `Update`
4. `validate_abc_updated` - `b`'s and `c`'s Ids must be unchanged, `a`'s must have
   changed; delivery to `a` under the new prefix
5. `destroy_b` / `validate_ac` - the remaining Ids must be exactly `a`'s updated Id and
   `c`'s Id
6. `cleanup_terraform` - destroy `c`, `b` (unless already destroyed), then `a`

`bucket-notifications-cross-stack-no-cleanup` works through the generic pattern. The
other generic patterns do not apply because this test names its own stages; use the
explicit `bucket-notifications-cross-stack-synth-only`,
`bucket-notifications-cross-stack-validate-only` (re-runs `validate_ac` after a
`-no-cleanup` run) and `bucket-notifications-cross-stack-cleanup-only` targets instead.

> [!NOTE]
> This target needs the `cdktn-io/cfncompat` provider, served by both
> `registry.terraform.io` and `registry.opentofu.org`; terratest runs `tofu`
> (`integ/aws/util.go`) and resolves it from the OpenTofu registry.
