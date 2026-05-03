export interface FeedMetadata {
  id: string;
  title: string;
  author?: string;
  description?: string;
  image?: string;
  sourceUrl: string;
  lastFetchedAt: number;
}

export interface Episode {
  id: string;
  feedId: string;
  feedTitle: string;
  guid?: string;
  title: string;
  description?: string;
  audioUrl: string;
  audioType?: string;
  duration?: number;
  publishedAt?: string;
  image?: string;
}

export interface Subscription {
  id: string;
  feedUrl: string;
  metadata: FeedMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface PlaybackProgress {
  episodeId: string;
  position: number;
  duration?: number;
  completed: boolean;
  updatedAt: number;
}

export interface QueueState {
  episodeIds: string[];
  currentEpisodeId?: string;
}

export interface PlayerSettings {
  playbackRate: number;
}

export interface LibraryState {
  subscriptions: Subscription[];
  episodes: Episode[];
  progress: PlaybackProgress[];
  queue: QueueState;
  settings: PlayerSettings;
}
