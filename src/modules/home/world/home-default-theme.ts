// Permanent default Hirotoli Home world (spec §18).
// hirotoli-village v1: cozy social village, warm daytime. UI light/dark mode
// NEVER changes this theme (spec §19) — it only styles CSS/UI components.
// Asset URLs are allowlisted manifest refs under /hirotoli/home/*; actual
// Quaternius GLBs land there after Phase 1 art approval (see
// assets/licenses/*). Keep the world data-driven so future events overlay
// without rewriting HomeWorld.

import { HomeWorldTheme } from './home-world-types';

export const DEFAULT_HIROTOLI_WORLD: HomeWorldTheme = {
  id: 'hirotoli-village',
  name: 'Hirotoli Village',
  version: 1,
  environment: {
    background: { url: 'color:#bfe3f0', kind: 'color' },
    sky: { url: '/hirotoli/home/environment/sky-day-soft.glb', kind: 'model' },
    ground: {
      url: '/hirotoli/home/environment/ground-village-paths.glb',
      kind: 'model',
    },
    environmentModel: {
      url: '/hirotoli/home/environment/village-core-v1.glb',
      kind: 'model',
    },
  },
  lighting: {
    ambient: { color: '#fff4e0', intensity: 0.7 },
    directional: {
      color: '#ffe7bd',
      intensity: 1.4,
      position: [4, 8, 5],
    },
    pointLights: [],
  },
  atmosphere: {
    fog: { color: '#cfe8f2', near: 18, far: 60 },
    particles: [
      {
        kind: 'pollen-drift',
        count: 40,
        color: '#fff8e1',
        size: 1.5,
        speed: 0.3,
        opacity: 0.45,
      },
    ],
    effects: [{ kind: 'contact-shadows', enabled: true }],
  },
  decorations: [
    { url: '/hirotoli/home/environment/house-01.glb', kind: 'house' },
    { url: '/hirotoli/home/environment/house-02.glb', kind: 'house' },
    { url: '/hirotoli/home/environment/house-03.glb', kind: 'house' },
    { url: '/hirotoli/home/environment/plaza-fountain.glb', kind: 'plaza' },
    { url: '/hirotoli/home/environment/bridge-stream.glb', kind: 'bridge' },
    { url: '/hirotoli/home/props/bench-01.glb', kind: 'prop' },
    { url: '/hirotoli/home/props/lantern-01.glb', kind: 'prop' },
    { url: '/hirotoli/home/nature/tree-01.glb', kind: 'nature' },
    { url: '/hirotoli/home/nature/bush-flower-set-01.glb', kind: 'nature' },
  ],
  audio: {
    ambient: { url: '/hirotoli/home/audio/village-day-ambient.mp3', kind: 'audio' },
  },
  characterStage: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  },
  camera: {
    position: [0, 1.6, 5.2],
    target: [0, 1.1, 0],
  },
};

// Pre-village technical stage (dark lobby). Retained ONLY for controlled
// rollback until hirotoli-village passes production validation (spec Phase 11).
// Select via HOME_WORLD_ROLLBACK=1. Do not use as the default.
export const LEGACY_HIROTOLI_WORLD: HomeWorldTheme = {
  id: 'hirotoli-home-default',
  name: 'Hirotoli Home',
  version: 2,
  environment: {
    background: { url: 'color:#0a0b10', kind: 'color' },
    ground: { url: 'stage-circle', kind: 'procedural' },
  },
  lighting: {
    ambient: { color: '#ffffff', intensity: 0.5 },
    directional: {
      color: '#ffffff',
      intensity: 1.6,
      position: [4, 8, 5],
    },
    pointLights: [],
  },
  atmosphere: {
    fog: { color: '#0a0b10', near: 9, far: 26 },
    particles: [
      {
        kind: 'sparkles',
        count: 60,
        color: 'accent',
        size: 2,
        speed: 0.4,
        opacity: 0.5,
      },
    ],
    effects: [{ kind: 'contact-shadows', enabled: true }],
  },
  decorations: [],
  characterStage: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  },
  camera: {
    position: [0, 1.5, 5],
    target: [0, 1.2, 0],
  },
};

export function getDefaultWorld(): HomeWorldTheme {
  if (process.env.HOME_WORLD_ROLLBACK === '1') {
    return LEGACY_HIROTOLI_WORLD;
  }
  return DEFAULT_HIROTOLI_WORLD;
}
