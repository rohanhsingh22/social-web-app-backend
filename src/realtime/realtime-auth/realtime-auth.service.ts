import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService } from '@app/modules/auth/auth.service';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';

export type RealtimeSocket = Socket & {
  data: {
    user?: AuthenticatedUser;
    isGuest: boolean;
    joinedChannelIds: Set<string>;
  };
};

@Injectable()
export class RealtimeAuthService {
  private readonly logger = new Logger(RealtimeAuthService.name);

  constructor(private readonly authService: AuthService) {}

  async authenticate(socket: RealtimeSocket): Promise<void> {
    socket.data.isGuest = true;
    socket.data.joinedChannelIds = new Set();

    const token = this.extractToken(socket);

    if (!token) {
      return;
    }

    const user = await this.authService.verifyAccessToken(token);
    socket.data.user = user;
    socket.data.isGuest = false;
  }

  private extractToken(socket: Socket): string | undefined {
    const authHeader = socket.handshake.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }

    const authToken = socket.handshake.auth?.token as string | undefined;

    if (authToken) {
      return authToken;
    }

    const cookie = socket.handshake.headers.cookie;

    if (!cookie) {
      return undefined;
    }

    const match = cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
    return match?.[1];
  }
}
