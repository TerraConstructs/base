package aws

import (
	"fmt"

	acmTypes "github.com/aws/aws-sdk-go-v2/service/acm/types"
	route53Types "github.com/aws/aws-sdk-go-v2/service/route53/types"
)

// CloudFrontFunctionValidationFailed is an error that occurs if response validation fails.
type CloudFrontFunctionValidationFailed struct {
	FunctionName string
	Failures     error
}

func (err CloudFrontFunctionValidationFailed) Error() string {
	if err.Failures == nil {
		return fmt.Sprintf("Validation failed for Function %s", err.FunctionName)
	}
	return fmt.Sprintf("Validation failed for Function %s.\nFailures:\n%v", err.FunctionName, err.Failures)
}

// CertificateNotIssuedError is returned when the ACM Certificate status is not issued.
type CertificateNotIssuedError struct {
	certArn       string
	currentStatus acmTypes.CertificateStatus
}

func (err CertificateNotIssuedError) Error() string {
	return fmt.Sprintf(
		"Certificate %s not yet %s (current %s)",
		err.certArn,
		acmTypes.CertificateStatusIssued,
		err.currentStatus,
	)
}

func NewCertificateNotIssuedError(certArn string, currentStatus acmTypes.CertificateStatus) CertificateNotIssuedError {
	return CertificateNotIssuedError{certArn, currentStatus}
}

// IamRoleNotFoundError is returned when the IAM role is not found.
type IamRoleNotFoundError struct {
	roleName string
}

func (err IamRoleNotFoundError) Error() string {
	return fmt.Sprintf("IAM Role %s not found", err.roleName)
}

func NewIamRoleNotFoundError(roleName string) IamRoleNotFoundError {
	return IamRoleNotFoundError{roleName}
}

// IamManagedPolicyNotFoundError is returned when the IAM managed policy is not found.
type IamManagedPolicyNotFoundError struct {
	policyArn string
}

func (err IamManagedPolicyNotFoundError) Error() string {
	return fmt.Sprintf("IAM Managed Policy %s not found", err.policyArn)
}

func NewIamManagedPolicyNotFoundError(policyArn string) IamManagedPolicyNotFoundError {
	return IamManagedPolicyNotFoundError{policyArn}
}

// BucketNotificationNotEnabledError is returned when the S3 bucket notification is not enabled.
type BucketNotificationNotEnabledError struct {
	bucketName string
	region     string
}

func (err BucketNotificationNotEnabledError) Error() string {
	return fmt.Sprintf("Bucket %s in %s has no notification configuration", err.bucketName, err.region)
}

func NewBucketNotificationNotEnabledError(region, bucketName string) BucketNotificationNotEnabledError {
	return BucketNotificationNotEnabledError{bucketName, region}
}

// LogGroupNotFoundError is returned when a CloudWatch Logs log group does not exist.
type LogGroupNotFoundError struct {
	logGroupName string
}

// Error implements the error interface.
func (err LogGroupNotFoundError) Error() string {
	return fmt.Sprintf("Log group %s not found", err.logGroupName)
}

// NewLogGroupNotFoundError returns a LogGroupNotFoundError for the given log group name.
func NewLogGroupNotFoundError(logGroupName string) LogGroupNotFoundError {
	return LogGroupNotFoundError{logGroupName}
}

// Route53RecordSetNotFoundError is returned when a Route 53 record set does not exist.
type Route53RecordSetNotFoundError struct {
	hostedZoneID string
	recordName   string
	recordType   route53Types.RRType
}

// Error implements the error interface.
func (err Route53RecordSetNotFoundError) Error() string {
	return fmt.Sprintf("%s record %s not found in hosted zone %s", err.recordType, err.recordName, err.hostedZoneID)
}

// NewRoute53RecordSetNotFoundError returns a Route53RecordSetNotFoundError for the given hosted zone, record name and type.
func NewRoute53RecordSetNotFoundError(hostedZoneID, recordName string, recordType route53Types.RRType) Route53RecordSetNotFoundError {
	return Route53RecordSetNotFoundError{hostedZoneID, recordName, recordType}
}
