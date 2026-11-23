# Integration Tests

> [!WARNING]
> Make sure to build (`pnpm compile`) before running e2e.
> terratest only uses the compiled `lib` folder.

[terratest.gruntwork.io](https://terratest.gruntwork.io/) is a golang library of modules for IaC testing.

Refer to their excelent [Quick Start](https://terratest.gruntwork.io/docs/getting-started/quick-start/) docs for an introduction on how to use terratest.

Launch an Authenticated AWS Shell.

## E2E User Setup

To run the integration tests, you must not use the root AWS account. Instead, create a dedicated IAM user with administrative privileges.

1.  **Create the IAM User:**

    ```sh
    aws iam create-user --user-name terraconstructs-e2e
    ```

2.  **Attach Administrator Policy:**

    ```sh
    aws iam attach-user-policy --user-name terraconstructs-e2e --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
    ```

3.  **Create and Configure Access Key:**

    ```sh
    aws iam create-access-key --user-name terraconstructs-e2e
    ```

    This command will output an `AccessKeyId` and a `SecretAccessKey`. Use these to configure a new AWS CLI profile:

    ```sh
    aws configure --profile terraconstructs-e2e set aws_access_key_id <YOUR_ACCESS_KEY_ID>
    aws configure --profile terraconstructs-e2e set aws_secret_access_key <YOUR_SECRET_ACCESS_KEY>
    ```

4.  **Set the AWS_PROFILE Environment Variable:**

    Before running the tests, set the `AWS_PROFILE` environment variable to use the newly created profile:

    ```sh
    export AWS_PROFILE=terraconstructs-e2e
    ```

## Run against the AWS emulator

The AWS tests run against the [AWS emulator](https://xsavikx.github.io/aws-emulator-docker/) without AWS credentials.
Docker must run on your machine.

Run one target in its service directory. Add `-emulator` to the target name:

```console
cd integ/aws/encryption
make key-emulator
```

Run all AWS targets against one emulator container from `integ`:

```console
make aws-emulator
make aws-emulator EMULATOR_SERVICE=encryption
make aws-emulator-list
```

The aggregate target finds the targets in `integ/aws/*/Makefile`, starts the container once, and removes it at the end.
It continues after a failure, prints a summary, and exits with a non-zero code if any target fails.
`EMULATOR_SERVICE` selects one service directory. `aws-emulator-list` shows the targets that run and the targets that skip.

Targets that the emulator cannot serve are in [`emulator-skip.txt`](./emulator-skip.txt).
Each line holds a service and a target. Edit this file to change the skip list.
Set `EMULATOR_SKIP_FILE` to use a different file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMULATOR_PORT` | `9397` | Host port of the emulator. |
| `EMULATOR_NAME` | `terraconstructs-aws-emulator` | Container name. `emulator-up` removes a container with this name. |
| `EMULATOR_IMAGE` | `ghcr.io/xsavikx/aws-emulator:latest` | Container image. |

The `-emulator` target removes the AWS credential variables, sets `AWS_EC2_METADATA_DISABLED=true` and `AWS_DISABLE_HOST_PREFIX_INJECTION=true`, and uses an empty `AWS_CONFIG_FILE`.
The Go SDK v2 and the Terraform AWS provider ignore `AWS_DISABLE_HOST_PREFIX_INJECTION`. It does not fix the skipped S3 Control and Cloud Map targets.

### Use an emulator that already runs

Set `EMULATOR_EXTERNAL=1` to use an emulator that another process started.
The targets then do not start or stop a container, and do not check the port.
They read the endpoint, CA bundle, credentials file and config file from the environment, and still remove the AWS credential variables.
`AWS_ENDPOINT_URL` must be set. The run stops with an error if it is empty.

```sh
EMULATOR_EXTERNAL=1 make -C integ aws-emulator EMULATOR_SERVICE=network
```

### CI

CI starts the emulator with the [run-aws-emulator](https://github.com/xSAVIKx/run-aws-emulator) action and sets `EMULATOR_EXTERNAL=1`.
The action exports the environment variables. Local runs use Docker through `make`.
The action step uses the same image as `EMULATOR_IMAGE`.
A failed job prints the container log.

The `build` workflow runs the `integ-aws-emulator` job on every pull request.
The job uses a matrix with one leg per service directory in `integ/aws/*/Makefile`. Each leg runs in parallel on its own runner with its own emulator container, and runs `make aws-emulator EMULATOR_SERVICE=<service>`.
The `integ-aws-emulator` workflow runs the full suite sequentially (`make aws-emulator`) every night and on demand.
Both jobs run only in the `TerraConstructs/base` repository.

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
