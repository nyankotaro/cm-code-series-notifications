import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { CodeSeriesStack } from '../lib/code-series-stack'

const env = {
  account: 'your_accountid',
  region: 'ap-northeast-1',
};
test('Snapshot tests', () => {
  const stack = new Stack();
  const codeSeries = new CodeSeriesStack(stack, 'SnapshotTest1', {
    envName: "test",
    projectName: "test",
    env: env,
    slackWorkspaceId: "your_workspaceid",
    slackChannelId: "your_slachannelid"
  })

  const template1 = Template.fromStack(codeSeries)
  expect(template1.toJSON()).toMatchSnapshot();
});