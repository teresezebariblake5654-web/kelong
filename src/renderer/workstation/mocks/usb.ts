import type { UsbDevice } from '@workstation/types';

export const mockUsbDevice: UsbDevice = {
  id: 'usb_demo_001',
  label: 'AI员工助手 U 盘',
  serialHint: 'USB-••••-A1',
  status: 'connected',
  lastSeenAt: new Date().toISOString(),
};
