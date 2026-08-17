import { createCloudClient } from '@aw/shared';
import {
  clearUserSession,
  getActiveOrganizationId,
  getUserAccessToken,
  getUserRefreshToken,
  loadSettings,
  setUserAccessToken,
  setUserRefreshToken,
} from './localStore';

/** User JWT client: org-scoped methods inject `X-Organization-Id`. */
export function getUserCloudClient() {
  const settings = loadSettings();
  return createCloudClient({
    baseUrl: settings.apiBaseUrl.replace(/\/$/, ''),
    getAccessToken: getUserAccessToken,
    getOrganizationId: getActiveOrganizationId,
    getRefreshToken: getUserRefreshToken,
    onSessionTokens: ({ accessToken, refreshToken }) => {
      setUserAccessToken(accessToken);
      if (refreshToken) setUserRefreshToken(refreshToken);
    },
    onSessionExpired: () => {
      clearUserSession();
    },
  });
}
