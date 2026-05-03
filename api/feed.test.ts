import dns from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFeedResponse } from './feed';

const validRss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Large Valid Show</title>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://cdn.example.com/episode.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;

describe('buildFeedResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts valid feeds larger than the previous 3 MB cap', async () => {
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(validRss, {
        status: 200,
        headers: { 'content-length': '3947518', 'content-type': 'application/xml' }
      })
    );

    const feed = await buildFeedResponse('https://feeds.example.com/show.xml');

    expect(feed.metadata.title).toBe('Large Valid Show');
    expect(feed.episodes).toHaveLength(1);
  });

  it('rejects feeds above the 8 MB cap', async () => {
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(validRss, {
        status: 200,
        headers: { 'content-length': '8000001', 'content-type': 'application/xml' }
      })
    );

    await expect(buildFeedResponse('https://feeds.example.com/show.xml')).rejects.toMatchObject({
      message: 'Feed is too large',
      statusCode: 413
    });
  });
});

function mockPublicDns() {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
}
