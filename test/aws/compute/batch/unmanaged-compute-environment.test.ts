// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/aws-cdk-lib/aws-batch/test/unmanaged-compute-environment.test.ts

import { batchComputeEnvironment } from "@cdktn/provider-aws";
import { Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
// import { capitalizePropertyNames } from './utils';
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as batch from "../../../../src/aws/compute/batch";
import * as iam from "../../../../src/aws/iam";
import { Template } from "../../../assertions";

const gridBackendConfig = {
  address: "http://localhost:3000",
};

// const defaultExpectedProps: CfnComputeEnvironmentProps = {
//   type: 'unmanaged',
//   computeEnvironmentName: undefined,
//   computeResources: undefined,
//   eksConfiguration: undefined,
//   replaceComputeEnvironment: undefined,
//   serviceRole: {
//     'Fn::GetAtt': ['MyCEBatchServiceRole4FDA2CB6', 'Arn'],
//   } as any,
//   state: 'ENABLED',
//   tags: undefined,
//   unmanagedvCpus: undefined,
//   updatePolicy: undefined,
// };
//
// let stack = new Stack();
// const pascalCaseExpectedProps = capitalizePropertyNames(stack, defaultExpectedProps);

describe("UnmanagedComputeEnvironment", () => {
  test("Should synth and match SnapShot", () => {
    // GIVEN
    const stack = getAwsStack();

    // WHEN
    new batch.UnmanagedComputeEnvironment(stack, "MyCE");

    // THEN
    stack.prepareStack(); // may generate additional resources
    expect(Testing.synth(stack)).toMatchSnapshot();
  });
});

let stack: AwsStack;

test("default props", () => {
  // GIVEN
  stack = getAwsStack();

  // WHEN
  const ce = new batch.UnmanagedComputeEnvironment(stack, "MyCE");

  // THEN
  const role = ce.node.findChild("BatchServiceRole") as iam.Role;
  Template.synth(stack).toHaveResourceWithProperties(
    batchComputeEnvironment.BatchComputeEnvironment,
    {
      // NOTE: upstream CDK passes the lowercase CFN enum literal 'unmanaged'; the Terraform
      // provider forwards `type` verbatim to the Batch API, so the canonical uppercase
      // `ComputeEnvironmentType` enum value is asserted here instead (see unmanaged-compute-environment.ts).
      type: "UNMANAGED",
      state: "ENABLED",
      service_role: stack.resolve(role.roleArn),
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
  //   ...pascalCaseExpectedProps,
  // });
});

test("respects enabled: false", () => {
  // GIVEN
  stack = getAwsStack();

  // WHEN
  new batch.UnmanagedComputeEnvironment(stack, "MyCE", {
    enabled: false,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchComputeEnvironment.BatchComputeEnvironment,
    {
      state: "DISABLED",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
  //   ...pascalCaseExpectedProps,
  //   State: 'DISABLED',
  // });
});

test("respects name", () => {
  // GIVEN
  stack = getAwsStack();

  // WHEN
  new batch.UnmanagedComputeEnvironment(stack, "MyCE", {
    computeEnvironmentName: "magic",
  });

  // THEN
  // TERRACONSTRUCTS DEVIATION: `computeEnvironmentName` (CFN, single optional string) is honored
  // verbatim via TF `name` (exact) rather than `namePrefix` -- see the gridUUID hybrid naming model
  // in unmanaged-compute-environment.ts.
  Template.synth(stack).toHaveResourceWithProperties(
    batchComputeEnvironment.BatchComputeEnvironment,
    {
      name: "magic",
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
  //   ...pascalCaseExpectedProps,
  //   ComputeEnvironmentName: 'magic',
  // });
});

test("respects serviceRole", () => {
  // GIVEN
  stack = getAwsStack();

  // WHEN
  const myMagicRole = new iam.Role(stack, "myMagicRole", {
    assumedBy: new iam.ServicePrincipal("batch.amazonaws.com"),
  });
  new batch.UnmanagedComputeEnvironment(stack, "MyCE", {
    serviceRole: myMagicRole,
  });

  // THEN
  Template.synth(stack).toHaveResourceWithProperties(
    batchComputeEnvironment.BatchComputeEnvironment,
    {
      service_role: stack.resolve(myMagicRole.roleArn),
    },
  );
  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
  //   ...pascalCaseExpectedProps,
  //   ServiceRole: {
  //     'Fn::GetAtt': ['myMagicRole2BBD827A', 'Arn'],
  //   },
  // });
});

test("respects unmanagedvCpus", () => {
  // GIVEN
  stack = getAwsStack();

  // WHEN
  const ce = new batch.UnmanagedComputeEnvironment(stack, "MyCE", {
    unmanagedvCpus: 256,
  });

  // THEN
  // TERRACONSTRUCTS DEVIATION (provider-unsupported): `unmanagedvCpus` has no counterpart on
  // `BatchComputeEnvironmentConfig` (verified against @cdktn/provider-aws 6.52.0) even though the
  // underlying Batch CreateComputeEnvironment API accepts it -- the Terraform provider does not
  // expose it at all. It is preserved as a construct-level, TF-resource-less property only (for
  // FairshareSchedulingPolicy-aware JobQueues to read); it cannot be asserted against the synthesized
  // `aws_batch_compute_environment` resource. See mappings/aws-batch.json (CfnComputeEnvironment entry,
  // "UNMAPPABLE Cfn props" section).
  expect(ce.unmanagedvCPUs).toEqual(256);

  // Template.fromStack(stack).hasResourceProperties('AWS::Batch::ComputeEnvironment', {
  //   ...pascalCaseExpectedProps,
  //   UnmanagedvCpus: 256,
  // });
});

function getAwsStack(): AwsStack {
  const app = Testing.app();
  return new AwsStack(app, "TestStack", {
    gridBackendConfig,
  });
}
