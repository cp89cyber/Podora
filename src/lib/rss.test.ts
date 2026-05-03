import { describe, expect, it } from 'vitest';
import { normalizePodcastFeed, parseDurationToSeconds, stableId, stripHtml } from './rss';

describe('normalizePodcastFeed', () => {
  it('normalizes podcast RSS metadata and audio episodes', () => {
    const feed = normalizePodcastFeed(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Example Show</title>
          <itunes:author>Example Network</itunes:author>
          <description><![CDATA[<p>Sharp conversations.</p>]]></description>
          <itunes:image href="https://cdn.example.com/show.jpg" />
          <item>
            <guid>episode-1</guid>
            <title>Launch</title>
            <description><![CDATA[<p>Hello audio.</p>]]></description>
            <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
            <itunes:duration>01:02:03</itunes:duration>
            <enclosure url="https://cdn.example.com/launch.mp3" type="audio/mpeg" length="123" />
          </item>
          <item>
            <title>Notes only</title>
          </item>
        </channel>
      </rss>`,
      'https://feeds.example.com/show.xml'
    );

    expect(feed.metadata.title).toBe('Example Show');
    expect(feed.metadata.author).toBe('Example Network');
    expect(feed.metadata.image).toBe('https://cdn.example.com/show.jpg');
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]).toMatchObject({
      feedTitle: 'Example Show',
      guid: 'episode-1',
      title: 'Launch',
      description: 'Hello audio.',
      audioUrl: 'https://cdn.example.com/launch.mp3',
      audioType: 'audio/mpeg',
      duration: 3723
    });
  });

  it('normalizes atom enclosures', () => {
    const feed = normalizePodcastFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Cast</title>
        <author><name>Atom Author</name></author>
        <entry>
          <id>tag:example.com,2024:1</id>
          <title>Atom Episode</title>
          <updated>2024-02-02T00:00:00Z</updated>
          <link rel="enclosure" href="https://example.com/audio.m4a" type="audio/mp4" />
        </entry>
      </feed>`,
      'https://example.com/atom.xml'
    );

    expect(feed.metadata.title).toBe('Atom Cast');
    expect(feed.metadata.author).toBe('Atom Author');
    expect(feed.episodes[0]?.audioUrl).toBe('https://example.com/audio.m4a');
  });
});

describe('rss helpers', () => {
  it('creates stable ids', () => {
    expect(stableId('same')).toBe(stableId('same'));
    expect(stableId('same')).not.toBe(stableId('different'));
  });

  it('parses podcast durations', () => {
    expect(parseDurationToSeconds('90')).toBe(90);
    expect(parseDurationToSeconds('04:05')).toBe(245);
    expect(parseDurationToSeconds('1:02:03')).toBe(3723);
    expect(parseDurationToSeconds('unknown')).toBeUndefined();
  });

  it('strips html from summaries', () => {
    expect(stripHtml('<p>Hello <strong>world</strong>.</p>')).toBe('Hello world .');
  });
});
