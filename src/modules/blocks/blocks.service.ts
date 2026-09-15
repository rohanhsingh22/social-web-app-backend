import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionStatus, Prisma, UserStatus } from '@prisma/client';
import { normalizePublicUserId } from '@app/common/public-user-id';
import { profileCardSelect } from '@app/common/profile-card';
import { PrismaService } from '@app/core/prisma/prisma.service';

type BlockWithUser = Prisma.BlockGetPayload<{
  include: {
    blockedUser: {
      select: {
        id: true;
        profile: {
          select: ReturnType<BlocksService['publicProfileSelect']>;
        };
      };
    };
  };
}>;

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(blockerId: string) {
    const blocks = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: this.blockInclude(),
    });

    return blocks.map((block) => this.mapBlock(block));
  }

  async create(blockerId: string, blockedPublicUserId: string) {
    const publicUserId = normalizePublicUserId(blockedPublicUserId);

    if (!publicUserId) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const blockedUser = await this.prisma.user.findUnique({
      where: { publicUserId },
      select: { id: true, status: true, publicUserId: true },
    });

    if (!blockedUser || blockedUser.status === UserStatus.deleted) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    if (blockerId === blockedUser.id) {
      throw new BadRequestException('CANNOT_BLOCK_SELF');
    }

    const blockedUserId = blockedUser.id;

    const { userLowId, userHighId } = this.normalizedPair(
      blockerId,
      blockedUserId,
    );

    const block = await this.prisma.$transaction(async (tx) => {
      const created = await tx.block.upsert({
        where: {
          blockerId_blockedUserId: {
            blockerId,
            blockedUserId,
          },
        },
        create: {
          blockerId,
          blockedUserId,
        },
        update: {},
        include: this.blockInclude(),
      });

      await tx.connection.updateMany({
        where: {
          userLowId,
          userHighId,
          status: { in: [ConnectionStatus.pending, ConnectionStatus.accepted] },
        },
        data: { status: ConnectionStatus.blocked },
      });

      return created;
    });

    return this.mapBlock(block);
  }

  async remove(blockerId: string, blockedPublicUserId: string) {
    const publicUserId = normalizePublicUserId(blockedPublicUserId);

    if (!publicUserId) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const blockedUser = await this.prisma.user.findUnique({
      where: { publicUserId },
      select: { id: true },
    });

    if (!blockedUser) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const blockedUserId = blockedUser.id;

    const deleted = await this.prisma.block.deleteMany({
      where: { blockerId, blockedUserId },
    });

    await this.prisma.connection.updateMany({
      where: {
        ...this.normalizedPair(blockerId, blockedUserId),
        status: ConnectionStatus.blocked,
      },
      data: { status: ConnectionStatus.cancelled },
    });

    return { blockedUserId: publicUserId, removed: deleted.count > 0 };
  }

  private normalizedPair(firstUserId: string, secondUserId: string) {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    return { userLowId, userHighId };
  }

  private blockInclude() {
    return {
      blockedUser: {
        select: {
          id: true,
          profile: { select: this.publicProfileSelect() },
        },
      },
    } satisfies Prisma.BlockInclude;
  }

  private publicProfileSelect() {
    return {
      userId: true,
      ...profileCardSelect,
      bio: true,
      ageGroup: true,
      region: true,
      primaryLanguage: true,
      languages: true,
    } satisfies Prisma.ProfileSelect;
  }

  private mapBlock(block: BlockWithUser) {
    return {
      id: block.id,
      blockerId: block.blockerId,
      blockedUserId: block.blockedUserId,
      createdAt: block.createdAt,
      blockedUser: block.blockedUser,
    };
  }
}
