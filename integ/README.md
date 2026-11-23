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

The `-emulator` target removes the AWS credential variables, sets `AWS_EC2_METADATA_DISABLED=true`, and uses an empty `AWS_CONFIG_FILE`.

The `integ-aws-emulator` GitHub workflow runs `make aws-emulator` every night and on demand. The full run takes hours, so it does not run on pull requests.

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
