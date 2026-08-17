/** Domain types for desktop client UI (independent of components). */

export type UserRole = 'operator' | 'admin' | 'viewer';

export type User = {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  organizationId: string;
};

export type Organization = {
  id: string;
  name: string;
  planCode: string;
  seatCount: number;
};

export type UsbConnectionStatus = 'connected' | 'offline' | 'unknown';

export type UsbDevice = {
  id: string;
  label: string;
  serialHint: string;
  status: UsbConnectionStatus;
  lastSeenAt: string;
};

export type TemplateCategoryId =
  | 'hr'
  | 'marketing'
  | 'sales'
  | 'operations'
  | 'administration'
  | 'procurement'
  | 'production'
  | 'logistics'
  | 'finance'
  | 'customer-service';

export type TemplateCategory = {
  id: TemplateCategoryId;
  name: string;
  description: string;
  templateCount: number;
  /** Token key used by CSS for subtle dept accent — never random hex in components */
  accentToken: `dept-${TemplateCategoryId}`;
};

export type BusinessTemplate = {
  id: string;
  code: string;
  version: string;
  name: string;
  categoryId: TemplateCategoryId;
  scenario: string;
  description: string;
  fileTypes: string[];
  dataTypes: string[];
  features: string[];
  creditCost: number;
  usageCount: number;
  lastUsedAt: string | null;
  favorited: boolean;
  recommended: boolean;
  requiredFields: string[];
  /** Links to @aw/task-templates role for workflow */
  agentRole: string;
};

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ProcessingTask = {
  id: string;
  fileName: string;
  templateId: string;
  templateName: string;
  createdAt: string;
  status: TaskStatus;
  progress: number;
  creditsCharged: number;
};

export type UsageQuota = {
  balance: number;
  reserved: number;
  monthlyConsumed: number;
  monthlyGranted: number;
  lowBalanceThreshold: number;
};

export type DashboardMetrics = {
  monthFileCount: number;
  completedTaskCount: number;
  minutesSaved: number;
  creditsConsumed: number;
};

export type PageViewState =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'error'
  | 'forbidden'
  | 'usb_offline'
  | 'quota_low'
  | 'unsupported_file';

export type WorkspaceSnapshot = {
  user: User;
  organization: Organization;
  usb: UsbDevice;
  quota: UsageQuota;
  metrics: DashboardMetrics;
  recentTasks: ProcessingTask[];
  commonTemplates: BusinessTemplate[];
};
