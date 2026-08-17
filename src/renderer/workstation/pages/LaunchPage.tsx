import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingState, PageHeader, ErrorState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { isFeatureEnabled } from '@workstation/config/featureFlags';
import {
  clearLicenseSession,
  getLicenseToken,
  getUserAccessToken,
  setLicenseSession,
} from '@workstation/lib/localStore';
import { getServices } from '@workstation/services/registry';
import { authSessionService } from '@workstation/services/authSession.service';
import { useWorkflow } from '@workstation/state/workflow';

export function LaunchPage() {
  const navigate = useNavigate();
  const { patch } = useWorkflow();
  const [message, setMessage] = useState('正在检查登录状态…');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userToken = getUserAccessToken();
        if (!userToken) {
          navigate('/login', { replace: true });
          return;
        }

        setMessage('正在同步组织上下文…');
        try {
          await authSessionService.refreshOrganizationContext();
        } catch {
          // Token may be stale — send user to login.
          authSessionService.logout();
          navigate('/login', { replace: true });
          return;
        }

        if (!isFeatureEnabled('licenseActivation')) {
          navigate('/chat', { replace: true });
          return;
        }

        const token = getLicenseToken();
        if (!token) {
          navigate('/activate', { replace: true });
          return;
        }

        setMessage('正在验证授权…');
        const { license, wallet } = getServices();
        const data = await license.verify();
        if (cancelled) return;
        if (data?.authorization) {
          setLicenseSession(token, data.authorization);
        }
        try {
          const snapshot = await wallet.getWallet();
          patch({ wallet: snapshot, error: undefined });
        } catch {
          // wallet can fail independently; still allow entry
        }
        navigate('/chat', { replace: true });
      } catch (err) {
        clearLicenseSession();
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '启动失败');
          setMessage('启动失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, patch]);

  return (
    <div className="mx-auto mt-[12vh] max-w-lg">
      <Card>
        <CardHeader>
          <PageHeader title="智力魔盒" lead={message} />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error ? (
            <>
              <ErrorState message={error} onRetry={() => navigate('/login', { replace: true })} />
              <Button variant="outline" onClick={() => navigate('/login', { replace: true })}>
                前往登录
              </Button>
            </>
          ) : (
            <LoadingState message="本地启动中，正在检查账号与组织。" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
