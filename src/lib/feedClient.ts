import type { NormalizedPodcastFeed } from './rss';

type FeedErrorPayload = {
  error?: string;
};

export async function fetchPodcastFeed(feedUrl: string): Promise<NormalizedPodcastFeed> {
  const response = await fetch(`/api/feed?url=${encodeURIComponent(feedUrl)}`);
  const payload = await parseFeedPayload(response);

  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload, response.status));
  }

  return payload as NormalizedPodcastFeed;
}

async function parseFeedPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) {
    if (response.ok) {
      throw new Error('Feed response was not valid JSON');
    }
    return undefined;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    if (response.ok) {
      throw new Error('Feed response was not valid JSON');
    }
    return undefined;
  }
}

function errorMessageFromPayload(payload: unknown, status: number): string {
  if (isFeedErrorPayload(payload) && payload.error) {
    return payload.error;
  }

  return `Feed request failed with HTTP ${status}`;
}

function isFeedErrorPayload(payload: unknown): payload is FeedErrorPayload {
  return typeof payload === 'object' && payload !== null && 'error' in payload;
}
