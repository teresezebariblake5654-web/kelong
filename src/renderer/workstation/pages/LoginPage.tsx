import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState, LoadingState, PageHeader } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { Input } from '@workstation/components/ui/input';
import { authSessionService } from '@workstation/services/authSession.service';

type Mode = 'login' | 'register';

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [orgHint, setOrgHint] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setOrgHint('');
    try {
      const ctx =
        mode === 'login'
          ? await authSessionService.login(email, password)
          : await authSessionService.register({ email, username, password });

      if (ctx.activeOrganizationId) {
        setOrgHint(`已自动选择组织：${ctx.activeOrganizationId}`);
      } else if (ctx.organizations.length > 1) {
        setOrgHint('检测到多个组织，请在设置中选择当前组织。');
      } else {
        setOrgHint('当前账号暂无组织。');
      }
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? '登录失败' : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-[10vh] max-w-lg">
      <Card>
        <CardHeader>
          <PageHeader
            title={mode === 'login' ? '账号登录' : '注册账号'}
            lead="登录/注册后自动加载所属组织，并作为后续组织隔离请求上下文。"
          />
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            {mode === 'register' ? (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">用户名</span>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="nickname"
                  required
                  minLength={2}
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">邮箱</span>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">密码</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
              />
            </label>
            {loading ? <LoadingState message={mode === 'login' ? '登录中…' : '注册中…'} /> : null}
            {error ? (
              <ErrorState message={error} onRetry={() => setError('')} />
            ) : null}
            {orgHint ? <p className="text-xs text-muted-foreground">{orgHint}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? '处理中…' : mode === 'login' ? '登录' : '注册并进入'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
                setOrgHint('');
              }}
            >
              {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
