#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CodeSeriesStack } from "../lib/code-series-stack";

const app = new cdk.App();
const projectName = app.node.tryGetContext("projectName");
const envKey = app.node.tryGetContext("env");
const envValues = app.node.tryGetContext(envKey);
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new CodeSeriesStack(app, `${projectName}-${envValues.envName}-codeseries-stack`, {
  projectName: projectName,
  envName: envValues.envName,
  env: env,
  slackWorkspaceId: "your_workspaceid",
  slackChannelId: "your_channelid",
});
