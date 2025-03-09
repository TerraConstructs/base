// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/test/placement-group.test.ts

import { placementGroup as tfPlacementGroup } from "@cdktf/provider-aws";
import { App, Testing } from "cdktf";
import "cdktf/lib/testing/adapters/jest";
import { AwsStack } from "../../../src/aws";
import {
  PlacementGroup,
  PlacementGroupSpreadLevel,
  PlacementGroupStrategy,
} from "../../../src/aws/compute";
import { Template } from "../../assertions";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const gridBackendConfig = {
  address: "http://localhost:3000",
};
const providerConfig = { region: "us-east-1" };

describe("placement group", () => {
  let app: App;
  let stack: AwsStack;

  beforeEach(() => {
    app = Testing.app();
    stack = new AwsStack(app, "MyStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
  });
  test("can configure empty placement group", () => {
    // GIVEN
    // WHEN
    new PlacementGroup(stack, "placementgroup");

    // THEN
    Template.synth(stack).toHaveResource(tfPlacementGroup.PlacementGroup);
  });

  test("only specifying partitions => strategy is PARTITION", () => {
    // GIVEN
    // WHEN
    new PlacementGroup(stack, "placementgroup", {
      partitions: 5,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfPlacementGroup.PlacementGroup,
      {
        partition_count: 5,
        strategy: PlacementGroupStrategy.PARTITION,
      },
    );
  });

  test("only specifying spreadLevel => strategy is SPREAD", () => {
    // GIVEN
    // WHEN
    new PlacementGroup(stack, "placementgroup", {
      spreadLevel: PlacementGroupSpreadLevel.HOST,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfPlacementGroup.PlacementGroup,
      {
        strategy: "spread",
      },
    );
  });

  test("placement group respects spreadLevel", () => {
    // GIVEN
    // WHEN
    new PlacementGroup(stack, "placementgroup", {
      spreadLevel: PlacementGroupSpreadLevel.HOST,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfPlacementGroup.PlacementGroup,
      {
        spread_level: "host",
      },
    );
  });

  test("placement group respects strategy", () => {
    // GIVEN
    new PlacementGroup(stack, "placementgroup", {
      strategy: PlacementGroupStrategy.SPREAD,
    });

    // THEN
    Template.synth(stack).toHaveResourceWithProperties(
      tfPlacementGroup.PlacementGroup,
      {
        strategy: PlacementGroupStrategy.SPREAD,
      },
    );
  });

  test("placement group throws if the CLUSTER strategy is used with partitions", () => {
    // GIVEN
    expect(
      () =>
        new PlacementGroup(stack, "placementgroup", {
          partitions: 5,
          spreadLevel: PlacementGroupSpreadLevel.HOST,
          strategy: PlacementGroupStrategy.CLUSTER,
        }),
    ).toThrow(
      /PlacementGroup 'placementgroup' can only specify 'partitions' with the 'PARTITION' strategy/,
    );
  });

  test("placement group throws if the SPREAD strategy is used with partitions", () => {
    // GIVEN
    expect(
      () =>
        new PlacementGroup(stack, "placementgroup", {
          partitions: 5,
          spreadLevel: PlacementGroupSpreadLevel.HOST,
          strategy: PlacementGroupStrategy.SPREAD,
        }),
    ).toThrow(
      /PlacementGroup 'placementgroup' can only specify 'partitions' with the 'PARTITION' strategy/,
    );
  });

  test("placement group throws if the SPREAD strategy is used with partitions", () => {
    // GIVEN
    expect(
      () =>
        new PlacementGroup(stack, "placementgroup", {
          partitions: 5,
          spreadLevel: PlacementGroupSpreadLevel.HOST,
          strategy: PlacementGroupStrategy.SPREAD,
        }),
    ).toThrow(
      /PlacementGroup 'placementgroup' can only specify 'partitions' with the 'PARTITION' strategy/,
    );
  });

  test("placement group throws if spreadLevel is used without the SPREAD strategy", () => {
    // GIVEN
    expect(
      () =>
        new PlacementGroup(stack, "placementgroup", {
          spreadLevel: PlacementGroupSpreadLevel.HOST,
          strategy: PlacementGroupStrategy.CLUSTER,
        }),
    ).toThrow(
      /PlacementGroup 'placementgroup' can only specify 'spreadLevel' with the 'SPREAD' strategy/,
    );
  });
});
