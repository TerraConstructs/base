// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/index.test.ts
//
// TODO(scope-reduction): omitted in this port. Upstream's Table/User test surface (this file
// and its siblings test/table.test.ts, test/user.test.ts, test/privileges.test.ts,
// test/database-query.test.ts, and test/database-query-provider/**) exercises the Table/User L2s
// and their Lambda custom-resource handler (`Custom::RedshiftDatabaseQuery`), which are
// themselves ported as fully commented-out files -- see the leading TODO block in
// `../table.ts` / `../user.ts` / `../private/database-query.ts` for the full rationale
// (TerraConstructs has no framework equivalent to CDK's `Provider`/`CustomResource` L2s in this
// repo yet). Per the "comment out, never delete" scope-reduction directive for this PR, this
// test file is ported here verbatim but fully commented out rather than dropped, so
// re-enablement is a de-commenting exercise (in lockstep with `../table.ts` / `../user.ts` /
// `../private/**`) once a custom-resource Lambda framework lands in this repo.
//
// Permalinks (v2.263.0):
//   test/table.test.ts                            https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/table.test.ts
//   test/user.test.ts                             https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/user.test.ts
//   test/privileges.test.ts                       https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/privileges.test.ts
//   test/database-query.test.ts                   https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query.test.ts
//   test/database-query-provider/escape.test.ts   https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/escape.test.ts
//   test/database-query-provider/index.test.ts    https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/index.test.ts
//   test/database-query-provider/privileges.test.ts https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/privileges.test.ts
//   test/database-query-provider/table.test.ts    https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/table.test.ts
//   test/database-query-provider/user.test.ts     https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/user.test.ts

// Placeholder so this suite satisfies Jest's "must contain at least one test" requirement while
// every upstream test below stays fully commented out (never deleted, per the scope-reduction
// directive). Remove this stub in the same de-commenting pass that re-enables the tests below.
test.skip("scope-reduction: test/database-query-provider/index.test.ts ported commented-out, see TODO above", () => {});

// -- BEGIN fully commented-out upstream port of test/database-query-provider/index.test.ts --
//
//
// import type * as AWSLambda from 'aws-lambda';
//
// const resourceProperties = {
//   handler: 'table',
//   ServiceToken: '',
// };
// const requestId = 'requestId';
// const baseEvent: AWSLambda.CloudFormationCustomResourceEvent = {
//   ResourceProperties: resourceProperties,
//   RequestType: 'Create',
//   ServiceToken: '',
//   ResponseURL: '',
//   StackId: '',
//   RequestId: requestId,
//   LogicalResourceId: '',
//   ResourceType: '',
// };
//
// const mockSubHandler = jest.fn();
// jest.mock('../../lib/private/database-query-provider/table', () => ({
//   __esModule: true,
//   handler: mockSubHandler,
// }));
// import { handler } from '../../lib/private/database-query-provider/index';
//
// beforeEach(() => {
//   jest.clearAllMocks();
// });
//
// test('calls sub handler', async () => {
//   const event = baseEvent;
//
//   await handler(event);
//
//   expect(mockSubHandler).toHaveBeenCalled();
// });
//
// test('throws with unregistered subhandler', async () => {
//   const event = {
//     ...baseEvent,
//     ResourceProperties: {
//       ...resourceProperties,
//       handler: 'unregistered',
//     },
//   };
//
//   await expect(handler(event)).rejects.toThrow(/Requested handler unregistered is not in supported set/);
//   expect(mockSubHandler).not.toHaveBeenCalled();
// });
//
// -- END fully commented-out upstream port of test/database-query-provider/index.test.ts --
