import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { CharactersService } from '@app/modules/characters/characters.service';
import { HomeMembershipService } from '@app/modules/home/home-membership.service';
import { HomePolicyService } from '@app/modules/home/home-policy.service';
import { HomePresenceService } from '@app/modules/home/home-presence.service';
import { HomeService } from '@app/modules/home/home.service';
import { HomeVoiceService } from '@app/modules/home/voice/home-voice.service';
import { RateLimitService } from '@app/common/rate-limit.service';

// DB integration: the 4-member cap under true concurrency (spec #119).
// Requires DATABASE_URL (dev/CI with Postgres). Two simultaneous joins into
// the last slot must admit exactly one — never five members.
jest.setTimeout(60000);

describe('Home concurrency (DB)', () => {
  let prisma: PrismaService;
  let homes: HomeService;
  let memberships: HomeMembershipService;
  let homeId: string | null = null;
  let loserId: string | null = null;
  const userIds: string[] = [];
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const fanout = {
      publishUserEvent: jest.fn(),
    } as unknown as FanoutService;
    const presence = {
      presenceMap: jest.fn(async () => new Map()),
    } as unknown as HomePresenceService;
    const voice = {
      closeVoiceHome: jest.fn(),
      removeVoiceParticipant: jest.fn(),
    } as unknown as HomeVoiceService;
    const rateLimit = {
      assertAllowed: jest.fn(),
    } as unknown as RateLimitService;

    const characters = {
      resolveCharacter: (characterId: string) => ({
        definition: { id: characterId },
        loadout: { characterId, accessoryIds: [] },
      }),
    } as unknown as CharactersService;

    homes = new HomeService(prisma, fanout, presence, voice, characters);
    memberships = new HomeMembershipService(
      prisma,
      homes,
      new HomePolicyService(),
      fanout,
      voice,
      rateLimit,
    );

    for (let i = 0; i < 5; i++) {
      const user = await prisma.user.create({
        data: { publicUserId: `HT-E2E-${suffix}-${i}` },
        select: { id: true },
      });
      userIds.push(user.id);
    }
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it('admits exactly one of two simultaneous joiners into the last slot', async () => {
    const home = await homes.ensureHomeForUser(userIds[0] as string);
    await memberships.joinHome(home.id, userIds[1] as string);
    await memberships.joinHome(home.id, userIds[2] as string);
    expect(await memberships.countMembers(home.id)).toBe(3);

    const results = await Promise.allSettled([
      memberships.joinHome(home.id, userIds[3] as string),
      memberships.joinHome(home.id, userIds[4] as string),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
      'HOME_FULL',
    );
    expect(await memberships.countMembers(home.id)).toBe(4);

    const winnerId = (fulfilled[0] as PromiseFulfilledResult<{ userId: string }>)
      .value.userId;
    loserId = [userIds[3], userIds[4]].find((id) => id !== winnerId) ?? null;
    homeId = home.id;
    expect(loserId).not.toBeNull();
  });

  it('rejects a fifth joiner sequentially', async () => {
    expect(homeId).not.toBeNull();
    expect(loserId).not.toBeNull();

    await expect(
      memberships.joinHome(homeId as string, loserId as string),
    ).rejects.toThrow('HOME_FULL');
    expect(await memberships.countMembers(homeId as string)).toBe(4);
  });
});
