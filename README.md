# guardduty-chatbot stacks

## npm install

```bash
npm install
```

## chatbotの変数設定

`bin/`配下ファイルに以下を設定する。

- slackWorkspaceId
- slackChannelId

```typescript
new CodeSeriesStack(app, `${projectName}-${envValues.envName}-codeseries-stack`, {
  projectName: projectName,
  envName: envValues.envName,
  env: env,
  slackWorkspaceId: "your_workspaceid", //AWS chatbotのWorkspace id
  slackChannelId: "your_channelid", //SlackのチャンネルID
});

```

[./bin/code-series.ts](./bin/code-series.ts)

## デプロイ

```shell
npx cdk deploy --all -c env=dev --require-aproval never
```

## ブログリンク
