import type { QueueState } from '../types';

export const emptyQueue: QueueState = {
  episodeIds: [],
  currentEpisodeId: undefined
};

export function createQueueFromList(episodeIds: string[], startEpisodeId: string): QueueState {
  const uniqueIds = unique(episodeIds);
  return {
    episodeIds: uniqueIds.includes(startEpisodeId) ? uniqueIds : [startEpisodeId, ...uniqueIds],
    currentEpisodeId: startEpisodeId
  };
}

export function enqueueEpisode(queue: QueueState, episodeId: string): QueueState {
  if (queue.episodeIds.includes(episodeId)) {
    return queue;
  }

  return {
    ...queue,
    episodeIds: [...queue.episodeIds, episodeId],
    currentEpisodeId: queue.currentEpisodeId ?? episodeId
  };
}

export function removeEpisodeFromQueue(queue: QueueState, episodeId: string): QueueState {
  const episodeIds = queue.episodeIds.filter((id) => id !== episodeId);
  const removedCurrent = queue.currentEpisodeId === episodeId;

  return {
    episodeIds,
    currentEpisodeId: removedCurrent ? episodeIds[0] : queue.currentEpisodeId
  };
}

export function selectNext(queue: QueueState): string | undefined {
  if (!queue.currentEpisodeId) {
    return queue.episodeIds[0];
  }

  const currentIndex = queue.episodeIds.indexOf(queue.currentEpisodeId);
  return currentIndex >= 0 ? queue.episodeIds[currentIndex + 1] : queue.episodeIds[0];
}

export function selectPrevious(queue: QueueState): string | undefined {
  if (!queue.currentEpisodeId) {
    return queue.episodeIds[0];
  }

  const currentIndex = queue.episodeIds.indexOf(queue.currentEpisodeId);
  if (currentIndex > 0) {
    return queue.episodeIds[currentIndex - 1];
  }

  return queue.currentEpisodeId;
}

export function sanitizeQueue(queue: QueueState, availableEpisodeIds: Set<string>): QueueState {
  const episodeIds = queue.episodeIds.filter((id) => availableEpisodeIds.has(id));
  return {
    episodeIds,
    currentEpisodeId:
      queue.currentEpisodeId && availableEpisodeIds.has(queue.currentEpisodeId)
        ? queue.currentEpisodeId
        : episodeIds[0]
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
