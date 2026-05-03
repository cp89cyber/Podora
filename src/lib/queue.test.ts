import { describe, expect, it } from 'vitest';
import { createQueueFromList, enqueueEpisode, removeEpisodeFromQueue, sanitizeQueue, selectNext, selectPrevious } from './queue';

describe('queue helpers', () => {
  it('creates a deduplicated queue from a selected episode', () => {
    expect(createQueueFromList(['a', 'b', 'b', 'c'], 'b')).toEqual({
      episodeIds: ['a', 'b', 'c'],
      currentEpisodeId: 'b'
    });
  });

  it('appends new episodes without duplicates', () => {
    const queue = { episodeIds: ['a'], currentEpisodeId: 'a' };
    expect(enqueueEpisode(queue, 'b').episodeIds).toEqual(['a', 'b']);
    expect(enqueueEpisode(queue, 'a')).toBe(queue);
  });

  it('selects neighboring queue items', () => {
    const queue = { episodeIds: ['a', 'b', 'c'], currentEpisodeId: 'b' };
    expect(selectNext(queue)).toBe('c');
    expect(selectPrevious(queue)).toBe('a');
  });

  it('removes current episodes and sanitizes missing episodes', () => {
    expect(removeEpisodeFromQueue({ episodeIds: ['a', 'b'], currentEpisodeId: 'a' }, 'a')).toEqual({
      episodeIds: ['b'],
      currentEpisodeId: 'b'
    });
    expect(sanitizeQueue({ episodeIds: ['a', 'b'], currentEpisodeId: 'a' }, new Set(['b']))).toEqual({
      episodeIds: ['b'],
      currentEpisodeId: 'b'
    });
  });
});
