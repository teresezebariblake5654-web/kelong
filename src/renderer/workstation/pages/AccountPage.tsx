import { FormEvent, useCallback, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CreditLedgerItem, CreditLedgerType } from '@aw/shared';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { PageStateView } from '@workstation/components/common/PageStateView';
import { PageContainer } from '@workstation/components/layout/PageContainer';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { Input } from '@workstation/components/ui/input';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import {
  getActiveOrganizationId,
  getUserAccessToken,
  loadSettings,
  loadWorkspace,
  saveSettings,
  saveWorkspace,
  type WorkspaceProfile,
} from '@workstation/lib/localStore';
import { authSessionService } from '@workstation/services/authSession.service';
import { useTemplateSessionStore } from '@workstation/state/templateSessionStore';
import type { PageViewState } from '@workstation/types';

export type AccountSection = 'profile' | 'credits' | 'help';

const LEDGER_TYPE_LABEL: Record<CreditLedgerType, string> = {
  INITIAL: '初始化',
  CONSUME: '消耗',
  REFUND: '退款',
  ADMIN_ADJUST: '管理员调整',
  RECHARGE: '充值到账',
};

function formatAmount(amount: number): string {
  if (amount > 0) return `+${amount.toLocaleString('zh-CN')}`;
  return amount.toLocaleString('zh-CN');
}

function resolveDisplayName(displayName: string | null, email: string | null): string {
  if (displayName?.trim()) return displayName.trim();
  if (email?.includes('@')) return email.split('@')[0] || '未设置名称';
  return '未设置名称';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
}

function resolveSection(pathname: string): AccountSection {
  if (pathname.startsWith('/account/credits')) return 'credits';
  if (pathname.startsWith('/account/help')) return 'help';
  return 'profile';
}

const SECTION_META: Record<AccountSection, { title: string; lead: string }> = {
  profile: { title: '账户信息', lead: '查看账号资料，并管理本机设置。' },
  credits: { title: 'AI 积分', lead: '查看可用积分与最近明细。' },
  help: { title: '帮助与支持', lead: '协议说明与常见支持入口。' },
};

