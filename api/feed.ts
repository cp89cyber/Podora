import dns from 'node:dns/promises';
import net from 'node:net';
import { normalizePodcastFeed, type NormalizedPodcastFeed } from '../src/lib/rss';

const MAX_FEED_BYTES = 8_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;

type QueryValue = string | string[] | undefined;

interface FeedRequest {
  method?: string;
  query: Record<string, QueryValue>;
}

interface FeedResponse {
  status: (statusCode: number) => FeedResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
}

export class FeedProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'FeedProxyError';
  }
}

export async function buildFeedResponse(rawUrl: QueryValue | null): Promise<NormalizedPodcastFeed> {
  const feedUrl = firstQueryValue(rawUrl);
  if (!feedUrl) {
    throw new FeedProxyError('Missing feed URL');
  }

  const { xml, finalUrl } = await fetchFeedXml(feedUrl);
  try {
    return normalizePodcastFeed(xml, finalUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Feed XML could not be parsed';
    throw new FeedProxyError(message, 422);
  }
}

export default async function handler(req: FeedRequest, res: FeedResponse) {
  if (req.method && req.method !== 'GET') {
    writeJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const feed = await buildFeedResponse(req.query.url);
    res.setHeader('cache-control', 's-maxage=600, stale-while-revalidate=86400');
    writeJson(res, 200, feed);
  } catch (error) {
    const statusCode = error instanceof FeedProxyError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Unable to load feed';
    writeJson(res, statusCode, { error: message });
  }
}

function writeJson(res: FeedResponse, statusCode: number, body: unknown) {
  res.status(statusCode);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

function firstQueryValue(value: QueryValue | null): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}

async function fetchFeedXml(rawUrl: string): Promise<{ xml: string; finalUrl: string }> {
  let currentUrl = await validateRemoteUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
          'user-agent': 'Podora/0.1 (+https://github.com/cp89cyber/Podora)'
        }
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new FeedProxyError('Feed redirect did not include a location', 502);
        }

        currentUrl = await validateRemoteUrl(new URL(location, currentUrl).toString());
        continue;
      }

      if (!response.ok) {
        throw new FeedProxyError(`Feed request failed with HTTP ${response.status}`, 502);
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_FEED_BYTES) {
        throw new FeedProxyError('Feed is too large', 413);
      }

      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_FEED_BYTES) {
        throw new FeedProxyError('Feed is too large', 413);
      }

      return {
        xml: new TextDecoder().decode(body),
        finalUrl: currentUrl
      };
    } catch (error) {
      if (error instanceof FeedProxyError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FeedProxyError('Feed request timed out', 504);
      }
      throw new FeedProxyError('Unable to fetch feed', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new FeedProxyError('Feed redirected too many times', 508);
}

async function validateRemoteUrl(rawUrl: string): Promise<string> {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FeedProxyError('Feed URL is not valid');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new FeedProxyError('Feed URL must use HTTP or HTTPS');
  }

  if (parsed.username || parsed.password) {
    throw new FeedProxyError('Feed URL credentials are not supported');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw new FeedProxyError('Feed URL host is not allowed');
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: false });
  } catch {
    throw new FeedProxyError('Feed URL host could not be resolved');
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new FeedProxyError('Feed URL resolves to a private network');
  }

  return parsed.toString();
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '0.0.0.0'
  );
}

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [first = 0, second = 0] = address.split('.').map((part) => Number(part));
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4) {
      return isPrivateAddress(mappedIpv4[1]);
    }

    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return true;
}
