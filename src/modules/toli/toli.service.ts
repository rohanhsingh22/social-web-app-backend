import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';
import {
  TOLI_AVATAR_KEYS,
  ToliName,
  isToliName,
} from './toli-avatars';

export type ToliSummary = {
  id: string;
  name: string;
  description: string;
  motto: string;
  memberCount: number;
  avatars: readonly string[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ToliService {
  private readonly logger = new Logger(ToliService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listTolis(): Promise<ToliSummary[]> {
    const tolis = await this.prisma.toli.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { profiles: true } } },
    });

    return tolis.map((toli) => this.toSummary(toli));
  }

  async getToli(idOrName: string): Promise<ToliSummary> {
    const toli = UUID_PATTERN.test(idOrName)
      ? await this.prisma.toli.findUnique({
          where: { id: idOrName },
          include: { _count: { select: { profiles: true } } },
        })
      : await this.prisma.toli.findFirst({
          where: { name: { equals: idOrName, mode: 'insensitive' } },
          include: { _count: { select: { profiles: true } } },
        });

    if (!toli) {
      throw new NotFoundException('TOLI_NOT_FOUND');
    }

    return this.toSummary(toli);
  }

  async findToliById(
    id: string,
  ): Promise<{ id: string; name: string } | null> {
    return this.prisma.toli.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  private toSummary(toli: {
    id: string;
    name: string;
    description: string;
    motto: string;
    _count: { profiles: number };
  }): ToliSummary {
    const name: ToliName | null = isToliName(toli.name) ? toli.name : null;

    if (!name) {
      this.logger.warn(`Toli "${toli.name}" has no avatar catalog entry`);
    }

    return {
      id: toli.id,
      name: toli.name,
      description: toli.description,
      motto: toli.motto,
      memberCount: toli._count.profiles,
      avatars: name ? TOLI_AVATAR_KEYS[name] : [],
    };
  }
}
