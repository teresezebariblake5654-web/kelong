export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function hasMinOrgRole(actual: string, required: OrgRole): boolean {
  if (!isOrgRole(actual)) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function canManageMembers(role: string): boolean {
  return hasMinOrgRole(role, 'admin');
}

export function canRunAgent(role: string): boolean {
  return hasMinOrgRole(role, 'member');
}

export function canUploadFiles(role: string): boolean {
  return hasMinOrgRole(role, 'member');
}
