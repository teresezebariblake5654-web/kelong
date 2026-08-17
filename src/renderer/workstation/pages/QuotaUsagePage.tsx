import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { PageContainer } from '@workstation/components/layout/PageContainer';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { getUserAccessToken, getActiveOrganizationId } from '@workstation/lib/localStore';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import { useNavigate } from 'react-router-dom';
import { useWorkflow } from '@workstation/state/workflow';

export function QuotaUsagePage() {
  const navigate = useNavigate();
  const { state } = useWorkflow();
  const hasSession = Boolean(getUserAccessToken() && getActiveOrganizationId());

  const balanceQuery = useQuery({
    queryKey: ['quota-usage', 'credits-balance'],
    enabled: hasSession,
    queryFn: () => getUserCloudClient().getCreditBalance(),
    retry: false,
  });

  const localBalance = state.wallet?.balance;
  const cloudBalance = balanceQuery.data?.availableBalance;
  const balance = cloudBalance ?? localBalance;

  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <PageHeader title="额度消耗" lead="查看当前可用分析额度与消耗情况。" />
          </CardHeader>
          <CardContent>
            <div className="rounded-2xl border border-[#D7E4F2] bg-[#F8FBFE] p-5">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Gauge className="size-4 text-[#7BA4D4]" />
                当前可用额度
              </div>
              <div className="mt-2 text-4xl font-semibold tracking-tight text-[#3A6EA5]">
                {balance == null ? '—' : Number(balance).toLocaleString('zh-CN')}
              </div>
              <p className="mt-2 text-xs text-slate-400">单位：分析额度 · 充值功能暂未开放</p>
            </div>

            {!hasSession ? (
              <div className="mt-4">
                <EmptyState
                  message="登录后可同步云端额度明细。"
                  action={
                    <Button
                      className="rounded-full bg-[#7BA4D4] hover:bg-[#6B94C4]"
                      onClick={() => navigate('/login')}
                    >
                      前往登录
                    </Button>
                  }
                />
              </div>
            ) : balanceQuery.isError ? (
              <p className="mt-4 text-sm text-slate-500">云端额度暂不可用，已展示本机缓存值（如有）。</p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => navigate('/account/credits')}>
                查看额度流水
              </Button>
              <Button variant="ghost" onClick={() => navigate('/chat')}>
                返回对话
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
