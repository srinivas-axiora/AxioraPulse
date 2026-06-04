import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';

export class AxioraPulseStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly ecrRepo: ecr.Repository;
  public readonly userPool: cognito.UserPool;
  public readonly databaseCluster: rds.DatabaseCluster;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly cognitoClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC Configuration (2 AZs, public ALB subnets & private ECS/RDS subnets)
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // 2. Security Groups
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Security Group for AxioraPulse ALB',
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS traffic');

    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Security Group for AxioraPulse ECS tasks',
    });
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(8080), 'Allow traffic from ALB on port 8080');

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      allowAllOutbound: true,
      description: 'Security Group for Aurora DB Cluster',
    });
    dbSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), 'Allow PostgreSQL traffic from ECS tasks');

    // 3. ECR Repository
    this.ecrRepo = new ecr.Repository(this, 'EcrRepo', {
      repositoryName: 'axiorapulse-repo',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // 4. Aurora PostgreSQL Serverless v2 DB
    this.databaseCluster = new rds.DatabaseCluster(this, 'DatabaseCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_1,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      readers: [
        rds.ClusterInstance.serverlessV2('Reader', { scaleWithWriter: true }),
      ],
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2.0,
      defaultDatabaseName: 'axiorapulse',
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        secretName: 'axiorapulse-db-credentials',
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 5. Cognito Setup
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'AxioraPulseUserPool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.cognitoClient = this.userPool.addClient('UserPoolClient', {
      userPoolClientName: 'AxioraPulseClient',
      generateSecret: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID],
        callbackUrls: [
          'https://axiorapulse.com/oauth2/idpresponse',
          'https://www.axiorapulse.com/oauth2/idpresponse',
        ],
      },
    });

    const userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: 'axiorapulse-auth-prod-env',
      },
    });

    // 6. Route 53 + ACM Certificate Setup
    let hostedZone: route53.IHostedZone;
    const hostedZoneIdContext = this.node.tryGetContext('hostedZoneId');
    if (hostedZoneIdContext) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: hostedZoneIdContext,
        zoneName: 'axiorapulse.com',
      });
    } else if (this.node.tryGetContext('localSynth') === 'true' || process.env.CDK_LOCAL_SYNTH === 'true') {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: 'Z00000000000000000000',
        zoneName: 'axiorapulse.com',
      });
    } else {
      hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: 'axiorapulse.com',
      });
    }

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'axiorapulse.com',
      subjectAlternativeNames: ['*.axiorapulse.com'],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // 7. Load Balancer (ALB) Setup
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: 'axiorapulse-alb',
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTP Port 80 Redirects to HTTPS
    this.alb.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    // HTTPS Port 443 Listener
    const httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      open: true,
    });

    // Target Groups for Blue/Green Deployments
    const blueTargetGroup = new elbv2.ApplicationTargetGroup(this, 'EcsBlueTargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
      },
    });

    const greenTargetGroup = new elbv2.ApplicationTargetGroup(this, 'EcsGreenTargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
      },
    });

    // Route 53 A Records pointing to ALB
    new route53.ARecord(this, 'AlbAliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.alb)),
    });

    new route53.ARecord(this, 'AlbWwwAliasRecord', {
      zone: hostedZone,
      recordName: 'www',
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.alb)),
    });

    // 8. Cognito Integration with ALB Rules
    // Rule 1: Public paths bypass Cognito (Group 1)
    httpsListener.addAction('PublicRoutes1', {
      priority: 1,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          '/s/*',
          '/embed/*',
          '/public/*',
          '/health',
          '/docs',
        ]),
      ],
      action: elbv2.ListenerAction.forward([blueTargetGroup]),
    });

    // Rule 2: Public paths bypass Cognito (Group 2)
    httpsListener.addAction('PublicRoutes2', {
      priority: 2,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          '/redoc',
          '/openapi.json',
        ]),
      ],
      action: elbv2.ListenerAction.forward([blueTargetGroup]),
    });

    // Rule 2: Default action authenticates via Cognito
    const cognitoAuthAction = new elbv2_actions.AuthenticateCognitoAction({
      userPool: this.userPool,
      userPoolClient: this.cognitoClient,
      userPoolDomain,
      next: elbv2.ListenerAction.forward([blueTargetGroup]),
    });

    httpsListener.addAction('DefaultAuth', {
      action: cognitoAuthAction,
    });

    // 9. ECS Fargate Setup
    const cluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc,
      clusterName: 'axiorapulse-cluster',
      containerInsights: true,
    });

    const executionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    this.databaseCluster.secret!.grantRead(executionRole);

    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole,
      family: 'axiorapulse-app',
    });

    taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
        logGroup: new logs.LogGroup(this, 'AppLogGroup', {
          logGroupName: '/ecs/axiorapulse-app',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      portMappings: [
        {
          containerPort: 8080,
          protocol: ecs.Protocol.TCP,
        },
      ],
      secrets: {
        'DB_SECRET_JSON': ecs.Secret.fromSecretsManager(this.databaseCluster.secret!),
      },
      environment: {
        'PORT': '8080',
        'ENVIRONMENT': 'production',
        'COGNITO_USER_POOL_ID': this.userPool.userPoolId,
        'COGNITO_APP_CLIENT_ID': this.cognitoClient.userPoolClientId,
        'COGNITO_REGION': this.region,
      },
    });

    this.ecsService = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      serviceName: 'axiorapulse-service',
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      deploymentController: {
        type: ecs.DeploymentControllerType.CODE_DEPLOY,
      },
    });

    // Attach Blue target group initially
    blueTargetGroup.addTarget(this.ecsService);

    // 10. Auto-Scaling
    const scaling = this.ecsService.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });
    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
    });

    // 11. CodeDeploy ECS Blue/Green Configuration
    const deploymentGroup = new codedeploy.EcsDeploymentGroup(this, 'EcsDeploymentGroup', {
      service: this.ecsService,
      blueGreenDeploymentConfig: {
        blueTargetGroup: blueTargetGroup,
        greenTargetGroup: greenTargetGroup,
        listener: httpsListener,
      },
      deploymentConfig: codedeploy.EcsDeploymentConfig.ALL_AT_ONCE,
    });

    // 12. Monitoring & SNS Alarms
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'axiorapulse-alarms',
    });

    const cpuAlarm = new cloudwatch.Alarm(this, 'CpuAlarm', {
      metric: this.ecsService.metricCpuUtilization(),
      threshold: 80,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      alarmDescription: 'High CPU utilization alarm for AxioraPulse Fargate Service',
    });
    cpuAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    const memoryAlarm = new cloudwatch.Alarm(this, 'MemoryAlarm', {
      metric: this.ecsService.metricMemoryUtilization(),
      threshold: 80,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      alarmDescription: 'High Memory utilization alarm for AxioraPulse Fargate Service',
    });
    memoryAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    const error5xxAlarm = new cloudwatch.Alarm(this, 'Error5xxAlarm', {
      metric: this.alb.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'ALB Target returned 5XX error',
    });
    error5xxAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    const latencyAlarm = new cloudwatch.Alarm(this, 'LatencyAlarm', {
      metric: this.alb.metricTargetResponseTime(),
      threshold: 2, // 2 seconds
      evaluationPeriods: 1,
      alarmDescription: 'High Target Response Latency',
    });
    latencyAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'The DNS name of the Application Load Balancer',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'The Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: this.ecrRepo.repositoryUri,
      description: 'The ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'DatabaseWriterEndpoint', {
      value: this.databaseCluster.clusterEndpoint.hostname,
      description: 'The Endpoint of the Aurora Database Writer Instance',
    });

    new cdk.CfnOutput(this, 'DatabaseReaderEndpoint', {
      value: this.databaseCluster.clusterReadEndpoint.hostname,
      description: 'The Endpoint of the Aurora Database Reader Instance',
    });
  }
}
