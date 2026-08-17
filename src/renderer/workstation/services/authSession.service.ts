import type { AuthSessionPayload, AuthUserSummary, OrganizationSummary } from '@aw/shared';
import { resolveActiveOrganizationId } from '@aw/shared';
import { getUserCloudClient } from '../lib/userCloud';
import {
  clearUserSession,
  getActiveOrganizationId,
  getLastLoginEmail,
  getUserAccessToken,
  getUserRefreshToken,
  saveOrganizations,
  saveUserProfile,
  setActiveOrganizationId,
  setLastLoginEmail,
  setUserAccessToken,
  setUserRefreshToken,
  clearActiveOrganizationId,
} from '../lib/localStore';

export type OrganizationContext = {
  user: AuthUserSummary;
  organizations: OrganizationSummary[];
  activeOrganizationId: string | null;
};

function applyOrganizations(organizations: OrganizationSummary[]): string | null {
  saveOrganizations(organizations);
  const nextId = resolveActiveOrganizationId(organizations, getActiveOrganizationId());
  if (nextId) {
    setActiveOrganizationId(nextId);
  } else {
    clearActiveOrganizationId();
  }
  return nextId;
}

function persistSession(session: AuthSessionPayload, emailHint?: string): OrganizationContext {
  setUserAccessToken(session.accessToken);
  if (session.refreshToken) {
    setUserRefreshToken(session.refreshToken);
  }
  saveUserProfile(session.user);
  const email = emailHint?.trim() || session.user.email;
  if (email) setLastLoginEmail(email);
  const organizations = session.organizations?.length > 0 ? session.organizations : [];
  const activeOrganizationId = applyOrganizations(organizations);
  return {
    user: session.user,
    organizations,
    activeOrganizationId,
  };
}

export const authSessionService = {
  getRememberedEmail() {
    return getLastLoginEmail();
  },

  async sendEmailOtp(email: string, purpose: 'register' | 'login') {
    const client = getUserCloudClient();
    return client.sendEmailOtp({ email: email.trim(), purpose });
  },

  async login(email: string, password: string): Promise<OrganizationContext> {
    const client = getUserCloudClient();
    const session = await client.login({ email: email.trim(), password });
    const context = persistSession(session, email);

    const organizations = await client.listOrganizations();
    const activeOrganizationId = applyOrganizations(organizations);
    return {
      user: context.user,
      organizations,
      activeOrganizationId,
    };
  },

  async loginWithOtp(email: string, code: string): Promise<OrganizationContext> {
    const client = getUserCloudClient();
    const session = await client.login({ email: email.trim(), code: code.trim() });
    const context = persistSession(session, email);
    const organizations =
      context.organizations.length > 0
        ? context.organizations
        : await client.listOrganizations();
    const activeOrganizationId = applyOrganizations(organizations);
    return { user: context.user, organizations, activeOrganizationId };
  },

  async register(
    input: { email: string; username: string; password: string; code?: string },
  ): Promise<OrganizationContext> {
    const client = getUserCloudClient();
    const session = await client.register({
      email: input.email.trim(),
      username: input.username.trim(),
      password: input.password,
      code: input.code?.trim(),
    });
    const context = persistSession(session, input.email);
    const organizations =
      context.organizations.length > 0
        ? context.organizations
        : await client.listOrganizations();
    const activeOrganizationId = applyOrganizations(organizations);
    return { user: context.user, organizations, activeOrganizationId };
  },

  /**
   * Restore session after app restart: keep logged-in if refresh token (or cookie) still valid.
   */
  async restoreSession(): Promise<OrganizationContext | null> {
    const access = getUserAccessToken();
    const refresh = getUserRefreshToken();
    if (!access && !refresh) return null;

    const client = getUserCloudClient();
    try {
      const me = await client.me();
      saveUserProfile(me);
      const organizations =
        me.organizations && me.organizations.length > 0
          ? me.organizations
          : await client.listOrganizations();
      const activeOrganizationId = applyOrganizations(organizations);
      if (me.email) setLastLoginEmail(me.email);
      return { user: me, organizations, activeOrganizationId };
    } catch {
      if (!refresh) {
        clearUserSession();
        return null;
      }
      try {
        const session = await client.refresh({ refreshToken: refresh });
        const context = persistSession(session);
        const organizations =
          context.organizations.length > 0
            ? context.organizations
            : await client.listOrganizations();
        const activeOrganizationId = applyOrganizations(organizations);
        return { user: context.user, organizations, activeOrganizationId };
      } catch {
        clearUserSession();
        return null;
      }
    }
  },

  async refreshOrganizationContext(): Promise<OrganizationContext> {
    const client = getUserCloudClient();
    const me = await client.me();
    saveUserProfile(me);
    const organizations =
      me.organizations && me.organizations.length > 0
        ? me.organizations
        : await client.listOrganizations();
    const activeOrganizationId = applyOrganizations(organizations);
    return { user: me, organizations, activeOrganizationId };
  },

  async uploadAvatar(file: File): Promise<AuthUserSummary> {
    const client = getUserCloudClient();
    const user = await client.uploadAvatar(file, file.name || 'avatar.png');
    saveUserProfile(user);
    window.dispatchEvent(new CustomEvent('workstation:profile-changed'));
    return user;
  },

  logout() {
    clearUserSession();
  },

  isLoggedIn() {
    return Boolean(getUserAccessToken() || getUserRefreshToken());
  },
};
