import { SetMetadata } from '@nestjs/common';
import { AdminPermission } from './admin-permissions';

export const ADMIN_PERMISSIONS_KEY = 'adminPermissions';

/**
 * Requires ALL listed permissions. Backend-enforced by AdminPermissionsGuard;
 * a hidden frontend button is never security.
 */
export const RequirePermissions = (...permissions: AdminPermission[]) =>
  SetMetadata(ADMIN_PERMISSIONS_KEY, permissions);
