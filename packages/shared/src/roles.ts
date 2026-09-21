export interface UserProfile {
  user_id: string;
  display_name: string | null;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerRecord {
  user_id: string;
  preferred_timezone: string;
  created_at: string;
}

export interface MasterOwnerAccount {
  id: string;
  business_name: string;
  status: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeMembership {
  employee_id: string;
  master_owner_id: string;
  business_name: string;
  status: string;
  turf_assignments: Array<{
    turf_id: string;
    turf_name: string;
    capabilities: string[];
  }>;
}

export interface UserContext {
  authenticated: boolean;
  user_id: string | null;
  profile: UserProfile | null;
  player: PlayerRecord | null;
  is_platform_admin: boolean;
  master_owner_accounts: MasterOwnerAccount[];
  employee_memberships: EmployeeMembership[];
}

export interface RoleResolution {
  authenticated: boolean;
  isPlatformAdmin: boolean;
  isMasterOwner: boolean;
  isStaffOwner: boolean;
  isPlayer: boolean;
  canAccessAdmin: boolean;
  canAccessMasterOwner: boolean;
  canAccessStaffOwner: boolean;
  canAccessPlayer: boolean;
}

/**
 * Resolves caller permissions from public.get_my_context().
 * Strictly non-hierarchical: each portal enforces its own required role.
 */
export function resolveUserRole(context: UserContext | null): RoleResolution {
  if (!context || !context.authenticated) {
    return {
      authenticated: false,
      isPlatformAdmin: false,
      isMasterOwner: false,
      isStaffOwner: false,
      isPlayer: false,
      canAccessAdmin: false,
      canAccessMasterOwner: false,
      canAccessStaffOwner: false,
      canAccessPlayer: true, // Anonymous visitors allowed on player catalog
    };
  }

  const isPlatformAdmin = Boolean(context.is_platform_admin);
  const isMasterOwner = Boolean(
    context.master_owner_accounts &&
    context.master_owner_accounts.some(mo => ['onboarding', 'active'].includes(mo.status))
  );
  const isStaffOwner = Boolean(
    context.employee_memberships &&
    context.employee_memberships.some(m => m.status === 'active')
  );
  const isPlayer = Boolean(context.player);

  return {
    authenticated: true,
    isPlatformAdmin,
    isMasterOwner,
    isStaffOwner,
    isPlayer,
    canAccessAdmin: isPlatformAdmin,
    canAccessMasterOwner: isMasterOwner,
    canAccessStaffOwner: isStaffOwner,
    canAccessPlayer: true, // Per approved rule: any authenticated user can book as player
  };
}
