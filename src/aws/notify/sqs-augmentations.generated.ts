// Copyright 2012-2024 Amazon.com, Inc. or its affiliates. All Rights Reserved.
/* eslint-disable prettier/prettier,max-len */
import * as cw from "../cloudwatch";
// TODO: re-add QueueBase and Metrics support
// import { QueueBase } from "./queue-base";
// this was renamed from QueueBase
import { Queue } from "./queue";

declare module "./queue" {
  interface IQueue {
    /**
     * Return the given named metric for this Queue
     */
    metric(metricName: string, props?: cw.MetricOptions): cw.Metric;

    /**
     * The approximate age of the oldest non-deleted message in the queue.
     *
     * Maximum over 5 minutes
     */
    metricApproximateAgeOfOldestMessage(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages in the queue that are delayed and not available for reading immediately.
     *
     * Maximum over 5 minutes
     */
    metricApproximateNumberOfMessagesDelayed(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages that are in flight.
     *
     * Maximum over 5 minutes
     */
    metricApproximateNumberOfMessagesNotVisible(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages available for retrieval from the queue.
     *
     * Maximum over 5 minutes
     */
    metricApproximateNumberOfMessagesVisible(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of ReceiveMessage API calls that did not return a message.
     *
     * Sum over 5 minutes
     */
    metricNumberOfEmptyReceives(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages deleted from the queue.
     *
     * Sum over 5 minutes
     */
    metricNumberOfMessagesDeleted(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages returned by calls to the ReceiveMessage action.
     *
     * Sum over 5 minutes
     */
    metricNumberOfMessagesReceived(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages added to a queue.
     *
     * Sum over 5 minutes
     */
    metricNumberOfMessagesSent(props?: cw.MetricOptions): cw.Metric;

    /**
     * The size of messages added to a queue.
     *
     * Average over 5 minutes
     */
    metricSentMessageSize(props?: cw.MetricOptions): cw.Metric;
  }
}



declare module "./queue" {
  interface Queue {
    /**
     * Return the given named metric for this Queue
     */
    metric(metricName: string, props?: cw.MetricOptions): cw.Metric;

    /**
     * The approximate age of the oldest non-deleted message in the queue.
     *
     * Maximum over 5 minutes
     */
    metricApproximateAgeOfOldestMessage(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages in the queue that are delayed and not available for reading immediately.
     *
     * Maximum over 5 minutes
     */
    metricApproximateNumberOfMessagesDelayed(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages that are in flight.
     *
     * Maximum over 5 minutes
     */
    metricApproximateNumberOfMessagesNotVisible(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages available for retrieval from the queue.
     *
     * Maximum over 5 minutes
     */
    metricApproximateNumberOfMessagesVisible(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of ReceiveMessage API calls that did not return a message.
     *
     * Sum over 5 minutes
     */
    metricNumberOfEmptyReceives(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages deleted from the queue.
     *
     * Sum over 5 minutes
     */
    metricNumberOfMessagesDeleted(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages returned by calls to the ReceiveMessage action.
     *
     * Sum over 5 minutes
     */
    metricNumberOfMessagesReceived(props?: cw.MetricOptions): cw.Metric;

    /**
     * The number of messages added to a queue.
     *
     * Sum over 5 minutes
     */
    metricNumberOfMessagesSent(props?: cw.MetricOptions): cw.Metric;

    /**
     * The size of messages added to a queue.
     *
     * Average over 5 minutes
     */
    metricSentMessageSize(props?: cw.MetricOptions): cw.Metric;
  }
}

Queue.prototype.metric = function(metricName: string, props?: cw.MetricOptions) {
  return new cw.Metric({
    "namespace": "AWS/SQS",
    "metricName": metricName,
    "dimensionsMap": {
      "QueueName": this.queueName
    },
    ...props
  }).attachTo(this);
};
Queue.prototype.metricApproximateAgeOfOldestMessage = function(props?: cw.MetricOptions) {
  return this.metric("ApproximateAgeOfOldestMessage", {
    "statistic": "Maximum",
    ...props
  });
};
Queue.prototype.metricApproximateNumberOfMessagesDelayed = function(props?: cw.MetricOptions) {
  return this.metric("ApproximateNumberOfMessagesDelayed", {
    "statistic": "Maximum",
    ...props
  });
};
Queue.prototype.metricApproximateNumberOfMessagesNotVisible = function(props?: cw.MetricOptions) {
  return this.metric("ApproximateNumberOfMessagesNotVisible", {
    "statistic": "Maximum",
    ...props
  });
};
Queue.prototype.metricApproximateNumberOfMessagesVisible = function(props?: cw.MetricOptions) {
  return this.metric("ApproximateNumberOfMessagesVisible", {
    "statistic": "Maximum",
    ...props
  });
};
Queue.prototype.metricNumberOfEmptyReceives = function(props?: cw.MetricOptions) {
  return this.metric("NumberOfEmptyReceives", {
    "statistic": "Sum",
    ...props
  });
};
Queue.prototype.metricNumberOfMessagesDeleted = function(props?: cw.MetricOptions) {
  return this.metric("NumberOfMessagesDeleted", {
    "statistic": "Sum",
    ...props
  });
};
Queue.prototype.metricNumberOfMessagesReceived = function(props?: cw.MetricOptions) {
  return this.metric("NumberOfMessagesReceived", {
    "statistic": "Sum",
    ...props
  });
};
Queue.prototype.metricNumberOfMessagesSent = function(props?: cw.MetricOptions) {
  return this.metric("NumberOfMessagesSent", {
    "statistic": "Sum",
    ...props
  });
};
Queue.prototype.metricSentMessageSize = function(props?: cw.MetricOptions) {
  return this.metric("SentMessageSize", {
    "statistic": "Average",
    ...props
  });
};