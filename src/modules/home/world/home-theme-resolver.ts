import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';
import {
  DEFAULT_HIROTOLI_WORLD,
  getDefaultWorld,
} from './home-default-theme';
import {
  HomeThemeLayer,
  HomeWorldTheme,
} from './home-world-types';

// Backend payload guards (Phase 8): keep the resolved theme production-safe
// on realistic devices. Frontend additionally lazy-loads, caches and
// degrades effects — these caps stop a bad event layer from blowing up the
// scene (draw calls, lights, particles).
export const MAX_DECORATIONS = 48;
export const MAX_POINT_LIGHTS = 4;
export const MAX_PARTICLES_PER_EMITTER = 220;

/**
 * Resolves default world + zero or more active layers into one renderable
 * theme (spec §16/§20). Event timing is server-authoritative — only layers
 * whose window contains now (or has no window) and isActive=true are applied.
 * At launch the table is empty, so this returns the permanent default
 * (hirotoli-village v1). Priority is deterministic ascending; later
 * (higher-priority) layers win on conflicts, decorations append.
 */
@Injectable()
export class HomeThemeResolver {
  private readonly logger = new Logger(HomeThemeResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  resolve(activeLayers: HomeThemeLayer[] = []): HomeWorldTheme {
    const base = getDefaultWorld();
    if (activeLayers.length === 0) {
      return base;
    }
    const sorted = [...activeLayers].sort((a, b) => a.priority - b.priority);
    const theme: HomeWorldTheme = JSON.parse(JSON.stringify(base));
    for (const layer of sorted) {
      if (layer.environment) {
        theme.environment = { ...theme.environment, ...layer.environment };
      }
      if (layer.lighting) {
        const pointLights =
          layer.lighting.pointLights ?? theme.lighting.pointLights ?? [];
        theme.lighting = {
          ...theme.lighting,
          ...layer.lighting,
          pointLights: pointLights.slice(0, MAX_POINT_LIGHTS),
        };
      }
      if (layer.atmosphere) {
        const particles = layer.atmosphere.particles
          ? layer.atmosphere.particles.map((p) => ({
              ...p,
              count: Math.min(p.count ?? 0, MAX_PARTICLES_PER_EMITTER),
            }))
          : theme.atmosphere.particles;
        theme.atmosphere = {
          ...theme.atmosphere,
          ...layer.atmosphere,
          ...(particles ? { particles } : {}),
        };
      }
      if (layer.decorations) {
        theme.decorations = [...theme.decorations, ...layer.decorations].slice(
          0,
          MAX_DECORATIONS,
        );
      }
      if (layer.audio) {
        theme.audio = layer.audio;
      }
    }
    return theme;
  }

  /** Active event layers from DB (server-authoritative timing). */
  async activeLayers(now: Date = new Date()): Promise<HomeThemeLayer[]> {
    try {
      const rows = await this.prisma.homeWorldThemeLayer.findMany({
        where: {
          isActive: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        },
        orderBy: { priority: 'asc' },
      });
      return rows.map((r) => ({
        id: r.id,
        priority: r.priority,
        environment: (r.environment as HomeThemeLayer['environment']) ?? undefined,
        lighting: (r.lighting as HomeThemeLayer['lighting']) ?? undefined,
        atmosphere: (r.atmosphere as HomeThemeLayer['atmosphere']) ?? undefined,
        decorations: (r.decorations as HomeThemeLayer['decorations']) ?? undefined,
        audio: (r.audio as HomeThemeLayer['audio']) ?? undefined,
      }));
    } catch {
      return [];
    }
  }

  async getActiveTheme(): Promise<{
    defaultTheme: HomeWorldTheme;
    activeLayers: HomeThemeLayer[];
    theme: HomeWorldTheme;
  }> {
    const defaultTheme = getDefaultWorld();
    const activeLayers = await this.activeLayers();
    const theme = this.resolve(activeLayers);
    // Observability (spec §30): theme resolution without PII/secrets.
    this.logger.debug(
      `home.theme.resolved theme=${theme.id} layers=${activeLayers.length}`,
    );
    for (const layer of activeLayers) {
      this.logger.debug(
        `home.theme.layer.applied layer=${layer.id} priority=${layer.priority}`,
      );
    }
    return {
      defaultTheme,
      activeLayers,
      theme,
    };
  }
}

export { DEFAULT_HIROTOLI_WORLD };
