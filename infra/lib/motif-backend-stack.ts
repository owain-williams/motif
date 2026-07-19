import * as path from 'path';
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

/**
 * Motif's Basic/Pro backend, per ADR 0004: a fully serverless AWS stack with no
 * VPC, RDS, NAT gateway, or bastion — every piece is pay-per-use so an idle
 * deployment costs ~nothing. RemovalPolicy.DESTROY throughout keeps the MVP
 * cheap to tear down; revisit before this holds real user data.
 */
export class MotifBackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Identity: account creation + login (AC: create account, log in) ---
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'motif-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Public client for Capture/Bridge (native/SPA) — no client secret.
    // USER_PASSWORD_AUTH is enabled so a test client can log in directly.
    const userPoolClient = userPool.addClient('AppClient', {
      userPoolClientName: 'motif-app',
      generateSecret: false,
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // --- Metadata: accounts, Ideas, tiers, pairings (single-table) ---
    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'motif',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Object storage: Idea audio (empty; not yet wired to the apps) ---
    const audioBucket = new s3.Bucket(this, 'IdeaAudio', {
      bucketName: `motif-idea-audio-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // --- Minimal API so the instance is concretely reachable ---
    // Plain-JS handler, no bundling/deps: /health is open, /me is JWT-guarded.
    const apiFn = new lambda.Function(this, 'ApiFn', {
      functionName: 'motif-api',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: { TABLE_NAME: table.tableName },
    });
    table.grant(apiFn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'motif-api',
      description: 'Motif backend edge (health + authenticated account)',
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
      },
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    const authorizer = new HttpUserPoolAuthorizer('Authorizer', userPool, {
      userPoolClients: [userPoolClient],
    });

    httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: '/me',
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer,
    });
    // Temporary debug/admin path until Stripe owns paid-tier changes.
    httpApi.addRoutes({
      path: '/me/tier',
      methods: [apigwv2.HttpMethod.PUT],
      integration,
      authorizer,
    });

    // --- Outputs consumed by the smoke test and app wiring ---
    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'BucketName', { value: audioBucket.bucketName });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
