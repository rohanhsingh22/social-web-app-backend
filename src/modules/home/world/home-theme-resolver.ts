import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { DEFAULT_HIROTOLI_WORLD } from './home-default-theme';
import {
  HomeThemeLayer,
  HomeWorldTheme,
} from './home-world-types';

/**
 * Resolves default world + zero or more active layers into one renderable
 * theme (spec §16). Event timing is server-authoritative — only layers whose
 * window contains now (or has no window) and isActive=true are applied.
 * At launch the table is empty, so this returns the permanent default.
 */
@Injectable()
export class HomeThemeResolver {
  private readonly logger = new Logger(HomeThemeResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  resolve(activeLayers: HomeThemeLayer[] = []): HomeWorldTheme {
    if (activeLayers.length === 0) {
      return DEFAULT_HIROTOLI_WORLD;
    }
    const sorted = [...activeLayers].sort((a, b) => a.priority - b.priority);
    const theme: HomeWorldTheme = JSON.parse(
      JSON.stringify(DEFAULT_HIROTOLI_WORLD),
    );
    for (const layer of sorted) {
      if (layer.environment) {
        theme.environment = { ...theme.environment, ...layer.environment };
      }
      if (layer.lighting) {
        theme.lighting = {
          ...theme.lighting,
          ...layer.lighting,
          pointLights:
            layer.lighting.pointLights ?? theme.lighting.pointLights,
        };
      }
      if (layer.atmosphere) {
        theme.atmosphere = { ...theme.atmosphere, ...layer.atmosphere };
      }
      if (layer.decorations) {
        theme.decorations = [...theme.decorations, ...layer.decorations];
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
    const activeLayers = await this.activeLayers();
    return {
      defaultTheme: DEFAULT_HIROTOLI_WORLD,
      activeLayers,
      theme: this.resolve(activeLayers),
    };
  }
}
