import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionStatus, Prisma, UserStatus } from '@prisma/client';
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

  async create(blockerId: string, blockedUserId: string) {
    if (blockerId === blockedUserId) {
      throw new BadRequestException('CANNOT_BLOCK_SELF');
    }

    const blockedUser = await this.prisma.user.findUnique({
      where: { id: blockedUserId },
      select: { id: true, status: true },
    });

    if (!blockedUser || blockedUser.status === UserStatus.deleted) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

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

  async remove(blockerId: string, blockedUserId: string) {
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

    return { blockedUserId, removed: deleted.count > 0 };
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
      username: true,
      displayName: true,
      avatarUrl: true,
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
