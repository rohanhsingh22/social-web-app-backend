import { HomeThemeResolver } from './home-theme-resolver';
import { DEFAULT_HIROTOLI_WORLD } from './home-default-theme';

describe('HomeThemeResolver event-readiness', () => {
  const createResolver = (layers: unknown[] = []) => {
    const prisma = {
      homeWorldThemeLayer: { findMany: jest.fn().mockResolvedValue(layers) },
    } as unknown as import('@app/core/prisma/prisma.service').PrismaService;
    return new HomeThemeResolver(prisma);
  };

  it('returns the permanent default when no event is active', async () => {
    const resolver = createResolver([]);
    const result = await resolver.getActiveTheme();
    expect(result.activeLayers).toEqual([]);
    expect(result.theme).toEqual(DEFAULT_HIROTOLI_WORLD);
  });

  it('overlays an event layer without touching the default', async () => {
    const now = new Date();
    const resolver = createResolver([
      {
        id: 'event-01',
        priority: 10,
        environment: { sky: { url: 'event://winter-sky', kind: 'model' } },
        lighting: undefined,
        atmosphere: {
          particles: [{ kind: 'snow', count: 200, color: '#ffffff' }],
        },
        decorations: [{ url: 'event://snow-tree', kind: 'prop' }],
        audio: undefined,
      },
    ]);
    // Bypass time-window filtering shape: feed layers directly to resolve.
    const theme = resolver.resolve([
      {
        id: 'event-01',
        priority: 10,
        decorations: [{ url: 'event://snow-tree', kind: 'prop' }],
      },
    ]);
    expect(theme.decorations).toHaveLength(1);
    expect(DEFAULT_HIROTOLI_WORLD.decorations).toHaveLength(0);
    void now;
  });
});
