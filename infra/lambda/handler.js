'use strict';

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');

const dynamo = new DynamoDBClient({});
const TIERS = new Set(['free', 'basic', 'pro']);

// Account edge for Capture. Cognito owns credentials; DynamoDB owns Motif's
// account metadata. Profiles are created lazily, so a newly confirmed Cognito
// account is immediately usable at the Free tier.
exports.handler = async (event) => {
  const routeKey = event.routeKey || '';
  const rawPath = event.rawPath || event.requestContext?.http?.path || '/';

  if (routeKey === 'GET /health' || rawPath.endsWith('/health')) {
    return json(200, {
      status: 'ok',
      service: 'motif-backend',
      time: new Date().toISOString(),
    });
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  if (routeKey === 'GET /me' || rawPath.endsWith('/me')) {
    const profile = await dynamo.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: profileKey(claims.sub),
      ConsistentRead: true,
    }));
    return json(200, {
      sub: claims.sub,
      email: claims.email,
      tier: profile.Item?.tier?.S ?? 'free',
    });
  }

  if (routeKey === 'PUT /me/tier' || rawPath.endsWith('/me/tier')) {
    const body = parseBody(event.body);
    if (!TIERS.has(body.tier)) {
      return json(400, { error: 'invalid_tier', allowed: [...TIERS] });
    }
    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: profileKey(claims.sub),
      UpdateExpression: 'SET #tier = :tier, email = :email, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#tier': 'tier' },
      ExpressionAttributeValues: {
        ':tier': { S: body.tier },
        ':email': { S: claims.email ?? '' },
        ':updatedAt': { S: new Date().toISOString() },
      },
    }));
    return json(200, { tier: body.tier });
  }

  return json(404, { error: 'not_found', path: rawPath });
};

function profileKey(sub) {
  return {
    PK: { S: `ACCOUNT#${sub}` },
    SK: { S: 'PROFILE' },
  };
}

function parseBody(body) {
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
