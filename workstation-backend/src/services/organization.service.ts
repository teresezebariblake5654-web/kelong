import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { canManageMembers, hasMinOrgRole, isOrgRole, OrgRole } from '../utils/orgRoles';
import { orgCreditService } from './orgCredit.service';

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'org';
}

export const organizationService = {
  async createDefaultOrganizationForUser(userId: string, username: string) {
    const slugBase = slugify(username);
    const slug = `${slugBase}-${userId.slice(-8)}`;

    return prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: `${username} Org`,
          slug,
          status: 'active',
          plan: 'free',
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId,
          role: 'owner',
          status: 'active',
        },
      });

      return org;
    }).then(async (org) => {
      // First create grants SIGNUP_BONUS_CREDITS once (idempotent BONUS ledger).
      await orgCreditService.ensureAccount(org.id, { userId });
      return org;
    });
  },

  async listForUser(userId: string) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, status: 'active' },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      status: m.organization.status,
      plan: m.organization.plan,
      role: m.role,
      membershipId: m.id,
    }));
  },

  async getMembership(userId: string, organizationId: string) {
    return prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      include: { organization: true },
    });
  },

  async requireMembership(userId: string, organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.status !== 'active') {
      throw new AppError(404, '组织不存在', 'ORGANIZATION_NOT_FOUND');
    }

    const membership = await this.getMembership(userId, organizationId);
    if (!membership || membership.status !== 'active') {
      throw new AppError(403, '无权访问该组织', 'ORGANIZATION_FORBIDDEN');
    }
    return membership;
  },

  async getByIdForUser(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);
    return {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      status: membership.organization.status,
      plan: membership.organization.plan,
      role: membership.role,
    };
  },

  async listMembers(actorUserId: string, organizationId: string) {
    await this.requireMembership(actorUserId, organizationId);
    const members = await prisma.organizationMember.findMany({
      where: { organizationId, status: 'active' },
      include: {
        user: {
          select: { id: true, username: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      role: m.role,
      username: m.user.username,
      email: m.user.email,
      createdAt: m.createdAt,
    }));
  },

  async addMember(
    actorUserId: string,
    organizationId: string,
    input: { email: string; role: string },
  ) {
    const actor = await this.requireMembership(actorUserId, organizationId);
    if (!canManageMembers(actor.role)) {
      throw new AppError(403, '需要管理员权限', 'FORBIDDEN');
    }

    const role = input.role || 'member';
    if (!isOrgRole(role) || role === 'owner') {
      throw new AppError(400, '无效的成员角色', 'BAD_REQUEST');
    }
    if (role === 'admin' && actor.role !== 'owner') {
      throw new AppError(403, '仅 OWNER 可添加 ADMIN', 'FORBIDDEN');
    }

    const user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user) {
      throw new AppError(404, '用户不存在', 'NOT_FOUND');
    }

    const existing = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: user.id },
      },
    });
    if (existing && existing.status === 'active') {
      throw new AppError(409, '成员已存在', 'MEMBER_EXISTS');
    }

    const member = existing
      ? await prisma.organizationMember.update({
          where: { id: existing.id },
          data: { role, status: 'active' },
        })
      : await prisma.organizationMember.create({
          data: {
            organizationId,
            userId: user.id,
            role,
            status: 'active',
          },
        });

    return {
      membershipId: member.id,
      userId: member.userId,
      role: member.role,
    };
  },

  async updateMemberRole(
    actorUserId: string,
    organizationId: string,
    membershipId: string,
    role: string,
  ) {
    const actor = await this.requireMembership(actorUserId, organizationId);
    if (!canManageMembers(actor.role)) {
      throw new AppError(403, '需要管理员权限', 'FORBIDDEN');
    }
    if (!isOrgRole(role) || role === 'owner') {
      throw new AppError(400, '无效的成员角色', 'BAD_REQUEST');
    }

    const target = await prisma.organizationMember.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!target || target.status !== 'active') {
      throw new AppError(404, '成员不存在', 'NOT_FOUND');
    }
    if (target.role === 'owner') {
      throw new AppError(400, '不能直接修改 OWNER 角色', 'BAD_REQUEST');
    }
    if (role === 'admin' && actor.role !== 'owner') {
      throw new AppError(403, '仅 OWNER 可设置 ADMIN', 'FORBIDDEN');
    }

    const updated = await prisma.organizationMember.update({
      where: { id: target.id },
      data: { role },
    });

    return {
      membershipId: updated.id,
      userId: updated.userId,
      role: updated.role,
    };
  },

  async removeMember(actorUserId: string, organizationId: string, membershipId: string) {
    const actor = await this.requireMembership(actorUserId, organizationId);
    if (!canManageMembers(actor.role)) {
      throw new AppError(403, '需要管理员权限', 'FORBIDDEN');
    }

    const target = await prisma.organizationMember.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!target || target.status !== 'active') {
      throw new AppError(404, '成员不存在', 'NOT_FOUND');
    }

    if (target.role === 'owner') {
      const ownerCount = await prisma.organizationMember.count({
        where: { organizationId, role: 'owner', status: 'active' },
      });
      if (ownerCount <= 1) {
        throw new AppError(400, '不能删除唯一 OWNER', 'LAST_OWNER');
      }
    }

    if (target.userId === actorUserId && target.role === 'owner') {
      const ownerCount = await prisma.organizationMember.count({
        where: { organizationId, role: 'owner', status: 'active' },
      });
      if (ownerCount <= 1) {
        throw new AppError(400, 'OWNER 不能删除自己导致组织无 OWNER', 'LAST_OWNER');
      }
    }

    await prisma.organizationMember.update({
      where: { id: target.id },
      data: { status: 'removed' },
    });

    return { ok: true };
  },

  assertMinRole(actualRole: string, required: OrgRole) {
    if (!hasMinOrgRole(actualRole, required)) {
      throw new AppError(403, '权限不足', 'FORBIDDEN');
    }
  },
};
