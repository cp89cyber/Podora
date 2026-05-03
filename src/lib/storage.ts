import { openDB, type DBSchema } from 'idb';
import { emptyQueue, sanitizeQueue } from './queue';
import type { Episode, LibraryState, PlaybackProgress, PlayerSettings, QueueState, Subscription } from '../types';

const DB_NAME = 'podora';
const DB_VERSION = 1;
const QUEUE_KEY = 'queue';
const SETTINGS_KEY = 'settings';

export const defaultSettings: PlayerSettings = {
  playbackRate: 1
};

interface PodoraDB extends DBSchema {
  subscriptions: {
    key: string;
    value: Subscription;
    indexes: {
      'by-created': number;
    };
  };
  episodes: {
    key: string;
    value: Episode;
    indexes: {
      'by-feed': string;
      'by-published': string;
    };
  };
  progress: {
    key: string;
    value: PlaybackProgress;
  };
  keyval: {
    key: string;
    value: QueueState | PlayerSettings;
  };
}

const dbPromise = openDB<PodoraDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    const subscriptions = db.createObjectStore('subscriptions', { keyPath: 'id' });
    subscriptions.createIndex('by-created', 'createdAt');

    const episodes = db.createObjectStore('episodes', { keyPath: 'id' });
    episodes.createIndex('by-feed', 'feedId');
    episodes.createIndex('by-published', 'publishedAt');

    db.createObjectStore('progress', { keyPath: 'episodeId' });
    db.createObjectStore('keyval');
  }
});

export async function loadLibrary(): Promise<LibraryState> {
  const db = await dbPromise;
  const [subscriptions, episodes, progress, queueValue, settingsValue] = await Promise.all([
    db.getAll('subscriptions'),
    db.getAll('episodes'),
    db.getAll('progress'),
    db.get('keyval', QUEUE_KEY),
    db.get('keyval', SETTINGS_KEY)
  ]);

  const availableIds = new Set(episodes.map((episode) => episode.id));
  const queue = sanitizeQueue((queueValue as QueueState | undefined) ?? emptyQueue, availableIds);

  return {
    subscriptions: subscriptions.sort((a, b) => a.createdAt - b.createdAt),
    episodes,
    progress,
    queue,
    settings: {
      ...defaultSettings,
      ...((settingsValue as PlayerSettings | undefined) ?? {})
    }
  };
}

export async function upsertSubscription(subscription: Subscription, episodes: Episode[]) {
  const db = await dbPromise;
  const tx = db.transaction(['subscriptions', 'episodes'], 'readwrite');
  const existingEpisodes = await tx.objectStore('episodes').index('by-feed').getAll(subscription.id);

  await tx.objectStore('subscriptions').put(subscription);
  await Promise.all(existingEpisodes.map((episode) => tx.objectStore('episodes').delete(episode.id)));
  await Promise.all(episodes.map((episode) => tx.objectStore('episodes').put(episode)));
  await tx.done;
}

export async function removeSubscription(feedId: string) {
  const db = await dbPromise;
  const tx = db.transaction(['subscriptions', 'episodes', 'progress'], 'readwrite');
  const episodes = await tx.objectStore('episodes').index('by-feed').getAll(feedId);

  await tx.objectStore('subscriptions').delete(feedId);
  await Promise.all(
    episodes.flatMap((episode) => [
      tx.objectStore('episodes').delete(episode.id),
      tx.objectStore('progress').delete(episode.id)
    ])
  );
  await tx.done;
}

export async function savePlaybackProgress(progress: PlaybackProgress) {
  const db = await dbPromise;
  await db.put('progress', progress);
}

export async function saveQueueState(queue: QueueState) {
  const db = await dbPromise;
  await db.put('keyval', queue, QUEUE_KEY);
}

export async function savePlayerSettings(settings: PlayerSettings) {
  const db = await dbPromise;
  await db.put('keyval', settings, SETTINGS_KEY);
}
