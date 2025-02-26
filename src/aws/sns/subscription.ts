// https://github.com/aws/aws-cdk/blob/v2.170.0/packages/aws-cdk-lib/aws-sns/lib/subscribtion.ts

import { Construct } from 'constructs';
import { DeliveryPolicy } from './delivery-policy';
// import { CfnSubscription } from './sns.generated';
import { SubscriptionFilter } from './subscription-filter';
import { ITopic } from './topic-base';
// import { PolicyStatement, ServicePrincipal } from '../../aws-iam';
// import { IQueue } from '../../aws-sqs';
// import { Resource } from '../../core';