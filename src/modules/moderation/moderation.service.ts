import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';

const REPEATED_CHARACTER_PATTERN = /(.)\1{14,}/;
const URL_PATTERN = /https?:\/\/|www\./i;

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMessageAllowed(body: string): Promise<void> {
    this.assertNotSpam(body);

    const bannedWords = await this.prisma.bannedWord.findMany({
      where: { isActive: true },
      select: { word: true },
    });
    const normalized = body.toLowerCase();

    for (const bannedWord of bannedWords) {
      const word = bannedWord.word.trim().toLowerCase();

      if (word && this.containsBannedWord(normalized, word)) {
        throw new BadRequestException('BANNED_WORD');
      }
    }
  }

  private assertNotSpam(body: string): void {
    if (REPEATED_CHARACTER_PATTERN.test(body)) {
      throw new BadRequestException('SPAM_DETECTED');
    }

    const tokens = body.toLowerCase().split(/\s+/).filter(Boolean);
    const counts = new Map<string, number>();

    for (const token of tokens) {
      const count = (counts.get(token) ?? 0) + 1;
      counts.set(token, count);

      if (token.length > 2 && count >= 8) {
        throw new BadRequestException('SPAM_DETECTED');
      }
    }

    const linkCount = body.split(/\s+/).filter((part) => URL_PATTERN.test(part))
      .length;

    if (linkCount > 3) {
      throw new BadRequestException('SPAM_DETECTED');
    }
  }

  private containsBannedWord(body: string, word: string): boolean {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, 'i');
    return pattern.test(body);
  }
}
