/**
 * AirSense City - Vercel Serverless Function Entry Point (Root /api)
 * Forwards requests to the unified server.ts request handler.
 * Copyright©2026 by Nayla Dela Azzahra dan Dr. Erliyan Redy Susanto, M.Kom
 */

import type { IncomingMessage, ServerResponse } from 'http';
import requestHandler from '../server.ts';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  return requestHandler(req, res);
}
