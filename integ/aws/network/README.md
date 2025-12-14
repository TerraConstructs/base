# Network e2e tests

> [!WARNING]
> Deprecated: Use `aws/compute` Vpc and VpcV2 instead

> [!IMPORTANT]
> Terratest uses compiled package from `lib` directory, run `pnpm compile` after making changes!

Run terratest:

```console
$ make

Test Targets:
  simple-ipv4-vpc            Test Simple IPv4 VPC network connectivity

Other Targets:
  help                       Print out every target with a description
  clean                      clean up temporary files (tf/*, apps/cdktf.out, /tmp/go-synth-*)

Special pattern targets:
  %-no-cleanup:              Skip cleanup step (i.e. foo-no-cleanup)
  %-synth-only:              Skip deploy, validate, and cleanup steps (i.e. foo-synth-only)
  %-validate-only:           Skip synth and cleanup steps (i.e. foo-validate-only)
  %-cleanup-only:            Skip synth, deploy, and validate steps (i.e. foo-cleanup-only)
```

Iterating tests, use the `SKIP_` variables for the stages defined:

- SKIP_synth_app=true to skip converting Typescript into tf Json (this will prevent running any terraform stages)
- SKIP_deploy_terraform=true to skip terraform init and apply
- SKIP_validate=true to skip terratest validation stage
- SKIP_cleanup_terraform=true to skip terraform destroy

> [!WARNING]
> AWS Lambda VPC network optimizations cause destroy actions on the VPC to take up to 45 min (actual 20min on average).

For example, to synth app and deploy it, but keep everything running for troubleshooting (skip cleanup):

```sh
SKIP_cleanup_terraform=true make simple-ipv4-vpc
```

To re-run the Validation stage only

```sh
SKIP_synth_app=true SKIP_cleanup_terraform=true make simple-ipv4-vpc
```

To clean up after troubleshooting (skip build/deploy, but not cleanup)

```sh
SKIP_synth_app=true SKIP_deploy_terraform=true SKIP_validate=true make simple-ipv4-vpc
```

To synth app only

```sh
SKIP_deploy_terraform=true SKIP_validate=true SKIP_cleanup_terraform=true make simple-ipv4-vpc
```
