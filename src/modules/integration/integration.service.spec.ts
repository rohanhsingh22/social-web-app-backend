import { IntegrationService } from './integration.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { SessionService } from '@app/core/session/session.service';
import { ProviderRegistry } from './providers/provider.registry';

describe('IntegrationService display-name handling', () => {
  const createService = () => {
    const tx = {
      authIdentity: { findUnique: jest.fn(), update: jest.fn() },
      user: { update: jest.fn(), create: jest.fn() },
      profile: { findUnique: jest.fn() },
    };
    const transaction = jest.fn(async (cb: (client: unknown) => unknown) =>
      cb(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const sessionService = {
      createSession: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        refreshExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    } as unknown as SessionService;
    const provider = { exchangeCode: jest.fn(), fetchProfile: jest.fn() };
    const registry = {
      getProvider: jest.fn().mockReturnValue(provider),
    } as unknown as ProviderRegistry;

    return {
      service: new IntegrationService(prisma, sessionService, registry),
      tx,
      provider,
    };
  };

  const providerProfile = (overrides = {}) => ({
    providerUserId: 'provider-123',
    email: 'rohan@example.com',
    displayName: 'Rohan',
    avatarUrl: 'https://example.com/avatar-b.png',
    ...overrides,
  });

  it('never overwrites the HiRotoli display name on repeat login', async () => {
    const { service, tx, provider } = createService();
    provider.exchangeCode.mockResolvedValue('provider-token');
    provider.fetchProfile.mockResolvedValue(providerProfile());
    tx.authIdentity.findUnique.mockResolvedValue({
      id: 'identity-id',
      userId: 'user-id',
      providerAvatarUrl: 'https://example.com/avatar-a.png',
      user: {
        profile: { avatarUrl: 'https://example.com/avatar-a.png' },
      },
    });
    tx.user.update.mockResolvedValue({ id: 'user-id' });

    await service.loginWithCode('google', 'code', {});

    expect(tx.authIdentity.update).toHaveBeenCalledWith({
      where: { id: 'identity-id' },
      data: expect.objectContaining({
        providerDisplayName: 'Rohan',
        providerAvatarUrl: 'https://example.com/avatar-b.png',
      }),
    });
    const updateData = tx.user.update.mock.calls[0][0].data;
    expect(updateData.profile?.update?.displayName).toBeUndefined();
  });

  it('leaves a custom avatar alone while still syncing provider data', async () => {
    const { service, tx, provider } = createService();
    provider.exchangeCode.mockResolvedValue('provider-token');
    provider.fetchProfile.mockResolvedValue(providerProfile());
    tx.authIdentity.findUnique.mockResolvedValue({
      id: 'identity-id',
      userId: 'user-id',
      providerAvatarUrl: 'https://example.com/avatar-a.png',
      user: { profile: { avatarUrl: 'https://example.com/custom.png' } },
    });
    tx.user.update.mockResolvedValue({ id: 'user-id' });

    await service.loginWithCode('google', 'code', {});

    const updateData = tx.user.update.mock.calls[0][0].data;
    expect(updateData.profile).toBeUndefined();
    expect(updateData.lastLoginAt).toEqual(expect.any(Date));
  });

  it('suffixes a colliding provider display name on signup', async () => {
    const { service, tx, provider } = createService();
    provider.exchangeCode.mockResolvedValue('provider-token');
    provider.fetchProfile.mockResolvedValue(providerProfile());
    tx.authIdentity.findUnique.mockResolvedValue(null);
    tx.profile.findUnique
      .mockResolvedValueOnce({ userId: 'other-user' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.user.create.mockResolvedValue({ id: 'new-user' });

    await service.loginWithCode('google', 'code', {});

    const createdDisplayName =
      tx.user.create.mock.calls[0][0].data.profile.create.displayName;
    expect(createdDisplayName).not.toBe('Rohan');
    expect(createdDisplayName.startsWith('Rohan_')).toBe(true);
  });
});
