// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-s3-assets/test/asset.test.ts

// import * as fs from "fs";
// import * as os from "os";
import * as path from "path";
import {
  dataAwsIamPolicyDocument,
  iamGroupPolicy,
  iamUserPolicy,
  s3Object,
} from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../../src/aws/aws-stack";
import * as iam from "../../../../src/aws/iam";
import { Asset } from "../../../../src/aws/storage/assets/s3";
import { Template } from "../../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

const SAMPLE_ASSET_DIR = path.join(__dirname, "sample-asset-directory");
// const SAMPLE_ASSET_HASH =
//   "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2";

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
    stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
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
      // path: "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
      bucket: "${aws_s3_bucket.AssetBucket.bucket}",
      key: "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2.zip",
      source:
        "assets/FileAsset/6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2/archive.zip",
      source_hash:
        "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
    });

    // expect(stack.resolve(entry!.data)).toEqual({
    //   path: SAMPLE_ASSET_DIR,
    //   id: "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
    //   packaging: "zip",
    //   sourceHash:
    //     "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
    //   s3BucketParameter:
    //     "AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2S3Bucket50B5A10B",
    //   s3KeyParameter:
    //     "AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2S3VersionKey1F7D75F9",
    //   artifactHashParameter:
    //     "AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2ArtifactHash220DE9BD",
    // });

    // expect(
    //   template.Parameters
    //     .AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2S3Bucket50B5A10B
    //     .Type,
    // ).toBe("String");
    // expect(
    //   template.Parameters
    //     .AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2S3VersionKey1F7D75F9
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
  //     path: "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
  //   });
  //   // expect(meta["/my-stack"][0].data).toEqual({
  //   //   path: "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
  //   //   id: "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
  //   //   packaging: "zip",
  //   //   sourceHash:
  //   //     "6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
  //   //   s3BucketParameter:
  //   //     "AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2S3Bucket50B5A10B",
  //   //   s3KeyParameter:
  //   //     "AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2S3VersionKey1F7D75F9",
  //   //   artifactHashParameter:
  //   //     "AssetParameters6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2ArtifactHash220DE9BD",
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
      key: "78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197.txt",
      // path: "asset.78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197.txt",
      source:
        "assets/FileAsset/78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197/asset.78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197.txt",
      source_hash:
        "78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197",
    });

    // expect(stack.resolve(entry!.data)).toEqual({
    //   path: "asset.78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197.txt",
    //   packaging: "file",
    //   id: "78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197",
    //   sourceHash:
    //     "78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197",
    //   s3BucketParameter:
    //     "AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197S3Bucket2C60F94A",
    //   s3KeyParameter:
    //     "AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197S3VersionKey9482DC35",
    //   artifactHashParameter:
    //     "AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197ArtifactHash22BFFA67",
    // });

    // // verify that now the template contains parameters for this asset
    // expect(
    //   template.findParameters(
    //     "AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197S3Bucket2C60F94A",
    //   )
    //     .AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197S3Bucket2C60F94A
    //     .Type,
    // ).toBe("String");
    // expect(
    //   template.findParameters(
    //     "AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197S3VersionKey9482DC35",
    //   )
    //     .AssetParameters78add9eaf468dfa2191da44a7da92a21baba4c686cf6053d772556768ef21197S3VersionKey9482DC35
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
  //         "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
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
  //       "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2";
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
  //         "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
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
  //       "asset.6b84b87243a4a01c592d78e1fd3855c4bfef39328cd0a450cc97e81717fea2a2",
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
