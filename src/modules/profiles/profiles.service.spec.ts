import { ConflictException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { PrismaService } from '@app/core/prisma/prisma.service';

describe('ProfilesService', () => {
  const createService = () => {
    const profile = {
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    const prisma = {
      profile,
    } as unknown as PrismaService;

    return {
      service: new ProfilesService(prisma),
      profile,
    };
  };

  it('updates the current profile and marks it complete when required fields exist', async () => {
    const { service, profile } = createService();
    profile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        userId: 'user-id',
        username: 'old_name',
        displayName: 'Old Name',
        avatarUrl: null,
        bio: null,
        dob: null,
        ageGroup: null,
        gender: null,
        region: null,
        city: null,
        primaryLanguage: null,
        languages: [],
        isComplete: false,
        createdAt: new Date('2026-05-16T06:00:00.000Z'),
        updatedAt: new Date('2026-05-16T06:00:00.000Z'),
      });
    profile.update.mockResolvedValue({
      userId: 'user-id',
      username: 'new_name',
      isComplete: true,
    });

    await expect(
      service.updateOwnProfile('user-id', {
        username: 'new_name',
        displayName: 'New Name',
        dob: '2000-01-01',
        region: 'Delhi',
        primaryLanguage: 'Hindi',
        languages: ['Hindi', 'English'],
      }),
    ).resolves.toEqual({
      userId: 'user-id',
      username: 'new_name',
      isComplete: true,
    });
    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: expect.objectContaining({
        username: 'new_name',
        ageGroup: '26-35',
        isComplete: true,
      }),
    });
  });

  it('rejects usernames owned by another user', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValueOnce({ userId: 'other-user-id' });

    await expect(
      service.updateOwnProfile('user-id', {
        username: 'taken_name',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns only safe public profile fields', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValue({
      username: 'public_user',
      displayName: 'Public User',
    });

    await expect(service.getPublicProfile('public_user')).resolves.toEqual({
      username: 'public_user',
      displayName: 'Public User',
    });
    expect(profile.findUnique).toHaveBeenCalledWith({
      where: { username: 'public_user' },
      select: {
        userId: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        ageGroup: true,
        gender: true,
        region: true,
        city: true,
        primaryLanguage: true,
        languages: true,
        isComplete: true,
        createdAt: true,
      },
    });
  });
});
