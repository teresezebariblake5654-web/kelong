import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { Input } from '@workstation/components/ui/input';
import { PageHeader } from '@workstation/components/common';
import { makeDeviceFingerprint, makeUsbFingerprint } from '@workstation/lib/cloud';
import { loadSettings, setLicenseSession } from '@workstation/lib/localStore';
import { getServices } from '@workstation/services/registry';
import { useWorkflow } from '@workstation/state/workflow';

export function ActivatePage() {
  const navigate = useNavigate();
  const { patch } = useWorkflow();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const settings = loadSettings();
      const { license, wallet } = getServices();
      const session = await license.activate({
        activationCode: code.trim(),
        usbFingerprint: await makeUsbFingerprint(),
        deviceFingerprint: makeDeviceFingerprint(),
        deviceName: settings.deviceName,
      });
      setLicenseSession(session.accessToken, session.authorization);
      try {
        const snapshot = await wallet.getWallet();
        patch({ wallet: snapshot });
      } catch {
        // ignore
      }
      navigate('/home', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-[10vh] max-w-lg">
      <Card>
        <CardHeader>
          <PageHeader title="授权激活" lead="输入 U 盘激活码完成授权。无需注册账号。" />
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">激活码</span>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="请输入激活码"
                autoComplete="off"
                required
              />
            </label>
            {error ? <ErrorState message={error} /> : null}
            <Button type="submit" disabled={loading || !code.trim()}>
              {loading ? '激活中…' : '激活并进入'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
