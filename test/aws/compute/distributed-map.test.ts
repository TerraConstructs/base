import { Testing } from "cdktf";
import { render } from "./private/render-util";
import { compute, storage, AwsSpec } from "../../../src/aws";
import "cdktf/lib/testing/adapters/jest";
import { CsvHeaders } from "../../../src/aws/compute/states/distributed-map/item-reader";
import { Annotations } from "../../assertions";

const gridUUID = "123e4567-e89b-12d3";

describe("Distributed Map State", () => {
  test("DistributedMap isDistributedMap", () => {
    // GIVEN
    const app = Testing.app();
    const spec = new AwsSpec(app, `TestSpec`, {
      environmentName: "Test",
      gridUUID,
      providerConfig: {
        region: "us-east-1",
      },
      gridBackendConfig: {
        address: "http://localhost:3000",
      },
    });

    //WHEN
    const map = new compute.DistributedMap(spec, "Map State", {
      maxConcurrency: 1,
      itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      itemSelector: {
        foo: "foo",
        bar: compute.JsonPath.stringAt("$.bar"),
      },
    });

    // THEN
    expect(() => {
      compute.DistributedMap.isDistributedMap(map);
    }).toBeTruthy();
  });

  describe("State Machine With Distributed Map State", () => {
    let spec: AwsSpec;
    beforeEach(() => {
      // GIVEN
      const app = Testing.app();
      spec = new AwsSpec(app, `TestSpec`, {
        environmentName: "Test",
        gridUUID,
        providerConfig: {
          region: "us-east-1",
        },
        gridBackendConfig: {
          address: "http://localhost:3000",
        },
      });
    });

    test("simple", () => {
      // WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      // THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemsPath: "$.inputForMap",
            MaxConcurrency: 1,
          },
        },
      });
    });

    test("with ResultPath", () => {
      // WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
        resultPath: compute.JsonPath.DISCARD,
      });
      map.itemProcessor(
        new compute.Pass(spec, "Pass State", {
          resultPath: compute.JsonPath.DISCARD,
        }),
      );

      // THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                  ResultPath: null,
                },
              },
            },
            ItemsPath: "$.inputForMap",
            MaxConcurrency: 1,
            ResultPath: null,
          },
        },
      });
    });

    test("and ResultSelector", () => {
      // WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
        resultSelector: {
          buz: "buz",
          baz: compute.JsonPath.stringAt("$.baz"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      // THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemsPath: "$.inputForMap",
            MaxConcurrency: 1,
            ResultSelector: {
              buz: "buz",
              "baz.$": "$.baz",
            },
          },
        },
      });
    });

    test("and S3ObjectsItemReader", () => {
      // GIVEN
      const readerBucket = new storage.Bucket(spec, "TestBucket");

      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemReader: new compute.S3ObjectsItemReader({
          bucket: readerBucket,
          prefix: "test",
          maxItems: 10,
        }),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemReader: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:listObjectsV2",
              ReaderConfig: {
                MaxItems: 10,
              },
              Parameters: {
                Bucket: "${aws_s3_bucket.TestBucket_560B80BC.bucket}",
                Prefix: "test",
              },
            },
            MaxConcurrency: 1,
          },
        },
      });
    });

    test("and S3JsonItemReader", () => {
      // GIVEN
      const readerBucket = new storage.Bucket(spec, "TestBucket");

      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemReader: new compute.S3JsonItemReader({
          bucket: readerBucket,
          key: "test.json",
        }),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemReader: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Parameters: {
                Bucket: "${aws_s3_bucket.TestBucket_560B80BC.bucket}",
                Key: "test.json",
              },
            },
            MaxConcurrency: 1,
          },
        },
      });
    });

    test("and First Row S3CsvItemReader", () => {
      // GIVEN
      const readerBucket = new storage.Bucket(spec, "TestBucket");

      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemReader: new compute.S3CsvItemReader({
          bucket: readerBucket,
          key: "test.csv",
          csvHeaders: CsvHeaders.useFirstRow(),
        }),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemReader: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:getObject",
              ReaderConfig: {
                InputType: "CSV",
                CSVHeaderLocation: "FIRST_ROW",
              },
              Parameters: {
                Bucket: "${aws_s3_bucket.TestBucket_560B80BC.bucket}",
                Key: "test.csv",
              },
            },
            MaxConcurrency: 1,
          },
        },
      });
    });

    test("and Given S3CsvItemReader", () => {
      // GIVEN
      const readerBucket = new storage.Bucket(spec, "TestBucket");

      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemReader: new compute.S3CsvItemReader({
          bucket: readerBucket,
          key: "test.json",
          csvHeaders: CsvHeaders.use(["header1", "header2"]),
        }),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemReader: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:getObject",
              ReaderConfig: {
                InputType: "CSV",
                CSVHeaderLocation: "GIVEN",
                CSVHeaders: ["header1", "header2"],
              },
              Parameters: {
                Bucket: "${aws_s3_bucket.TestBucket_560B80BC.bucket}",
                Key: "test.json",
              },
            },
            MaxConcurrency: 1,
          },
        },
      });
    });

    test("and S3ManifestItemReader", () => {
      // GIVEN
      const readerBucket = new storage.Bucket(spec, "TestBucket");

      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemReader: new compute.S3ManifestItemReader({
          bucket: readerBucket,
          key: "manifest.json",
        }),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemReader: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:getObject",
              ReaderConfig: {
                InputType: "MANIFEST",
              },
              Parameters: {
                Bucket: "${aws_s3_bucket.TestBucket_560B80BC.bucket}",
                Key: "manifest.json",
              },
            },
            MaxConcurrency: 1,
          },
        },
      });
    });

    test(", ItemReader and BucketNamePath", () => {
      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        itemReader: new compute.S3ManifestItemReader({
          bucketNamePath: compute.JsonPath.stringAt("$.bucketName"),
          bucketNameScope: spec,
          key: compute.JsonPath.stringAt("$.key"),
        }),
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemReader: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:getObject",
              ReaderConfig: {
                InputType: "MANIFEST",
              },
              Parameters: {
                "Bucket.$": "$.bucketName",
                "Key.$": "$.key",
              },
            },
          },
        },
      });
    });

    test("and ResultWriter", () => {
      // GIVEN
      const writerBucket = new storage.Bucket(spec, "TestBucket");

      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        maxConcurrency: 1,
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
        itemSelector: {
          foo: "foo",
          bar: compute.JsonPath.stringAt("$.bar"),
        },
        resultWriter: new compute.ResultWriter({
          bucket: writerBucket,
          prefix: "test",
        }),
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemSelector: {
              foo: "foo",
              "bar.$": "$.bar",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemsPath: "$.inputForMap",
            ResultWriter: {
              Resource:
                "arn:${data.aws_partition.Partitition.partition}:states:::s3:putObject",
              Parameters: {
                Bucket: "${aws_s3_bucket.TestBucket_560B80BC.bucket}",
                Prefix: "test",
              },
            },
            MaxConcurrency: 1,
          },
        },
      });
    });

    test("Path Properties", () => {
      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
        mapExecutionType: compute.StateMachineType.EXPRESS,
        toleratedFailurePercentagePath: compute.JsonPath.stringAt(
          "$.toleratedFailurePercentage",
        ),
        toleratedFailureCountPath: compute.JsonPath.stringAt(
          "$.toleratedFailureCount",
        ),
        itemBatcher: new compute.ItemBatcher({
          maxItemsPerBatchPath: compute.JsonPath.stringAt("$.maxItemsPerBatch"),
          maxInputBytesPerBatchPath: compute.JsonPath.stringAt(
            "$.maxInputBytesPerBatch",
          ),
        }),
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.EXPRESS,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemsPath: "$.inputForMap",
            ToleratedFailurePercentagePath: "$.toleratedFailurePercentage",
            ToleratedFailureCountPath: "$.toleratedFailureCount",
            ItemBatcher: {
              MaxItemsPerBatchPath: "$.maxItemsPerBatch",
              MaxInputBytesPerBatchPath: "$.maxInputBytesPerBatch",
            },
          },
        },
      });
    });

    test("Number Properties", () => {
      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
        mapExecutionType: compute.StateMachineType.EXPRESS,
        toleratedFailurePercentage: 100,
        toleratedFailureCount: 101,
        label: "testLabel",
        itemBatcher: new compute.ItemBatcher({
          maxItemsPerBatch: 10,
          maxInputBytesPerBatch: 11,
          batchInput: {
            Test: "test",
          },
        }),
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"));

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.EXPRESS,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            ItemsPath: "$.inputForMap",
            ToleratedFailurePercentage: 100,
            ToleratedFailureCount: 101,
            Label: "testLabel",
            ItemBatcher: {
              BatchInput: {
                Test: "test",
              },
              MaxItemsPerBatch: 10,
              MaxInputBytesPerBatch: 11,
            },
          },
        },
      });
    });

    test("does not throw while accessing bucket of itemReader which was initialised with bucket", () => {
      const bucket = new storage.Bucket(spec, "TestBucket");
      const itemReader = new compute.S3JsonItemReader({
        bucket,
        key: "test.json",
      });

      expect(itemReader.bucket).toStrictEqual(bucket);
    });

    test("should use default mapExecutionType and ignore itemProcessor executionType", () => {
      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {});
      map.itemProcessor(new compute.Pass(spec, "Pass State"), {
        mode: compute.ProcessorMode.DISTRIBUTED,
        executionType: compute.ProcessorType.EXPRESS,
      });

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.STANDARD,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
          },
        },
      });

      Annotations.fromStack(spec).hasWarnings({
        constructPath: "TestSpec/Map State",
        message:
          /Property 'ProcessorConfig.executionType' is ignored, use the 'mapExecutionType' in the 'DistributedMap' class instead./,
      });
      // Annotations.fromStack(spec).hasWarning(
      //   "/Default/Map State",
      //   Match.stringLikeRegexp(
      //     "Property 'ProcessorConfig.executionType' is ignored, use the 'mapExecutionType' in the 'DistributedMap' class instead.",
      //   ),
      // );
    });

    test("should use configured mapExecutionType and ignore itemProcessor executionType", () => {
      //WHEN
      const map = new compute.DistributedMap(spec, "Map State", {
        mapExecutionType: compute.StateMachineType.EXPRESS,
      });
      map.itemProcessor(new compute.Pass(spec, "Pass State"), {
        mode: compute.ProcessorMode.DISTRIBUTED,
        executionType: compute.ProcessorType.STANDARD,
      });

      //THEN
      expect(render(spec, map)).toStrictEqual({
        StartAt: "Map State",
        States: {
          "Map State": {
            Type: "Map",
            End: true,
            ItemProcessor: {
              ProcessorConfig: {
                Mode: compute.ProcessorMode.DISTRIBUTED,
                ExecutionType: compute.StateMachineType.EXPRESS,
              },
              StartAt: "Pass State",
              States: {
                "Pass State": {
                  Type: "Pass",
                  End: true,
                },
              },
            },
          },
        },
      });

      Annotations.fromStack(spec).hasWarnings({
        constructPath: "TestSpec/Map State",
        message:
          /Property 'ProcessorConfig.executionType' is ignored, use the 'mapExecutionType' in the 'DistributedMap' class instead./,
      });
      // Annotations.fromStack(spec).hasWarning(
      //   "/Default/Map State",
      //   Match.stringLikeRegexp(
      //     "Property 'ProcessorConfig.executionType' is ignored, use the 'mapExecutionType' in the 'DistributedMap' class instead.",
      //   ),
      // );
    });

    test("should throw if itemReader contains neither bucket nor bucketNamePath", () => {
      // TODO: Improve this error message?
      expect(
        () =>
          new compute.DistributedMap(spec, "Map State", {
            itemReader: new compute.S3JsonItemReader({
              key: "test.json",
            }),
          }),
      ).toThrow(/Cannot determine partition/);
    });
  });

  test("synth is successful", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        maxConcurrency: 1,
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      });
      map.itemProcessor(new compute.Pass(stack, "Pass State"));
      return map;
    });

    // synth with validations
    Testing.synth(spec, true);
  });

  test("fails in synthesis if itemsPath and itemReader", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        itemReader: new compute.S3JsonItemReader({
          bucket: new storage.Bucket(stack, "TestBucket"),
          key: "test.json",
        }),
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      });

      return map;
    });

    expect(() => Testing.synth(spec, true)).toThrow(
      /Provide either `itemsPath` or `itemReader`, but not both/,
    );
  });

  test("fails in synthesis if itemReader contains both bucket and bucketNamePath", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        itemReader: new compute.S3JsonItemReader({
          bucket: new storage.Bucket(stack, "TestBucket"),
          bucketNamePath: compute.JsonPath.stringAt("$.bucketName"),
          key: "test.json",
        }),
      });

      return map;
    });

    expect(() => Testing.synth(spec, true)).toThrow(
      /Provide either `bucket` or `bucketNamePath` and `bucketNameScope`, but not both/,
    );
  });

  // // This is now thrown when S3JsonItemReader is created instead of synth time
  // test("fails in synthesis if itemReader contains neither bucket nor bucketNamePath", () => {
  //   const spec = createStackWithMap((stack) => {
  //     const map = new compute.DistributedMap(stack, "Map State", {
  //       itemReader: new compute.S3JsonItemReader({
  //         key: "test.json",
  //       }),
  //     });

  //     return map;
  //   });

  //   expect(() => Testing.synth(spec, true)).toThrow(
  //     /Provide either `bucket` or `bucketNamePath`/,
  //   );
  // });

  test("fails in synthesis if ItemProcessor is in INLINE mode", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        maxConcurrency: 1,
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      });
      map.itemProcessor(new compute.Pass(stack, "Pass State"), {
        mode: compute.ProcessorMode.INLINE,
      });
      return map;
    });

    expect(() => Testing.synth(spec, true)).toThrow(
      /Processing mode cannot be `INLINE` for a Distributed Map/,
    );
  });

  test("fails in synthesis if label is too long", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        label: "a".repeat(45),
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      });

      return map;
    });

    expect(() => Testing.synth(spec, true)).toThrow(
      /label must be 40 characters or less/,
    );
  });

  test("fails in synthesis if label has special characters", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        label: "this is invalid?",
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      });

      return map;
    });

    expect(() => Testing.synth(spec, true)).toThrow(
      /label cannot contain any whitespace or special characters/,
    );
  });

  test("does not fail in synthesis if label has `s`", () => {
    const spec = createStackWithMap((stack) => {
      const map = new compute.DistributedMap(stack, "Map State", {
        label: "s",
        itemsPath: compute.JsonPath.stringAt("$.inputForMap"),
      });

      return map;
    });

    Testing.synth(spec, true);
  });
});

// function render(sm: compute.IChainable) {
//   return new AwsSpec().resolve(
//     new compute.StateGraph(sm.startState, "Test Graph").toGraphJson(),
//   );
// }

function createStackWithMap(
  mapFactory: (spec: AwsSpec) => compute.DistributedMap,
) {
  const app = Testing.app();
  const spec = new AwsSpec(app, `TestSpec`, {
    environmentName: "Test",
    gridUUID,
    providerConfig: {
      region: "us-east-1",
    },
    gridBackendConfig: {
      address: "http://localhost:3000",
    },
  });
  const map = mapFactory(spec);
  new compute.StateGraph(map, "Test Graph");
  return spec;
}
