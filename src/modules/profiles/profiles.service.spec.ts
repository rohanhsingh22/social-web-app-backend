import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ThoughtsService } from '@app/modules/thoughts/thoughts.service';
import { ToliService } from '@app/modules/toli/toli.service';
import { ProfilesService } from './profiles.service';
import { PrismaService } from '@app/core/prisma/prisma.service';

describe('ProfilesService', () => {
  const createService = () => {
    const profile = {
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    const user = {
      findUnique: jest.fn(),
    };
    const prisma = {
      profile,
      user,
    } as unknown as PrismaService;
    const toliService = {
      findToliById: jest.fn(),
    } as unknown as ToliService;
    const thoughtsService = {
      recordEvent: jest.fn(),
    } as unknown as ThoughtsService;

    return {
      service: new ProfilesService(prisma, toliService, thoughtsService),
      profile,
      user,
      toliService,
    };
  };

  it('updates the current profile and marks it complete when required fields exist', async () => {
    const { service, profile } = createService();
    const storedProfile = {
      userId: 'user-id',
      username: 'new_name',
      displayName: 'New Name',
      displayNameNormalized: 'new name',
      avatarUrl: null,
      profilePictureType: 'provider',
      toliAvatarKey: null,
      bio: null,
      dob: new Date('2000-01-01T00:00:00.000Z'),
      ageGroup: '26-35',
      gender: null,
      characterConfig: null,
      region: 'Delhi',
      city: null,
      primaryLanguage: 'Hindi',
      languages: ['Hindi', 'English'],
      interests: [],
      isComplete: true,
      createdAt: new Date('2026-05-16T06:00:00.000Z'),
      updatedAt: new Date('2026-05-16T06:00:00.000Z'),
      toli: null,
      user: { publicUserId: 'HT-7K4M9Q2X' },
    };
    profile.findUnique
      .mockResolvedValueOnce(null)
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
        user: { publicUserId: 'HT-7K4M9Q2X' },
      })
      .mockResolvedValueOnce(storedProfile);
    profile.update.mockResolvedValue({ userId: 'user-id' });

    await expect(
      service.updateOwnProfile('user-id', {
        username: 'new_name',
        displayName: 'New Name',
        dob: '2000-01-01',
        region: 'Delhi',
        primaryLanguage: 'Hindi',
        languages: ['Hindi', 'English'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        username: 'new_name',
        isComplete: true,
        publicUserId: 'HT-7K4M9Q2X',
        toli: null,
        profilePicture: {
          type: 'provider',
          avatarUrl: null,
          toliAvatarKey: null,
          toli: null,
        },
      }),
    );
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

  it('rejects display names owned by another user (case-insensitive)', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValue({ userId: 'other-user-id' });

    await expect(
      service.updateOwnProfile('user-id', { displayName: 'rOhAn' }),
    ).rejects.toThrow(ConflictException);
    expect(profile.findUnique).toHaveBeenCalledWith({
      where: { displayNameNormalized: 'rohan' },
      select: { userId: true },
    });
  });

  it('trims display names and allows keeping your own', async () => {
    const { service, profile } = createService();
    const storedProfile = {
      userId: 'user-id',
      username: 'old_name',
      displayName: 'New Name',
      displayNameNormalized: 'new name',
      avatarUrl: null,
      profilePictureType: 'provider',
      toliAvatarKey: null,
      bio: null,
      dob: null,
      ageGroup: '26-35',
      gender: null,
      characterConfig: null,
      region: 'Delhi',
      city: null,
      primaryLanguage: 'Hindi',
      languages: [],
      interests: [],
      isComplete: true,
      toli: null,
      user: { publicUserId: 'HT-7K4M9Q2X' },
    };
    profile.findUnique
      .mockResolvedValueOnce({ userId: 'user-id' })
      .mockResolvedValueOnce({
        userId: 'user-id',
        username: 'old_name',
        displayName: 'Old Name',
        avatarUrl: null,
        bio: null,
        dob: null,
        ageGroup: '26-35',
        gender: null,
        region: 'Delhi',
        city: null,
        primaryLanguage: 'Hindi',
        languages: [],
        isComplete: true,
        user: { publicUserId: 'HT-7K4M9Q2X' },
      })
      .mockResolvedValueOnce(storedProfile);
    profile.update.mockResolvedValue({ userId: 'user-id' });

    await service.updateOwnProfile('user-id', { displayName: '  New Name  ' });

    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: expect.objectContaining({
        displayName: 'New Name',
        displayNameNormalized: 'new name',
      }),
    });
  });

  it('maps a display-name write race to a conflict', async () => {
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
        ageGroup: '26-35',
        gender: null,
        region: 'Delhi',
        city: null,
        primaryLanguage: 'Hindi',
        languages: [],
        isComplete: true,
        user: { publicUserId: 'HT-7K4M9Q2X' },
      });
    profile.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['profiles_display_name_normalized_key'] },
      }),
    );

    await expect(
      service.updateOwnProfile('user-id', { displayName: 'Rohan' }),
    ).rejects.toThrow(ConflictException);
  });

  it('reports display-name availability excluding self', async () => {
    const { service, profile } = createService();
    profile.findUnique
      .mockResolvedValueOnce({ userId: 'other-user-id' })
      .mockResolvedValueOnce({ userId: 'user-id' });

    await expect(
      service.checkDisplayNameAvailability('user-id', 'Rohan'),
    ).resolves.toEqual({ available: false, displayName: 'Rohan' });
    await expect(
      service.checkDisplayNameAvailability('user-id', 'rohan'),
    ).resolves.toEqual({ available: true, displayName: 'rohan' });
  });

  it('returns only safe public profile fields', async () => {
    const { service, user } = createService();
    user.findUnique.mockResolvedValue({
      publicUserId: 'HT-7K4M9Q2X',
      status: 'active',
      profile: {
        username: 'public_user',
        displayName: 'Public User',
        avatarUrl: 'https://example.com/avatar.png',
        profilePictureType: 'provider',
        toliAvatarKey: null,
        bio: null,
        dob: null,
        ageGroup: null,
        gender: null,
        characterConfig: null,
        region: null,
        city: null,
        primaryLanguage: null,
        languages: [],
        interests: ['music'],
        isComplete: false,
        createdAt: new Date('2026-05-16T06:00:00.000Z'),
        toli: null,
      },
      settings: null,
    });

    await expect(service.getUserProfile('HT-7K4M9Q2X')).resolves.toEqual(
      expect.objectContaining({
        publicUserId: 'HT-7K4M9Q2X',
        username: 'public_user',
        displayName: 'Public User',
        profilePicture: {
          type: 'provider',
          avatarUrl: 'https://example.com/avatar.png',
          toliAvatarKey: null,
          toli: null,
        },
        toli: null,
        interests: ['music'],
      }),
    );
    expect(user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publicUserId: 'HT-7K4M9Q2X' },
      }),
    );
  });

  it('returns the current profile picture', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValue({
      profilePictureType: 'toli',
      toliAvatarKey: 'vector_03',
      avatarUrl: 'https://example.com/avatar.png',
      toli: { id: 'toli-id', name: 'Vector' },
    });

    await expect(service.getProfilePicture('user-id')).resolves.toEqual({
      type: 'toli',
      avatarUrl: null,
      toliAvatarKey: 'vector_03',
      toli: { id: 'toli-id', name: 'Vector' },
    });
  });

  it('switches the picture to a valid Toli avatar', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValue({
      avatarUrl: 'https://example.com/avatar.png',
      toli: { id: 'toli-id', name: 'Vector' },
    });
    profile.update.mockResolvedValue({
      profilePictureType: 'toli',
      toliAvatarKey: 'vector_03',
      avatarUrl: 'https://example.com/avatar.png',
      toli: { id: 'toli-id', name: 'Vector' },
    });

    await expect(
      service.updateProfilePicture('user-id', {
        type: 'toli',
        avatarKey: 'vector_03',
      }),
    ).resolves.toEqual({
      type: 'toli',
      avatarUrl: null,
      toliAvatarKey: 'vector_03',
      toli: { id: 'toli-id', name: 'Vector' },
    });
    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: { profilePictureType: 'toli', toliAvatarKey: 'vector_03' },
      select: expect.anything(),
    });
  });

  it('rejects Toli avatars without membership or from another Toli', async () => {
    const { service, profile } = createService();
    profile.findUnique
      .mockResolvedValueOnce({ avatarUrl: null, toli: null })
      .mockResolvedValueOnce({
        avatarUrl: null,
        toli: { id: 'toli-id', name: 'Vector' },
      });

    await expect(
      service.updateProfilePicture('user-id', {
        type: 'toli',
        avatarKey: 'vector_01',
      }),
    ).rejects.toThrow('TOLI_REQUIRED');
    await expect(
      service.updateProfilePicture('user-id', {
        type: 'toli',
        avatarKey: 'wave_01',
      }),
    ).rejects.toThrow('INVALID_AVATAR_KEY');
    expect(profile.update).not.toHaveBeenCalled();
  });

  it('rejects avatar keys on provider pictures and clears keys on switch', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValue({
      avatarUrl: 'https://example.com/avatar.png',
      toli: { id: 'toli-id', name: 'Vector' },
    });
    profile.update.mockResolvedValue({
      profilePictureType: 'provider',
      toliAvatarKey: null,
      avatarUrl: 'https://example.com/avatar.png',
      toli: { id: 'toli-id', name: 'Vector' },
    });

    await expect(
      service.updateProfilePicture('user-id', {
        type: 'provider',
        avatarKey: 'vector_01',
      }),
    ).rejects.toThrow('AVATAR_KEY_NOT_ALLOWED');

    await expect(
      service.updateProfilePicture('user-id', { type: 'provider' }),
    ).resolves.toEqual({
      type: 'provider',
      avatarUrl: 'https://example.com/avatar.png',
      toliAvatarKey: null,
      toli: { id: 'toli-id', name: 'Vector' },
    });
    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: { profilePictureType: 'provider', toliAvatarKey: null },
      select: expect.anything(),
    });
  });

  it('selects a Toli without touching a provider picture', async () => {
    const { service, profile, toliService } = createService();
    const findToliById = toliService.findToliById as jest.Mock;
    findToliById.mockResolvedValue({ id: 'vector-id', name: 'Vector' });
    profile.findUnique
      .mockResolvedValueOnce({
        toliId: null,
        profilePictureType: 'provider',
        toliAvatarKey: null,
      })
      .mockResolvedValueOnce({
        userId: 'user-id',
        username: 'user_name',
        displayName: 'User Name',
        avatarUrl: null,
        profilePictureType: 'provider',
        toliAvatarKey: null,
        toli: { id: 'vector-id', name: 'Vector' },
        user: { publicUserId: 'HT-7K4M9Q2X' },
      });
    profile.update.mockResolvedValue({});

    const result = await service.selectToli('user-id', 'vector-id');

    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: { toliId: 'vector-id' },
    });
    expect(result).toEqual(
      expect.objectContaining({
        toli: { id: 'vector-id', name: 'Vector' },
      }),
    );
  });

  it('resets a stale Toli avatar when switching Tolies', async () => {
    const { service, profile, toliService } = createService();
    const findToliById = toliService.findToliById as jest.Mock;
    findToliById.mockResolvedValue({ id: 'wave-id', name: 'Wave' });
    profile.findUnique
      .mockResolvedValueOnce({
        toliId: 'vector-id',
        profilePictureType: 'toli',
        toliAvatarKey: 'vector_01',
      })
      .mockResolvedValueOnce({
        userId: 'user-id',
        username: 'user_name',
        displayName: 'User Name',
        avatarUrl: null,
        profilePictureType: 'provider',
        toliAvatarKey: null,
        toli: { id: 'wave-id', name: 'Wave' },
        user: { publicUserId: 'HT-7K4M9Q2X' },
      });
    profile.update.mockResolvedValue({});

    await service.selectToli('user-id', 'wave-id');

    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: {
        toliId: 'wave-id',
        profilePictureType: 'provider',
        toliAvatarKey: null,
      },
    });
  });

  it('clears membership and Toli avatars on skip', async () => {
    const { service, profile } = createService();
    profile.findUnique
      .mockResolvedValueOnce({
        toliId: 'vector-id',
        profilePictureType: 'toli',
        toliAvatarKey: 'vector_02',
      })
      .mockResolvedValueOnce({
        userId: 'user-id',
        username: 'user_name',
        displayName: 'User Name',
        avatarUrl: null,
        profilePictureType: 'provider',
        toliAvatarKey: null,
        toli: null,
        user: { publicUserId: 'HT-7K4M9Q2X' },
      });
    profile.update.mockResolvedValue({});

    const result = await service.selectToli('user-id', null);

    expect(profile.update).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: {
        toliId: null,
        profilePictureType: 'provider',
        toliAvatarKey: null,
      },
    });
    expect(result).toEqual(expect.objectContaining({ toli: null }));
  });

  it('rejects unknown Tolies and no-ops identical selection', async () => {
    const { service, profile, toliService } = createService();
    const findToliById = toliService.findToliById as jest.Mock;
    findToliById.mockResolvedValue(null);
    profile.findUnique.mockResolvedValue({
      toliId: 'vector-id',
      profilePictureType: 'provider',
      toliAvatarKey: null,
    });

    await expect(service.selectToli('user-id', 'missing-id')).rejects.toThrow(
      'TOLI_NOT_FOUND',
    );
    expect(profile.update).not.toHaveBeenCalled();
  });
});
