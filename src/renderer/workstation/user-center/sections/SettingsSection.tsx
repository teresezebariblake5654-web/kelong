import { FormEvent, useMemo, useState } from 'react';
import { authSessionService } from '@workstation/services/authSession.service';
import {
  getUserAccessToken,
  loadOrganizations,
  loadUserProfile,
} from '@workstation/lib/localStore';

type SettingsSectionProps = {
  onAuthChange?: () => void;
};

type Mode = 'login' | 'register';

export function SettingsSection({ onAuthChange }: SettingsSectionProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const session = useMemo(() => {
    void tick;
    const token = getUserAccessToken();
    const user = loadUserProfile();
    const orgs = loadOrganizations();
    return {
      loggedIn: Boolean(token && user),
      user,
      orgName: orgs[0]?.name ?? null,
    };
  }, [tick]);

  function notifyAuthChanged() {
    setTick((n) => n + 1);
    onAuthChange?.();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setHint('');
    try {
      const ctx =
        mode === 'login'
          ? await authSessionService.login(email, password)
          : await authSessionService.register({ email, username, password });
      if (ctx.activeOrganizationId) {
        setHint(`已登录，组织：${ctx.organizations[0]?.name ?? ctx.activeOrganizationId}`);
      } else {
        setHint('已登录；当前账号暂无组织，请联系管理员。');
      }
      notifyAuthChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? '登录失败' : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  function onLogout() {
    authSessionService.logout();
    setHint('已退出');
    setError('');
    notifyAuthChanged();
  }

  return (
    <div className="uc-panel">
      <h3>设置</h3>
      <p className="lead">登录账号用于积分、购买与偏好设置。智能体能力共用同一套引擎。</p>

      <div className="uc-card space-y-3">
        <div className="text-[12px] font-medium">账号</div>
        {session.loggedIn ? (
          <>
            <p className="uc-muted leading-relaxed">
              当前：{session.user?.username || session.user?.email || '已登录'}
              {session.orgName ? ` · ${session.orgName}` : ''}
            </p>
            <p className="uc-muted text-[11px] leading-relaxed">
              若积分仍提示「无效的 token」，请先退出再重新登录（旧后端签发的 token 不可用）。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="uc-btn-gold"
                onClick={() => {
                  authSessionService.logout();
                  setMode('login');
                  setHint('已退出，请重新登录');
                  setError('');
                  notifyAuthChanged();
                }}
              >
                退出并重新登录
              </button>
              <button type="button" className="uc-chip" onClick={onLogout}>
                仅退出
              </button>
            </div>
          </>
        ) : (
          <form className="space-y-2.5" onSubmit={(e) => void onSubmit(e)}>
            <p className="uc-muted leading-relaxed">
              积分、购买、AI 扣费需登录后使用。可先用演示账号，或注册新账号。
            </p>
            {mode === 'register' ? (
              <label className="block space-y-1 text-[12px]">
                <span className="text-white/55">用户名</span>
                <input
                  className="uc-input w-full"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="nickname"
                  required
                  minLength={2}
                />
              </label>
            ) : null}
            <label className="block space-y-1 text-[12px]">
              <span className="text-white/55">邮箱</span>
              <input
                className="uc-input w-full"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="block space-y-1 text-[12px]">
              <span className="text-white/55">密码</span>
              <input
                className="uc-input w-full"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
              />
            </label>
            {error ? <p className="text-[12px] text-[#fca5a5]">{error}</p> : null}
            {hint ? <p className="text-[12px] text-[#86efac]">{hint}</p> : null}
            <button type="submit" className="uc-btn-gold w-full" disabled={loading}>
              {loading ? '处理中…' : mode === 'login' ? '登录工作站' : '注册并登录'}
            </button>
            <button
              type="button"
              className="uc-chip w-full"
              disabled={loading}
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
                setHint('');
              }}
            >
              {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
            </button>
          </form>
        )}
        {session.loggedIn && hint ? <p className="text-[12px] text-[#86efac]">{hint}</p> : null}
      </div>

      <div className="uc-card">
        <div className="text-[12px] font-medium">关于</div>
        <p className="uc-muted mt-1 leading-relaxed">
          AI员工助手 · AI EMPLOYEE ASSISTANT
          <br />
          版本随 火星 AI 客户端发布。
        </p>
      </div>
    </div>
  );
}
