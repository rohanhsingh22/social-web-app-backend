import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';

export type AdminAuditInput = {
  actorId: string;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
  idempotencyKey?: string;
};

/**
 * Append-only writer for consequential admin actions. Application code never
 * updates or deletes AdminAuditEvent rows; metadata carries redacted fragments
 * only — never tokens, secrets or raw message bodies.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    data: AdminAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<unknown> {
    const client = tx ?? this.prisma;
    return client.adminAuditEvent.create({
      data: {
        actorId: data.actorId,
        actorRole: data.actorRole,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        reason: data.reason,
        metadata: data.metadata ?? Prisma.DbNull,
        requestId: data.requestId,
        idempotencyKey: data.idempotencyKey,
      },
    });
  }
}
