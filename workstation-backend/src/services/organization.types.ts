export const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const RANK: Record<OrgRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return RANK[actual] >= RANK[required];
}

export function canRunAgent(role: OrgRole): boolean {
  return roleAtLeast(role, 'MEMBER');
}

export function canManageMembers(role: OrgRole): boolean {
  return roleAtLeast(role, 'ADMIN');
}
