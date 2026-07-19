'use strict';

// Minimal edge handler for the Motif backend. No dependencies so the asset
// zips with zero bundling. Routes:
//   GET /health  -> open liveness probe
//   GET /me      -> echoes the Cognito JWT claims injected by the HTTP API
//                   authorizer (proves an authenticated request round-trips)
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

  if (routeKey === 'GET /me' || rawPath.endsWith('/me')) {
    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    return json(200, {
      sub: claims.sub,
      email: claims.email,
      tokenUse: claims.token_use,
    });
  }

  return json(404, { error: 'not_found', path: rawPath });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
