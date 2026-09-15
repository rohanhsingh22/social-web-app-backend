import { Injectable } from '@nestjs/common';

// Deterministic rule-based ranking for the For You feed (Launch 1, no ML).
// All weights live here so ranking can evolve without touching the feed API.
// v1 signals: freshness, shared interests, Toli match, engagement.
// Author/topic repetition is handled by diversity interleaving, not scoring.
// Reports/hides/blocks exclude content before scoring (see ThoughtsService).
export const THOUGHT_RANK_WEIGHTS = {
  // Exponential freshness decay: score halves every half-life.
  freshnessHalfLifeHours: 24,
  freshnessWeight: 10,
  // Per shared interest between viewer and author.
  interestMatchWeight: 3,
  // Viewer and author share a Toli.
  toliMatchWeight: 4,
  // Log-scaled engagement so viral outliers cannot dominate forever.
  likeWeight: 1,
  commentWeight: 2,
  shareWeight: 2.5,
  // Diversity interleave caps.
  preferredAuthorCapPerPage: 2,
  maxAuthorCapPerPage: 4,
} as const;

export type RankableThought = {
  id: string;
  createdAt: Date;
  authorId: string;
  authorInterests: string[];
  authorToliId: string | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
};

export type RankViewer = {
  interests: string[];
  toliId: string | null;
};

export type ScoredThought<T> = {
  thought: T;
  score: number;
};

@Injectable()
export class ThoughtsRankingService {
  scoreThought(
    thought: RankableThought,
    viewer: RankViewer,
    now: Date = new Date(),
  ): number {
    const weights = THOUGHT_RANK_WEIGHTS;
    const ageHours = Math.max(
      0,
      (now.getTime() - thought.createdAt.getTime()) / 3_600_000,
    );
    const freshness =
      weights.freshnessWeight *
      Math.pow(0.5, ageHours / weights.freshnessHalfLifeHours);

    const viewerInterests = new Set(viewer.interests);
    const sharedInterests = thought.authorInterests.filter((interest) =>
      viewerInterests.has(interest),
    ).length;
    const interestScore = sharedInterests * weights.interestMatchWeight;

    const toliScore =
      viewer.toliId && thought.authorToliId === viewer.toliId
        ? weights.toliMatchWeight
        : 0;

    const engagement =
      weights.likeWeight * Math.log1p(thought.likeCount) +
      weights.commentWeight * Math.log1p(thought.commentCount) +
      weights.shareWeight * Math.log1p(thought.shareCount);

    return freshness + interestScore + toliScore + engagement;
  }

  rank<T extends RankableThought>(
    thoughts: T[],
    viewer: RankViewer,
    now: Date = new Date(),
  ): ScoredThought<T>[] {
    return thoughts
      .map((thought) => ({
        thought,
        score: this.scoreThought(thought, viewer, now),
      }))
      .sort((a, b) => b.score - a.score || a.thought.id.localeCompare(b.thought.id));
  }

  // Greedy author-diversity interleave: prefer at most N thoughts per author,
  // then fill remaining slots up to a hard cap so one author can never own
  // the whole page.
  applyAuthorDiversity<T extends { authorId: string }>(
    scored: ScoredThought<T>[],
    limit: number,
  ): ScoredThought<T>[] {
    const { preferredAuthorCapPerPage, maxAuthorCapPerPage } =
      THOUGHT_RANK_WEIGHTS;
    const picked: ScoredThought<T>[] = [];
    const counts = new Map<string, number>();

    const take = (cap: number) => {
      for (const item of scored) {
        if (picked.length >= limit) {
          return;
        }

        if (picked.includes(item)) {
          continue;
        }

        if ((counts.get(item.thought.authorId) ?? 0) >= cap) {
          continue;
        }

        picked.push(item);
        counts.set(
          item.thought.authorId,
          (counts.get(item.thought.authorId) ?? 0) + 1,
        );
      }
    };

    take(preferredAuthorCapPerPage);
    take(maxAuthorCapPerPage);

    return picked;
  }
}
