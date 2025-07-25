// https://github.com/aws/aws-cdk/blob/v2.186.0/packages/aws-cdk-lib/aws-autoscaling-common/test/intervals.test.ts

import * as fc from "fast-check";
import { arbitrary_complete_intervals } from "./util";
import * as appscaling from "../../../../src/aws/compute/autoscaling-common";
import {
  findAlarmThresholds,
  normalizeIntervals,
} from "../../../../src/aws/compute/autoscaling-common/interval-utils";

describe("intervals", () => {
  test("test bounds propagation", () => {
    const intervals = normalizeIntervals(realisticRelativeIntervals(), false);

    expect(intervals).toEqual([
      { lower: 0, upper: 10, change: -2 },
      { lower: 10, upper: 20, change: -1 },
      { lower: 20, upper: 80, change: undefined },
      { lower: 80, upper: 90, change: +1 },
      { lower: 90, upper: Infinity, change: +2 },
    ]);
  });

  test("test interval completion", () => {
    const lowerIncompleteIntervals = normalizeIntervals(
      incompleteLowerRelativeIntervals(),
      false,
    );
    const upperIncompleteIntervals = normalizeIntervals(
      incompleteUpperRelativeIntervals(),
      false,
    );

    expect(lowerIncompleteIntervals).toEqual([
      { lower: 0, upper: 65, change: undefined },
      { lower: 65, upper: 85, change: +2 },
      { lower: 85, upper: Infinity, change: +3 },
    ]);

    expect(upperIncompleteIntervals).toEqual([
      { lower: 0, upper: 65, change: +2 },
      { lower: 65, upper: 85, change: +3 },
      { lower: 85, upper: Infinity, change: undefined },
    ]);
  });

  test("bounds propagation fails if middle boundary missing", () => {
    expect(() => {
      normalizeIntervals(
        [
          { lower: 0, change: -2 },
          { upper: 20, change: -1 },
        ],
        false,
      );
    }).toThrow();
  });

  test("lower alarm index is lower than higher alarm index", () => {
    fc.assert(
      fc.property(arbitrary_complete_intervals(), (intervals) => {
        const alarms = findAlarmThresholds(intervals);

        return (
          alarms.lowerAlarmIntervalIndex === undefined ||
          alarms.upperAlarmIntervalIndex === undefined ||
          alarms.lowerAlarmIntervalIndex < alarms.upperAlarmIntervalIndex
        );
      }),
    );
  });

  test("never pick undefined intervals for relative alarms", () => {
    fc.assert(
      fc.property(arbitrary_complete_intervals(), (intervals) => {
        const alarms = findAlarmThresholds(intervals);

        return (
          (alarms.lowerAlarmIntervalIndex === undefined ||
            intervals[alarms.lowerAlarmIntervalIndex].change !== undefined) &&
          (alarms.upperAlarmIntervalIndex === undefined ||
            intervals[alarms.upperAlarmIntervalIndex].change !== undefined)
        );
      }),
    );
  });

  test("pick intervals on either side of the undefined interval, if present", () => {
    fc.assert(
      fc.property(arbitrary_complete_intervals(), (intervals) => {
        // There must be an undefined interval and it must not be at the edges
        const i = intervals.findIndex((x) => x.change === undefined);
        fc.pre(i > 0 && i < intervals.length - 1);

        const alarms = findAlarmThresholds(intervals);
        return (
          alarms.lowerAlarmIntervalIndex === i - 1 &&
          alarms.upperAlarmIntervalIndex === i + 1
        );
      }),
    );
  });

  test("no picking upper bound infinity for lower alarm", () => {
    fc.assert(
      fc.property(arbitrary_complete_intervals(), (intervals) => {
        const alarms = findAlarmThresholds(intervals);
        fc.pre(alarms.lowerAlarmIntervalIndex !== undefined);

        return intervals[alarms.lowerAlarmIntervalIndex!].upper !== Infinity;
      }),
    );
  });

  test("no picking lower bound 0 for upper alarm", () => {
    fc.assert(
      fc.property(arbitrary_complete_intervals(), (intervals) => {
        const alarms = findAlarmThresholds(intervals);
        fc.pre(alarms.upperAlarmIntervalIndex !== undefined);

        return intervals[alarms.upperAlarmIntervalIndex!].lower !== 0;
      }),
    );
  });
});

function realisticRelativeIntervals(): appscaling.ScalingInterval[] {
  // Function so we don't have to worry about cloning
  return [
    { upper: 10, change: -2 },
    { upper: 20, change: -1 },
    { lower: 80, change: +1 },
    { lower: 90, change: +2 },
  ];
}

function incompleteLowerRelativeIntervals(): appscaling.ScalingInterval[] {
  // Function so we don't have to worry about cloning
  // The first interval's lower is not zero nor undefined
  return [
    { lower: 65, change: +2 },
    { lower: 85, change: +3 },
  ];
}

function incompleteUpperRelativeIntervals(): appscaling.ScalingInterval[] {
  // Function so we don't have to worry about cloning
  // The last interval's upper is not Infinity nor undefined
  return [
    { upper: 65, change: +2 },
    { upper: 85, change: +3 },
  ];
}
