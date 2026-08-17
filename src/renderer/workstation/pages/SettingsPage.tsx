import { FormEvent, useState } from 'react';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { Input } from '@workstation/components/ui/input';
import {
  loadSettings,
  loadWorkspace,
  saveSettings,
  saveWorkspace,
  type WorkspaceProfile,
} from '@workstation/lib/localStore';

export function SettingsPage() {
  const [settings, setSettings] = useState(loadSettings);
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    saveSettings(settings);
    saveWorkspace(workspace);
    setSaved(true);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <PageHeader
            title="设置"
            lead="配置企业信息、云端地址与本机显示名称。"
          />
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
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
            {saved ? <EmptyState message="已保存到本机配置。" /> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
