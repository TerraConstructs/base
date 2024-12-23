// https://github.com/aws/aws-cdk/blob/a2c633f1e698249496f11338312ab42bd7b1e4f0/packages/@aws-cdk-testing/framework-integ/test/aws-kinesis/test/integ.stream-dashboard.ts

import { App, LocalBackend } from "cdktf";
import { aws } from "../../../../src";

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "stream-dashboard";

const app = new App({
  outdir,
});
const stack = new aws.AwsStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

const stream = new aws.notify.Stream(stack, "myStream");

const dashboard = new aws.cloudwatch.Dashboard(stack, "StreamDashboard", {
  registerOutputs: true,
  outputName: "dashboard",
});

function graphWidget(title: string, metric: aws.cloudwatch.Metric) {
  return new aws.cloudwatch.GraphWidget(stack, {
    title,
    left: [metric],
    width: 12,
    height: 5,
  });
}

function percentGraphWidget(
  title: string,
  countMetric: aws.cloudwatch.Metric,
  totalMetric: aws.cloudwatch.Metric,
) {
  return new aws.cloudwatch.GraphWidget(stack, {
    title,
    left: [
      new aws.cloudwatch.MathExpression({
        expression: "( count / total ) * 100",
        usingMetrics: {
          count: countMetric,
          total: totalMetric,
        },
      }),
    ],
    width: 12,
    height: 5,
  });
}

dashboard.addWidgets(
  graphWidget(
    "Get records - sum (Bytes)",
    stream.metricGetRecordsBytes({ statistic: "Sum" }),
  ),
  graphWidget(
    "Get records iterator age - maximum (Milliseconds)",
    stream.metricGetRecordsIteratorAgeMilliseconds(),
  ),
  graphWidget(
    "Get records latency - average (Milliseconds)",
    stream.metricGetRecordsLatency(),
  ),
  graphWidget(
    "Get records - sum (Count)",
    stream.metricGetRecords({ statistic: "Sum" }),
  ),
  graphWidget(
    "Get records success - average (Percent)",
    stream.metricGetRecordsSuccess(),
  ),
  graphWidget(
    "Incoming data - sum (Bytes)",
    stream.metricIncomingBytes({ statistic: "Sum" }),
  ),
  graphWidget(
    "Incoming records - sum (Count)",
    stream.metricIncomingRecords({ statistic: "Sum" }),
  ),
  graphWidget(
    "Put record - sum (Bytes)",
    stream.metricPutRecordBytes({ statistic: "Sum" }),
  ),
  graphWidget(
    "Put record latency - average (Milliseconds)",
    stream.metricPutRecordLatency(),
  ),
  graphWidget(
    "Put record success - average (Percent)",
    stream.metricPutRecordSuccess(),
  ),
  graphWidget(
    "Put records - sum (Bytes)",
    stream.metricPutRecordsBytes({ statistic: "Sum" }),
  ),
  graphWidget(
    "Put records latency - average (Milliseconds)",
    stream.metricPutRecordsLatency(),
  ),
  graphWidget(
    "Read throughput exceeded - average (Percent)",
    stream.metricReadProvisionedThroughputExceeded(),
  ),
  graphWidget(
    "Write throughput exceeded - average (Count)",
    stream.metricWriteProvisionedThroughputExceeded(),
  ),
  percentGraphWidget(
    "Put records successful records - average (Percent)",
    stream.metricPutRecordsSuccessfulRecords(),
    stream.metricPutRecordsTotalRecords(),
  ),
  percentGraphWidget(
    "Put records failed records - average (Percent)",
    stream.metricPutRecordsFailedRecords(),
    stream.metricPutRecordsTotalRecords(),
  ),
  percentGraphWidget(
    "Put records throttled records - average (Percent)",
    stream.metricPutRecordsThrottledRecords(),
    stream.metricPutRecordsTotalRecords(),
  ),
);

app.synth();
