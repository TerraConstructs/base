// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-s3-assets/test/asset.test.ts

// import * as fs from "fs";
// import * as os from "os";
import * as path from "path";
import {
  dataAwsIamPolicyDocument,
  iamGroupPolicy,
  iamUserPolicy,
  s3Object,
} from "@cdktn/provider-aws";
import { App, Testing } from "cdktn";
import "cdktn/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as iam from "../../../../src/aws/iam";
import { Asset } from "../../../../src/aws/storage/assets/s3";
import { Template } from "../../../assertions";

const SAMPLE_ASSET_DIR = path.join(__dirname, "sample-asset-directory");
// const SAMPLE_ASSET_HASH =
//   "EBD21D757D188EF1FB59019F88B577F5";

const TEST_OUTDIR = path.join(__dirname, "cdk.out");
describe("s3-assets", () => {
  let stack: AwsStack;
  beforeEach(() => {
    const app = Testing.stubVersion(
      new App({
        outdir: TEST_OUTDIR,
        stackTraces: false,
        context: {
          cdktfJsonPath: path.resolve(__dirname, "fixtures/app/cdktf.json"),
        },
      }),
    );
    stack = new AwsStack(app);
  });
  test("simple use case", () => {
    // context: {
    //   [cxapi.DISABLE_ASSET_STAGING_CONTEXT]: "true",
    //   [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false,
    // },
    new Asset(stack, "MyAsset", {
      path: SAMPLE_ASSET_DIR,
    });

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(s3Object.S3Object, {
      // path: "asset.EBD21D757D188EF1FB59019F88B577F5",
      bucket: "${aws_s3_bucket.AssetBucket.bucket}",
      key: "EBD21D757D188EF1FB59019F88B577F5.zip",
      source: "assets/FileAsset/EBD21D757D188EF1FB59019F88B577F5/archive.zip",
      source_hash: "EBD21D757D188EF1FB59019F88B577F5",
    });

    // expect(stack.resolve(entry!.data)).toEqual({
    //   path: SAMPLE_ASSET_DIR,
    //   id: "EBD21D757D188EF1FB59019F88B577F5",
    //   packaging: "zip",
    //   sourceHash:
    //     "EBD21D757D188EF1FB59019F88B577F5",
    //   s3BucketParameter:
    //     "AssetParametersEBD21D757D188EF1FB59019F88B577F5S3Bucket50B5A10B",
    //   s3KeyParameter:
    //     "AssetParametersEBD21D757D188EF1FB59019F88B577F5S3VersionKey1F7D75F9",
    //   artifactHashParameter:
    //     "AssetParametersEBD21D757D188EF1FB59019F88B577F5ArtifactHash220DE9BD",
    // });

    // expect(
    //   template.Parameters
    //     .AssetParametersEBD21D757D188EF1FB59019F88B577F5S3Bucket50B5A10B
    //     .Type,
    // ).toBe("String");
    // expect(
    //   template.Parameters
    //     .AssetParametersEBD21D757D188EF1FB59019F88B577F5S3VersionKey1F7D75F9
    //     .Type,
    // ).toBe("String");
  });

  // test("verify that the app resolves tokens in metadata", () => {
  //   // context: {
  //   //   [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false,
  //   // },
  //   const dirPath = path.resolve(__dirname, "sample-asset-directory");

  //   new Asset(stack, "MyAsset", {
  //     path: dirPath,
  //   });

  //   const template = new Template(stack);
  //   template.expect.toHaveResourceWithProperties(s3Object.S3Object, {
  //     path: "asset.EBD21D757D188EF1FB59019F88B577F5",
  //   });
  //   // expect(meta["/my-stack"][0].data).toEqual({
  //   //   path: "asset.EBD21D757D188EF1FB59019F88B577F5",
  //   //   id: "EBD21D757D188EF1FB59019F88B577F5",
  //   //   packaging: "zip",
  //   //   sourceHash:
  //   //     "EBD21D757D188EF1FB59019F88B577F5",
  //   //   s3BucketParameter:
  //   //     "AssetParametersEBD21D757D188EF1FB59019F88B577F5S3Bucket50B5A10B",
  //   //   s3KeyParameter:
  //   //     "AssetParametersEBD21D757D188EF1FB59019F88B577F5S3VersionKey1F7D75F9",
  //   //   artifactHashParameter:
  //   //     "AssetParametersEBD21D757D188EF1FB59019F88B577F5ArtifactHash220DE9BD",
  //   // });
  // });

  test('"file" assets', () => {
    // context: {
    //   [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false,
    // },
    const filePath = path.join(__dirname, "file-asset.txt");
    new Asset(stack, "MyAsset", { path: filePath });

    const template = new Template(stack);
    template.expect.toHaveResourceWithProperties(s3Object.S3Object, {
      bucket: "${aws_s3_bucket.AssetBucket.bucket}",
      content_type: "text/plain; charset=utf-8",
      key: "0051B3AA83C727C8CB33FF664C20796E.txt",
      // path: "asset.0051B3AA83C727C8CB33FF664C20796E.txt",
      source:
        "assets/FileAsset/0051B3AA83C727C8CB33FF664C20796E/asset.0051B3AA83C727C8CB33FF664C20796E.txt",
      source_hash: "0051B3AA83C727C8CB33FF664C20796E",
    });

    // expect(stack.resolve(entry!.data)).toEqual({
    //   path: "asset.0051B3AA83C727C8CB33FF664C20796E.txt",
    //   packaging: "file",
    //   id: "0051B3AA83C727C8CB33FF664C20796E",
    //   sourceHash:
    //     "0051B3AA83C727C8CB33FF664C20796E",
    //   s3BucketParameter:
    //     "AssetParameters0051B3AA83C727C8CB33FF664C20796ES3Bucket2C60F94A",
    //   s3KeyParameter:
    //     "AssetParameters0051B3AA83C727C8CB33FF664C20796ES3VersionKey9482DC35",
    //   artifactHashParameter:
    //     "AssetParameters0051B3AA83C727C8CB33FF664C20796EArtifactHash22BFFA67",
    // });

    // // verify that now the template contains parameters for this asset
    // expect(
    //   template.findParameters(
    //     "AssetParameters0051B3AA83C727C8CB33FF664C20796ES3Bucket2C60F94A",
    //   )
    //     .AssetParameters0051B3AA83C727C8CB33FF664C20796ES3Bucket2C60F94A
    //     .Type,
    // ).toBe("String");
    // expect(
    //   template.findParameters(
    //     "AssetParameters0051B3AA83C727C8CB33FF664C20796ES3VersionKey9482DC35",
    //   )
    //     .AssetParameters0051B3AA83C727C8CB33FF664C20796ES3VersionKey9482DC35
    //     .Type,
    // ).toBe("String");
  });

  test('"readers" or "grantRead" can be used to grant read permissions on the asset to a principal', () => {
    // context: {
    //   [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false,
    // },

    const user = new iam.User(stack, "MyUser");
    const group = new iam.Group(stack, "MyGroup");

    const asset = new Asset(stack, "MyAsset", {
      path: path.join(__dirname, "sample-asset-directory"),
      readers: [user],
    });

    asset.grantRead(group);

    const template = new Template(stack);

    template.expect.toHaveDataSourceWithProperties(
      dataAwsIamPolicyDocument.DataAwsIamPolicyDocument,
      {
        statement: [
          {
            actions: ["s3:GetObject*", "s3:GetBucket*", "s3:List*"],
            effect: "Allow",
            resources: [
              "arn:${data.aws_partition.Partitition.partition}:s3:::${aws_s3_bucket.AssetBucket.bucket}",
              "arn:${data.aws_partition.Partitition.partition}:s3:::${aws_s3_bucket.AssetBucket.bucket}/*",
            ],
          },
        ],
      },
    );
    template.expect.toHaveResourceWithProperties(iamUserPolicy.IamUserPolicy, {
      user: stack.resolve(user.userName),
      policy:
        "${data.aws_iam_policy_document.MyUser_DefaultPolicy_F49DB418.json}",
    });
    template.expect.toHaveResourceWithProperties(
      iamGroupPolicy.IamGroupPolicy,
      {
        group: stack.resolve(group.groupName),
        policy:
          "${data.aws_iam_policy_document.MyGroup_DefaultPolicy_C4EFEE82.json}",
      },
    );
  });

  test("fails if path is empty", () => {
    expect(
      () =>
        new Asset(stack, "MyDirectory", {
          path: "",
        }),
    ).toThrow(/Asset path cannot be empty/);
  });

  test("fails if directory not found", () => {
    expect(
      () =>
        new Asset(stack, "MyDirectory", {
          path: "/path/not/found/" + Math.random() * 999999,
        }),
    ).toThrow(/Cannot find asset/);
  });

  test("multiple assets under the same parent", () => {
    // WHEN
    expect(
      () =>
        new Asset(stack, "MyDirectory1", {
          path: path.join(__dirname, "sample-asset-directory"),
        }),
    ).not.toThrow();
    expect(
      () =>
        new Asset(stack, "MyDirectory2", {
          path: path.join(__dirname, "sample-asset-directory"),
        }),
    ).not.toThrow();
  });

  test("isFile indicates if the asset represents a single file", () => {
    // WHEN
    const directoryAsset = new Asset(stack, "SampleAssetDirectory", {
      path: path.join(__dirname, "sample-asset-directory"),
    });

    // TODO: The AWS AssetManager uses "FileAsset" as the id for file assets,
    // users will get confused when they get an error that the id is already in use?
    // const fileAsset = new Asset(stack, "FileAsset", {
    const fileAsset = new Asset(stack, "SampleAssetFile", {
      path: path.join(
        __dirname,
        "sample-asset-directory",
        "sample-asset-file.txt",
      ),
    });

    // THEN
    expect(directoryAsset.isFile).toBe(false);
    expect(fileAsset.isFile).toBe(true);
  });

  test("isZipArchive indicates if the asset represents a .zip file (either explicitly or via ZipDirectory packaging)", () => {
    // WHEN
    const nonZipAsset = new Asset(stack, "NonZipAsset", {
      path: path.join(
        __dirname,
        "sample-asset-directory",
        "sample-asset-file.txt",
      ),
    });

    const zipDirectoryAsset = new Asset(stack, "ZipDirectoryAsset", {
      path: path.join(__dirname, "sample-asset-directory"),
    });

    const zipFileAsset = new Asset(stack, "ZipFileAsset", {
      path: path.join(
        __dirname,
        "sample-asset-directory",
        "sample-zip-asset.zip",
      ),
    });

    const jarFileAsset = new Asset(stack, "JarFileAsset", {
      path: path.join(
        __dirname,
        "sample-asset-directory",
        "sample-jar-asset.jar",
      ),
    });

    // THEN
    expect(nonZipAsset.isZipArchive).toBe(false);
    expect(zipDirectoryAsset.isZipArchive).toBe(true);
    expect(zipFileAsset.isZipArchive).toBe(true);
    expect(jarFileAsset.isZipArchive).toBe(true);
  });

  // test("addResourceMetadata can be used to add CFN metadata to resources", () => {
  //   // GIVEN
  //   stack.node.setContext(cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT, true);

  //   const location = path.join(__dirname, "sample-asset-directory");
  //   const resource = new cdk.CfnResource(stack, "MyResource", {
  //     type: "My::Resource::Type",
  //   });
  //   const asset = new Asset(stack, "MyAsset", { path: location });

  //   // WHEN
  //   asset.addResourceMetadata(resource, "PropName");

  //   // THEN
  //   Template.fromStack(stack).hasResource("My::Resource::Type", {
  //     Metadata: {
  //       "aws:asset:path":
  //         "asset.EBD21D757D188EF1FB59019F88B577F5",
  //       "aws:asset:is-bundled": false,
  //       "aws:asset:property": "PropName",
  //     },
  //   });
  // });

  // test("asset metadata is only emitted if ASSET_RESOURCE_METADATA_ENABLED_CONTEXT is defined", () => {
  //   const resource = new cdk.CfnResource(stack, "MyResource", {
  //     type: "My::Resource::Type",
  //   });
  //   const asset = new Asset(stack, "MyAsset", { path: SAMPLE_ASSET_DIR });

  //   // WHEN
  //   asset.addResourceMetadata(resource, "PropName");

  //   // THEN
  //   Template.fromStack(stack).hasResource(
  //     "My::Resource::Type",
  //     Match.not({
  //       Metadata: {
  //         "aws:asset:path": SAMPLE_ASSET_DIR,
  //         "aws:asset:is-bundled": false,
  //         "aws:asset:property": "PropName",
  //       },
  //     }),
  //   );
  // });

  // test("nested assemblies share assets: legacy synth edition", () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack1 = new cdk.Stack(new cdk.Stage(app, "Stage1"), "Stack", {
  //     synthesizer: new cdk.LegacyStackSynthesizer(),
  //   });
  //   const stack2 = new cdk.Stack(new cdk.Stage(app, "Stage2"), "Stack", {
  //     synthesizer: new cdk.LegacyStackSynthesizer(),
  //   });

  //   // WHEN
  //   new Asset(stack1, "MyAsset", { path: SAMPLE_ASSET_DIR });
  //   new Asset(stack2, "MyAsset", { path: SAMPLE_ASSET_DIR });

  //   // THEN
  //   const assembly = app.synth();

  //   // Read the assets from the stack metadata
  //   for (const stageName of ["Stage1", "Stage2"]) {
  //     const stackArtifact = assembly
  //       .getNestedAssembly(`assembly-${stageName}`)
  //       .artifacts.filter(isStackArtifact)[0];
  //     const assetMeta = stackArtifact.findMetadataByType(
  //       cxschema.ArtifactMetadataEntryType.ASSET,
  //     );
  //     expect(assetMeta[0]).toEqual(
  //       expect.objectContaining({
  //         data: expect.objectContaining({
  //           packaging: "zip",
  //           path: `../asset.${SAMPLE_ASSET_HASH}`,
  //         }),
  //       }),
  //     );
  //   }
  // });

  // test("nested assemblies share assets: default synth edition", () => {
  //   // GIVEN
  //   const app = new cdk.App();
  //   const stack1 = new cdk.Stack(new cdk.Stage(app, "Stage1"), "Stack", {
  //     synthesizer: new cdk.DefaultStackSynthesizer(),
  //   });
  //   const stack2 = new cdk.Stack(new cdk.Stage(app, "Stage2"), "Stack", {
  //     synthesizer: new cdk.DefaultStackSynthesizer(),
  //   });

  //   // WHEN
  //   new Asset(stack1, "MyAsset", { path: SAMPLE_ASSET_DIR });
  //   new Asset(stack2, "MyAsset", { path: SAMPLE_ASSET_DIR });

  //   // THEN
  //   const assembly = app.synth();

  //   // Read the asset manifests to verify the file paths
  //   for (const stageName of ["Stage1", "Stage2"]) {
  //     const manifestArtifact = assembly
  //       .getNestedAssembly(`assembly-${stageName}`)
  //       .artifacts.filter(
  //         cxapi.AssetManifestArtifact.isAssetManifestArtifact,
  //       )[0];
  //     const manifest = JSON.parse(
  //       fs.readFileSync(manifestArtifact.file, { encoding: "utf-8" }),
  //     );

  //     expect(manifest.files[SAMPLE_ASSET_HASH].source).toEqual({
  //       packaging: "zip",
  //       path: `../asset.${SAMPLE_ASSET_HASH}`,
  //     });
  //   }
  // });

  // describe("staging", () => {
  //   test("copy file assets under <outdir>/${fingerprint}.ext", () => {
  //     const tempdir = mkdtempSync();
  //     process.chdir(tempdir); // change current directory to somewhere in /tmp

  //     // GIVEN
  //     const app = new cdk.App({ outdir: tempdir });
  //     const stack = new cdk.Stack(app, "stack");

  //     // WHEN
  //     new Asset(stack, "ZipFile", {
  //       path: path.join(SAMPLE_ASSET_DIR, "sample-zip-asset.zip"),
  //     });

  //     new Asset(stack, "TextFile", {
  //       path: path.join(SAMPLE_ASSET_DIR, "sample-asset-file.txt"),
  //     });

  //     // THEN
  //     app.synth();
  //     expect(fs.existsSync(tempdir)).toBe(true);
  //     expect(
  //       fs.existsSync(
  //         path.join(
  //           tempdir,
  //           "asset.a7a79cdf84b802ea8b198059ff899cffc095a1b9606e919f98e05bf80779756b.zip",
  //         ),
  //       ),
  //     ).toBe(true);
  //   });

  //   test("copy directory under .assets/fingerprint/**", () => {
  //     const tempdir = mkdtempSync();
  //     process.chdir(tempdir); // change current directory to somewhere in /tmp

  //     // GIVEN
  //     const app = new cdk.App({ outdir: tempdir });
  //     const stack = new cdk.Stack(app, "stack");

  //     // WHEN
  //     new Asset(stack, "ZipDirectory", {
  //       path: SAMPLE_ASSET_DIR,
  //     });

  //     // THEN
  //     app.synth();
  //     expect(fs.existsSync(tempdir)).toBe(true);
  //     const hash =
  //       "asset.EBD21D757D188EF1FB59019F88B577F5";
  //     expect(
  //       fs.existsSync(path.join(tempdir, hash, "sample-asset-file.txt")),
  //     ).toBe(true);
  //     expect(
  //       fs.existsSync(path.join(tempdir, hash, "sample-jar-asset.jar")),
  //     ).toBe(true);
  //     expect(() => fs.readdirSync(tempdir)).not.toThrow();
  //   });

  //   test("staging path is relative if the dir is below the working directory", () => {
  //     // GIVEN
  //     const tempdir = mkdtempSync();
  //     process.chdir(tempdir); // change current directory to somewhere in /tmp

  //     const staging = ".my-awesome-staging-directory";
  //     const app = new cdk.App({
  //       outdir: staging,
  //       context: {
  //         [cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT]: "true",
  //       },
  //     });

  //     const stack = new cdk.Stack(app, "stack");

  //     const resource = new cdk.CfnResource(stack, "MyResource", {
  //       type: "My::Resource::Type",
  //     });
  //     const asset = new Asset(stack, "MyAsset", { path: SAMPLE_ASSET_DIR });

  //     // WHEN
  //     asset.addResourceMetadata(resource, "PropName");

  //     const template = Template.fromStack(stack);
  //     expect(
  //       template.findResources("My::Resource::Type").MyResource.Metadata,
  //     ).toEqual({
  //       "aws:asset:path":
  //         "asset.EBD21D757D188EF1FB59019F88B577F5",
  //       "aws:asset:is-bundled": false,
  //       "aws:asset:property": "PropName",
  //     });
  //   });

  //   test("if staging is disabled, asset path is absolute", () => {
  //     // GIVEN
  //     const staging = path.resolve(mkdtempSync());
  //     const app = new cdk.App({
  //       outdir: staging,
  //       context: {
  //         [cxapi.DISABLE_ASSET_STAGING_CONTEXT]: "true",
  //         [cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT]: "true",
  //       },
  //     });

  //     const stack = new cdk.Stack(app, "stack");

  //     const resource = new cdk.CfnResource(stack, "MyResource", {
  //       type: "My::Resource::Type",
  //     });
  //     const asset = new Asset(stack, "MyAsset", { path: SAMPLE_ASSET_DIR });

  //     // WHEN
  //     asset.addResourceMetadata(resource, "PropName");

  //     const template = Template.fromStack(stack);
  //     expect(
  //       template.findResources("My::Resource::Type").MyResource.Metadata,
  //     ).toEqual({
  //       "aws:asset:path": SAMPLE_ASSET_DIR,
  //       "aws:asset:is-bundled": false,
  //       "aws:asset:property": "PropName",
  //     });
  //   });

  //   test("cdk metadata points to staged asset", () => {
  //     // GIVEN
  //     const app = new cdk.App({
  //       context: {
  //         [cxapi.NEW_STYLE_STACK_SYNTHESIS_CONTEXT]: false,
  //       },
  //     });
  //     const stack = new cdk.Stack(app, "stack");
  //     new Asset(stack, "MyAsset", { path: SAMPLE_ASSET_DIR });

  //     // WHEN
  //     const session = app.synth();
  //     const artifact = session.getStackByName(stack.stackName);
  //     const metadata = artifact.manifest.metadata || {};
  //     const md = Object.values(metadata)[0]![0]!
  //       .data as cxschema.AssetMetadataEntry;
  //     expect(md.path).toBe(
  //       "asset.EBD21D757D188EF1FB59019F88B577F5",
  //     );
  //   });
  // });
});

// function mkdtempSync() {
//   return fs.mkdtempSync(path.join(os.tmpdir(), "assets.test"));
// }

// function isStackArtifact(x: any): x is cxapi.CloudFormationStackArtifact {
//   return x instanceof cxapi.CloudFormationStackArtifact;
// }
