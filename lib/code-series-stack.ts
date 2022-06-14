import * as fs from "fs";

import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as chatbot from "aws-cdk-lib/aws-chatbot";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as notifications from "aws-cdk-lib/aws-codestarnotifications";
import * as actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as elbv2argets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";

export interface props extends StackProps {
  projectName: String;
  envName: String;
  slackWorkspaceId: string,
  slackChannelId: string,
}
export class CodeSeriesStack extends Stack {
  constructor(scope: Construct, id: string, props: props) {
    super(scope, id, props);

    /**
     * Create a Role
     */
    const ec2Role = new iam.Role(this, "Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("PowerUserAccess"));

    /**
     * Nat Instace
     */
    const provider = ec2.NatProvider.instance({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });

    /**
     * Create a VPC
     */
    const vpc = new ec2.Vpc(this, `${props.projectName}-${props.envName}-vpc`, {
      maxAzs: 2,
      natGatewayProvider: provider,
      natGateways: 1,
    });

    /**
     * Create SecurityGroups
     */
    const albsg = new ec2.SecurityGroup(this, `${props.projectName}-${props.envName}-albsg`, {
      vpc: vpc,
    });
    albsg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    const ec2sg = new ec2.SecurityGroup(this, `${props.projectName}-${props.envName}-ec2sg`, {
      vpc: vpc,
    });
    ec2sg.addIngressRule(albsg, ec2.Port.allTraffic());

    /**
     * Create a Deploy EC2
     */
    const instanceProfile = new iam.CfnInstanceProfile(this, `${props.projectName}-${props.envName}-instanceprofile`, {
      roles: [ec2Role.roleName],
    });
    const lunchTemplate = new ec2.CfnLaunchTemplate(this, `${props.projectName}-${props.envName}-lunchtemplate`, {
      launchTemplateData: {
        iamInstanceProfile: {
          arn: instanceProfile.attrArn,
        },
        imageId: "ami-02c3627b04781eada",
        instanceType: "t3.small",
        instanceMarketOptions: {
          marketType: "spot",
          spotOptions: {
            instanceInterruptionBehavior: "stop",
            spotInstanceType: "persistent",
          },
        },
        keyName: "tokyo-266232831585",
      },
      launchTemplateName: `${props.projectName}-${props.envName}-lunchtemplate`,
    });
    const instance = new ec2.CfnInstance(this, `${props.projectName}-${props.envName}-deploy-ec2`, {
      launchTemplate: {
        launchTemplateId: lunchTemplate.ref,
        version: lunchTemplate.attrLatestVersionNumber,
      },
      securityGroupIds: [ec2sg.securityGroupId],
      subnetId: vpc.privateSubnets[0].subnetId,
      tags: [
        {
          key: "Name",
          value: `${props.projectName}-${props.envName}-deploy-ec2`,
        },
        {
          key: "Deploy",
          value: "on",
        },
      ],
      userData: fs.readFileSync(`${__dirname}/userdata.sh`, "base64"),
    });

    /**
     * Create a ALB
     */
    const targetGroup = new elbv2.ApplicationTargetGroup(this, `${props.projectName}-${props.envName}-targetgroup`, {
      deregistrationDelay: Duration.seconds(0),
      healthCheck: {
        healthyThresholdCount: 2,
        interval: Duration.seconds(5),
        timeout: Duration.seconds(4),
      },
      port: 80,
      targetGroupName: `${props.projectName}-${props.envName}-targetgroup`,
      targetType: elbv2.TargetType.INSTANCE,
      targets: [new elbv2argets.InstanceIdTarget(instance.ref, 80)],
      vpc: vpc,
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, `${props.projectName}-${props.envName}-alb`, {
      vpc: vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albsg,
    });
    alb.addListener(`${props.projectName}-${props.envName}-listener`, {
      defaultTargetGroups: [targetGroup],
      port: 80,
    });

    /**
     * Create a Role for codebuild
     */
    const codebuildRole = new iam.Role(this, `${props.projectName}-${props.envName}-codebuild-role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    });
    codebuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCodeBuildDeveloperAccess"));
    codebuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("EC2InstanceProfileForImageBuilderECRContainerBuilds"));
    codebuildRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("PowerUserAccess"));

    /**
     * Create code series
     */
    // Create a Codecommit
    const repository = new codecommit.Repository(this, `${props.projectName}-${props.envName}-commit`, {
      repositoryName: `${props.projectName}-${props.envName}-commit`,
    });

    // Create a Codebuild
    const project = new codebuild.Project(this, `${props.projectName}-${props.envName}-build`, {
      projectName: `${props.projectName}-${props.envName}-build`,
      source: codebuild.Source.codeCommit({ repository }),
      role: codebuildRole,
      vpc: vpc,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
      },
    });

    // Create a CodeDeploy
    const application = new codedeploy.ServerApplication(this, `${props.projectName}-${props.envName}-codedeploy`, {
      applicationName: `${props.projectName}-${props.envName}-codedeploy`,
    });
    const serverDeploymentGroup = new codedeploy.ServerDeploymentGroup(this, `${props.projectName}-${props.envName}-ec2deploy`, {
      application,
      deploymentGroupName: `${props.projectName}-${props.envName}-ec2deploy`,
      ec2InstanceTags: new codedeploy.InstanceTagSet({
        Deploy: ["on"],
      }),
      loadBalancer: codedeploy.LoadBalancer.application(targetGroup),
    });

    // Create a pipeline
    const sourceArtifact = new codepipeline.Artifact("SourceArtifact");
    const buildArtifact = new codepipeline.Artifact("BuildArtifact");

    const sourceAction = new actions.CodeCommitSourceAction({
      actionName: `${props.projectName}-${props.envName}-sourceaction`,
      branch: "main",
      repository: repository,
      output: sourceArtifact,
    });
    const buildActions = new actions.CodeBuildAction({
      actionName: `${props.projectName}-${props.envName}-buildaction`,
      input: sourceArtifact,
      project: project,
      outputs: [buildArtifact],
    });
    const approvalActions = new actions.ManualApprovalAction({
      actionName: "approval"
    })
    const deployActions = new actions.CodeDeployServerDeployAction({
      actionName: `${props.projectName}-${props.envName}-deployaction`,
      input: buildArtifact,
      deploymentGroup: serverDeploymentGroup,
    });

    const pipeline = new codepipeline.Pipeline(this, `${props.projectName}-${props.envName}-pipeline`, {
      pipelineName: `${props.projectName}-${props.envName}-pipeline`,
      stages: [
        {
          stageName: `${props.projectName}-${props.envName}-source`,
          actions: [sourceAction],
        },
        {
          stageName: `${props.projectName}-${props.envName}-build`,
          actions: [buildActions],
        },
        {
          stageName: `${props.projectName}-${props.envName}-approval`,
          actions: [approvalActions],
        },
        {
          stageName: `${props.projectName}-${props.envName}-deploy`,
          actions: [deployActions],
        },
      ],
    });

    // Set a notification
    const snsTopicForChatBot = new sns.Topic(this, `${props.projectName}-${props.envName}-code-series-topic-for-chatbot`, {
      topicName: `${props.projectName}-${props.envName}-code-series-topic-for-chatbot`,
      displayName: `${props.projectName}-${props.envName}-code-series-topic-for-chatbot`,
    });

    const chatbotForSlack = new chatbot.SlackChannelConfiguration(this, `${props.projectName}-${props.envName}-code-series-chatbot`, {
      slackChannelConfigurationName: "code-series-chatbot",
      slackWorkspaceId: props.slackWorkspaceId,
      slackChannelId: props.slackChannelId,
      notificationTopics: [snsTopicForChatBot],
    });

    repository.notifyOn(`${props.projectName}-${props.envName}-codecommit-notification-rule`, chatbotForSlack, {
      notificationRuleName: `${props.projectName}-${props.envName}-codecommit-notification-rule`,
      events: [
        codecommit.RepositoryNotificationEvents.APPROVAL_RULE_OVERRIDDEN,
        codecommit.RepositoryNotificationEvents.APPROVAL_STATUS_CHANGED,
        codecommit.RepositoryNotificationEvents.BRANCH_OR_TAG_CREATED,
        codecommit.RepositoryNotificationEvents.BRANCH_OR_TAG_DELETED,
        codecommit.RepositoryNotificationEvents.BRANCH_OR_TAG_UPDATED,
        codecommit.RepositoryNotificationEvents.COMMIT_COMMENT,
        codecommit.RepositoryNotificationEvents.PULL_REQUEST_COMMENT,
        codecommit.RepositoryNotificationEvents.PULL_REQUEST_CREATED,
        codecommit.RepositoryNotificationEvents.PULL_REQUEST_MERGED,
        codecommit.RepositoryNotificationEvents.PULL_REQUEST_SOURCE_UPDATED,
        codecommit.RepositoryNotificationEvents.PULL_REQUEST_STATUS_CHANGED,
      ],
    });

    project.notifyOn(`${props.projectName}-${props.envName}-codebuild-notification-rule`, chatbotForSlack, {
      notificationRuleName: `${props.projectName}-${props.envName}-codebuild-notification-rule`,
      events: [
        codebuild.ProjectNotificationEvents.BUILD_FAILED,
        codebuild.ProjectNotificationEvents.BUILD_IN_PROGRESS,
        codebuild.ProjectNotificationEvents.BUILD_PHASE_FAILED,
        codebuild.ProjectNotificationEvents.BUILD_PHASE_SUCCEEDED,
        codebuild.ProjectNotificationEvents.BUILD_STOPPED,
        codebuild.ProjectNotificationEvents.BUILD_SUCCEEDED,
      ],
    });

    new notifications.CfnNotificationRule(this, `${props.projectName}-${props.envName}-codedeploy-notification-rule`, {
      detailType: "FULL",
      eventTypeIds: [
        "codedeploy-application-deployment-succeeded",
        "codedeploy-application-deployment-failed",
        "codedeploy-application-deployment-started",
      ],
      name: `${props.projectName}-${props.envName}-codedeploy-notification-rule`,
      resource: application.applicationArn,
      targets: [
        {
          targetAddress: chatbotForSlack.slackChannelConfigurationArn,
          targetType: "AWSChatbotSlack",
        },
      ],
    });

    pipeline.notifyOn(`${props.projectName}-${props.envName}-pipeline-notification-rule)`, chatbotForSlack, {
      notificationRuleName: `${props.projectName}-${props.envName}-pipeline-notification-rule`,
      events: [
        codepipeline.PipelineNotificationEvents.ACTION_EXECUTION_CANCELED,
        codepipeline.PipelineNotificationEvents.ACTION_EXECUTION_FAILED,
        codepipeline.PipelineNotificationEvents.ACTION_EXECUTION_STARTED,
        codepipeline.PipelineNotificationEvents.ACTION_EXECUTION_SUCCEEDED,
        codepipeline.PipelineNotificationEvents.MANUAL_APPROVAL_FAILED,
        codepipeline.PipelineNotificationEvents.MANUAL_APPROVAL_NEEDED,
        codepipeline.PipelineNotificationEvents.MANUAL_APPROVAL_SUCCEEDED,
        codepipeline.PipelineNotificationEvents.PIPELINE_EXECUTION_CANCELED,
        codepipeline.PipelineNotificationEvents.PIPELINE_EXECUTION_FAILED,
        codepipeline.PipelineNotificationEvents.PIPELINE_EXECUTION_RESUMED,
        codepipeline.PipelineNotificationEvents.PIPELINE_EXECUTION_STARTED,
        codepipeline.PipelineNotificationEvents.PIPELINE_EXECUTION_SUCCEEDED,
        codepipeline.PipelineNotificationEvents.PIPELINE_EXECUTION_SUPERSEDED,
        codepipeline.PipelineNotificationEvents.STAGE_EXECUTION_CANCELED,
        codepipeline.PipelineNotificationEvents.STAGE_EXECUTION_FAILED,
        codepipeline.PipelineNotificationEvents.STAGE_EXECUTION_RESUMED,
        codepipeline.PipelineNotificationEvents.STAGE_EXECUTION_STARTED,
        codepipeline.PipelineNotificationEvents.STAGE_EXECUTION_SUCCEEDED,
      ],
    });

    // Output ALB parameter
    new CfnOutput(this, `${props.projectName}-${props.envName}-output-alb`, {
      value: alb.loadBalancerDnsName,
      exportName: "LoadBalancerDnsName",
    });
  }
}
