// Single-account port of upstream integ.zone-delegation-iam-stack.ts
// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk-testing/framework-integ/test/aws-route53/test/integ.zone-delegation-iam-stack.ts
import { App, LocalBackend, Lazy, TerraformOutput } from "cdktn";
import { aws, Duration } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "zone-delegation";
// TERRACONSTRUCTS DEVIATION: upstream uses the literal `uniqueexample.com`; the Go test passes a random
// name under a domain we own so parallel / repeated runs never collide.
const parentZoneName =
  process.env.PARENT_ZONE_NAME ?? "zone-delegation.e2e.terraconstructs.dev";
const childZoneName = `sub1.${parentZoneName}`;

// Construct id of the stack-level singleton provider that backs
// CrossAccountZoneDelegationRecord (`${resourceType}CustomResourceProvider`).
const delegationProviderId =
  "Custom::CrossAccountZoneDelegationCustomResourceProvider";

const app = new App({
  outdir,
});
const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "g12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
// TODO: use TerraConstruct e2e s3 backend?
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const parentZone = new aws.edge.DnsZone(stack, "ParentZone", {
  zoneName: parentZoneName,
});

// The provider (and its role) only exists once the delegation record below
// is constructed, so resolve its role ARN lazily at synth time.
let providerRoleArn: string | undefined;

// TERRACONSTRUCTS DEVIATION: upstream trusts the account root restricted (ArnLike aws:PrincipalArn) to
// the stack's role name pattern; here the condition pins the exact ARN of the
// delegation provider's Lambda execution role.
const delegationRole = new aws.iam.Role(stack, "ZoneDelegationRole", {
  assumedBy: new aws.iam.AccountRootPrincipal().withConditions({
    test: "ArnEquals",
    variable: "aws:PrincipalArn",
    values: [
      Lazy.stringValue({
        produce: () => {
          if (!providerRoleArn) {
            throw new Error(
              `${delegationProviderId} was not created by CrossAccountZoneDelegationRecord`,
            );
          }
          return providerRoleArn;
        },
      }),
    ],
  }),
});

const delegationGrant = parentZone.grantDelegation(delegationRole, {
  delegatedZoneNames: [childZoneName],
});

const childZone = new aws.edge.DnsZone(stack, "ChildZone", {
  zoneName: childZoneName,
});

// TERRACONSTRUCTS DEVIATION: parentHostedZoneId (instead of upstream's
// parentHostedZoneName) gives the custom resource a Terraform reference to the
// parent zone, so destroy deletes the NS record before the parent zone.
new aws.edge.CrossAccountZoneDelegationRecord(childZone, "ZoneDelegation", {
  delegatedZone: childZone,
  parentHostedZoneId: parentZone.zoneId,
  delegationRole,
  ttl: Duration.seconds(60),
}).node.addDependency(delegationGrant);

// TERRACONSTRUCTS DEVIATION: look up the internal singleton provider to expose its role and log group.
const provider = stack.node.findChild(delegationProviderId) as unknown as {
  readonly roleArn: string;
  readonly node: { findChild(id: string): unknown };
};
providerRoleArn = provider.roleArn;
const providerLogGroup = provider.node.findChild("LogGroup") as {
  readonly name: string;
};

new TerraformOutput(stack, "parent_zone_id", {
  value: parentZone.zoneId,
});
new TerraformOutput(stack, "child_zone_name", {
  value: childZone.zoneName,
});
new TerraformOutput(stack, "child_name_servers", {
  value: childZone.nameServers,
});
new TerraformOutput(stack, "provider_log_group_name", {
  value: providerLogGroup.name,
});

app.synth();
