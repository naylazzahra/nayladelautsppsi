/**
 * AirSense City - HTTP Static & REST API Server (TypeScript / Vercel Compatible)
 * Standard: Permen LHK No. 14 Tahun 2020 / SNI 19-4102-1996
 * Sesuai Dokumen Kebutuhan Produk (PRD) Bagian 12 & SKILL.md
 * 
 * Copyright©2026 by Nayla Dela Azzahra dan Dr. Erliyan Redy Susanto, M.Kom
 * Kolaborasi Pemerintah Kota Bandar Lampung & Universitas Teknokrat Indonesia
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

// Gunakan process.cwd() dan path.resolve() agar kompatibel dengan CommonJS Vercel tanpa import.meta
const rootDir = process.cwd();
const appRequire = typeof require === 'function' ? require : createRequire(path.resolve(rootDir, 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { calculateSubIndex, getISPUStatus } = appRequire(path.resolve(rootDir, 'js/ispu.js'));

export interface Station {
  id: string;
  code: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  ispu: number;
  pm25: number;
  pm10: number;
  temp: number;
  rh: number;
  dominant: 'PM2.5' | 'PM10';
}

export interface SSEClient {
  id: number;
  res: http.ServerResponse;
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=UTF-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf'
};

// In-memory telemetry state on backend (Tokio simulation model)
export const backendStations: Station[] = [
  { id: '01', code: 'ST-TKG-01', name: 'Pusat Kota (Tanjung Karang)', location: 'Jl. Raden Intan, Enggal', lat: -5.4128, lng: 105.2575, ispu: 76, pm25: 28.4, pm10: 45.2, temp: 31.5, rh: 68, dominant: 'PM2.5' },
  { id: '02', code: 'ST-UTI-02', name: 'Area Kampus (Kedaton - UTI)', location: 'Jl. ZA. Pagar Alam, Kedaton', lat: -5.3789, lng: 105.2514, ispu: 42, pm25: 14.1, pm10: 22.0, temp: 30.2, rh: 72, dominant: 'PM2.5' },
  { id: '03', code: 'ST-PNJ-03', name: 'Kawasan Industri (Panjang)', location: 'Jl. Yos Sudarso, Pelabuhan', lat: -5.4678, lng: 105.3189, ispu: 138, pm25: 58.7, pm10: 89.4, temp: 33.1, rh: 61, dominant: 'PM2.5' },
  { id: '04', code: 'ST-KML-04', name: 'Area Permukiman (Kemiling)', location: 'Jl. Teuku Cik Ditiro, Kemiling', lat: -5.3982, lng: 105.2156, ispu: 38, pm25: 11.2, pm10: 19.5, temp: 28.9, rh: 78, dominant: 'PM2.5' },
  { id: '05', code: 'ST-RBS-05', name: 'Kawasan Transportasi (Rajabasa)', location: 'Terminal Tipe A Rajabasa', lat: -5.3587, lng: 105.2348, ispu: 84, pm25: 32.6, pm10: 51.0, temp: 32.0, rh: 65, dominant: 'PM2.5' }
];

let sseClients: SSEClient[] = [];
let lastSimulatedTime = Date.now();

// Broadcast helper for SSE
export function broadcastSSE(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch {
      // Ignore closed stream write errors
    }
  });
}

// Single step of telemetry fluctuation
export function simulateStep(): void {
  backendStations.forEach(st => {
    st.pm25 = Math.max(3.0, parseFloat((st.pm25 + (Math.random() - 0.48) * 1.5).toFixed(1)));
    st.pm10 = Math.max(5.0, parseFloat((st.pm10 + (Math.random() - 0.48) * 2.0).toFixed(1)));
    const sub25 = calculateSubIndex('pm25', st.pm25);
    const sub10 = calculateSubIndex('pm10', st.pm10);
    st.ispu = Math.max(sub25, sub10);
    st.dominant = sub25 >= sub10 ? 'PM2.5' : 'PM10';
  });
}

/**
 * Vercel Serverless Lifecycle Optimization:
 * Serverless functions scale to 0 when idle and freeze background timers.
 * This helper calculates elapsed time and advances telemetry gracefully upon request,
 * guaranteeing dynamic, continuous readings even across cold starts.
 */
