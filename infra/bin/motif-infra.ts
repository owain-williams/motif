#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { MotifBackendStack } from '../lib/motif-backend-stack';

// Pinned to a single account/region for the solo MVP (ADR 0004) so a deploy
// can never accidentally target the wrong AWS account.
const app = new App();

new MotifBackendStack(app, 'MotifBackendStack', {
  env: { account: '775696080126', region: 'eu-west-2' },
  description:
    'Motif serverless backend: Cognito + DynamoDB + S3 + HTTP API (motif-6fu.2)',
});
