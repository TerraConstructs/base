# TerraConstructs

**TerraConstructs** is a library of classes and interfaces inspired by [AWS CDK](https://github.com/aws/aws-cdk), but designed to leverage the power and flexibility of Terraform. Built using [CDKTF](https://github.com/hashicorp/terraform-cdk), TerraConstructs enables developers to define cloud infrastructure using familiar object-oriented programming patterns, while taking advantage of Terraform/OpenTofu's broad provider ecosystem and efficient state management.

With TerraConstructs, you can write infrastructure as code that is intuitive, modular, and maintainable. It combines the ease of high-level constructs with the powerful capabilities of Terraform providers, offering an exceptional developer experience for defining and managing cloud resources.

---

### Why TerraConstructs?

- **Object-Oriented Constructs**: Simplify infrastructure definition with reusable, high-level constructs that abstract complexity.
- **Terraform Integration**: Use the extensive Terraform provider ecosystem for multi-cloud and hybrid-cloud deployments.
- **Inspired by AWS CDK**: Enjoy similar patterns and abstractions with the flexibility to go beyond AWS.

---

For detailed documentation, examples, and to learn more about the project, visit our website:
👉 **[terraconstructs.dev](https://terraconstructs.dev)**

### Contributing

To get started contributing to TerraConstructs:

1. **Clone the Repository**
   ```bash
   git clone https://github.com/terraconstructs/base.git
   cd base
   ```

2. **Install Dependencies**
   Ensure you have **Node.js** (`>=18.18.0`) installed along with the **pnpm** (`9.9.0`) package manager. Then run:
   ```bash
   pnpm install
   ```

   This will set up the workspace and install all required dependencies.

### Tool versions

Correct tool versions can be controlled using [mise](https://mise.jdx.dev/getting-started.html#quickstart).

```console
# view requested config
mise ls

# install tool versions required
mise install
```

### Integration testing

TerraConstructs are validated using [gruntwork-io/terratest](https://github.com/gruntwork-io/terratest).

Refer to [integ/](./integ/README.md) for further details.
