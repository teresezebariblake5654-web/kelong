import {
  createRuleStore,
  createWorkflowRuntime,
  detectWorkflowUploadContext,
  setOutputCaptureSink,
  type CapturedOutputArtifact,
} from '@aw/data-engine';
import { getWorkflowDefinition } from '@aw/task-templates';
import { inspectSpreadsheetBytes, inspectSpreadsheetFiles, workflowAliasesForRole } from './fieldInspect';
import {
  assertNoPathTraversal,
  assertPathInsideWorkspace,
  displayFileName,
  getFileExtension,
  isAllowedSpreadsheetExtension,
  isAllowedWorkflowInputExtension,
} from './pathSafety';
import { sanitizeWorkflowError } from './sensitiveData';
import { validateWorkflowRules } from './workflowRuleSchemas';
import {
  checkWorkflowInputCapability as evaluateWorkflowInputCapability,
  type WorkflowInputCapability,
} from './workflowCapabilities';
import {
  DesktopBridgeError,
  type DesktopExecuteRequest,
  type DesktopExecuteResult,
  type DesktopWorkflowBridge,
  type InspectedInputFile,
  type InspectWorkflowInputRequest,
  type LocalWorkspaceConfig,
  type SelectedLocalFile,
} from './types';
import {
  clearCompanyWorkflowRules,
  loadCompanyRulesDocument,
  loadWorkspaceConfig,
  saveCompanyWorkflowRules,
  saveWorkspaceConfig,
} from './workspaceStore';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function pickFilesViaInput(extensions: string[], multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = extensions.map((ext) => `.${ext.replace(/^\./, '')}`).join(',');
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

async function fileToSelected(file: File, allowBinary = false): Promise<SelectedLocalFile> {
  const ext = getFileExtension(file.name);
  if (allowBinary ? !isAllowedWorkflowInputExtension(ext) : !isAllowedSpreadsheetExtension(ext)) {
    throw new DesktopBridgeError('UNSUPPORTED_FORMAT', `不支持的文件格式：.${ext}`);
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(buffer);
  return {
    name: file.name,
    path: `memory://${file.name}`,
    size: file.size,
    sha256,
    bytes: buffer,
    extension: ext,
  };
}

function validateRules(rules: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(rules)) {
    if (value === null || value === undefined) {
      throw new DesktopBridgeError('INVALID_RULES', `规则 ${key} 不能为空`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new DesktopBridgeError('INVALID_RULES', `规则 ${key} 必须是有效数字`);
    }
    // 允许对象/数组（如 defaultOwners、ratingBands、orderStatusMap）
  }
}

export class BrowserDevelopmentWorkflowBridge implements DesktopWorkflowBridge {
  private fetchCallCount = 0;
  protected running = false;
  private lastArtifacts = new Map<string, CapturedOutputArtifact>();

  getFetchCallCount(): number {
    return this.fetchCallCount;
  }

  async getWorkspaceConfig(): Promise<LocalWorkspaceConfig> {
    return loadWorkspaceConfig();
  }

  async setWorkspaceConfig(config: LocalWorkspaceConfig): Promise<void> {
    assertNoPathTraversal(config.rootDir);
    if (!config.companyId.trim()) {
      throw new DesktopBridgeError('INVALID_RULES', '公司标识不能为空');
    }
    saveWorkspaceConfig({
      rootDir: config.rootDir.trim(),
      companyId: config.companyId.trim(),
    });
  }

  async selectWorkspaceDirectory(): Promise<string | null> {
    const name = window.prompt(
      '浏览器开发模式：请输入工作区名称（不会访问真实磁盘路径）',
      loadWorkspaceConfig().rootDir,
    );
    if (!name) return null;
    assertNoPathTraversal(name);
    const config = loadWorkspaceConfig();
    saveWorkspaceConfig({ ...config, rootDir: name.trim() || config.rootDir });
    return name.trim();
  }

  async selectInputFile(options: {
    extensions: string[];
    multiple?: boolean;
  }): Promise<SelectedLocalFile | null> {
    if (options.multiple) {
      const files = await this.selectInputFiles(options);
      return files[0] ?? null;
    }
    const files = await pickFilesViaInput(options.extensions, false);
    if (!files[0]) return null;
    const allowBinary = options.extensions.some((e) =>
      ['png', 'jpg', 'jpeg', 'pdf', 'gif', 'webp', 'bmp'].includes(e.replace(/^\./, '').toLowerCase()),
    );
    return fileToSelected(files[0], allowBinary);
  }

  async selectInputFiles(options: { extensions: string[] }): Promise<SelectedLocalFile[]> {
    const files = await pickFilesViaInput(options.extensions, true);
    const allowBinary = options.extensions.some((e) =>
      ['png', 'jpg', 'jpeg', 'pdf', 'gif', 'webp', 'bmp'].includes(e.replace(/^\./, '').toLowerCase()),
    );
    const selected: SelectedLocalFile[] = [];
    for (const file of files) {
      selected.push(await fileToSelected(file, allowBinary));
    }
    return selected;
  }

  checkWorkflowInputCapability(input: {
    workflowId: string;
    role: string;
    fileName: string;
    extension?: string;
  }): WorkflowInputCapability {
    return evaluateWorkflowInputCapability(input);
  }

  async inspectInputFile(input: {
    workflowId: string;
    role: string;
    path: string;
    bytes?: Uint8Array;
    fileName?: string;
  }): Promise<InspectedInputFile> {
    if (!input.bytes || input.bytes.byteLength === 0) {
      throw new DesktopBridgeError(
        'FILE_NOT_FOUND',
        '浏览器模式需要通过文件选择器加载文件内容，无法仅凭路径读取。',
      );
    }
    return inspectSpreadsheetBytes({
      workflowId: input.workflowId,
      role: input.role,
      bytes: input.bytes,
      fileName: input.fileName || displayFileName(input.path),
    });
  }

  async inspectWorkflowInput(input: InspectWorkflowInputRequest): Promise<InspectedInputFile> {
    const files = [];
    for (const file of input.files) {
      if (!file.bytes || file.bytes.byteLength === 0) {
        throw new DesktopBridgeError(
          'FILE_NOT_FOUND',
          '多文件角色需要通过文件选择器加载内容，无法仅凭路径读取。',
        );
      }
      files.push({ name: file.name, bytes: file.bytes });
    }
    return inspectSpreadsheetFiles({
      workflowId: input.workflowId,
      role: input.role,
      files,
    });
  }

  async detectUploadContext(input: {
    workflowId: string;
    files: SelectedLocalFile[];
    answers?: Record<string, string>;
  }) {
    const definition = getWorkflowDefinition(input.workflowId);
    if (!definition) {
      throw new DesktopBridgeError('WORKFLOW_NOT_FOUND', `未找到工作流：${input.workflowId}`);
    }
    if (!input.files.length) {
      throw new DesktopBridgeError('MISSING_REQUIRED_ROLE', '请先上传业务文件');
    }
    return detectWorkflowUploadContext({
      sources: input.files.map((file) => {
        if (!file.bytes?.byteLength) {
          throw new DesktopBridgeError('FILE_NOT_FOUND', `无法读取文件：${file.name}`);
        }
        return { fileId: file.sha256, fileName: file.name, bytes: file.bytes };
      }),
      roles: definition.inputRoles.map((role) => ({
        role: role.role,
        description: role.description || role.role,
        required: role.required,
        requiredFields: role.requiredFields,
        aliases: workflowAliasesForRole(role.role, role.requiredFields),

      })),
      answers: input.answers,
    });
  }
  async getWorkflowRules(workflowId: string) {
    const definition = getWorkflowDefinition(workflowId);
    if (!definition) {
      throw new DesktopBridgeError('WORKFLOW_NOT_FOUND', `未找到工作流：${workflowId}`);
    }
    const workspace = loadWorkspaceConfig();
    const defaults = createRuleStore().getDefaults(workflowId);
    const company = loadCompanyRulesDocument(workspace.companyId)[workflowId] ?? {};
    const effective = createRuleStore().resolve(workflowId, {
      companyRules: company,
    });
    return { defaults, company, effective };
  }

  async saveWorkflowRules(workflowId: string, rules: Record<string, unknown>): Promise<void> {
    const check = validateWorkflowRules(workflowId, rules);
    if (!check.ok) {
      throw new DesktopBridgeError('INVALID_RULES', check.message);
    }
    validateRules(rules);
    const workspace = loadWorkspaceConfig();
    saveCompanyWorkflowRules(workspace.companyId, workflowId, rules);
  }

  async resetWorkflowRules(workflowId: string): Promise<Record<string, unknown>> {
    const workspace = loadWorkspaceConfig();
    clearCompanyWorkflowRules(workspace.companyId, workflowId);
    return createRuleStore().getDefaults(workflowId);
  }

  async executeWorkflow(request: DesktopExecuteRequest): Promise<DesktopExecuteResult> {
    if (this.running) {
      throw new DesktopBridgeError('ALREADY_RUNNING', '任务正在运行，请勿重复点击');
    }
    const definition = getWorkflowDefinition(request.workflowId);
    if (!definition) {
      throw new DesktopBridgeError('WORKFLOW_NOT_FOUND', `未找到工作流：${request.workflowId}`);
    }

    for (const role of definition.inputRoles.filter((r) => r.required)) {
      if (!request.inputFiles.some((f) => f.role === role.role && f.bytes?.byteLength)) {
        throw new DesktopBridgeError('MISSING_REQUIRED_ROLE', `请先选择必填文件：${role.description || role.role}`);
      }
    }

    const workspace = loadWorkspaceConfig();
    const companyRules =
      request.companyRules ??
      loadCompanyRulesDocument(workspace.companyId)[request.workflowId] ??
      {};
    const effectiveRules = createRuleStore().resolve(request.workflowId, {
      companyRules,
      rules: request.rules,
    });

    const ruleCheck = validateWorkflowRules(request.workflowId, {
      ...effectiveRules,
      ...(request.rules ?? {}),
    });
    if (!ruleCheck.ok) {
      throw new DesktopBridgeError('INVALID_RULES', ruleCheck.message);
    }

    this.running = true;
    const artifacts: CapturedOutputArtifact[] = [];
    setOutputCaptureSink((artifact) => {
      artifacts.push(artifact);
      this.lastArtifacts.set(artifact.path, artifact);
      this.lastArtifacts.set(artifact.fileName, artifact);
    });

    try {
      const runtime = createWorkflowRuntime();
      const result = await runtime.execute({
        workflowId: request.workflowId,
        companyId: request.companyId || workspace.companyId,
        inputFiles: request.inputFiles.map((file) => ({
          role: file.role,
          path: file.path,
          sha256: file.sha256,
          originalName: file.originalName,
          bytes: file.bytes,
        })),
        companyRules,
        rules: request.rules,
        outputDir: `${workspace.rootDir}/outputs/${request.workflowId}`,
        runDate: request.runDate,
      });

      return {
        ...result,
        outputArtifacts: artifacts.map((a) => ({
          fileName: a.fileName,
          path: a.path,
          bytes: a.bytes,
        })),
        effectiveRules,
        cloudUpload: false,
        executedAt: new Date().toISOString(),
        phase: '完成',
      };
    } catch (error) {
      const message = sanitizeWorkflowError(
        error instanceof Error ? error.message : String(error),
      );
      const detail = error instanceof Error ? error.message : String(error);
      throw new DesktopBridgeError('RUN_FAILED', message || '工作流运行失败，请检查输入文件与规则后重试', detail);
    } finally {
      setOutputCaptureSink(null);
      this.running = false;
    }
  }

  async openFile(path: string, bytes?: Uint8Array, fileName?: string): Promise<void> {
    const artifact =
      bytes
        ? { bytes, fileName: fileName || displayFileName(path) }
        : this.lastArtifacts.get(path) || this.lastArtifacts.get(displayFileName(path));
    if (!artifact?.bytes) {
      throw new DesktopBridgeError(
        'BROWSER_OPEN_UNSUPPORTED',
        `浏览器模式无法直接打开本地路径。结果文件：${displayFileName(path)}。请使用下载方式保存后手动打开。`,
        path,
      );
    }
    const blob = new Blob([new Uint8Array(artifact.bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.fileName || displayFileName(path);
    a.click();
    URL.revokeObjectURL(url);
  }

  async revealInFolder(path: string): Promise<void> {
    throw new DesktopBridgeError(
      'BROWSER_OPEN_UNSUPPORTED',
      `浏览器模式无法打开所在文件夹。文件标识：${displayFileName(path)}`,
      path,
    );
  }
}

/** Node/Vitest bridge that writes real files under an OS temp workspace. */
export class NodeTestWorkflowBridge extends BrowserDevelopmentWorkflowBridge {
  private workspace: LocalWorkspaceConfig;

  constructor(workspace: LocalWorkspaceConfig) {
    super();
    this.workspace = workspace;
  }

  override async getWorkspaceConfig(): Promise<LocalWorkspaceConfig> {
    return this.workspace;
  }

  override async setWorkspaceConfig(config: LocalWorkspaceConfig): Promise<void> {
    assertNoPathTraversal(config.rootDir);
    this.workspace = config;
  }

  override async executeWorkflow(request: DesktopExecuteRequest): Promise<DesktopExecuteResult> {
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const {
      createFileRuleStore,
      createRuleStore,
      createWorkflowRuntime,
      setOutputCaptureSink,
    } = await import('@aw/data-engine');

    if (this.running) {
      throw new DesktopBridgeError('ALREADY_RUNNING', '任务正在运行，请勿重复点击');
    }
    this.running = true;

    try {
      const definition = getWorkflowDefinition(request.workflowId);
      if (!definition) {
        throw new DesktopBridgeError('WORKFLOW_NOT_FOUND', `未找到工作流：${request.workflowId}`);
      }

      for (const role of definition.inputRoles.filter((r) => r.required)) {
        const hasFile = request.inputFiles.some(
          (f) => f.role === role.role && (f.bytes?.byteLength || f.path),
        );
        if (!hasFile) {
          throw new DesktopBridgeError(
            'MISSING_REQUIRED_ROLE',
            `请先选择必填文件：${role.description || role.role}`,
          );
        }
      }

      mkdirSync(this.workspace.rootDir, { recursive: true });
      const outputDir = join(this.workspace.rootDir, 'outputs', request.workflowId);
      mkdirSync(outputDir, { recursive: true });

      const persisted = createFileRuleStore({ rootDir: this.workspace.rootDir });
      const companyDocRules = await persisted.getWorkflowRules(
        this.workspace.companyId,
        request.workflowId,
      );
      const companyRules = request.companyRules ?? companyDocRules;
      const effectiveRules = createRuleStore().resolve(request.workflowId, {
        companyRules,
        rules: request.rules,
      });

      const inputFiles = [];
      for (const file of request.inputFiles) {
        assertNoPathTraversal(file.path);
        let path = file.path;
        if (file.bytes && file.bytes.byteLength > 0) {
          path = join(this.workspace.rootDir, 'inputs', request.workflowId, file.originalName);
          mkdirSync(join(this.workspace.rootDir, 'inputs', request.workflowId), { recursive: true });
          writeFileSync(path, file.bytes);
        }
        if (!existsSync(path)) {
          throw new DesktopBridgeError('FILE_NOT_FOUND', `文件不存在：${displayFileName(file.originalName)}`);
        }
        inputFiles.push({
          role: file.role,
          path,
          sha256: file.sha256,
          originalName: file.originalName,
        });
      }

      const artifacts: CapturedOutputArtifact[] = [];
      setOutputCaptureSink((artifact) => artifacts.push(artifact));
      try {
        const result = await createWorkflowRuntime({
          persistedRuleStore: persisted,
        }).execute({
          workflowId: request.workflowId,
          companyId: this.workspace.companyId,
          inputFiles,
          companyRules,
          rules: request.rules,
          outputDir,
          runDate: request.runDate,
        });

        for (const out of result.outputFiles) {
          assertPathInsideWorkspace(out, this.workspace.rootDir);
        }

        return {
          ...result,
          outputArtifacts: artifacts.map((a) => ({
            fileName: a.fileName,
            path: a.path.startsWith('memory://')
              ? join(outputDir, a.fileName)
              : a.path,
            bytes: a.bytes,
          })),
          effectiveRules,
          cloudUpload: false,
          executedAt: new Date().toISOString(),
          phase: '完成',
        };
      } finally {
        setOutputCaptureSink(null);
      }
    } catch (error) {
      if (error instanceof DesktopBridgeError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new DesktopBridgeError('RUN_FAILED', '工作流运行失败，请检查输入文件与规则后重试', message);
    } finally {
      this.running = false;
    }
  }

  override async openFile(path: string): Promise<void> {
    assertPathInsideWorkspace(path, this.workspace.rootDir);
    // Node tests only assert the call; no OS open.
  }

  override async revealInFolder(path: string): Promise<void> {
    assertPathInsideWorkspace(path, this.workspace.rootDir);
  }

  override async saveWorkflowRules(workflowId: string, rules: Record<string, unknown>): Promise<void> {
    validateRules(rules);
    const { createFileRuleStore } = await import('@aw/data-engine');
    const store = createFileRuleStore({ rootDir: this.workspace.rootDir });
    await store.saveWorkflowRules(this.workspace.companyId, workflowId, rules);
  }

  override async getWorkflowRules(workflowId: string) {
    const { createFileRuleStore, createRuleStore } = await import('@aw/data-engine');
    const defaults = createRuleStore().getDefaults(workflowId);
    const store = createFileRuleStore({ rootDir: this.workspace.rootDir });
    const company = await store.getWorkflowRules(this.workspace.companyId, workflowId);
    const effective = createRuleStore().resolve(workflowId, { companyRules: company });
    return { defaults, company, effective };
  }

  override async resetWorkflowRules(workflowId: string): Promise<Record<string, unknown>> {
    const { createFileRuleStore, createRuleStore } = await import('@aw/data-engine');
    const store = createFileRuleStore({ rootDir: this.workspace.rootDir });
    await store.saveWorkflowRules(this.workspace.companyId, workflowId, {});
    return createRuleStore().getDefaults(workflowId);
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Runtime specifier — Vite must not statically resolve optional Tauri plugins. */
function importTauriPlugin(pluginPath: string): Promise<unknown> {
  const scope = ['@', 'tauri', '-', 'apps'].join('');
  const specifier = `${scope}/${pluginPath}`;
  return import(/* @vite-ignore */ specifier);
}

export class TauriDesktopWorkflowBridge extends BrowserDevelopmentWorkflowBridge {
  override async selectWorkspaceDirectory(): Promise<string | null> {
    try {
      const dialog = (await importTauriPlugin('plugin-dialog')) as {
        open: (opts: { directory: boolean; multiple: boolean }) => Promise<string | string[] | null>;
      };
      const selected = await dialog.open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return null;
      assertNoPathTraversal(selected);
      const config = await this.getWorkspaceConfig();
      await this.setWorkspaceConfig({ ...config, rootDir: selected });
      return selected;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DesktopBridgeError(
        'WORKSPACE_MISSING',
        '无法选择工作区目录（需要 Tauri 对话框插件）',
        message,
      );
    }
  }

  override async selectInputFile(options: {
    extensions: string[];
    multiple?: boolean;
  }): Promise<SelectedLocalFile | null> {
    try {
      const dialog = (await importTauriPlugin('plugin-dialog')) as {
        open: (opts: {
          multiple: boolean;
          filters: Array<{ name: string; extensions: string[] }>;
        }) => Promise<string | string[] | null>;
      };
      const fs = (await importTauriPlugin('plugin-fs')) as {
        readFile: (path: string) => Promise<Uint8Array>;
      };
      const selected = await dialog.open({
        multiple: false,
        filters: [
          {
            name: 'Spreadsheet',
            extensions: options.extensions.map((e) => e.replace(/^\./, '')),
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return null;
      assertNoPathTraversal(selected);
      const bytes = await fs.readFile(selected);
      const sha256 = await sha256Hex(bytes);
      const name = displayFileName(selected);
      return {
        name,
        path: selected,
        size: bytes.byteLength,
        sha256,
        bytes,
        extension: getFileExtension(name),
      };
    } catch (error) {
      // Fall back to browser file picker when Tauri plugins are unavailable.
      if (import.meta.env.DEV) {
        return super.selectInputFile(options);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new DesktopBridgeError('FILE_NOT_FOUND', '无法选择本地文件', message);
    }
  }

  override async openFile(path: string, bytes?: Uint8Array, fileName?: string): Promise<void> {
    try {
      const opener = (await importTauriPlugin('plugin-opener')) as {
        openPath: (path: string) => Promise<void>;
      };
      const workspace = await this.getWorkspaceConfig();
      if (!path.startsWith('memory://')) {
        assertPathInsideWorkspace(path, workspace.rootDir);
      }
      await opener.openPath(path);
    } catch {
      await super.openFile(path, bytes, fileName);
    }
  }

  override async revealInFolder(path: string): Promise<void> {
    try {
      const opener = (await importTauriPlugin('plugin-opener')) as {
        revealItemInDir: (path: string) => Promise<void>;
      };
      const workspace = await this.getWorkspaceConfig();
      assertPathInsideWorkspace(path, workspace.rootDir);
      await opener.revealItemInDir(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DesktopBridgeError('BROWSER_OPEN_UNSUPPORTED', '无法打开所在文件夹', message);
    }
  }
}

let bridgeSingleton: DesktopWorkflowBridge | null = null;

export function getDesktopWorkflowBridge(): DesktopWorkflowBridge {
  if (bridgeSingleton) return bridgeSingleton;
  bridgeSingleton = isTauriRuntime()
    ? new TauriDesktopWorkflowBridge()
    : new BrowserDevelopmentWorkflowBridge();
  return bridgeSingleton;
}

export function __setDesktopWorkflowBridgeForTests(bridge: DesktopWorkflowBridge | null): void {
  bridgeSingleton = bridge;
}






