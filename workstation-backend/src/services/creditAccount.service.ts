import { CreditAccount } from '@prisma/client';
import { organizationService } from './organization.service';
import { orgCreditService } from './orgCredit.service';
import { prisma } from '../config/database';

export type EnsuredCreditAccount = CreditAccount & {
  totalRecharged: number;
  totalConsumed: number;
};

/**
 * Ensure the user has at least one organization CreditAccount.
 * CreditAccount is org-scoped; first create grants signup bonus once.
 *
 * - Concurrent creates are safe (unique organizationId + P2002 retry).
 * - Signup bonus ledger is idempotent via sourceType/sourceId + idempotencyKey.
 */
export async function ensureCreditAccount(userId: string): Promise<EnsuredCreditAccount> {
  if (!userId) {
    throw new Error('ensureCreditAccount requires userId');
  }

  let orgs = await organizationService.listForUser(userId);
  if (orgs.length === 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    await organizationService.createDefaultOrganizationForUser(
      userId,
      user?.username ?? `user-${userId.slice(-6)}`,
    );
    orgs = await organizationService.listForUser(userId);
  }

  const primaryOrgId = orgs[0]!.id;
  const account = await orgCreditService.ensureAccount(primaryOrgId, { userId });

  for (const org of orgs.slice(1)) {
    await orgCreditService.ensureAccount(org.id, { userId });
  }

  return withTotals(account);
}

function withTotals(account: CreditAccount): EnsuredCreditAccount {
  return {
    ...account,
    totalRecharged: account.totalRecharged ?? 0,
    totalConsumed: account.totalConsumed ?? 0,
  };
}

export const creditAccountService = {
  ensureCreditAccount,
};
