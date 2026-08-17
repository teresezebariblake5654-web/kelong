import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudClient, resolveActiveOrganizationId } from '../src/index.js';

describe('resolveActiveOrganizationId', () => {
  it('auto-selects when user has exactly one organization', () => {
    const id = resolveActiveOrganizationId([{ id: 'org-1', name: 'A', slug: 'a', role: 'owner' }], null);
    expect(id).toBe('org-1');
  });

  it('keeps previous id when still a member of multiple orgs', () => {
    const orgs = [
      { id: 'org-1', name: 'A', slug: 'a', role: 'owner' },
      { id: 'org-2', name: 'B', slug: 'b', role: 'member' },
    ];
    expect(resolveActiveOrganizationId(orgs, 'org-2')).toBe('org-2');
  });

  it('returns null when multiple orgs and previous is invalid', () => {
    const orgs = [
      { id: 'org-1', name: 'A', slug: 'a', role: 'owner' },
      { id: 'org-2', name: 'B', slug: 'b', role: 'member' },
    ];
    expect(resolveActiveOrganizationId(orgs, 'missing')).toBeNull();
  });
});

describe('createCloudClient organization header', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send X-Organization-Id for listOrganizations', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudClient({
      baseUrl: 'http://localhost:3001',
      getAccessToken: () => 'user-token',
      getOrganizationId: () => 'org-should-not-appear',
    });

    await client.listOrganizations();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer user-token');
    expect(headers.get('X-Organization-Id')).toBeNull();
  });

  it('injects X-Organization-Id for uploadFile', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            fileId: 'f1',
            originalName: 'a.csv',
            size: 1,
            extension: '.csv',
            createdAt: new Date().toISOString(),
          },
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

    await client.uploadFile(new Blob(['a']), 'a.csv');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/files/upload');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Organization-Id')).toBe('org-active-1');
  });
});
