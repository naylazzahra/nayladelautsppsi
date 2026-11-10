/**
 * AirSense City - Vercel Migration Automated Endpoint Test Suite
 * Validates server.ts, api/index.ts, CORS, SSE, Security Headers, and Static Assets
 * Copyright©2026 by Nayla Dela Azzahra dan Dr. Erliyan Redy Susanto, M.Kom
 */

import http from 'http';
import handler, { backendStations } from './server.ts';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testId, description, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${testId}: ${description}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${testId}: ${description} - ${details}`);
  }
}

// Helper to simulate mock HTTP request to the handler
function request(options, body = null) {
  return new Promise((resolve) => {
    const req = new http.IncomingMessage(null);
    req.method = options.method || 'GET';
    req.url = options.url || '/';
    req.headers = Object.assign({
      host: 'localhost:3000',
      'user-agent': 'AirSense-Vercel-Migration-Test'
    }, options.headers || {});
    req.socket = { remoteAddress: '127.0.0.1' };

    let resHeaders = {};
    let statusCode = 200;
    let resData = '';
    const chunks = [];

    const res = new http.ServerResponse(req);
    res.setHeader = (k, v) => { resHeaders[k.toLowerCase()] = v; return res; };
    res.getHeader = (k) => resHeaders[k.toLowerCase()];
    res.writeHead = (code, headers = {}) => {
      statusCode = code;
      Object.keys(headers).forEach(k => { resHeaders[k.toLowerCase()] = headers[k]; });
      return res;
    };
    res.write = (chunk) => {
      chunks.push(chunk);
      resData += chunk.toString();
      return true;
    };
    res.end = (chunk) => {
      if (chunk) {
        chunks.push(chunk);
        resData += chunk.toString();
      }
      resolve({ statusCode, headers: resHeaders, body: resData });
      return res;
    };

    // Invoke handler
    handler(req, res);

    if (body) {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    } else {
      req.emit('end');
    }
  });
}

async function runMigrationTests() {
  console.log('===============================================================');
  console.log(' AIRSENSE CITY - VERCEL DEPLOYMENT MIGRATION VERIFICATION');
  console.log(' Entrypoint: server.ts / api/*.ts');
  console.log(' Copyright©2026 Nayla Dela Azzahra & Dr. Erliyan Redy Susanto');
  console.log('===============================================================\n');

  // 1. GET /api/overview
  const resOverview = await request({ method: 'GET', url: '/api/overview' });
  assert(resOverview.statusCode === 200, 'TEST-MIG-01', 'GET /api/overview returns HTTP 200');
  const jsonOverview = JSON.parse(resOverview.body);
  assert(jsonOverview.total_stations === 5, 'TEST-MIG-02', 'Overview reports 5 monitoring stations');
  assert(jsonOverview.system === 'AirSense City API', 'TEST-MIG-03', 'Overview reports system identity');
  assert(jsonOverview.is_simulated === true, 'TEST-MIG-04', 'Overview maintains data simulasi flag');

  // 2. GET /api/locations
  const resLocations = await request({ method: 'GET', url: '/api/locations' });
  assert(resLocations.statusCode === 200, 'TEST-MIG-05', 'GET /api/locations returns HTTP 200');
  const jsonLocations = JSON.parse(resLocations.body);
  assert(jsonLocations.count === 5 && jsonLocations.locations.length === 5, 'TEST-MIG-06', 'Returns all 5 stations with telemetry');

  // 3. GET /api/locations/01/readings
  const resReadings = await request({ method: 'GET', url: '/api/locations/01/readings' });
  assert(resReadings.statusCode === 200, 'TEST-MIG-07', 'GET /api/locations/01/readings returns HTTP 200');
  const jsonReadings = JSON.parse(resReadings.body);
  assert(jsonReadings.readings.length === 25, 'TEST-MIG-08', 'Returns 25 hourly readings (24h history + current)');

  // 4. GET /api/hotspots
  const resHotspots = await request({ method: 'GET', url: '/api/hotspots' });
  assert(resHotspots.statusCode === 200, 'TEST-MIG-09', 'GET /api/hotspots returns HTTP 200');
  const jsonHotspots = JSON.parse(resHotspots.body);
  assert(jsonHotspots.window_hours === 24 && jsonHotspots.threshold_pct === 30.0, 'TEST-MIG-10', 'Hotspot engine applies PRD FR-HOT parameters (24h, 30%)');

  // 5. GET /api/alerts
  const resAlerts = await request({ method: 'GET', url: '/api/alerts' });
  assert(resAlerts.statusCode === 200, 'TEST-MIG-11', 'GET /api/alerts returns HTTP 200');
  const jsonAlerts = JSON.parse(resAlerts.body);
  assert(Array.isArray(jsonAlerts.active_alerts), 'TEST-MIG-12', 'Alerts endpoint returns active_alerts array');

  // 6. POST /api/auth/login
  const resLogin = await request({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' }
  }, JSON.stringify({ email: 'admin.dlh@bandarlampung.go.id' }));
  assert(resLogin.statusCode === 200, 'TEST-MIG-13', 'POST /api/auth/login returns HTTP 200');
  const jsonLogin = JSON.parse(resLogin.body);
  assert(jsonLogin.user && jsonLogin.user.role === 'admin', 'TEST-MIG-14', 'Login properly assigns admin role');

  // 7. POST /api/ingest (Auth failure & success)
  const resIngestUnauthorized = await request({
    method: 'POST',
    url: '/api/ingest',
    headers: { 'content-type': 'application/json', 'x-api-key': 'wrong_key' }
  }, JSON.stringify({ pm25: 25.0 }));
  assert(resIngestUnauthorized.statusCode === 401, 'TEST-MIG-15', 'POST /api/ingest rejects unauthorized sensor key');

  const resIngestAuthorized = await request({
    method: 'POST',
    url: '/api/ingest',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.SENSOR_INGEST_SECRET || 'airsense_sensor_secret_key_2026' }
  }, JSON.stringify({ pm25: 25.0 }));
  assert(resIngestAuthorized.statusCode === 200, 'TEST-MIG-16', 'POST /api/ingest accepts authorized sensor data');

  // 8. CORS Headers with Vercel deployment domain
  const resCorsVercel = await request({
    method: 'OPTIONS',
    url: '/api/overview',
    headers: { origin: 'https://airsense-city.vercel.app' }
  });
  assert(resCorsVercel.statusCode === 204, 'TEST-MIG-17', 'OPTIONS /api/overview returns HTTP 204 preflight');
  assert(resCorsVercel.headers['access-control-allow-origin'] === 'https://airsense-city.vercel.app', 'TEST-MIG-18', 'CORS dynamically allows *.vercel.app domain');

  // 9. OWASP Security Headers Check
  const resSecHeaders = await request({ method: 'GET', url: '/api/overview' });
  assert(resSecHeaders.headers['x-content-type-options'] === 'nosniff', 'TEST-MIG-19', 'Security header X-Content-Type-Options: nosniff present');
  assert(resSecHeaders.headers['x-frame-options'] === 'SAMEORIGIN', 'TEST-MIG-20', 'Security header X-Frame-Options: SAMEORIGIN present');
  assert(resSecHeaders.headers['referrer-policy'] === 'strict-origin-when-cross-origin', 'TEST-MIG-21', 'Security header Referrer-Policy present');

  // 10. Vercel Rewrite Path Resolution Test
  const resRewritten = await request({
    method: 'GET',
    url: '/api/index',
    headers: { 'x-forwarded-uri': '/api/locations' }
  });
  assert(resRewritten.statusCode === 200, 'TEST-MIG-22', 'Rewritten /api/index correctly resolves /api/locations via x-forwarded-uri');

  // 11. SSE Endpoint Initial Handshake
  let sseHandshakeReceived = false;
  let sseTelemetryReceived = false;
  const sseReq = new http.IncomingMessage(null);
  sseReq.method = 'GET';
  sseReq.url = '/api/stream';
  sseReq.headers = { host: 'localhost:3000' };
  sseReq.socket = { remoteAddress: '127.0.0.1' };
  const sseRes = new http.ServerResponse(sseReq);
  sseRes.setHeader = () => sseRes;
  sseRes.writeHead = (code) => {
    assert(code === 200, 'TEST-MIG-23', 'SSE /api/stream returns HTTP 200 stream');
    return sseRes;
  };
  sseRes.write = (chunk) => {
    const text = chunk.toString();
    if (text.includes('connected')) sseHandshakeReceived = true;
    if (text.includes('telemetry_update')) sseTelemetryReceived = true;
    return true;
  };
  sseRes.end = () => sseRes;

  handler(sseReq, sseRes);
  sseReq.emit('end');

  assert(sseHandshakeReceived, 'TEST-MIG-24', 'SSE stream sends initial connection handshake');
  assert(sseTelemetryReceived, 'TEST-MIG-25', 'SSE stream sends immediate telemetry snapshot');

  // Trigger close on SSE to cleanly unregister
  sseReq.emit('close');

  console.log('\n===============================================================');
  console.log(` HASIL PENGUJIAN MIGRASI: ${passedTests} LULUS, ${failedTests} GAGAL (Total: ${totalTests} Kasus Uji)`);
  console.log(` Persentase Keberhasilan: ${((passedTests/totalTests)*100).toFixed(1)}%`);
  console.log('===============================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMigrationTests();

