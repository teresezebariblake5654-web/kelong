import {
  mockBusinessTemplates,
  mockDashboardMetrics,
  mockOrganization,
  mockProcessingTasks,
  mockTemplateCategories,
  mockUsageQuota,
  mockUsbDevice,
  mockUser,
} from '@workstation/mocks';
import type {
  BusinessTemplate,
  DashboardMetrics,
  ProcessingTask,
  TemplateCategory,
  TemplateCategoryId,
  UsageQuota,
  UsbDevice,
  WorkspaceSnapshot,
} from '@workstation/types';

function delay(ms = 280): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type TemplateQuery = {
  categoryId?: TemplateCategoryId | 'all';
  search?: string;
  tab?: 'all' | 'recent' | 'favorites' | 'recommended';
  sort?: 'name' | 'usage' | 'recent';
};

let favoriteIds = new Set(mockBusinessTemplates.filter((t) => t.favorited).map((t) => t.id));
let usageOverrides: Record<string, { count: number; lastUsedAt: string }> = {};

export const workspaceService = {
  async getSnapshot(): Promise<WorkspaceSnapshot> {
    await delay();
    const templates = withRuntimeFlags(mockBusinessTemplates);
    return {
      user: mockUser,
      organization: mockOrganization,
      usb: mockUsbDevice,
      quota: mockUsageQuota,
      metrics: mockDashboardMetrics,
      recentTasks: mockProcessingTasks,
      commonTemplates: templates
        .slice()
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 6),
    };
  },

  async getUsbDevice(): Promise<UsbDevice> {
    await delay(120);
    return mockUsbDevice;
  },

  async getQuota(): Promise<UsageQuota> {
    await delay(120);
    return mockUsageQuota;
  },

  async getMetrics(): Promise<DashboardMetrics> {
    await delay(120);
    return mockDashboardMetrics;
  },
};

export const templateService = {
  async listCategories(): Promise<TemplateCategory[]> {
    await delay(120);
    return mockTemplateCategories.map((c) => ({
      ...c,
      templateCount: withRuntimeFlags(mockBusinessTemplates).filter((t) => t.categoryId === c.id)
        .length,
    }));
  },

  async listTemplates(query: TemplateQuery = {}): Promise<BusinessTemplate[]> {
    await delay();
    let list = withRuntimeFlags(mockBusinessTemplates);

    if (query.categoryId && query.categoryId !== 'all') {
      list = list.filter((t) => t.categoryId === query.categoryId);
    }

    if (query.tab === 'favorites') {
      list = list.filter((t) => t.favorited);
    } else if (query.tab === 'recommended') {
      list = list.filter((t) => t.recommended);
    } else if (query.tab === 'recent') {
      list = list
        .filter((t) => t.lastUsedAt)
        .sort((a, b) => Date.parse(b.lastUsedAt ?? '') - Date.parse(a.lastUsedAt ?? ''));
    }

    const q = query.search?.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.scenario.toLowerCase().includes(q) ||
          t.code.toLowerCase().includes(q),
      );
    }

    const sort = query.sort ?? 'usage';
    if (query.tab !== 'recent') {
      list = [...list].sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
        if (sort === 'recent') {
          return Date.parse(b.lastUsedAt ?? '0') - Date.parse(a.lastUsedAt ?? '0');
        }
        return b.usageCount - a.usageCount;
      });
    }

    return list;
  },

  async toggleFavorite(templateId: string): Promise<BusinessTemplate | undefined> {
    await delay(80);
    if (favoriteIds.has(templateId)) favoriteIds.delete(templateId);
    else favoriteIds.add(templateId);
    return withRuntimeFlags(mockBusinessTemplates).find((t) => t.id === templateId);
  },

  async recordUse(templateId: string): Promise<void> {
    await delay(40);
    const current = usageOverrides[templateId];
    const base = mockBusinessTemplates.find((t) => t.id === templateId);
    usageOverrides[templateId] = {
      count: (current?.count ?? base?.usageCount ?? 0) + 1,
      lastUsedAt: new Date().toISOString(),
    };
  },

  async getById(templateId: string): Promise<BusinessTemplate | undefined> {
    await delay(80);
    return withRuntimeFlags(mockBusinessTemplates).find((t) => t.id === templateId);
  },
};

export const taskService = {
  async listRecent(limit = 20): Promise<ProcessingTask[]> {
    await delay(150);
    return mockProcessingTasks.slice(0, limit);
  },
};

function withRuntimeFlags(templates: BusinessTemplate[]): BusinessTemplate[] {
  return templates.map((t) => {
    const usage = usageOverrides[t.id];
    return {
      ...t,
      favorited: favoriteIds.has(t.id),
      usageCount: usage?.count ?? t.usageCount,
      lastUsedAt: usage?.lastUsedAt ?? t.lastUsedAt,
    };
  });
}
