package aws

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	terratestaws "github.com/gruntwork-io/terratest/modules/aws"
	"github.com/gruntwork-io/terratest/modules/logger"
	"github.com/gruntwork-io/terratest/modules/testing"
)

// SendMessageToFifoQueue sends the given message to the FIFO SQS queue with the given URL.
func SendMessageFifoToQueueWithDeduplicationId(t testing.TestingT, awsRegion string, queueURL string, message string, messageGroupID string, messageDeduplicationId string) {
	err := SendMessageToFifoQueueWithDeduplicationIdE(t, awsRegion, queueURL, message, messageGroupID, messageDeduplicationId)
	if err != nil {
		t.Fatal(err)
	}
}

// SendMessageToFifoQueueWithDeduplicationIdE sends the given message to the FIFO SQS queue with the given URL.
func SendMessageToFifoQueueWithDeduplicationIdE(t testing.TestingT, awsRegion string, queueURL string, message string, messageGroupID string, messageDeduplicationId string) error {
	logger.Log(t, fmt.Sprintf("Sending message %s to queue %s", message, queueURL))

	sqsClient, err := terratestaws.NewSqsClientE(t, awsRegion)
	if err != nil {
		return err
	}

	res, err := sqsClient.SendMessage(context.Background(), &sqs.SendMessageInput{
		MessageBody:            &message,
		QueueUrl:               &queueURL,
		MessageGroupId:         &messageGroupID,
		MessageDeduplicationId: &messageDeduplicationId,
	})

	if err != nil {
		if strings.Contains(err.Error(), "AWS.SimpleQueueService.NonExistentQueue") {
			logger.Log(t, fmt.Sprintf("WARN: Client has stopped listening on queue %s", queueURL))
			return nil
		}
		return err
	}

	logger.Log(t, fmt.Sprintf("Message id %s sent to queue %s", aws.ToString(res.MessageId), queueURL))
	return nil
}

func ChangeMessageVisibility(t testing.TestingT, awsRegion string, queueURL string, receipt string, timeoutSeconds int32) {
	err := ChangeMessageVisibilityE(t, awsRegion, queueURL, receipt, timeoutSeconds)
	if err != nil {
		t.Fatal(err)
	}
}

func ChangeMessageVisibilityE(t testing.TestingT, awsRegion string, queueURL string, receipt string, timeoutSeconds int32) error {
	logger.Log(t, fmt.Sprintf("Setting message visibilityTimeout to %d on queue %s", timeoutSeconds, queueURL))

	sqsClient, err := terratestaws.NewSqsClientE(t, awsRegion)
	if err != nil {
		return err
	}

	_, err = sqsClient.ChangeMessageVisibility(context.Background(), &sqs.ChangeMessageVisibilityInput{
		QueueUrl:          &queueURL,
		ReceiptHandle:     &receipt,
		VisibilityTimeout: timeoutSeconds,
	})

	if err != nil {
		return err
	}
	return nil
}

// QueueMessageResponse contains a queue message.
type QueueMessageResponse struct {
	ReceiptHandle           string
	MessageBody             string
	ApproximateReceiveCount int64
	SentTimestamp           time.Time
	Error                   error
}

// WaitForQueueMessage waits to receive a message from on the queueURL. Since the API only allows us to wait a max 20 seconds for a new
// message to arrive, we must loop TIMEOUT/20 number of times to be able to wait for a total of TIMEOUT seconds
func WaitForQueueMessage(t testing.TestingT, awsRegion string, queueURL string, timeout int) QueueMessageResponse {
	sqsClient, err := terratestaws.NewSqsClientE(t, awsRegion)
	if err != nil {
		return QueueMessageResponse{Error: err}
	}

	cycles := timeout
	cycleLength := 1
	if timeout >= 20 {
		cycleLength = 20
		cycles = timeout / cycleLength
	}

	for i := 0; i < cycles; i++ {
		logger.Log(t, fmt.Sprintf("Waiting for message on %s (%ss)", queueURL, strconv.Itoa(i*cycleLength)))
		input := sqs.ReceiveMessageInput{
			QueueUrl: aws.String(queueURL),
			MessageSystemAttributeNames: []types.MessageSystemAttributeName{
				types.MessageSystemAttributeNameSentTimestamp,           //"SentTimestamp",
				types.MessageSystemAttributeNameApproximateReceiveCount, // "ApproximateReceiveCount",
			},
			MaxNumberOfMessages:   1,
			MessageAttributeNames: []string{"All"},
			WaitTimeSeconds:       int32(cycleLength),
		}

		result, err := sqsClient.ReceiveMessage(context.Background(), &input)

		if err != nil {
			logger.Log(t, fmt.Sprintf("Error while waiting: %s", err))
			return QueueMessageResponse{Error: err}
		}

		if len(result.Messages) > 0 {
			logger.Log(t, fmt.Sprintf("Message %s received on %s", *result.Messages[0].MessageId, queueURL))
			attr := result.Messages[0].Attributes
			approximateReceiveCount, _ := strconv.ParseInt(attr["ApproximateReceiveCount"], 10, 64)
			sentTimestampMillis, _ := strconv.ParseInt(attr["SentTimestamp"], 10, 64)
			return QueueMessageResponse{
				ReceiptHandle:           *result.Messages[0].ReceiptHandle,
				MessageBody:             *result.Messages[0].Body,
				ApproximateReceiveCount: approximateReceiveCount,
				SentTimestamp:           time.Unix(0, sentTimestampMillis*int64(time.Millisecond)),
			}
		}
	}

	return QueueMessageResponse{Error: terratestaws.ReceiveMessageTimeout{QueueUrl: queueURL, TimeoutSec: timeout}}
}
