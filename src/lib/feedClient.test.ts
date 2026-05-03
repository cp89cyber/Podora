import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPodcastFeed } from './feedClient';
import type { NormalizedPodcastFeed } from './rss';

const feed: NormalizedPodcastFeed = {
  metadata: {
    id: 'feed-1',
    title: 'Example Show',
    sourceUrl: 'https://example.com/feed.xml',
    lastFetchedAt: 1
  },
  episodes: []
};

describe('fetchPodcastFeed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a normalized feed from the feed proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(feed));

    await expect(fetchPodcastFeed('https://example.com/feed.xml')).resolves.toEqual(feed);
    expect(fetchMock).toHaveBeenCalledWith('/api/feed?url=https%3A%2F%2Fexample.com%2Ffeed.xml');
  });

  it('uses JSON error messages from the feed proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'Feed is too large' }, { status: 413 }));

    await expect(fetchPodcastFeed('https://example.com/feed.xml')).rejects.toThrow('Feed is too large');
  });

  it('handles non-JSON server failures without surfacing a parser error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('A server error occurred', { status: 500 }));

    await expect(fetchPodcastFeed('https://example.com/feed.xml')).rejects.toThrow(
      'Feed request failed with HTTP 500'
    );
  });

  it('handles invalid successful responses as controlled errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('A server error occurred', { status: 200 }));

    await expect(fetchPodcastFeed('https://example.com/feed.xml')).rejects.toThrow(
      'Feed response was not valid JSON'
    );
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers
    }
  });
}
