#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AxioraPulseStack } from '../lib/axiora-pulse-stack';
import { AxioraPulsePipelineStack } from '../lib/axiora-pulse-pipeline-stack';

const app = new cdk.App();

const env = { 
  account: '039971552199', 
  region: 'us-east-1' 
};

const appStack = new AxioraPulseStack(app, 'AxioraPulseStack', {
  env,
  description: 'Production SaaS environment for AxioraPulse in us-east-1',
});

new AxioraPulsePipelineStack(app, 'AxioraPulsePipelineStack', {
  env,
  ecrRepo: appStack.ecrRepo,
  ecsService: appStack.ecsService,
  description: 'CI/CD pipeline for AxioraPulse in us-east-1',
});
