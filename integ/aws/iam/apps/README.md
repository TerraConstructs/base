# IAM CDKTN Apps

These are the CDKTN Apps for integration testing.

You may run them directly using `bun role` for example.

> [!WARNING]
> To speed up iteration, these import statements point directly
> to typescript source files, however, you may bugs in bun typescript
> execution. Fix these by compiling the package and temporary point
> to script to use the `lib` directly.
>
> HOWEVER: The actual terratest code requires the path to be `../../../src` or
> will fail to synth.
