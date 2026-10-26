// https://github.com/aws/aws-cdk/blob/v2.233.0/packages/@aws-cdk/custom-resource-handlers/lib/aws-route53/cross-account-zone-delegation-handler/index.ts
//
// Vendored from aws-cdk v2.233.0 (commit c2964655af6dc9f6594879b4cdb7bfc1c1beede2; v2.263.0 only fixes a
// comment typo). Transpiled to CommonJS with TypeScript 5.9 transpileModule (target ES2022, module CommonJS),
// matching the custom-resource-handlers package tsconfig; logic is otherwise unmodified.
// aws-cdk bundles this handler with `@aws-sdk/*` marked external, so `@aws-sdk/client-route-53` and
// `@aws-sdk/credential-providers` are resolved from the AWS SDK v3 shipped in the Lambda Node.js runtime.
// CrossAccountZoneDelegationProvider (src/aws/edge) stages this directory as the provider code asset.
//
// Do not edit by hand: regenerate from the upstream source instead.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
// eslint-disable-next-line import/no-extraneous-dependencies
const client_route_53_1 = require("@aws-sdk/client-route-53");
// eslint-disable-next-line import/no-extraneous-dependencies
const credential_providers_1 = require("@aws-sdk/credential-providers");
async function handler(event) {
    const resourceProps = event.ResourceProperties;
    switch (event.RequestType) {
        case 'Create':
            return cfnEventHandler(resourceProps, false);
        case 'Update':
            return cfnUpdateEventHandler(resourceProps, event.OldResourceProperties);
        case 'Delete':
            return cfnEventHandler(resourceProps, true);
    }
}
async function cfnUpdateEventHandler(props, oldProps) {
    if (oldProps && props.DelegatedZoneName !== oldProps.DelegatedZoneName) {
        await cfnEventHandler(oldProps, true);
    }
    await cfnEventHandler(props, false);
}
async function cfnEventHandler(props, isDeleteEvent) {
    const { AssumeRoleArn, ParentZoneId, ParentZoneName, DelegatedZoneName, DelegatedZoneNameServers, TTL, AssumeRoleRegion } = props;
    if (!ParentZoneId && !ParentZoneName) {
        throw Error('One of ParentZoneId or ParentZoneName must be specified');
    }
    const timestamp = (new Date()).getTime();
    const route53 = new client_route_53_1.Route53({
        credentials: (0, credential_providers_1.fromTemporaryCredentials)({
            clientConfig: {
                region: AssumeRoleRegion ?? route53Region(process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? ''),
            },
            params: {
                RoleArn: AssumeRoleArn,
                RoleSessionName: `cross-account-zone-delegation-${timestamp}`,
            },
        }),
    });
    const parentZoneId = ParentZoneId ?? await getHostedZoneIdByName(ParentZoneName, route53);
    await route53.changeResourceRecordSets({
        HostedZoneId: parentZoneId,
        ChangeBatch: {
            Changes: [{
                    Action: isDeleteEvent ? 'DELETE' : 'UPSERT',
                    ResourceRecordSet: {
                        Name: DelegatedZoneName,
                        Type: 'NS',
                        TTL,
                        ResourceRecords: DelegatedZoneNameServers.map(ns => ({ Value: ns })),
                    },
                }],
        },
    });
}
async function getHostedZoneIdByName(name, route53) {
    const zones = await route53.listHostedZonesByName({ DNSName: name });
    const matchedZones = zones.HostedZones?.filter(zone => {
        const matchZoneName = zone.Name === `${name}.`;
        const isPublic = zone.Config?.PrivateZone !== true;
        return matchZoneName && isPublic;
    }) ?? [];
    if (matchedZones && matchedZones.length !== 1) {
        throw Error(`Expected one hosted zone to match the given name but found ${matchedZones.length}`);
    }
    // will always be defined because we throw if length !==1
    return matchedZones[0].Id;
}
/**
 * Return the region that hosts the Route53 endpoint
 *
 * Route53 is a partitional service: the control plane lives in one particular region,
 * which is different for every partition.
 *
 * The SDK knows how to convert a "target region" to a "route53 endpoint", which
 * equates to a (potentially different) region. However, when we use STS
 * AssumeRole credentials, we must grab credentials that will work in that
 * region.
 *
 * By default, STS AssumeRole will call the STS endpoint for the same region
 * as the Lambda runs in. Normally, this is all good. However, when the AssumeRole
 * is used to assume a role in a different account A, the AssumeRole will fail if the
 * Lambda is executing in an an opt-in region R to which account A has not been opted in.
 *
 * To solve this, we will always AssumeRole in the same region as the Route53 call will
 * resolve to.
 */
function route53Region(region) {
    const partitions = {
        'cn': 'cn-northwest-1',
        'us-gov': 'us-gov-west-1',
        'us-iso': 'us-iso-east-1',
        'us-isob': 'us-isob-east-1',
        'eu-isoe': 'eu-isoe-west-1',
        'us-isof': 'us-isof-south-1',
        'eusc-de': 'eusc-de-east-1',
    };
    for (const [prefix, mainRegion] of Object.entries(partitions)) {
        if (region.startsWith(`${prefix}-`)) {
            return mainRegion;
        }
    }
    // Default for commercial partition
    return 'us-east-1';
}
