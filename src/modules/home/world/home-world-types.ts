// Permanent Hirotoli Home world theme contract (spec §13-16).
// This is the 3D world theme — NOT the light/dark/accent UI preference.

export type AssetRef = { url: string; kind?: string };

export type LightConfig = {
  color?: string;
  intensity?: number;
  position?: [number, number, number];
};

export type FogConfig = {
  color?: string;
  near?: number;
  far?: number;
};

export type ParticleConfig = {
  kind: string;
  count?: number;
  color?: string;
  size?: number;
  speed?: number;
  opacity?: number;
};

export type EffectConfig = {
  kind: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
};

export type HomeWorldTheme = {
  id: string;
  name: string;
  version: number;
  environment: {
    background?: AssetRef;
    sky?: AssetRef;
    ground?: AssetRef;
    environmentModel?: AssetRef;
  };
  lighting: {
    ambient: LightConfig;
    directional?: LightConfig;
    pointLights?: LightConfig[];
  };
  atmosphere: {
    fog?: FogConfig;
    particles?: ParticleConfig[];
    effects?: EffectConfig[];
  };
  decorations: AssetRef[];
  audio?: { ambient?: AssetRef; music?: AssetRef };
  characterStage: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  };
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
};

export type HomeThemeLayer = {
  id: string;
  priority: number;
  environment?: Partial<HomeWorldTheme['environment']>;
  lighting?: Partial<HomeWorldTheme['lighting']>;
  atmosphere?: Partial<HomeWorldTheme['atmosphere']>;
  decorations?: AssetRef[];
  audio?: HomeWorldTheme['audio'];
};
