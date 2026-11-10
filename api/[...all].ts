/**
 * AirSense City - Vercel Serverless Function Catch-All Route (Nested /api/*)
 * Handles /api/overview, /api/locations, /api/stream, /api/auth/login, etc.
 * Copyright©2026 by Nayla Dela Azzahra dan Dr. Erliyan Redy Susanto, M.Kom
 */

import type { IncomingMessage, ServerResponse } from 'http';
import requestHandler from '../server.ts';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  return requestHandler(req, res);
}
