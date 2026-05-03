import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FastForward,
  Gauge,
  Headphones,
  Home,
  ListMusic,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  Settings,
  SkipBack,
  SkipForward,
  Trash2,
  WifiOff,
  X
} from 'lucide-react';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { fetchPodcastFeed } from './lib/feedClient';
import {
  createQueueFromList,
  emptyQueue,
  enqueueEpisode,
  removeEpisodeFromQueue,
  sanitizeQueue,
  selectNext,
  selectPrevious
} from './lib/queue';
import {
  defaultSettings,
  loadLibrary,
  removeSubscription as removeStoredSubscription,
  savePlaybackProgress,
  savePlayerSettings,
  saveQueueState,
  upsertSubscription
} from './lib/storage';
import type { Episode, LibraryState, PlaybackProgress, PlayerSettings, QueueState, Subscription } from './types';

type Tab = 'home' | 'library' | 'queue' | 'player';

const initialLibrary: LibraryState = {
  subscriptions: [],
  episodes: [],
  progress: [],
  queue: emptyQueue,
  settings: defaultSettings
};

const rates = [0.8, 1, 1.25, 1.5, 1.75, 2];

export default function App() {
  const [library, setLibrary] = useState<LibraryState>(initialLibrary);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingFeed, setIsAddingFeed] = useState(false);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [playToken, setPlayToken] = useState(0);

  useEffect(() => {
    let isMounted = true;
    loadLibrary()
      .then((snapshot) => {
        if (isMounted) {
          setLibrary(snapshot);
        }
      })
      .catch(() => {
        if (isMounted) {
          setNotice('Local library could not be opened.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const episodesById = useMemo(
    () => new Map(library.episodes.map((episode) => [episode.id, episode])),
    [library.episodes]
  );
  const progressById = useMemo(
    () => new Map(library.progress.map((progress) => [progress.episodeId, progress])),
    [library.progress]
  );
  const recentEpisodes = useMemo(
    () =>
      [...library.episodes].sort((a, b) => {
        const aDate = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bDate = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return bDate - aDate;
      }),
    [library.episodes]
  );
  const queueEpisodes = useMemo(
    () => library.queue.episodeIds.map((episodeId) => episodesById.get(episodeId)).filter(Boolean) as Episode[],
    [episodesById, library.queue.episodeIds]
  );
  const currentEpisode = library.queue.currentEpisodeId ? episodesById.get(library.queue.currentEpisodeId) : undefined;
  const currentProgress = currentEpisode ? progressById.get(currentEpisode.id) : undefined;

  const persistProgress = useCallback((progress: PlaybackProgress) => {
    setLibrary((current) => ({
      ...current,
      progress: upsertProgress(current.progress, progress)
    }));
    void savePlaybackProgress(progress);
  }, []);

  const updateQueue = useCallback((queue: QueueState) => {
    setLibrary((current) => ({ ...current, queue }));
    void saveQueueState(queue);
  }, []);

  const playQueue = useCallback(
    (queue: QueueState) => {
      updateQueue(queue);
      setPlayToken((token) => token + 1);
    },
    [updateQueue]
  );

  const goToNext = useCallback(() => {
    const nextEpisodeId = selectNext(library.queue);
    if (nextEpisodeId) {
      playQueue({ ...library.queue, currentEpisodeId: nextEpisodeId });
    }
  }, [library.queue, playQueue]);

  const goToPrevious = useCallback(() => {
    const previousEpisodeId = selectPrevious(library.queue);
    if (previousEpisodeId) {
      playQueue({ ...library.queue, currentEpisodeId: previousEpisodeId });
    }
  }, [library.queue, playQueue]);

  const player = useAudioPlayer({
    episode: currentEpisode,
    progress: currentProgress,
    settings: library.settings,
    playToken,
    onProgress: persistProgress,
    onEnded: goToNext,
    onNext: goToNext,
    onPrevious: goToPrevious
  });

  const handleAddFeed = useCallback(
    async (feedUrl: string) => {
      setIsAddingFeed(true);
      setNotice(null);

      try {
        const feed = await fetchPodcastFeed(feedUrl);
        const now = Date.now();
        const existing = library.subscriptions.find((subscription) => subscription.id === feed.metadata.id);
        const subscription: Subscription = {
          id: feed.metadata.id,
          feedUrl,
          metadata: feed.metadata,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };

        await upsertSubscription(subscription, feed.episodes);
        const snapshot = await loadLibrary();
        setLibrary(snapshot);
        setNotice(`Added ${feed.metadata.title}.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Feed could not be added.');
      } finally {
        setIsAddingFeed(false);
      }
    },
    [library.subscriptions]
  );

  const refreshFeed = useCallback(
    async (subscription: Subscription) => {
      setRefreshingFeedId(subscription.id);
      setNotice(null);

      try {
        const feed = await fetchPodcastFeed(subscription.feedUrl);
        const updatedSubscription: Subscription = {
          ...subscription,
          metadata: feed.metadata,
          updatedAt: Date.now()
        };
        await upsertSubscription(updatedSubscription, feed.episodes);
        const snapshot = await loadLibrary();
        setLibrary(snapshot);
        setNotice(`${feed.metadata.title} is current.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Feed could not be refreshed.');
      } finally {
        setRefreshingFeedId(null);
      }
    },
    []
  );

  const deleteFeed = useCallback(
    async (feedId: string) => {
      await removeStoredSubscription(feedId);
      const remainingEpisodes = library.episodes.filter((episode) => episode.feedId !== feedId);
      const nextQueue = sanitizeQueue(library.queue, new Set(remainingEpisodes.map((episode) => episode.id)));
      await saveQueueState(nextQueue);
      setLibrary((current) => ({
        ...current,
        subscriptions: current.subscriptions.filter((subscription) => subscription.id !== feedId),
        episodes: current.episodes.filter((episode) => episode.feedId !== feedId),
        progress: current.progress.filter((progress) => remainingEpisodes.some((episode) => episode.id === progress.episodeId)),
        queue: nextQueue
      }));
    },
    [library.episodes, library.queue]
  );

  const playEpisodeList = useCallback(
    (episodes: Episode[], episode: Episode) => {
      playQueue(createQueueFromList(episodes.map((item) => item.id), episode.id));
      setActiveTab('player');
    },
    [playQueue]
  );

  const addEpisodeToQueue = useCallback(
    (episode: Episode) => {
      const nextQueue = enqueueEpisode(library.queue, episode.id);
      updateQueue(nextQueue);
      setNotice(`${episode.title} added to queue.`);
    },
    [library.queue, updateQueue]
  );

  const removeQueuedEpisode = useCallback(
    (episodeId: string) => {
      updateQueue(removeEpisodeFromQueue(library.queue, episodeId));
    },
    [library.queue, updateQueue]
  );

  const updateSettings = useCallback((settings: PlayerSettings) => {
    setLibrary((current) => ({ ...current, settings }));
    void savePlayerSettings(settings);
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.svg" alt="" className="brand-mark" />
          <div>
            <strong>Podora</strong>
            <span>{library.subscriptions.length} subscriptions</span>
          </div>
        </div>
        {!isOnline ? (
          <span className="status-pill">
            <WifiOff size={15} />
            Offline
          </span>
        ) : null}
      </header>

      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="icon-button ghost" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>
      ) : null}

      <section className="screen" aria-busy={isLoading}>
        {isLoading ? (
          <LoadingState />
        ) : (
          <>
            {activeTab === 'home' ? (
              <HomeView
                episodes={recentEpisodes}
                progressById={progressById}
                onPlay={playEpisodeList}
                onEnqueue={addEpisodeToQueue}
                onAddFeed={handleAddFeed}
                isAddingFeed={isAddingFeed}
              />
            ) : null}
            {activeTab === 'library' ? (
              <LibraryView
                subscriptions={library.subscriptions}
                episodes={library.episodes}
                onAddFeed={handleAddFeed}
                onRefresh={refreshFeed}
                onDelete={deleteFeed}
                isAddingFeed={isAddingFeed}
                refreshingFeedId={refreshingFeedId}
              />
            ) : null}
            {activeTab === 'queue' ? (
              <QueueView
                episodes={queueEpisodes}
                currentEpisodeId={currentEpisode?.id}
                onPlay={(episode) => playEpisodeList(queueEpisodes, episode)}
                onRemove={removeQueuedEpisode}
              />
            ) : null}
            {activeTab === 'player' ? (
              <PlayerView
                episode={currentEpisode}
                player={player}
                settings={library.settings}
                onSettingsChange={updateSettings}
                onPrevious={goToPrevious}
                onNext={goToNext}
              />
            ) : null}
          </>
        )}
      </section>

      {currentEpisode && activeTab !== 'player' ? (
        <MiniPlayer episode={currentEpisode} player={player} onOpen={() => setActiveTab('player')} />
      ) : null}

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton icon={Home} label="Home" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
        <NavButton icon={BookOpen} label="Library" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
        <NavButton icon={ListMusic} label="Queue" active={activeTab === 'queue'} onClick={() => setActiveTab('queue')} />
        <NavButton icon={Headphones} label="Player" active={activeTab === 'player'} onClick={() => setActiveTab('player')} />
      </nav>
    </main>
  );
}

interface PlayerApi {
  isPlaying: boolean;
  position: number;
  duration: number;
  error: string | null;
  toggle: () => void;
  seekTo: (position: number) => void;
  seekBy: (seconds: number) => void;
}

function HomeView({
  episodes,
  progressById,
  onPlay,
  onEnqueue,
  onAddFeed,
  isAddingFeed
}: {
  episodes: Episode[];
  progressById: Map<string, PlaybackProgress>;
  onPlay: (episodes: Episode[], episode: Episode) => void;
  onEnqueue: (episode: Episode) => void;
  onAddFeed: (feedUrl: string) => void;
  isAddingFeed: boolean;
}) {
  if (episodes.length === 0) {
    return (
      <div className="empty-state">
        <div className="wave-asset" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <h1>Podora</h1>
        <p>Build a local library from podcast RSS feeds.</p>
        <AddFeedForm onSubmit={onAddFeed} isBusy={isAddingFeed} />
      </div>
    );
  }

  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Recent</span>
          <h1>Latest episodes</h1>
        </div>
      </div>
      <EpisodeList episodes={episodes.slice(0, 30)} progressById={progressById} onPlay={onPlay} onEnqueue={onEnqueue} />
    </div>
  );
}

function LibraryView({
  subscriptions,
  episodes,
  onAddFeed,
  onRefresh,
  onDelete,
  isAddingFeed,
  refreshingFeedId
}: {
  subscriptions: Subscription[];
  episodes: Episode[];
  onAddFeed: (feedUrl: string) => void;
  onRefresh: (subscription: Subscription) => void;
  onDelete: (feedId: string) => void;
  isAddingFeed: boolean;
  refreshingFeedId: string | null;
}) {
  const episodeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    episodes.forEach((episode) => counts.set(episode.feedId, (counts.get(episode.feedId) ?? 0) + 1));
    return counts;
  }, [episodes]);

  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Subscriptions</h1>
        </div>
      </div>
      <AddFeedForm onSubmit={onAddFeed} isBusy={isAddingFeed} compact />
      <div className="feed-list">
        {subscriptions.length === 0 ? (
          <p className="muted">No subscriptions yet.</p>
        ) : (
          subscriptions.map((subscription) => (
            <article className="feed-row" key={subscription.id}>
              <CoverArt src={subscription.metadata.image} title={subscription.metadata.title} />
              <div className="row-copy">
                <h2>{subscription.metadata.title}</h2>
                <p>{subscription.metadata.author ?? `${episodeCounts.get(subscription.id) ?? 0} episodes`}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => onRefresh(subscription)}
                aria-label={`Refresh ${subscription.metadata.title}`}
                disabled={refreshingFeedId === subscription.id}
              >
                <RefreshCw size={18} className={refreshingFeedId === subscription.id ? 'spin' : undefined} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => onDelete(subscription.id)}
                aria-label={`Delete ${subscription.metadata.title}`}
              >
                <Trash2 size={18} />
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function QueueView({
  episodes,
  currentEpisodeId,
  onPlay,
  onRemove
}: {
  episodes: Episode[];
  currentEpisodeId?: string;
  onPlay: (episode: Episode) => void;
  onRemove: (episodeId: string) => void;
}) {
  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Queue</span>
          <h1>Up next</h1>
        </div>
      </div>
      {episodes.length === 0 ? (
        <p className="muted">Queue is empty.</p>
      ) : (
        <div className="episode-list">
          {episodes.map((episode) => (
            <article className={`episode-row ${episode.id === currentEpisodeId ? 'active' : ''}`} key={episode.id}>
              <CoverArt src={episode.image} title={episode.title} />
              <div className="row-copy">
                <h2>{episode.title}</h2>
                <p>{episode.feedTitle}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => onPlay(episode)} aria-label={`Play ${episode.title}`}>
                <Play size={18} />
              </button>
              <button type="button" className="icon-button ghost" onClick={() => onRemove(episode.id)} aria-label={`Remove ${episode.title}`}>
                <X size={18} />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerView({
  episode,
  player,
  settings,
  onSettingsChange,
  onPrevious,
  onNext
}: {
  episode?: Episode;
  player: PlayerApi;
  settings: PlayerSettings;
  onSettingsChange: (settings: PlayerSettings) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!episode) {
    return (
      <div className="empty-state compact-empty">
        <Headphones size={44} />
        <h1>Nothing playing</h1>
      </div>
    );
  }

  const maxDuration = Math.max(player.duration, episode.duration ?? 0, 1);

  return (
    <div className="player-view">
      <CoverArt src={episode.image} title={episode.title} large />
      <div className="now-playing-copy">
        <span>{episode.feedTitle}</span>
        <h1>{episode.title}</h1>
      </div>

      {player.error ? <p className="player-error">{player.error}</p> : null}

      <div className="timeline">
        <input
          type="range"
          min="0"
          max={maxDuration}
          value={Math.min(player.position, maxDuration)}
          onChange={(event) => player.seekTo(Number(event.currentTarget.value))}
          aria-label="Playback position"
        />
        <div className="time-row">
          <span>{formatDuration(player.position)}</span>
          <span>{formatDuration(maxDuration)}</span>
        </div>
      </div>

      <div className="transport">
        <button type="button" className="icon-button large" onClick={onPrevious} aria-label="Previous episode">
          <SkipBack size={24} />
        </button>
        <button type="button" className="icon-button large" onClick={() => player.seekBy(-15)} aria-label="Back 15 seconds">
          <Rewind size={24} />
        </button>
        <button type="button" className="play-button" onClick={player.toggle} aria-label={player.isPlaying ? 'Pause' : 'Play'}>
          {player.isPlaying ? <Pause size={32} /> : <Play size={32} />}
        </button>
        <button type="button" className="icon-button large" onClick={() => player.seekBy(30)} aria-label="Forward 30 seconds">
          <FastForward size={24} />
        </button>
        <button type="button" className="icon-button large" onClick={onNext} aria-label="Next episode">
          <SkipForward size={24} />
        </button>
      </div>

      <div className="settings-strip">
        <Gauge size={18} />
        <select
          value={settings.playbackRate}
          onChange={(event) => onSettingsChange({ ...settings, playbackRate: Number(event.currentTarget.value) })}
          aria-label="Playback speed"
        >
          {rates.map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
        <Settings size={18} />
      </div>
    </div>
  );
}

function EpisodeList({
  episodes,
  progressById,
  onPlay,
  onEnqueue
}: {
  episodes: Episode[];
  progressById: Map<string, PlaybackProgress>;
  onPlay: (episodes: Episode[], episode: Episode) => void;
  onEnqueue: (episode: Episode) => void;
}) {
  return (
    <div className="episode-list">
      {episodes.map((episode) => {
        const progress = progressById.get(episode.id);
        return (
          <article className="episode-row" key={episode.id}>
            <CoverArt src={episode.image} title={episode.title} />
            <div className="row-copy">
              <div className="row-meta">
                <span>{episode.feedTitle}</span>
                <span>{formatDate(episode.publishedAt)}</span>
              </div>
              <h2>{episode.title}</h2>
              <p>
                {progress?.completed ? 'Played' : progress?.position ? `${formatDuration(progress.position)} played` : formatDuration(episode.duration)}
              </p>
              {progress?.position ? <ProgressBar value={progress.position} max={progress.duration ?? episode.duration ?? 1} /> : null}
            </div>
            <button type="button" className="icon-button" onClick={() => onEnqueue(episode)} aria-label={`Add ${episode.title} to queue`}>
              <Plus size={18} />
            </button>
            <button type="button" className="icon-button primary" onClick={() => onPlay(episodes, episode)} aria-label={`Play ${episode.title}`}>
              <Play size={18} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

function AddFeedForm({
  onSubmit,
  isBusy,
  compact = false
}: {
  onSubmit: (feedUrl: string) => void;
  isBusy: boolean;
  compact?: boolean;
}) {
  const [feedUrl, setFeedUrl] = useState('');

  return (
    <form
      className={`add-feed ${compact ? 'compact' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (feedUrl.trim()) {
          onSubmit(feedUrl.trim());
          setFeedUrl('');
        }
      }}
    >
      <input
        type="url"
        inputMode="url"
        value={feedUrl}
        placeholder="https://example.com/feed.xml"
        onChange={(event) => setFeedUrl(event.currentTarget.value)}
        aria-label="RSS feed URL"
        required
      />
      <button type="submit" disabled={isBusy}>
        {isBusy ? <RefreshCw size={18} className="spin" /> : <Plus size={18} />}
        <span>Add feed</span>
      </button>
    </form>
  );
}

function MiniPlayer({ episode, player, onOpen }: { episode: Episode; player: PlayerApi; onOpen: () => void }) {
  return (
    <aside className="mini-player">
      <button type="button" className="mini-open" onClick={onOpen}>
        <CoverArt src={episode.image} title={episode.title} />
        <span>
          <strong>{episode.title}</strong>
          <small>{episode.feedTitle}</small>
        </span>
      </button>
      <button type="button" className="icon-button primary" onClick={player.toggle} aria-label={player.isPlaying ? 'Pause' : 'Play'}>
        {player.isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
    </aside>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: typeof Home;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Icon size={21} />
      <span>{label}</span>
    </button>
  );
}

function CoverArt({ src, title, large = false }: { src?: string; title: string; large?: boolean }) {
  return (
    <div className={`cover-art ${large ? 'large' : ''}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Headphones size={large ? 54 : 24} aria-hidden="true" />}
      <span className="sr-only">{title}</span>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="progress-bar" aria-hidden="true">
      <span style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="empty-state compact-empty">
      <RefreshCw className="spin" size={34} />
      <h1>Loading</h1>
    </div>
  );
}

function upsertProgress(progressList: PlaybackProgress[], nextProgress: PlaybackProgress) {
  const withoutExisting = progressList.filter((progress) => progress.episodeId !== nextProgress.episodeId);
  return [...withoutExisting, nextProgress];
}

function formatDate(value: string | undefined) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatDuration(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return '0:00';
  }

  const rounded = Math.max(0, Math.floor(value));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
