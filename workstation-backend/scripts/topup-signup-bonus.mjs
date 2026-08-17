import { PrismaClient, CreditLedgerType } from '@prisma/client';

const BONUS = Number(process.env.SIGNUP_BONUS_CREDITS || 20_000);
const ONLY_EMAIL = process.argv[2] || null;

const prisma = new PrismaClient();

async function topupOrg(orgId, userId, currentBalance) {
  if (currentBalance >= BONUS) {
    console.log('skip', orgId, 'balance', currentBalance);
    return;
  }
  const add = BONUS - currentBalance;
  const idempotencyKey = `org:${orgId}:manual_signup_bonus_topup_v1`;
  const existing = await prisma.creditLedger.findUnique({ where: { idempotencyKey } });
  if (existing) {
    console.log('skip already topped', orgId);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.creditAccount.update({
      where: { organizationId: orgId },
      data: {
        balance: { increment: add },
        totalRecharged: { increment: add },
      },
    });
    await tx.creditLedger.create({
      data: {
        organizationId: orgId,
        userId,
        type: CreditLedgerType.RECHARGE,
        amount: add,
        balanceBefore: currentBalance,
        balanceAfter: updated.balance,
        description: `补发注册赠送约¥20 BONUS credits=${add}`,
        idempotencyKey,
        sourceType: 'BONUS',
        sourceId: `manual_signup_bonus:${orgId}`,
      },
    });
  });
  console.log('topped', orgId, '+', add, '->', currentBalance + add);
}

async function main() {
  console.log('SIGNUP_BONUS_CREDITS target =', BONUS);
  const users = await prisma.user.findMany({
    where: ONLY_EMAIL ? { email: ONLY_EMAIL } : undefined,
    include: {
      memberships: {
        include: {
          organization: { include: { creditAccount: true } },
        },
      },
    },
  });

  for (const user of users) {
    for (const m of user.memberships) {
      let account = m.organization.creditAccount;
      if (!account) {
        account = await prisma.creditAccount.create({
          data: {
            organizationId: m.organizationId,
            balance: 0,
            frozenBalance: 0,
            totalRecharged: 0,
            totalConsumed: 0,
          },
        });
      }
      await topupOrg(m.organizationId, user.id, account.balance);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
