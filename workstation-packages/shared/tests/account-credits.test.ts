import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudClient } from '../src/index.js';
import type { AccountProfile, CreditBalance, CreditLedgerPage } from '../src/index.js';

describe('account + credits cloudClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects X-Organization-Id for credit balance requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            balance: 10000,
            frozenBalance: 0,
            availableBalance: 10000,
            unit: 'credits',
            updatedAt: '2026-07-14T00:00:00.000Z',
          } satisfies CreditBalance,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudClient({
      baseUrl: 'http://localhost:3001',
      getAccessToken: () => 'user-token',
      getOrganizationId: () => 'org-active-1',
    });

    const data = await client.getCreditBalance();
    expect(data.balance).toBe(10000);
    expect(data.unit).toBe('credits');

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer user-token');
    expect(headers.get('X-Organization-Id')).toBe('org-active-1');
  });

  it('parses account profile response', async () => {
    const profile: AccountProfile = {
      user: { id: 'u1', displayName: '演示用户', email: 'demo@example.com' },
      organization: { id: 'o1', name: '演示组织', role: 'OWNER' },
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: profile }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudClient({
      baseUrl: 'http://localhost:3001',
      getAccessToken: () => 'user-token',
      getOrganizationId: () => 'o1',
    });

    const data = await client.getAccountProfile();
    expect(data.user.displayName).toBe('演示用户');
    expect(data.organization.role).toBe('OWNER');
    expect((data as { provider?: string }).provider).toBeUndefined();
  });

  it('parses credit ledger pagination types', async () => {
    const page: CreditLedgerPage = {
      items: [
        {
          id: 'ledger_1',
          type: 'CONSUME',
          amount: -20,
          balanceAfter: 9980,
          description: '智能分析任务消耗',
          createdAt: '2026-07-14T00:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: page }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudClient({
      baseUrl: 'http://localhost:3001',
      getAccessToken: () => 'user-token',
      getOrganizationId: () => 'o1',
    });

    const data = await client.getCreditLedger({ page: 1, pageSize: 20 });
    expect(data.items[0]?.type).toBe('CONSUME');
    expect(data.pagination.totalPages).toBe(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/credits/ledger?page=1&pageSize=20');
    expect(new Headers(init?.headers).get('X-Organization-Id')).toBe('o1');
  });
});
