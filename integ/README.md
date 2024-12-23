# Integration Tests

> [!WARNING]
> Make sure to build (`pnpm compile`) before running e2e.
> terratest only uses the compiled `lib` folder.

[terratest.gruntwork.io](https://terratest.gruntwork.io/) is a golang library of modules for IaC testing.

Refer to their excelent [Quick Start](https://terratest.gruntwork.io/docs/getting-started/quick-start/) docs for an introduction on how to use terratest.

Launch an Authenticated AWS Shell.

Run all e2e tests:

> [!IMPORTANT]
> Ensure [bun](https://bun.sh) is installed and available on `$PATH` for terratest to synth.
> To manually run the integration "apps", use `bun run`.

```sh
go test -v -count 1 -timeout 180m ./...
```

> [!IMPORTANT]
> Running all e2e tests will take significant amount of time and is not recommended, use individual make targets per namespace:
> i.e. `cd staticsite; make public-website-bucket`

## Make targets

> [!IMPORTANT]
> If you encounter any issues with the `awk` commands used, you might need to install GNU versions of these tools via Homebrew and ensure `gnubin` is first on `$PATH`.
>
> brew install awk
