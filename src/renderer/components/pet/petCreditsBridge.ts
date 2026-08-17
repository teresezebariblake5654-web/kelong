import { getActiveOrganizationId, getUserAccessToken, loadSettings } from '../../workstation/lib/localStore';

/**
 * Passive-only balance probe for the pet layer.
 * Does NOT use createCloudClient — so 401/refresh failures never clear the app session.
 */
export async function fetchPetCreditBalance(): Promise<number | null> {
  const token = getUserAccessToken();
  const orgId = getActiveOrganizationId();
  if (!token || !orgId) return null;

  try {
    const base = loadSettings().apiBaseUrl.replace(/\/$/, '');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${base}/api/v1/credits/balance`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Organization-Id': orgId,
        Accept: 'application/json',
      },
      signal: controller.signal,
      // Pet must not participate in cookie/session side channels
      credentials: 'omit',
      cache: 'no-store',
    });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { availableBalance?: number };
      availableBalance?: number;
    };
    const n = Number(json?.data?.availableBalance ?? json?.availableBalance);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