export function AccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const section = resolveSection(location.pathname);
  const meta = SECTION_META[section];
  const resetCurrentTemplate = useTemplateSessionStore((s) => s.resetCurrentTemplate);
  const [reloadKey, setReloadKey] = useState(0);
  const [settings, setSettings] = useState(loadSettings);
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const hasSession = Boolean(getUserAccessToken() && getActiveOrganizationId());

  const [profileQuery, balanceQuery, ledgerQuery] = useQueries({
    queries: [
      {
        queryKey: ['account', 'profile', reloadKey],
        enabled: hasSession && section === 'profile',
        queryFn: () => getUserCloudClient().getAccountProfile(),
        retry: false,
      },
      {
        queryKey: ['account', 'credits-balance', reloadKey],
        enabled: hasSession && section === 'credits',
        queryFn: () => getUserCloudClient().getCreditBalance(),
        retry: false,
      },
      {
        queryKey: ['account', 'credits-ledger', reloadKey],
        enabled: hasSession && section === 'credits',
        queryFn: () => getUserCloudClient().getCreditLedger({ page: 1, pageSize: 20 }),
        retry: false,
      },
    ],
  });

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const onLogout = useCallback(() => {
    authSessionService.logout();
    resetCurrentTemplate();
    navigate('/login', { replace: true });
  }, [navigate, resetCurrentTemplate]);

  const onSaveSettings = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      saveSettings(settings);
      saveWorkspace(workspace);
      setSettingsSaved(true);
    },
    [settings, workspace],
  );

  const profileState: PageViewState = !hasSession
    ? 'error'
    : profileQuery.isLoading
      ? 'loading'
      : profileQuery.isError
        ? 'error'
        : profileQuery.data
          ? 'ready'
          : 'empty';

  const balanceState: PageViewState = !hasSession
    ? 'error'
    : balanceQuery.isLoading
      ? 'loading'
      : balanceQuery.isError
        ? 'error'
        : balanceQuery.data
          ? 'ready'
          : 'empty';

  const ledgerItems: CreditLedgerItem[] = ledgerQuery.data?.items ?? [];
  const ledgerState: PageViewState = !hasSession
    ? 'error'
    : ledgerQuery.isLoading
      ? 'loading'
      : ledgerQuery.isError
        ? 'error'
        : ledgerItems.length === 0
          ? 'empty'
          : 'ready';

  const profile = profileQuery.data;
  const balance = balanceQuery.data;

  const roleLabel = useMemo(() => {
    const role = profile?.organization.role?.toUpperCase() ?? '';
    if (role === 'OWNER') return '所有者';
    if (role === 'ADMIN') return '管理员';
    if (role === 'MEMBER') return '成员';
    return profile?.organization.role || '—';
  }, [profile?.organization.role]);

  if (!hasSession && section !== 'help') {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <PageHeader title={meta.title} lead={meta.lead} />
          </CardHeader>
          <CardContent>
            <EmptyState
              message="请先登录后再查看该页面。"
              action={
                <Button onClick={() => navigate('/login', { replace: true })}>前往登录</Button>
              }
            />
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader>
            <PageHeader title={meta.title} lead={meta.lead} />
          </CardHeader>
        </Card>

        {section === 'profile' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>基本资料</CardTitle>
              </CardHeader>
              <CardContent>
                <PageStateView
                  state={profileState}
                  errorMessage="账户信息加载失败"
                  emptyMessage="暂无账户信息"
                  onRetry={reload}
                >
                  {profile ? (
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">用户名称</dt>
                        <dd className="mt-1 font-medium">
                          {resolveDisplayName(profile.user.displayName, profile.user.email)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">邮箱</dt>
                        <dd className="mt-1 font-medium">{profile.user.email || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">当前组织</dt>
                        <dd className="mt-1 font-medium">{profile.organization.name}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">当前角色</dt>
                        <dd className="mt-1 font-medium">{roleLabel}</dd>
                      </div>
                    </dl>
                  ) : null}
                </PageStateView>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>本机设置</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-4" onSubmit={onSaveSettings}>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-muted-foreground">企业名称</span>
                    <Input
                      value={workspace.organizationName}
                      onChange={(e) =>
                        setWorkspace({ ...workspace, organizationName: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-muted-foreground">U 盘状态</span>
                    <select
                      className="h-9 rounded-[10px] border border-input bg-card px-3 text-sm"
                      value={workspace.usbStatus}
                      onChange={(e) =>
                        setWorkspace({
                          ...workspace,
                          usbStatus: e.target.value as WorkspaceProfile['usbStatus'],
                        })
                      }
                    >
                      <option value="connected">已连接</option>
                      <option value="offline">离线</option>
                      <option value="unknown">未知</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-muted-foreground">云端服务地址</span>
                    <Input
                      value={settings.apiBaseUrl}
                      onChange={(e) => setSettings({ ...settings, apiBaseUrl: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-muted-foreground">设备名称</span>
                    <Input
                      value={settings.deviceName}
                      onChange={(e) => setSettings({ ...settings, deviceName: e.target.value })}
                    />
                  </label>
                  <Button type="submit">保存设置</Button>
                  {settingsSaved ? <EmptyState message="已保存到本机配置。" /> : null}
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between gap-3 pt-6">
                <p className="text-sm text-muted-foreground">退出后需重新登录才能继续使用分析服务。</p>
                <Button variant="outline" onClick={onLogout}>
                  退出登录
                </Button>
              </CardContent>
            </Card>
          </>
        ) : null}

        {section === 'credits' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>积分概览</CardTitle>
              </CardHeader>
              <CardContent>
                <PageStateView
                  state={balanceState}
                  errorMessage="额度信息加载失败"
                  emptyMessage="暂无额度数据"
                  onRetry={reload}
                >
                  {balance ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">剩余分析额度</div>
                        <div className="mt-1 text-3xl font-semibold tracking-tight">
                          {balance.availableBalance.toLocaleString('zh-CN')}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">单位：分析额度</div>
                      </div>
                      <dl className="grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-muted-foreground">可用额度</dt>
                          <dd className="mt-1 font-medium">
                            {balance.availableBalance.toLocaleString('zh-CN')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">冻结额度</dt>
                          <dd className="mt-1 font-medium">
                            {balance.frozenBalance.toLocaleString('zh-CN')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">最近更新</dt>
                          <dd className="mt-1 font-medium">{formatDateTime(balance.updatedAt)}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground">额度充值功能暂未开放</p>
                    </div>
                  ) : null}
                </PageStateView>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>最近额度流水</CardTitle>
              </CardHeader>
              <CardContent>
                <PageStateView
                  state={ledgerState}
                  errorMessage="额度流水加载失败"
                  emptyMessage="暂无额度流水"
                  onRetry={reload}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-2 py-2 font-medium">时间</th>
                          <th className="px-2 py-2 font-medium">类型</th>
                          <th className="px-2 py-2 font-medium">说明</th>
                          <th className="px-2 py-2 font-medium">额度变化</th>
                          <th className="px-2 py-2 font-medium">变化后余额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerItems.map((item) => (
                          <tr key={item.id} className="border-b border-border/60">
                            <td className="px-2 py-2 whitespace-nowrap">
                              {formatDateTime(item.createdAt)}
                            </td>
                            <td className="px-2 py-2">
                              {LEDGER_TYPE_LABEL[item.type as CreditLedgerType] ?? item.type}
                            </td>
                            <td className="px-2 py-2">{item.description || '—'}</td>
                            <td
                              className={
                                item.amount < 0
                                  ? 'px-2 py-2 font-medium text-destructive'
                                  : 'px-2 py-2 font-medium text-emerald-700'
                              }
                            >
                              {formatAmount(item.amount)}
                            </td>
                            <td className="px-2 py-2">
                              {item.balanceAfter.toLocaleString('zh-CN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </PageStateView>
              </CardContent>
            </Card>
          </>
        ) : null}

        {section === 'help' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>常见问题</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <p>分析结果仅供业务参考，不会自动改账、发薪、退款或回写 ERP/WMS。</p>
                <p>原始业务表格默认仅在本机处理，不会上传到云端。</p>
                <p>若 AI 积分不足，可先到「AI 积分」查看余额与明细，再前往购买积分。</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>法律与合规</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-sm">
                <Button variant="outline" size="sm" onClick={() => navigate('/legal/terms')}>
                  用户协议
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/legal/privacy')}>
                  隐私政策
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/legal/refund')}>
                  退款说明
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>联系支持</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600">
                <p>使用过程中如遇登录、额度或本地运行问题，请联系企业管理员或实施支持。</p>
                <p className="text-xs text-muted-foreground">本机演示环境不提供在线客服会话。</p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </PageContainer>
  );
}
