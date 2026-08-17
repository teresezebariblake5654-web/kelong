import { Usb } from 'lucide-react';
import { Badge } from '@workstation/components/ui/badge';
import type { UsbDevice } from '@workstation/types';
import { cn } from '@workstation/lib/utils';

type UsbDeviceStatusProps = {
  device: UsbDevice | null | undefined;
  className?: string;
};

export function UsbDeviceStatus({ device, className }: UsbDeviceStatusProps) {
  if (!device) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <Usb className="size-3" />
        U 盘未知
      </Badge>
    );
  }

  const variant =
    device.status === 'connected' ? 'success' : device.status === 'offline' ? 'warning' : 'secondary';
  const label =
    device.status === 'connected'
      ? 'U 盘已连接'
      : device.status === 'offline'
        ? 'U 盘未连接'
        : 'U 盘状态未知';

  return (
    <Badge variant={variant} className={cn('gap-1', className)} title={device.label}>
      <Usb className="size-3" />
      {label}
    </Badge>
  );
}
