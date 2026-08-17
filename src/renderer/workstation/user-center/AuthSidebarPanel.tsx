import { FormEvent, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { authSessionService } from '@workstation/services/authSession.service';
import type { UserCenterProfile } from './userCenter.types';

type AuthSidebarPanelProps = {
  profile: UserCenterProfile;
  onAuthChange: () => void;
};

type AuthMode = 'login' | 'register';
type LoginMethod = 'password' | 'otp';

/**
 * Always-visible login / logout controls under the profile card in the user-center drawer.
 */
export function AuthSidebarPanel({ profile, onAuthChange }: AuthSidebarPanelProps) {
  const rememberedEmail = authSessionService.getRememberedEmail() ?? '';
  const [mode, setMode] = useState<AuthMode>(rememberedEmail ? 'login' : 'register');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [showForm, setShowForm] = useState(!profile.loggedIn);
  const [email, setEmail] = useState(rememberedEmail);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (profile.loggedIn) {
      setShowForm(false);
      return;
    }
    const remembered = authSessionService.getRememberedEmail();
    if (remembered) {
      setEmail(remembered);
      setMode('login');
    }
    setShowForm(true);
  }, [profile.loggedIn]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendOtp() {
    setSendingOtp(true);
    setError('');
    setHint('');
    try {
      const purpose = mode === 'register' ? 'register' : 'login';
      const data = await authSessionService.sendEmailOtp(email, purpose);
      setCooldown(data.retryAfterSec || 60);
      if (data.mockCode) {
        setHint(`开发模式验证码：${data.mockCode}（生产环境会发到邮箱）`);
        setCode(data.mockCode);
      } else {
        setHint('验证码已发送，请查收邮箱（含垃圾箱）');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送验证码失败');
    } finally {
      setSendingOtp(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setHint('');
    try {
      let ctx;
      if (mode === 'register') {
        if (!code.trim()) {
          throw new Error('请先获取并填写邮箱验证码');
        }
        ctx = await authSessionService.register({
          email,
          username,
          password,
          code: code.trim(),
        });
      } else if (loginMethod === 'otp') {
        ctx = await authSessionService.loginWithOtp(email, code.trim());
      } else {
        ctx = await authSessionService.login(email, password);
      }
      setHint(
        ctx.activeOrganizationId
          ? `已登录 · ${ctx.organizations[0]?.name ?? '组织已就绪'}`
          : '已登录（暂无组织）',
      );
      setShowForm(false);
      onAuthChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? '登录失败' : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  function onLogout() {
    authSessionService.logout();
    setHint('已退出登录');
    setError('');
    setShowForm(true);
    setMode('login');
    setLoginMethod('password');
    onAuthChange();
  }

  const needOtp = mode === 'register' || loginMethod === 'otp';

  if (profile.loggedIn && !showForm) {
    return (
      <div className="mt-2 space-y-2">
        {hint ? <p className="text-[11px] text-[#86efac]">{hint}</p> : null}
        <button type="button" className="uc-chip w-full justify-center gap-1.5" onClick={onLogout}>
          <LogOut className="size-3.5" aria-hidden />
          退出登录
        </button>
        <button
          type="button"
          className="uc-chip w-full justify-center"
          onClick={() => {
            setShowForm(true);
            setMode('login');
            setHint('');
            setError('');
          }}
        >
          切换账号
        </button>
      </div>
    );
  }

  return (
    <div className="uc-card mt-2 space-y-2.5 !p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-white/85">
          {mode === 'login' ? '登录工作站' : '邮箱注册'}
        </div>
        {profile.loggedIn ? (
          <button
            type="button"
            className="text-[11px] text-white/45 hover:text-white/80"
            onClick={() => {
              setShowForm(false);
              setError('');
            }}
          >
            取消
          </button>
        ) : null}
      </div>
      <p className="uc-muted text-[11px] leading-relaxed">
        {mode === 'register'
          ? '输入邮箱获取验证码，设置用户名和密码完成注册。'
          : '可用密码登录，或切换为邮箱验证码登录。'}
      </p>
      <form className="space-y-2" onSubmit={(e) => void onSubmit(e)}>
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

        {mode === 'login' ? (
          <div className="uc-chip-row">
            <button
              type="button"
              className={`uc-chip ${loginMethod === 'password' ? 'uc-chip--on' : ''}`}
              onClick={() => setLoginMethod('password')}
            >
              密码登录
            </button>
            <button
              type="button"
              className={`uc-chip ${loginMethod === 'otp' ? 'uc-chip--on' : ''}`}
              onClick={() => setLoginMethod('otp')}
            >
              验证码登录
            </button>
          </div>
        ) : null}

        {mode === 'register' || loginMethod === 'password' ? (
          <label className="block space-y-1 text-[12px]">
            <span className="text-white/55">密码</span>
            <input
              className="uc-input w-full"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required={mode === 'register' || loginMethod === 'password'}
              minLength={8}
            />
          </label>
        ) : null}

        {needOtp ? (
          <div className="space-y-1">
            <span className="text-[12px] text-white/55">邮箱验证码</span>
            <div className="flex gap-2">
              <input
                className="uc-input min-w-0 flex-1"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6 位数字"
                required
                minLength={6}
                maxLength={6}
              />
              <button
                type="button"
                className="uc-chip shrink-0"
                disabled={sendingOtp || cooldown > 0 || !email.trim()}
                onClick={() => void sendOtp()}
              >
                {cooldown > 0 ? `${cooldown}s` : sendingOtp ? '发送中' : '获取验证码'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-[12px] text-[#fca5a5]">{error}</p> : null}
        {hint ? <p className="text-[12px] text-[#86efac]">{hint}</p> : null}
        <button type="submit" className="uc-btn-gold w-full" disabled={loading}>
          <LogIn className="size-3.5" aria-hidden />
          {loading ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
        <button
          type="button"
          className="uc-chip w-full justify-center"
          disabled={loading}
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setHint('');
            setCode('');
          }}
        >
          {mode === 'login' ? '没有账号？邮箱注册' : '已有账号？登录'}
        </button>
        {profile.loggedIn ? (
          <button type="button" className="uc-chip w-full justify-center gap-1.5" onClick={onLogout}>
            <LogOut className="size-3.5" aria-hidden />
            退出当前账号
          </button>
        ) : null}
      </form>
    </div>
  );
}
