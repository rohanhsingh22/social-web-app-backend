// Launch animation manifest (spec §10, Phase 4).
// Backend owns the logical-name -> clip allowlist; the frontend animation
// controller lazy-loads clips by URL and cross-fades. Only the launch subset
// ships — the full 120+ Universal Animation Library stays future-compatible
// without changing this contract. Clips remain independently loadable so Home
// never downloads a huge library. Unknown names fall back to `idle`.

export const LAUNCH_ANIMATIONS = [
  'idle',
  'wave',
  'happy',
  'sad',
  'celebrate',
  'interaction-ready',
] as const;

export type LaunchAnimationName = (typeof LAUNCH_ANIMATIONS)[number];

export const FALLBACK_ANIMATION: LaunchAnimationName = 'idle';

export type AnimationClipRef = {
  name: LaunchAnimationName;
  url: string;
  loop: boolean;
  crossFadeMs: number;
};

// Candidate Quaternius URLs land under /hirotoli/characters/animations/* after
// Phase 1 art approval. Until then these refs are the authoritative allowlist
// shape (not yet shipped assets) — the controller must reject anything else.
export const ANIMATION_MANIFEST: AnimationClipRef[] = LAUNCH_ANIMATIONS.map(
  (name) => ({
    name,
    url: `/hirotoli/characters/animations/${name}.glb`,
    loop: name === 'idle',
    crossFadeMs: 250,
  }),
);

export const ANIMATION_MAP = new Map(
  ANIMATION_MANIFEST.map((clip) => [clip.name, clip]),
);

export function resolveAnimation(
  name: unknown,
): AnimationClipRef {
  if (typeof name === 'string') {
    const clip = ANIMATION_MAP.get(name as LaunchAnimationName);
    if (clip) {
      return clip;
    }
  }
  return ANIMATION_MAP.get(FALLBACK_ANIMATION) as AnimationClipRef;
}
