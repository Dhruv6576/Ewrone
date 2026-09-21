export interface PortalClientConfig {
  portal: 'admin' | 'owner' | 'player';
  cookieName: string;
  storageKey: string;
  port: number;
}

export const PORTAL_CONFIGS: Record<'admin' | 'owner' | 'player', PortalClientConfig> = {
  admin: {
    portal: 'admin',
    cookieName: 'sb-boxcodex-admin-auth-token',
    storageKey: 'boxcodex_admin_auth',
    port: 3003,
  },
  owner: {
    portal: 'owner',
    cookieName: 'sb-boxcodex-owner-auth-token',
    storageKey: 'boxcodex_owner_auth',
    port: 3001,
  },
  player: {
    portal: 'player',
    cookieName: 'sb-boxcodex-player-auth-token',
    storageKey: 'boxcodex_player_auth',
    port: 3000,
  },
};
