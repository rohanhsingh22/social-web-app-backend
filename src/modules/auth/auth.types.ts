import { UserRole, UserStatus } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  status: UserStatus;
  role: UserRole;
};

export type AccessTokenPayload = AuthenticatedUser & {
  sessionId: string;
};

export type FacebookProfile = {
  id: string;
  name?: string;
  email?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
};
