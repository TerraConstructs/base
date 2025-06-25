import { Lazy, Testing, App } from "cdktf";
import { AwsStack } from "../../../src/aws/aws-stack";
import { Schedule } from "../../../src/aws/compute/schedule";
import { Duration } from "../../../src/duration";

const environmentName = "Test";
const gridUUID = "123e4567-e89b-12d3";
const providerConfig = { region: "us-east-1" };
const gridBackendConfig = {
  address: "http://localhost:3000",
};

describe("cron", () => {
  test("test utc cron, hour only", () => {
    expect(Schedule.cron({ hour: "18", minute: "0" }).expressionString).toEqual(
      "cron(0 18 * * ? *)",
    );
  });

  test("test utc cron, hour and minute", () => {
    expect(
      Schedule.cron({ hour: "18", minute: "24" }).expressionString,
    ).toEqual("cron(24 18 * * ? *)");
  });
});

describe("rate", () => {
  test("rate must be whole number of minutes", () => {
    expect(() => {
      Schedule.rate(Duration.minutes(0.13456));
    }).toThrow(
      /'0.13456 minutes' cannot be converted into a whole number of seconds/,
    );
  });

  test("rate can be in seconds", () => {
    const duration = Schedule.rate(Duration.seconds(120));
    expect("rate(2 minutes)").toEqual(duration.expressionString);
  });

  test("rate must not be in seconds when specified as a token", () => {
    expect(() => {
      Schedule.rate(Duration.seconds(Lazy.numberValue({ produce: () => 5 })));
    }).toThrow(/Allowed units for scheduling/);
  });

  test("rate cannot be 0", () => {
    expect(() => {
      Schedule.rate(Duration.days(0));
    }).toThrow(/Duration cannot be 0/);
  });

  test("rate can be token", () => {
    const app = Testing.app();
    const stack = new AwsStack(app, "TestStack", {
      environmentName,
      gridUUID,
      providerConfig,
      gridBackendConfig,
    });
    const lazyDuration = Duration.minutes(
      Lazy.numberValue({ produce: () => 5 }),
    );
    const rate = Schedule.rate(lazyDuration);
    // Assuming expressionString itself can be a token that needs resolving
    expect("rate(5 minutes)").toEqual(stack.resolve(rate.expressionString));
  });

  test("rate can be in allowed type hours", () => {
    expect("rate(1 hour)").toEqual(
      Schedule.rate(Duration.hours(1)).expressionString,
    );
  });
});

describe("expression", () => {
  test("test using a literal schedule expression", () => {
    expect(Schedule.expression("cron(0 18 * * ? *)").expressionString).toEqual(
      "cron(0 18 * * ? *)",
    );
  });
});

describe("at", () => {
  test("test using at with a specific Date", () => {
    // Note: JavaScript's Date month is 0-indexed (0 for January, 10 for November)
    // Date.UTC(year, monthIndex, day, hours, minutes, seconds)
    // So, 2021, 10, 26 means November 26, 2021
    expect(
      Schedule.at(new Date(Date.UTC(2021, 10, 26))).expressionString,
    ).toEqual("at(2021-11-26T00:00:00)");
  });
});
