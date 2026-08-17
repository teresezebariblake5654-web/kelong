import type { ReactNode } from 'react';
import { ALLOWED_UPLOAD_TYPES_MESSAGE } from '@aw/shared';
import { EmptyState } from '@workstation/components/common/EmptyState';
import { ErrorState } from '@workstation/components/common/ErrorState';
import { LoadingSkeleton } from '@workstation/components/common/LoadingSkeleton';
import { Button } from '@workstation/components/ui/button';
import type { PageViewState } from '@workstation/types';

type PageStateViewProps = {
  state: PageViewState;
  errorMessage?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  onResolveAction?: () => void;
  children: ReactNode;
};

export function PageStateView({
  state,
  errorMessage,
  emptyMessage,
  onRetry,
  onResolveAction,
  children,
}: PageStateViewProps) {
  if (state === 'loading') return <LoadingSkeleton rows={4} />;
  if (state === 'error') {
    return <ErrorState message={errorMessage ?? '请稍后重试。'} onRetry={onRetry} />;
  }
  if (state === 'empty') {
    return <EmptyState message={emptyMessage ?? '暂无数据。'} />;
  }
  if (state === 'forbidden') {
    return (
      <EmptyState
        title="无权限"
        message="当前账号无权访问此功能。"
        action={
          onResolveAction ? (
            <Button variant="outline" onClick={onResolveAction}>
              返回工作台
            </Button>
          ) : null
        }
      />
    );
  }
  if (state === 'usb_offline') {
    return (
      <EmptyState
        title="U 盘未连接"
        message="请插入授权 U 盘后重试。可在设置中查看设备状态。"
        action={
          onResolveAction ? (
            <Button variant="outline" onClick={onResolveAction}>
              打开设置
            </Button>
          ) : null
        }
      />
    );
  }
  if (state === 'quota_low') {
    return (
      <EmptyState
        title="AI 积分不足"
        message="当前 AI 积分不足以启动新任务，请购买积分或选择低消耗模板。"
        action={
          onResolveAction ? (
            <Button onClick={onResolveAction}>查看额度</Button>
          ) : null
        }
      />
    );
  }
  if (state === 'unsupported_file') {
    return (
      <EmptyState
        title="文件不支持"
        message={ALLOWED_UPLOAD_TYPES_MESSAGE}
      />
    );
  }
  return children;
}
