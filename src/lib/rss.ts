import { XMLParser } from 'fast-xml-parser';
import type { Episode, FeedMetadata } from '../types';

type XmlRecord = Record<string, unknown>;

export interface NormalizedPodcastFeed {
  metadata: FeedMetadata;
  episodes: Episode[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

export function normalizePodcastFeed(xml: string, sourceUrl: string): NormalizedPodcastFeed {
  const parsed = parser.parse(xml) as XmlRecord;
  const rssChannel = getRecord(getRecord(first(parsed.rss))?.channel);
  const atomFeed = getRecord(first(parsed.feed));

  if (rssChannel) {
    return normalizeRssChannel(rssChannel, sourceUrl);
  }

  if (atomFeed) {
    return normalizeAtomFeed(atomFeed, sourceUrl);
  }

  throw new Error('Feed XML is not RSS or Atom');
}

export function stableId(input: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function parseDurationToSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const cleanValue = value.trim();
  if (/^\d+$/.test(cleanValue)) {
    return Number(cleanValue);
  }

  const parts = cleanValue.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return undefined;
}

export function stripHtml(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const clean = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean || undefined;
}

function normalizeRssChannel(channel: XmlRecord, sourceUrl: string): NormalizedPodcastFeed {
  const feedId = stableId(`feed:${sourceUrl}`);
  const title = textFrom(channel, ['title']) ?? hostnameFallback(sourceUrl);
  const feedImage = imageFrom(channel, ['itunes:image', 'image', 'media:thumbnail', 'media:content']);
  const metadata: FeedMetadata = {
    id: feedId,
    title,
    author: textFrom(channel, ['itunes:author', 'author', 'managingEditor']),
    description: stripHtml(textFrom(channel, ['itunes:summary', 'description'])),
    image: feedImage,
    sourceUrl,
    lastFetchedAt: Date.now()
  };

  const rawItems = asArray(channel.item);
  const episodes = rawItems
    .map((item) => normalizeRssItem(item, metadata, sourceUrl))
    .filter((episode): episode is Episode => Boolean(episode));

  return { metadata, episodes };
}

function normalizeRssItem(value: unknown, metadata: FeedMetadata, sourceUrl: string): Episode | undefined {
  const item = getRecord(value);
  if (!item) {
    return undefined;
  }

  const enclosure = first(item.enclosure);
  const audioUrl = attribute(enclosure, ['@_url', 'url', 'href']) ?? textFrom(item, ['media:content']);
  if (!audioUrl) {
    return undefined;
  }

  const title = textFrom(item, ['title']) ?? 'Untitled episode';
  const guid = textFrom(item, ['guid', 'id']);
  const publishedAt = normalizeDate(textFrom(item, ['pubDate', 'published', 'updated', 'dc:date']));
  const image = imageFrom(item, ['itunes:image', 'media:thumbnail', 'media:content']) ?? metadata.image;

  return {
    id: stableId(`episode:${sourceUrl}:${guid ?? audioUrl}:${title}`),
    feedId: metadata.id,
    feedTitle: metadata.title,
    guid,
    title,
    description: stripHtml(textFrom(item, ['itunes:summary', 'description', 'content:encoded'])),
    audioUrl,
    audioType: attribute(enclosure, ['@_type', 'type']),
    duration: parseDurationToSeconds(textFrom(item, ['itunes:duration'])),
    publishedAt,
    image
  };
}

function normalizeAtomFeed(feed: XmlRecord, sourceUrl: string): NormalizedPodcastFeed {
  const feedId = stableId(`feed:${sourceUrl}`);
  const title = textFrom(feed, ['title']) ?? hostnameFallback(sourceUrl);
  const feedImage = atomImage(feed);
  const metadata: FeedMetadata = {
    id: feedId,
    title,
    author: atomAuthor(feed.author),
    description: stripHtml(textFrom(feed, ['subtitle', 'summary'])),
    image: feedImage,
    sourceUrl,
    lastFetchedAt: Date.now()
  };

  const episodes = asArray(feed.entry)
    .map((entry) => normalizeAtomEntry(entry, metadata, sourceUrl))
    .filter((episode): episode is Episode => Boolean(episode));

  return { metadata, episodes };
}

function normalizeAtomEntry(value: unknown, metadata: FeedMetadata, sourceUrl: string): Episode | undefined {
  const entry = getRecord(value);
  if (!entry) {
    return undefined;
  }

  const links = asArray(entry.link);
  const enclosure = links.find((link) => attribute(link, ['@_rel', 'rel']) === 'enclosure') ?? links[0];
  const audioUrl = attribute(enclosure, ['@_href', 'href']);
  if (!audioUrl) {
    return undefined;
  }

  const title = textFrom(entry, ['title']) ?? 'Untitled episode';
  const guid = textFrom(entry, ['id']);

  return {
    id: stableId(`episode:${sourceUrl}:${guid ?? audioUrl}:${title}`),
    feedId: metadata.id,
    feedTitle: metadata.title,
    guid,
    title,
    description: stripHtml(textFrom(entry, ['summary', 'content'])),
    audioUrl,
    audioType: attribute(enclosure, ['@_type', 'type']),
    publishedAt: normalizeDate(textFrom(entry, ['published', 'updated'])),
    image: atomImage(entry) ?? metadata.image
  };
}

function textFrom(record: XmlRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const text = textValue(record[key]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function imageFrom(record: XmlRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = first(record[key]);
    const direct = textValue(value);
    if (direct && looksLikeUrl(direct)) {
      return direct;
    }

    const href = attribute(value, ['@_href', 'href', '@_url', 'url']);
    if (href) {
      return href;
    }

    const nestedUrl = getRecord(value)?.url;
    const nestedText = textValue(nestedUrl);
    if (nestedText) {
      return nestedText;
    }
  }
  return undefined;
}

function atomImage(record: XmlRecord): string | undefined {
  const icon = textFrom(record, ['icon', 'logo']);
  if (icon) {
    return icon;
  }

  return asArray(record.link)
    .map((link) => {
      const rel = attribute(link, ['@_rel', 'rel']);
      if (rel === 'icon' || rel === 'logo') {
        return attribute(link, ['@_href', 'href']);
      }
      return undefined;
    })
    .find(Boolean);
}

function atomAuthor(value: unknown): string | undefined {
  const author = getRecord(first(value));
  if (!author) {
    return textValue(value);
  }
  return textFrom(author, ['name']) ?? textValue(author);
}

function attribute(value: unknown, keys: string[]): string | undefined {
  const record = getRecord(first(value));
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const text = textValue(record[key]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  const current = first(value);

  if (typeof current === 'string') {
    return current.trim() || undefined;
  }

  if (typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }

  const record = getRecord(current);
  if (!record) {
    return undefined;
  }

  return (
    textValue(record['#text']) ??
    textValue(record['#cdata']) ??
    textValue(record._) ??
    textValue(record.value)
  );
}

function getRecord(value: unknown): XmlRecord | undefined {
  const current = first(value);
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    return current as XmlRecord;
  }
  return undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function hostnameFallback(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return 'Podcast';
  }
}

function looksLikeUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/');
}