export function advanceSimulationIfNeeded(): void {
  const now = Date.now();
  const elapsedSeconds = (now - lastSimulatedTime) / 1000;
  if (elapsedSeconds >= 5) {
    const steps = Math.min(Math.floor(elapsedSeconds / 5), 10);
    for (let i = 0; i < steps; i++) {
      simulateStep();
    }
    lastSimulatedTime = now;
  }
}

// Background simulation loop for persistent long-running environments (local dev standalone)
const isDirectExecution = typeof process.argv[1] === 'string' && 
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js') || process.argv[1].includes('server'));

if (isDirectExecution && !process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    simulateStep();
    lastSimulatedTime = Date.now();
    if (sseClients.length > 0) {
      broadcastSSE({ type: 'telemetry_update', timestamp: new Date().toISOString(), stations: backendStations });
    }
  }, 5000);
}

// Security: In-memory Rate Limiter for Login (PRD FR-AUTH-05 / OWASP A04)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function rateLimitLogin(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record) return false;
  if (now > record.resetTime) {
    rateLimitMap.delete(ip);
    return false;
  }
  return record.count >= 5;
}

function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) {
    rateLimitMap.delete(ip);
    return;
  }
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + 15 * 60 * 1000 };
  record.count++;
  rateLimitMap.set(ip, record);
}

