import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_CENTER_NAV_ITEMS } from './UserCenterNavigation';
import * as userCenterApi from './userCenterApi';

const workstationRoot = path.resolve(__dirname, '..');

function readWorkstation(relativePath: string) {
  return readFileSync(path.join(workstationRoot, relativePath), 'utf8');
}

describe('dead UI interaction guards', () => {
  it('hides undeveloped usage nav and exports real feedback submit', () => {
    expect(USER_CENTER_NAV_ITEMS.map((item) => item.id)).toEqual([
      'overview',
      'credits',
      'recharge',
      'help',
      'settings',
    ]);
    expect(USER_CENTER_NAV_ITEMS.some((item) => item.id === ('usage' as never))).toBe(false);
    expect('submitFeedback' in userCenterApi).toBe(true);
  });

  it('wires department composer library to modal and omits apps menu / report route', () => {
    const workspace = readWorkstation('components/agent-workspace/AgentWorkspace.tsx');
    const departmentPage = readWorkstation('pages/DepartmentWorkspacePage.tsx');
    const taskInput = readWorkstation('components/agent-workspace/TaskInput.tsx');
    const routes = readWorkstation('WorkstationApp.tsx');

    expect(workspace).toContain('onOpenLibrary={() => setLibraryOpen(true)}');
    expect(workspace).toContain('从文件库选择');
    expect(workspace).not.toContain("navigate('/files')");
    expect(workspace).not.toContain('onOpenApps');
    expect(workspace).not.toContain('showDeveloping');
    expect(workspace).not.toContain('查看结构化报告');

    expect(departmentPage).not.toContain("navigate('/report')");
    expect(departmentPage).not.toContain('showReportLink');

    expect(taskInput).toContain('{onOpenLibrary ? (');
    expect(taskInput).toContain('{onOpenApps ? (');

    expect(routes).not.toMatch(/path=["']\/files["']/);
    expect(routes).not.toMatch(/path=["']\/report["']/);
    expect(routes).toContain('path="*"');
  });

  it('keeps help section free of hash-link tutorials and wires in-app feedback', () => {
    const help = readWorkstation('user-center/sections/HelpFeedbackSection.tsx');
    const faq = readWorkstation('user-center/userCenter.mock.ts');
    expect(help).not.toContain('href="#"');
    expect(help).not.toContain('MOCK_TUTORIALS');
    expect(help).not.toContain('mailto:');
    expect(help).not.toContain('jq202604');
    expect(help).not.toContain('@126.com');
    expect(help).toContain('submitFeedback');
    expect(help).toContain('emailConsent');
    expect(faq).not.toContain('可以开发票吗？');
  });
});
