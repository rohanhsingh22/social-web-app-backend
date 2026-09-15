import { ThoughtsRankingService } from './thoughts-ranking.service';

describe('ThoughtsRankingService', () => {
  const createService = () => new ThoughtsRankingService();

  const thought = (overrides = {}) => ({
    id: 'thought-1',
    createdAt: new Date('2026-09-14T11:00:00.000Z'),
    authorId: 'author-1',
    authorInterests: ['music', 'cricket'],
    authorToliId: 'vector-id',
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    ...overrides,
  });

  const viewer = {
    interests: ['music'],
    toliId: 'vector-id',
  };

  it('scores freshness above stale content', () => {
    const service = createService();
    const now = new Date('2026-09-14T12:00:00.000Z');

    const fresh = service.scoreThought(thought(), viewer, now);
    const stale = service.scoreThought(
      thought({
        id: 'thought-2',
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      }),
      viewer,
      now,
    );

    expect(fresh).toBeGreaterThan(stale);
  });

  it('rewards shared interests, Toli match, and engagement', () => {
    const service = createService();
    const now = new Date('2026-09-14T12:00:00.000Z');
    const base = service.scoreThought(thought(), viewer, now);

    expect(
      service.scoreThought(
        thought({ id: 't2', authorInterests: ['chess'] }),
        viewer,
        now,
      ),
    ).toBeLessThan(base);
    expect(
      service.scoreThought(
        thought({ id: 't3', authorToliId: 'wave-id' }),
        viewer,
        now,
      ),
    ).toBeLessThan(base);
    expect(
      service.scoreThought(
        thought({ id: 't4', likeCount: 100, commentCount: 20 }),
        viewer,
        now,
      ),
    ).toBeGreaterThan(base);
  });

  it('ranks deterministically with id tiebreak', () => {
    const service = createService();
    const now = new Date('2026-09-14T12:00:00.000Z');
    const ranked = service.rank(
      [thought({ id: 'b' }), thought({ id: 'a' })],
      viewer,
      now,
    );

    expect(ranked.map((item) => item.thought.id)).toEqual(['a', 'b']);
  });

  it('caps authors per page without losing the top picks', () => {
    const service = createService();
    const now = new Date('2026-09-14T12:00:00.000Z');
    const ranked = service.rank(
      [
        thought({ id: 'a1', authorId: 'author-1', likeCount: 50 }),
        thought({ id: 'a2', authorId: 'author-1', likeCount: 40 }),
        thought({ id: 'a3', authorId: 'author-1', likeCount: 30 }),
        thought({ id: 'b1', authorId: 'author-2', likeCount: 5 }),
      ],
      viewer,
      now,
    );

    const page = service.applyAuthorDiversity(ranked, 3);
    const ids = page.map((item) => item.thought.id);

    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
    expect(ids).toContain('b1');
    expect(ids).not.toContain('a3');
  });
});
