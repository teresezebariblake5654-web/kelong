import { useMutation } from '@tanstack/react-query';
import { PageHeader, EmptyState, ErrorState, FeatureUnavailable, LoadingState } from '@workstation/components/common';
import { Badge } from '@workstation/components/ui/badge';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { isFeatureEnabled } from '@workstation/config/featureFlags';
import { usePlansQuery, useWalletQuery } from '@workstation/hooks/useCloudQueries';
import { getServices } from '@workstation/services/registry';
import { useWorkflow } from '@workstation/state/workflow';
import { queryClient } from '@workstation/lib/queryClient';

export function WalletPage() {
  const { state } = useWorkflow();
  const walletQuery = useWalletQuery(true);
  const plansQuery = usePlansQuery(isFeatureEnabled('payment'));
  const buyMutation = useMutation({
    mutationFn: (planCode: string) =>
      getServices().wallet.createOrder({ planCode, paymentProvider: 'mock' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  const loading = walletQuery.isLoading || plansQuery.isLoading;
  const error =
    walletQuery.error instanceof Error
      ? walletQuery.error.message
      : buyMutation.error instanceof Error
        ? buyMutation.error.message
        : '';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader title="AI 积分" lead="只展示业务积分与套餐，不显示技术参数。" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? <LoadingState message="正在加载额度与套餐…" /> : null}

          <div className="grid max-w-xs gap-1 rounded-[12px] border border-border bg-muted/40 p-4">
            <div className="text-xs text-muted-foreground">当前余额</div>
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {state.wallet?.balance ?? walletQuery.data?.balance ?? '—'}
            </div>
          </div>

          {state.task ? (
            <EmptyState
              message={`当前任务「${state.task.name}」预计消耗 ${state.task.estimatedCredits} AI 积分。`}
            />
          ) : null}

          {isFeatureEnabled('payment') ? (
            <div className="grid grid-cols-2 gap-3">
              {(plansQuery.data ?? []).map((plan) => (
                <button
                  key={plan.code}
                  type="button"
                  className="rounded-[12px] border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:opacity-50"
                  disabled={buyMutation.isPending}
                  onClick={() => buyMutation.mutate(plan.code)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{plan.name}</strong>
                    <Badge variant="secondary">{plan.billingCycle}</Badge>
                  </div>
                  <div className="mt-2 font-mono text-sm tabular-nums">
                    ¥{(plan.priceCents / 100).toFixed(2)} · +{plan.includedCredits} 额度
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <FeatureUnavailable
              featureName="套餐购买"
              hint="支付能力将在后续阶段接入，当前仅展示余额与预计消耗。"
            />
          )}

          {!loading &&
          !(plansQuery.data?.length ?? 0) &&
          !error &&
          isFeatureEnabled('payment') ? (
            <EmptyState message="暂无可用套餐，请确认云端服务已启动并完成 Seed。" />
          ) : null}

          {buyMutation.data ? (
            <EmptyState
              message={`订单 ${String(buyMutation.data.order.orderNo ?? '')} 已创建，状态：待支付。`}
            />
          ) : null}

          {error ? (
            <ErrorState
              message={error}
              onRetry={() => {
                void walletQuery.refetch();
                void plansQuery.refetch();
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>说明</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => void walletQuery.refetch()}>
            刷新余额
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
