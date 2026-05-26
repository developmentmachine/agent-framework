import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentRuntime } from './runtime.js';
import type { StreamEvent } from './types/contracts.js';
import type { TerminalReason } from './types/domain.js';

export interface WebhookSurfaceOptions {
  port?: number;
  host?: string;
  path?: string;
  runtime: AgentRuntime;
}

export class WebhookSurface {
  constructor(private readonly options: WebhookSurfaceOptions) {}

  start(): Promise<void> {
    const path = this.options.path ?? '/webhook';
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== path) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      try {
        const body = await readBody(req);
        const payload = JSON.parse(body) as {
          sessionId?: string;
          message?: string;
          channel?: string;
        };

        const events: StreamEvent[] = [];
        const generator = this.options.runtime.router.route({
          sessionId: payload.sessionId ?? 'webhook',
          input: { role: 'user', content: payload.message ?? '' },
        });

        let result = await generator.next();
        while (!result.done) {
          events.push(result.value);
          result = await generator.next();
        }

        const reason = (result.value ?? { kind: 'completed' }) as TerminalReason;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, events, reason }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
    });

    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 8787;

    return new Promise((resolve) => {
      server.listen(port, host, () => resolve());
    });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
