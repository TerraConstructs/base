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
