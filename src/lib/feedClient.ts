import type { NormalizedPodcastFeed } from './rss';

export async function fetchPodcastFeed(feedUrl: string): Promise<NormalizedPodcastFeed> {
  const response = await fetch(`/api/feed?url=${encodeURIComponent(feedUrl)}`);
  const payload = (await response.json()) as NormalizedPodcastFeed | { error?: string };

  if (!response.ok) {
    throw new Error('error' in payload && payload.error ? payload.error : 'Unable to load feed');
  }

  return payload as NormalizedPodcastFeed;
}
