import { useCallback, useEffect, useMemo, useState } from 'react';
import { Headset } from 'lucide-react';
import {
  getUserAccessToken,
  getUserRefreshToken,
  loadOrganizations,
  loadUserProfile,
  loadWorkspace,
} from '@workstation/lib/localStore';
import { authSessionService } from '@workstation/services/authSession.service';
import { useUserCenterStore } from '@workstation/state/userCenterStore';
import { AuthSidebarPanel } from './AuthSidebarPanel';
import { CreditSummaryCard } from './CreditSummaryCard';
import { UserCenterContent } from './UserCenterContent';
import { UserCenterNavigation } from './UserCenterNavigation';
import { UserProfileCard } from './UserProfileCard';
import { getCreditSummary } from './userCenterApi';
import type { CreditOverview, UserCenterProfile } from './userCenter.types';
import './userCenter.css';

function resolveProfile(): UserCenterProfile {
  const token = getUserAccessToken();
  const refresh = getUserRefreshToken();
  const user = loadUserProfile();
  const orgs = loadOrganizations();
  const workspace = loadWorkspace();

  if ((!token && !refresh) || !user) {
    return {
      displayName: '未登录',
      organizationName: '登录后可查看积分与使用 AI',
      roleLabel: '访客',
      loggedIn: false,
      avatarUrl: null,
      avatarInitials: '?',
    };
  }

  const displayName =
    user.username?.trim() ||
    (user.email?.includes('@') ? user.email.split('@')[0]! : '') ||
    '用户';

  return {
    displayName,
    organizationName: orgs[0]?.name || workspace.organizationName || '我的组织',
    roleLabel: orgs[0]?.role === 'owner' ? '企业管理员' : '成员',
    loggedIn: true,
    avatarUrl: user.avatarUrl ?? null,
    avatarInitials: displayName.slice(0, 1).toUpperCase(),
  };
}

/**
 * Left glass drawer for workstation. Mount once under WorkstationChrome;
 * does not alter department card / scroll logic.
 */
export function UserCenterDrawer() {
  const open = useUserCenterStore((s) => s.open);
  const section = useUserCenterStore((s) => s.section);
  const closeUserCenter = useUserCenterStore((s) => s.closeUserCenter);
  const setSection = useUserCenterStore((s) => s.setSection);
  const [authTick, setAuthTick] = useState(0);
  const profile = useMemo(() => resolveProfile(), [open, authTick]);
  const [overview, setOverview] = useState<CreditOverview | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const refreshFooterSummary = useCallback(async () => {
    if (!getUserAccessToken()) {
      setOverview(null);
      return;
    }
    setSummaryLoading(true);
    try {
      const data = await getCreditSummary();
      setOverview(data);
    } catch {
      setOverview(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const onAuthChange = useCallback(() => {
    setAuthTick((n) => n + 1);
    setOverview(null);
    void refreshFooterSummary();
  }, [refreshFooterSummary]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await authSessionService.restoreSession();
      if (!cancelled && restored) {
        setAuthTick((n) => n + 1);
        void refreshFooterSummary();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshFooterSummary]);

  useEffect(() => {
    if (!open) return;
    void refreshFooterSummary();
  }, [open, authTick, refreshFooterSummary]);

  useEffect(() => {
    const onCreditsChanged = () => {
      void refreshFooterSummary();
    };
    window.addEventListener('workstation:credits-changed', onCreditsChanged);
    return () => window.removeEventListener('workstation:credits-changed', onCreditsChanged);
  }, [refreshFooterSummary]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeUserCenter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeUserCenter, open]);

  return (
    <div className={`uc-shell ${open ? 'uc-shell--open' : ''}`} aria-hidden={!open}>
      <button
        type="button"
        className="uc-backdrop"
        aria-label="关闭用户中心"
        tabIndex={open ? 0 : -1}
        onClick={closeUserCenter}
      />
      <aside className="uc-drawer" role="dialog" aria-modal="true" aria-label="用户中心">
        <div className="uc-scroll">
          <div className="uc-brand">
            <span className="uc-brand__orb" aria-hidden />
            <div>
              <div className="uc-brand__title">AI员工助手</div>
              <div className="uc-brand__sub">AI EMPLOYEE ASSISTANT</div>
            </div>
          </div>

          <UserProfileCard profile={profile} onAvatarChanged={onAuthChange} />
          <AuthSidebarPanel
            key={`${profile.loggedIn}-${authTick}`}
            profile={profile}
            onAuthChange={onAuthChange}
          />
          <UserCenterNavigation active={section} onSelect={setSection} />

          <div className="mt-3">
            <UserCenterContent
              section={section}
              onSection={setSection}
              onSummaryLoaded={setOverview}
              onAuthChange={onAuthChange}
            />
          </div>

          <CreditSummaryCard
            overview={overview}
            loading={summaryLoading}
            onDetails={() => setSection('credits')}
            onRecharge={() => setSection('recharge')}
          />

          <button
            type="button"
            className="uc-card uc-help-card w-full"
            onClick={() => setSection('help')}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[#e0c88a]">
              <Headset className="size-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-[12.5px] font-semibold">帮助与反馈</span>
              <span className="uc-muted mt-0.5 block leading-snug">
                使用问题、积分异常、功能建议
              </span>
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
}