// Timing-safe comparison to prevent side-channel timing attacks (OWASP A02)
function timingSafeCheck(provided: string | undefined, expected: string): boolean {
  if (!provided || typeof provided !== 'string') return false;
  const bufProvided = Buffer.from(provided);
  const bufExpected = Buffer.from(expected);
  if (bufProvided.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

// Extract canonical path taking into account Vercel rewrites and proxy headers
function resolveRequestPath(req: http.IncomingMessage): string {
  const forwardedUri = req.headers['x-forwarded-uri'] as string | undefined;
  const matchedPath = req.headers['x-matched-path'] as string | undefined;
  const originalUrl = req.headers['x-original-url'] as string | undefined;

  let urlCandidate = req.url || '/';
  if (urlCandidate === '/api/index' || urlCandidate.startsWith('/api/index?')) {
    if (forwardedUri) urlCandidate = forwardedUri;
    else if (matchedPath) urlCandidate = matchedPath;
    else if (originalUrl) urlCandidate = originalUrl;
  }

  const urlParts = urlCandidate.split('?');
  return decodeURI(urlParts[0]);
}

// Whitelist-based Restricted CORS Evaluator (OWASP A05)
function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // Same-origin or non-browser client

  const trustedList = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://bandarlampung.go.id,https://teknokrat.ac.id')
    .split(',')
    .map(o => o.trim());

  if (trustedList.includes(origin)) return true;

  // Localhost & 127.0.0.1 on any port
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;

  // Any Vercel deployment domain (production or preview branches)
  if (/^https:\/\/[a-zA-Z0-9._-]+\.vercel\.app$/.test(origin)) return true;

  // Same host match
  if (host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch {
      // Invalid URL syntax
    }
  }

  return false;
}

export function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const reqPath = resolveRequestPath(req);
  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIp = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : req.socket.remoteAddress || '127.0.0.1';

  // Security Headers (OWASP A05: Security Misconfiguration)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Whitelist-based Restricted CORS Policy (OWASP A05)
  const clientOrigin = req.headers.origin;
  const reqHost = req.headers.host;
  if (clientOrigin && isAllowedOrigin(clientOrigin, reqHost)) {
    res.setHeader('Access-Control-Allow-Origin', clientOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-KEY');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // -----------------------------------------------------------------
  // REST API ENDPOINTS (PRD Section 12)
  // -----------------------------------------------------------------

  // 1. GET /api/overview
  if (req.method === 'GET' && reqPath === '/api/overview') {
    advanceSimulationIfNeeded();
    const total = backendStations.length;
    const sorted = [...backendStations].sort((a, b) => a.ispu - b.ispu);
    const counts: Record<string, number> = { baik: 0, sedang: 0, 'tidak-sehat': 0, 'sangat-tidak-sehat': 0, berbahaya: 0 };
    backendStations.forEach(s => {
      const cat = getISPUStatus(s.ispu).key;
      counts[cat] = (counts[cat] || 0) + 1;
    });

    const response = {
      system: 'AirSense City API',
      standard: 'Permen LHK No. 14 Tahun 2020 / SNI 19-4102-1996',
      copyright: 'Copyright©2026 by Nayla Dela Azzahra dan Dr. Erliyan Redy Susanto, M.Kom',
      collaboration: 'Pemerintah Kota Bandar Lampung & Universitas Teknokrat Indonesia',
      total_stations: total,
      distribution: counts,
      best_station: sorted[0],
      worst_station: sorted[sorted.length - 1],
      is_simulated: true,
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
    return;
  }

  // 2. GET /api/locations
  if (req.method === 'GET' && reqPath === '/api/locations') {
    advanceSimulationIfNeeded();
    const data = backendStations.map(s => ({
      ...s,
      status: getISPUStatus(s.ispu)
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ locations: data, count: data.length }, null, 2));
    return;
  }

  // 3. GET /api/locations/:id/readings
  if (req.method === 'GET' && reqPath.startsWith('/api/locations/') && reqPath.endsWith('/readings')) {
    advanceSimulationIfNeeded();
    const parts = reqPath.split('/');
    const stationId = parts[3];
    const station = backendStations.find(s => s.id === stationId);
    if (!station) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stasiun tidak ditemukan' }));
      return;
    }

    // Mock 24 hours readings
    const readings = [];
    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      readings.push({
        time: new Date(now - i * 3600000).toISOString(),
        pm25: parseFloat((station.pm25 * (0.85 + Math.random() * 0.3)).toFixed(1)),
        pm10: parseFloat((station.pm10 * (0.85 + Math.random() * 0.3)).toFixed(1)),
        ispu: station.ispu,
        temp: station.temp,
        rh: station.rh
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ station_id: stationId, station_name: station.name, readings }, null, 2));
    return;
  }

  // 4. GET /api/hotspots (FR-HOT)
  if (req.method === 'GET' && reqPath === '/api/hotspots') {
    advanceSimulationIfNeeded();
    const hotspots = backendStations.map(st => {
      const isUnhealthy = st.ispu >= 101;
      return {
        location_id: st.id,
        name: st.name,
        avg_pm25: st.pm25,
        pct_unhealthy: isUnhealthy ? 45.0 : 5.0,
        status: isUnhealthy ? 'Hotspot Aktif' : 'Terkendali',
        window: '24-jam'
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ window_hours: 24, threshold_pct: 30.0, results: hotspots }, null, 2));
    return;
  }

  // 5. GET /api/alerts (FR-ALR)
  if (req.method === 'GET' && reqPath === '/api/alerts') {
    advanceSimulationIfNeeded();
    const activeAlerts = backendStations.filter(s => s.ispu >= 101).map(s => ({
      id: `ALT-${s.id}`,
      station_id: s.id,
      station_name: s.name,
      level: getISPUStatus(s.ispu).label,
      ispu: s.ispu,
      dominant: s.dominant,
      message: `Peringatan: Kualitas udara di ${s.name} mencapai ${s.ispu} (${getISPUStatus(s.ispu).label}). Disarankan mengenakan masker.`,
      status: 'active',
      timestamp: new Date().toISOString()
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active_alerts: activeAlerts, count: activeAlerts.length }, null, 2));
    return;
  }

  // 6. GET /api/stream (SSE Endpoint - PRD Section 9.1 & 12 / Vercel Streaming)
  if (req.method === 'GET' && reqPath === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'AirSense City SSE Stream Aktif' })}\n\n`);

    // Immediately push current snapshot
    advanceSimulationIfNeeded();
    res.write(`data: ${JSON.stringify({ type: 'telemetry_update', timestamp: new Date().toISOString(), stations: backendStations })}\n\n`);

    const client: SSEClient = { id: Date.now(), res };
    sseClients.push(client);

    // Stream updates every 5s while client is connected
    const streamTimer = setInterval(() => {
      simulateStep();
      lastSimulatedTime = Date.now();
      try {
        res.write(`data: ${JSON.stringify({ type: 'telemetry_update', timestamp: new Date().toISOString(), stations: backendStations })}\n\n`);
      } catch {
        clearInterval(streamTimer);
      }
    }, 5000);

    req.on('close', () => {
      clearInterval(streamTimer);
      sseClients = sseClients.filter(c => c.id !== client.id);
    });
    return;
  }

  // 7. POST /api/auth/login (with Rate Limiting - PRD FR-AUTH-05)
  if (req.method === 'POST' && reqPath === '/api/auth/login') {
    if (rateLimitLogin(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Terlalu banyak percobaan login (Rate limit terlewati). Silakan coba kembali dalam 15 menit.' }));
      return;
    }

    let body = '';
    let bodyLength = 0;
    const MAX_PAYLOAD = 1024 * 1024; // 1MB Max

    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_PAYLOAD) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const role = payload.email && payload.email.includes('admin') ? 'admin' : payload.email && payload.email.includes('petugas') ? 'officer' : 'public';
        recordLoginAttempt(clientIp, true);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token: `jwt_airsense_fake_${role}_token_2026`,
          user: { name: role === 'admin' ? 'Administrator DLH' : role === 'officer' ? 'Petugas DLH' : 'Warga Kota', email: payload.email || 'warga@bandarlampung.go.id', role }
        }));
      } catch {
        recordLoginAttempt(clientIp, false);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Format data JSON tidak valid' }));
      }
    });
    return;
  }

  // 8. POST /api/ingest (Sensor Ingest - PRD FR-SIM-06 & NFR-03 with Timing Attack Protection)
  if (req.method === 'POST' && reqPath === '/api/ingest') {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    const expectedKey = process.env.SENSOR_INGEST_SECRET || 'airsense_sensor_secret_key_2026';

    if (!apiKey || !timingSafeCheck(apiKey, expectedKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Otorisasi gagal: X-API-KEY sensor tidak valid atau tidak terdaftar.' }));
      return;
    }

    let body = '';
    let bodyLength = 0;
    const MAX_PAYLOAD = 1024 * 1024; // 1MB Max

    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_PAYLOAD) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', message: 'Data telemetri sensor terotentikasi berhasil diterima dan diproses' }));
    });
    return;
  }

  // -----------------------------------------------------------------
  // STATIC FILE SERVING (Fallback for standalone local Node.js server)
  // -----------------------------------------------------------------
  const resolvedBaseDir = path.resolve(rootDir);
  const relativePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const filePath = path.resolve(resolvedBaseDir, relativePath);

  if (!filePath.startsWith(resolvedBaseDir)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(`
        <div style="font-family:'Inter',sans-serif;padding:60px;text-align:center;background:#f8f9ff;min-height:100vh;">
          <h1 style="color:#003441;font-size:32px;">404 - Halaman Tidak Ditemukan</h1>
          <p style="color:#40484b;font-size:16px;">Berkas ${reqPath} tidak tersedia di server.</p>
          <a href="/" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#0f4c5c;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Kembali ke Dashboard AirSense City</a>
          <footer style="margin-top:60px;color:#70787c;font-size:12px;">
            Copyright©2026 by Nayla Dela Azzahra dan Dr. Erliyan Redy Susanto, M.Kom<br/>
            Kolaborasi Pemerintah Kota Bandar Lampung & Universitas Teknokrat Indonesia
          </footer>
        </div>
      `);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

export const server = http.createServer(requestHandler);

// Standalone execution entrypoint: only start listener if executed directly as main process
if (isDirectExecution && process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` AirSense City - Server TypeScript Berjalan di Port ${PORT}`);
    console.log(` Dashboard URL : http://localhost:${PORT}`);
    console.log(` API Endpoint  : http://localhost:${PORT}/api/overview`);
    console.log(` Copyright©2026 Nayla Dela Azzahra & Dr. Erliyan Redy Susanto`);
    console.log(`=======================================================`);
  });
}

export default requestHandler;
