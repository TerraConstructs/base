// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/region-info/build-tools/fact-tables.ts#L120

// https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-access-logs.html#access-logging-bucket-permissions
// https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/enable-access-logs.html#attach-bucket-policy
// Any not listed regions use the service principal "logdelivery.elasticloadbalancing.amazonaws.com"
export const ELBV2_ACCOUNTS: { [region: string]: string } = {
  "af-south-1": "098369216593",
  "ap-east-1": "754344448648",
  "ap-northeast-1": "582318560864",
  "ap-northeast-2": "600734575887",
  "ap-northeast-3": "383597477331",
  "ap-south-1": "718504428378",
  "ap-southeast-1": "114774131450",
  "ap-southeast-2": "783225319266",
  "ap-southeast-3": "589379963580",
  "ca-central-1": "985666609251",
  "cn-north-1": "638102146993",
  "cn-northwest-1": "037604701340",
  "eu-central-1": "054676820928",
  "eu-north-1": "897822967062",
  "eu-south-1": "635631232127",
  "eu-west-1": "156460612806",
  "eu-west-2": "652711504416",
  "eu-west-3": "009996457667",
  "me-south-1": "076674570225",
  "sa-east-1": "507241528517",
  "us-east-1": "127311923021",
  "us-east-2": "033677994240",
  "us-gov-east-1": "190560391635",
  "us-gov-west-1": "048591011584",
  "us-iso-east-1": "770363063475",
  "us-isob-east-1": "740734521339",
  "us-iso-west-1": "121062877647",
  "us-west-1": "027434742980",
  "us-west-2": "797873946194",
};

/**
 * The account ID for ELBv2 in this region
 */
export function getElbv2Account(region: string): string | undefined {
  return ELBV2_ACCOUNTS[region];
}
