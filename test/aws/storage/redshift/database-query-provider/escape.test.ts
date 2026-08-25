// https://github.com/aws/aws-cdk/blob/v2.263.0/packages/@aws-cdk/aws-redshift-alpha/test/database-query-provider/escape.test.ts
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
test.skip("scope-reduction: test/database-query-provider/escape.test.ts ported commented-out, see TODO above", () => {});

// -- BEGIN fully commented-out upstream port of test/database-query-provider/escape.test.ts --
//
// import { quoteIdentifier, quoteLiteral, quoteQualifiedIdentifier } from '../../lib/private/database-query-provider/escape';
//
// describe('quoteIdentifier', () => {
//   test('returns a plain lowercase identifier unchanged', () => {
//     expect(quoteIdentifier('users')).toEqual('users');
//   });
//
//   test('returns a mixed-case identifier unchanged (Redshift folds it, matching prior behaviour)', () => {
//     expect(quoteIdentifier('MyUser')).toEqual('MyUser');
//   });
//
//   test('returns an identifier with digits, underscores, and dollar signs unchanged', () => {
//     expect(quoteIdentifier('etl_user_2$')).toEqual('etl_user_2$');
//   });
//
//   test('returns a non-ASCII (multibyte) identifier unchanged', () => {
//     expect(quoteIdentifier('café')).toEqual('café');
//   });
//
//   test('delimits an identifier containing a space', () => {
//     expect(quoteIdentifier('a b')).toEqual('"a b"');
//   });
//
//   test('delimits an identifier starting with a digit', () => {
//     expect(quoteIdentifier('1table')).toEqual('"1table"');
//   });
//
//   test('delimits an identifier containing a double quote and doubles it', () => {
//     expect(quoteIdentifier('a"b')).toEqual('"a""b"');
//   });
//
//   test('delimits a name that would otherwise break out of the statement', () => {
//     expect(quoteIdentifier("evil PASSWORD 'x' CREATEUSER --")).toEqual('"evil PASSWORD \'x\' CREATEUSER --"');
//   });
//
//   test('delimits an empty identifier', () => {
//     expect(quoteIdentifier('')).toEqual('""');
//   });
// });
//
// describe('quoteLiteral', () => {
//   test('wraps a plain value in single quotes', () => {
//     expect(quoteLiteral('a')).toEqual("'a'");
//   });
//
//   test('doubles an embedded single quote character', () => {
//     expect(quoteLiteral("a'b")).toEqual("'a''b'");
//   });
//
//   test('wraps an empty value in single quotes', () => {
//     expect(quoteLiteral('')).toEqual("''");
//   });
// });
//
// describe('quoteQualifiedIdentifier', () => {
//   test('returns each bare-safe component unchanged, keeping the dot separator', () => {
//     expect(quoteQualifiedIdentifier('public.users')).toEqual('public.users');
//   });
//
//   test('returns a single bare-safe name unchanged', () => {
//     expect(quoteQualifiedIdentifier('users')).toEqual('users');
//   });
//
//   test('delimits only the component that needs it', () => {
//     expect(quoteQualifiedIdentifier('public.us ers')).toEqual('public."us ers"');
//   });
//
//   test('doubles an embedded double quote character within a component', () => {
//     expect(quoteQualifiedIdentifier('public.us"ers')).toEqual('public."us""ers"');
//   });
//
//   test('delimits an empty name', () => {
//     expect(quoteQualifiedIdentifier('')).toEqual('""');
//   });
// });
//
// -- END fully commented-out upstream port of test/database-query-provider/escape.test.ts --
