import {
  ANIMATION_MANIFEST,
  LAUNCH_ANIMATIONS,
  resolveAnimation,
} from './character-animations';

describe('character animations (spec §10)', () => {
  it('ships only the launch subset, independently loadable', () => {
    expect([...LAUNCH_ANIMATIONS]).toEqual([
      'idle',
      'wave',
      'happy',
      'sad',
      'celebrate',
      'interaction-ready',
    ]);
    expect(ANIMATION_MANIFEST).toHaveLength(6);
    for (const clip of ANIMATION_MANIFEST) {
      expect(clip.url).toMatch(/^\/hirotoli\/characters\/animations\//);
    }
  });

  it('falls back to idle on unknown names', () => {
    expect(resolveAnimation('dance').name).toBe('idle');
    expect(resolveAnimation(undefined).name).toBe('idle');
    expect(resolveAnimation('wave').name).toBe('wave');
  });
});
