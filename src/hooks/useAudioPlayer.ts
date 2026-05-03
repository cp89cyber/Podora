import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Episode, PlaybackProgress, PlayerSettings } from '../types';

interface UseAudioPlayerOptions {
  episode?: Episode;
  progress?: PlaybackProgress;
  settings: PlayerSettings;
  playToken: number;
  onProgress: (progress: PlaybackProgress) => void;
  onEnded: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function useAudioPlayer({
  episode,
  progress,
  settings,
  playToken,
  onProgress,
  onEnded,
  onNext,
  onPrevious
}: UseAudioPlayerOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const episodeRef = useRef<Episode | undefined>(episode);
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(progress?.position ?? 0);
  const [duration, setDuration] = useState(progress?.duration ?? episode?.duration ?? 0);
  const [error, setError] = useState<string | null>(null);
  const lastSavedPositionRef = useRef(0);

  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';
  }

  const audio = audioRef.current;

  useEffect(() => {
    episodeRef.current = episode;
  }, [episode]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const handleTimeUpdate = () => {
      const currentEpisode = episodeRef.current;
      if (!currentEpisode) {
        return;
      }

      const nextPosition = audio.currentTime || 0;
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : currentEpisode.duration;
      setPosition(nextPosition);
      setDuration(nextDuration ?? 0);

      if (Math.abs(nextPosition - lastSavedPositionRef.current) >= 5) {
        lastSavedPositionRef.current = nextPosition;
        onProgressRef.current({
          episodeId: currentEpisode.id,
          position: nextPosition,
          duration: nextDuration,
          completed: false,
          updatedAt: Date.now()
        });
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : episodeRef.current?.duration ?? 0);
    };

    const handleEnded = () => {
      const currentEpisode = episodeRef.current;
      setIsPlaying(false);

      if (currentEpisode) {
        onProgressRef.current({
          episodeId: currentEpisode.id,
          position: 0,
          duration: Number.isFinite(audio.duration) ? audio.duration : currentEpisode.duration,
          completed: true,
          updatedAt: Date.now()
        });
      }

      onEndedRef.current();
    };

    const handleError = () => {
      setIsPlaying(false);
      setError('This episode could not be played.');
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audio]);

  useEffect(() => {
    if (!episode) {
      audio.removeAttribute('src');
      setIsPlaying(false);
      setPosition(0);
      setDuration(0);
      return;
    }

    if (audio.dataset.episodeId !== episode.id) {
      audio.src = episode.audioUrl;
      audio.dataset.episodeId = episode.id;
      audio.playbackRate = settings.playbackRate;
      setError(null);
      setPosition(progress?.position ?? 0);
      setDuration(progress?.duration ?? episode.duration ?? 0);
      lastSavedPositionRef.current = progress?.position ?? 0;

      try {
        audio.currentTime = progress?.position ?? 0;
      } catch {
        // Some mobile browsers reject seeking before metadata is available.
      }
    }
  }, [audio, episode, progress, settings.playbackRate]);

  useEffect(() => {
    audio.playbackRate = settings.playbackRate;
  }, [audio, settings.playbackRate]);

  const play = useCallback(async () => {
    if (!episodeRef.current) {
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
      setError(null);
    } catch {
      setIsPlaying(false);
      setError('Playback needs a tap to start.');
    }
  }, [audio]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
  }, [audio]);

  const toggle = useCallback(() => {
    if (audio.paused) {
      void play();
    } else {
      pause();
    }
  }, [audio.paused, pause, play]);

  const seekTo = useCallback(
    (nextPosition: number) => {
      const safePosition = Math.max(0, Math.min(nextPosition, duration || nextPosition));
      audio.currentTime = safePosition;
      setPosition(safePosition);
    },
    [audio, duration]
  );

  const seekBy = useCallback(
    (seconds: number) => {
      seekTo((audio.currentTime || 0) + seconds);
    },
    [audio, seekTo]
  );

  useEffect(() => {
    if (playToken > 0) {
      void play();
    }
  }, [play, playToken]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !episode) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.feedTitle,
      artwork: episode.image ? [{ src: episode.image, sizes: '512x512', type: 'image/png' }] : []
    });

    navigator.mediaSession.setActionHandler('play', () => void play());
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-15));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(30));
    navigator.mediaSession.setActionHandler('previoustrack', onPrevious);
    navigator.mediaSession.setActionHandler('nexttrack', onNext);

    return () => {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    };
  }, [episode, onNext, onPrevious, pause, play, seekBy]);

  return useMemo(
    () => ({
      audio,
      isPlaying,
      position,
      duration,
      error,
      play,
      pause,
      toggle,
      seekTo,
      seekBy
    }),
    [audio, duration, error, isPlaying, pause, play, position, seekBy, seekTo, toggle]
  );
}
