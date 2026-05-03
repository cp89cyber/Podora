import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { buildFeedResponse, FeedProxyError } from './api/feed';

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function feedProxyDevPlugin(): Plugin {
  return {
    name: 'podora-feed-proxy-dev',
    configureServer(server) {
      server.middlewares.use('/api/feed', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }

        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        const rawFeedUrl = requestUrl.searchParams.get('url');

        try {
          const feed = await buildFeedResponse(rawFeedUrl);
          sendJson(res, 200, feed);
        } catch (error) {
          const statusCode = error instanceof FeedProxyError ? error.statusCode : 500;
          const message = error instanceof Error ? error.message : 'Unable to load feed';
          server.config.logger.warn(`[podora-feed-proxy] ${message}`);
          sendJson(res, statusCode, { error: message });
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    feedProxyDevPlugin()
  ]
});
