import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  RotateCcw,
  Save,
} from 'lucide-react';
import { getWorkflowDefinition } from '@aw/task-templates';
import type { UploadContext } from '@aw/data-engine';
import { WorkflowResultFollowUp } from '@workstation/components/workflows/WorkflowResultFollowUp';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import {
  DesktopBridgeError,
  createEmptyRoleInputs,
  departmentHomePath,
  displayFileName,
  formatBytes,
  financeNeedsReview,
  ecommerceNeedsReview,
  logisticsNeedsReview,
  adminNeedsReview,
  getDesktopWorkflowBridge,
  isDepartmentCatalogWorkflowId,
  isAutomaticExecutionRuleKey,
  isPathInsideWorkspace,
  isRunLocked,
  payrollNeedsReview,
  presentWorkflowResult,
  buildCompanyRulePatch,
  canonicalizeRulesDraft,
  fieldConstraintHint,
  formatRuleDisplayValue,
  formatRuleInputText,
  localizeRulesForDisplay,
  materializeRulesForRun,
  parseRuleInputText,
  readEditableRuleValue,
  readRuleValue,
  requiredRolesReady,
  resolveRuleSource,
  ruleFieldsForWorkflow,
  ruleKeyLabel,
  ruleSourceLabel,
  sanitizeWorkflowError,
  shortSha256,
  socialPolicyMissing,
  statusLabel,
  toExecuteInputFiles,
  writeRuleField,
  validateWorkflowRules,
  workflowDisclaimer,
  workflowDataHintSummary,
  workflowUploadCopy,
  type DepartmentWorkflowCategory,
  type DesktopExecuteResult,
  type RuleFieldSchema,
  type SelectedLocalFile,
  type SelectedWorkflowInput,
  type WorkflowUiPhase,
  type WorkflowUiStatus,
} from '@workstation/services/workflow';
import { cn } from '@workstation/lib/utils';
import { takeWorkflowHandoffFiles } from '@workstation/lib/workflowFileHandoff';

const THEME = {
  production: {
    label: '生产任务',
    border: 'border-emerald-100',
    soft: 'from-emerald-50',
    text: 'text-emerald-700',
    chip: 'bg-emerald-100 text-emerald-800',
    btnBorder: 'border-emerald-200',
    btnText: 'text-emerald-800',
    btnHover: 'hover:bg-emerald-50',
    runBg: 'bg-emerald-600 hover:bg-emerald-700',
    okBorder: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  hr: {
    label: '人事任务',
    border: 'border-indigo-100',
    soft: 'from-indigo-50',
    text: 'text-indigo-700',
    chip: 'bg-indigo-100 text-indigo-800',
    btnBorder: 'border-indigo-200',
    btnText: 'text-indigo-800',
    btnHover: 'hover:bg-indigo-50',
    runBg: 'bg-indigo-600 hover:bg-indigo-700',
    okBorder: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  },
  finance: {
    label: '财务任务',
    border: 'border-sky-100',
    soft: 'from-sky-50',
    text: 'text-sky-700',
    chip: 'bg-sky-100 text-sky-800',
    btnBorder: 'border-sky-200',
    btnText: 'text-sky-800',
    btnHover: 'hover:bg-sky-50',
    runBg: 'bg-sky-600 hover:bg-sky-700',
    okBorder: 'border-sky-200 bg-sky-50 text-sky-900',
  },
  ecommerce: {
    label: '电商任务',
    border: 'border-pink-100',
    soft: 'from-pink-50',
    text: 'text-pink-700',
    chip: 'bg-pink-100 text-pink-800',
    btnBorder: 'border-pink-200',
    btnText: 'text-pink-800',
    btnHover: 'hover:bg-pink-50',
    runBg: 'bg-pink-600 hover:bg-pink-700',
    okBorder: 'border-pink-200 bg-pink-50 text-pink-900',
  },
  logistics: {
    label: '物流任务',
    border: 'border-orange-100',
    soft: 'from-orange-50',
    text: 'text-orange-700',
    chip: 'bg-orange-100 text-orange-800',
    btnBorder: 'border-orange-200',
    btnText: 'text-orange-800',
    btnHover: 'hover:bg-orange-50',
    runBg: 'bg-orange-600 hover:bg-orange-700',
    okBorder: 'border-orange-200 bg-orange-50 text-orange-900',
  },
  admin: {
    label: '行政任务',
    border: 'border-slate-200',
    soft: 'from-slate-50',
    text: 'text-slate-700',
    chip: 'bg-slate-100 text-slate-800',
    btnBorder: 'border-slate-200',
    btnText: 'text-slate-800',
    btnHover: 'hover:bg-slate-50',
    runBg: 'bg-slate-700 hover:bg-slate-800',
    okBorder: 'border-slate-200 bg-slate-50 text-slate-900',
  },
} as const;

const WORKSTATION_PATH: Record<DepartmentWorkflowCategory, string> = {
  production: '/templates/production',
  hr: '/templates/hr',
  finance: '/templates/finance',
  ecommerce: '/templates/ecommerce',
  logistics: '/templates/logistics',
  admin: '/templates/administration',
};

function friendlyError(error: unknown): { message: string; detail?: string } {
  if (error instanceof DesktopBridgeError) {
    return {
      message: sanitizeWorkflowError(error.message),
      detail: error.technicalDetail ? sanitizeWorkflowError(error.technicalDetail) : undefined,
    };
  }
  if (error instanceof Error) return { message: sanitizeWorkflowError(error.message) };
  return { message: sanitizeWorkflowError(error) };
}

function exceptionAdvice(code: string): string {
  if (code.includes('NEGATIVE') || code.includes('负库存')) return '核对出入库与期初，确认后再处理库存';
  if (code.includes('MISSING') || code.includes('缺失') || code.includes('MISSING_RECEIPT'))
    return '补齐缺失数据或发票后重新运行';
  if (code.includes('TOLERANCE') || code.includes('差异') || code.includes('VARIANCE'))
    return '核对差异，必要时调整规则后重跑';
  if (code.includes('FAIL') || code.includes('质量')) return '按不合格清单隔离，勿执行放行';
  if (code.includes('DUPLICATE')) return '检查重复单据并保留正确版本';
  if (code.includes('BANK')) return '核对银行账号与实发合计，勿自动付款';
  if (code.includes('CONFLICT') || code.includes('AMBIGUOUS')) return '人工确认冲突/歧义，勿自动核销';
  if (code.includes('OCR_PROVIDER')) return '改用结构化发票表或人工录入，勿伪造 OCR';
  if (code.includes('ALLOCATION')) return '检查费用分摊规则，确保分摊前后总额平衡';
  if (code.includes('OVER_LIMIT')) return '超标准费用需人工审批，系统不自动付款';
  if (code.includes('CURRENCY')) return '核对币种与方向后人工处理';
  if (code.includes('OVERSELL')) return '超卖仅标记，勿自动取消订单';
  if (code.includes('OVER_REFUND') || code.includes('OVERREFUND')) return '核对退款额度，勿自动退款';
  if (code.includes('STOCKOUT')) return '核对库存与可售数量后再处理';
  return '查看结果工作簿对应 Sheet，确认后再人工处理';
}

function exceptionSheetHint(code: string): string {
  if (code.includes('NEGATIVE')) return '负库存';
  if (code.includes('MISSING_RECEIPT')) return '缺票清单';
  if (code.includes('MISSING')) return '缺失数据';
  if (code.includes('VARIANCE') || code.includes('TOLERANCE')) return '库存差异';
  if (code.includes('FAIL') || code.includes('DEFECT')) return '不合格清单';
  if (code.includes('BANK')) return '银行发薪 / 异常待人工';
  if (code.includes('CONFLICT') || code.includes('AMBIGUOUS')) return '歧义候选 / 重复冲突';
  if (code.includes('OCR')) return '发票登记表';
  if (code.includes('ALLOCATION')) return '费用分摊';
  if (code.includes('OVER_LIMIT')) return '超标准';
  if (code.includes('DUPLICATE')) return '重复费用 / 重复发票';
  return '运行说明 / 异常汇总';
}

function stripBytesFromInputs(
  inputs: Record<string, SelectedWorkflowInput>,
): Record<string, SelectedWorkflowInput> {
  const next: Record<string, SelectedWorkflowInput> = {};
  for (const [role, state] of Object.entries(inputs)) {
    next[role] = {
      role: state.role,
      files: state.files.map((file) => ({
        name: file.name,
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        extension: file.extension,
      })),
    };
  }
  return next;
}

export type WorkflowRunPageProps = {
  category: DepartmentWorkflowCategory;
};

export function WorkflowRunPage({ category }: WorkflowRunPageProps) {
  const navigate = useNavigate();
  const { workflowId = '' } = useParams();
  const definition = getWorkflowDefinition(workflowId);
  const bridge = getDesktopWorkflowBridge();
  const theme = THEME[category];
  const homePath = departmentHomePath(category);

  const [roleInputs, setRoleInputs] = useState<Record<string, SelectedWorkflowInput>>({});
  const [uploadedFiles, setUploadedFiles] = useState<SelectedLocalFile[]>([]);
  const [uploadContext, setUploadContext] = useState<UploadContext | null>(null);
  const [uploadAnswers, setUploadAnswers] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkflowUiStatus>('IDLE');
  const [phase, setPhase] = useState<WorkflowUiPhase | null>(null);
  const [rulesDraft, setRulesDraft] = useState<Record<string, unknown>>({});
  const [defaults, setDefaults] = useState<Record<string, unknown>>({});
  const [companyRules, setCompanyRules] = useState<Record<string, unknown>>({});
  const [effectiveRules, setEffectiveRules] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<DesktopExecuteResult | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [editingRuleKey, setEditingRuleKey] = useState<string | null>(null);
  const [editingRuleText, setEditingRuleText] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('browser-workspace');
  const [debugOpen, setDebugOpen] = useState(false);

  const runLock = useRef(false);

  const ruleFields = useMemo(
    () => (definition ? ruleFieldsForWorkflow(definition.id) : []),
    [definition],
  );

  const refreshRules = useCallback(async () => {
    if (!definition) return;
    const pack = await bridge.getWorkflowRules(definition.id);
    setDefaults(pack.defaults);
    setCompanyRules(pack.company);
    setRulesDraft(canonicalizeRulesDraft(definition.id, pack.defaults, pack.company));
    setEffectiveRules(pack.effective);
    const ws = await bridge.getWorkspaceConfig();
    setWorkspaceRoot(ws.rootDir);
  }, [bridge, definition]);

  useEffect(() => {
    void refreshRules().catch((err) => setError(friendlyError(err)));
  }, [refreshRules]);

  useEffect(() => {
    if (!definition) return;
    setRoleInputs(createEmptyRoleInputs(definition));
    setUploadedFiles([]);
    setUploadContext(null);
    setUploadAnswers({});
    setUploadError(null);
    setResult(null);
    setError(null);
    setRulesError(null);
    setEditingRuleKey(null);
    setStatus('IDLE');
    setPhase(null);
  }, [definition]);

  // After reset: pull Excel uploads carried from department chat (if any).
  useEffect(() => {
    if (!definition) return;
    const handoff = takeWorkflowHandoffFiles(definition.id);
    if (!handoff.length) return;
    setUploadedFiles(handoff);
    void detectUploadedFiles(handoff, {});
    // Intentionally only re-run when workflow id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition?.id]);

  const canRunByRole = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const role of definition?.inputRoles ?? []) {
      const match = uploadContext?.matchedTemplates.find((item) => item.role === role.role);
      map[role.role] = Boolean(match && match.missingFields.length === 0 && match.confidence >= 0.5);
    }
    return map;
  }, [definition, uploadContext]);

  const requiredReady = useMemo(() => {
    if (!definition || uploadContext?.clarifications.length) return false;
    return requiredRolesReady(definition, roleInputs, canRunByRole);
  }, [definition, roleInputs, canRunByRole, uploadContext]);

  useEffect(() => {
    if (status === 'RUNNING' || status === 'PARSING') return;
    if (result) {
      setStatus(
        result.status === 'FAILED'
          ? 'FAILED'
          : result.status === 'NEEDS_REVIEW' || result.status === 'NEEDS_CONFIRMATION'
            ? 'NEEDS_REVIEW'
            : 'COMPLETED',
      );
      return;
    }
    if (requiredReady) setStatus('READY');
    else if (!uploadedFiles.length) setStatus('IDLE');
  }, [requiredReady, result, status, uploadedFiles]);

  const detectUploadedFiles = useCallback(
    async (files: SelectedLocalFile[], answers: Record<string, string>) => {
      if (!definition || !files.length) return;
      setStatus('PARSING');
      setPhase('字段识别');
      setUploadError(null);
      try {
        const detected = await bridge.detectUploadContext({
          workflowId: definition.id,
          files,
          answers,
        });
        const nextInputs = createEmptyRoleInputs(definition);
        for (const prepared of detected.preparedInputs) {
          nextInputs[prepared.role] = {
            role: prepared.role,
            files: [
              {
                name: `${prepared.sourceFileName} · ${prepared.sheetName}.xlsx`,
                path: `memory://${prepared.fileId}/${prepared.role}.xlsx`,
                size: prepared.bytes.byteLength,
                sha256: `${prepared.fileId}:${prepared.role}:${prepared.sheetName}`,
                bytes: prepared.bytes,
                extension: 'xlsx',
              },
            ],
          };
        }
        setUploadContext(detected.context);
        setRoleInputs(nextInputs);
        const missing = definition.inputRoles.filter(
          (role) => role.required && !detected.context.matchedTemplates.some(
            (match) => match.role === role.role && match.missingFields.length === 0 && match.confidence >= 0.5,
          ),
        );
        if (missing.length) {
          const detail = missing
            .map((role) => {
              const match = detected.context.matchedTemplates.find((item) => item.role === role.role);
              const label = role.description || role.role;
              if (match?.missingFields?.length) {
                return `${label}（缺列：${match.missingFields.join('、')}）`;
              }
              return `${label}（未匹配到表头，请确认第 1 行是字段名）`;
            })
            .join('；');
          setUploadError(
            `还无法识别：${detail}。可换一份表头更标准的导出表，或补传对应角色文件。`,
          );
          setStatus('IDLE');
        } else if (detected.context.clarifications.length) {
          setStatus('IDLE');
        } else {
          setStatus('READY');
        }
      } catch (err) {
        setUploadError(friendlyError(err).message);
        setStatus('IDLE');
      } finally {
        setPhase(null);
      }
    },
    [bridge, definition],
  );

  const onPickBusinessFiles = async () => {
    if (!definition) return;
    try {
      const selected = await bridge.selectInputFiles({ extensions: ['xlsx', 'xls', 'csv'] });
      if (!selected.length) return;
      const bySha = new Map(uploadedFiles.map((file) => [file.sha256, file]));
      for (const file of selected) bySha.set(file.sha256, file);
      const files = [...bySha.values()];
      setUploadedFiles(files);
      setUploadAnswers({});
      await detectUploadedFiles(files, {});
    } catch (err) {
      setUploadError(friendlyError(err).message);
    }
  };

  const answerClarification = async (questionId: string, candidateKey: string) => {
    const answers = { ...uploadAnswers, [questionId]: candidateKey };
    setUploadAnswers(answers);
    await detectUploadedFiles(uploadedFiles, answers);
  };

  const removeUploadedFile = async (sha256: string) => {
    const files = uploadedFiles.filter((file) => file.sha256 !== sha256);
    setUploadedFiles(files);
    setUploadAnswers({});
    if (!files.length) {
      setUploadContext(null);
      setRoleInputs(createEmptyRoleInputs(definition!));
      setUploadError(null);
      setStatus('IDLE');
      return;
    }
    await detectUploadedFiles(files, {});
  };
  const commitRuleText = useCallback((field: RuleFieldSchema, text: string) => {
    const parsed = parseRuleInputText(text, field);
    setRulesDraft((prev) => writeRuleField(prev, field.key, parsed));
  }, []);

  const onSaveRules = async () => {
    if (!definition) return;
    const materialized = materializeRulesForRun(definition.id, rulesDraft);
    const check = validateWorkflowRules(definition.id, materialized);
    if (!check.ok) {
      setRulesError(check.message);
      setError({ message: check.message });
      return;
    }
    try {
      const patch = buildCompanyRulePatch(definition.id, rulesDraft, defaults);
      await bridge.saveWorkflowRules(definition.id, patch);
      await refreshRules();
      setRulesError(null);
      setError(null);
    } catch (err) {
      const friendly = friendlyError(err);
      setRulesError(friendly.message);
      setError(friendly);
    }
  };

  const onResetRules = async () => {
    if (!definition) return;
    await bridge.resetWorkflowRules(definition.id);
    setRulesError(null);
    setEditingRuleKey(null);
    await refreshRules();
  };

  const runWorkflow = async () => {
    if (!definition || runLock.current || status === 'RUNNING') return;
    if (!requiredReady) {
      setError({ message: '请先为所有必填角色选择并识别文件' });
      return;
    }
    const materialized = materializeRulesForRun(definition.id, rulesDraft);
    const ruleCheck = validateWorkflowRules(definition.id, materialized);
    if (!ruleCheck.ok) {
      setRulesError(ruleCheck.message);
      setError({ message: ruleCheck.message });
      return;
    }
    runLock.current = true;
    const previousResult = result;
    setStatus('RUNNING');
    setPhase('本地计算');
    setError(null);
    setRulesError(null);

    try {
      const ws = await bridge.getWorkspaceConfig();
      const inputFiles = toExecuteInputFiles(definition, roleInputs);

      setPhase('生成结果');
      const executed = await bridge.executeWorkflow({
        workflowId: definition.id,
        companyId: ws.companyId,
        rules: materialized,
        runDate: new Date().toISOString().slice(0, 10),
        inputFiles,
      });

      // Drop raw bytes from UI state after a successful bridge call (keep sha/name/path).
      setRoleInputs((prev) => stripBytesFromInputs(prev));

      if (executed.status === 'FAILED') {
        setStatus('FAILED');
        setError({ message: sanitizeWorkflowError(executed.errorMessage || '运行失败') });
        if (previousResult && previousResult.status !== 'FAILED') {
          setResult(previousResult);
        }
        return;
      }

      setResult(executed);
      setEffectiveRules(executed.effectiveRules);
      setPhase('完成');
      setStatus(
        executed.status === 'NEEDS_REVIEW' || executed.status === 'NEEDS_CONFIRMATION'
          ? 'NEEDS_REVIEW'
          : 'COMPLETED',
      );
    } catch (err) {
      setStatus('FAILED');
      setError(friendlyError(err));
      if (previousResult && previousResult.status !== 'FAILED') {
        setResult(previousResult);
      }
    } finally {
      runLock.current = false;
    }
  };

  if (!isDepartmentCatalogWorkflowId(workflowId) || !definition) {
    return <Navigate to={homePath} replace />;
  }
  if (category === 'production' && !workflowId.startsWith('PROD-')) {
    return <Navigate to={homePath} replace />;
  }
  if (category === 'hr' && !workflowId.startsWith('HR-')) {
    return <Navigate to={homePath} replace />;
  }
  if (category === 'finance' && !workflowId.startsWith('FIN-')) {
    return <Navigate to={homePath} replace />;
  }
  if (category === 'ecommerce' && !workflowId.startsWith('ECOM-')) {
    return <Navigate to={homePath} replace />;
  }
  if (category === 'logistics' && !workflowId.startsWith('LOG-')) {
    return <Navigate to={homePath} replace />;
  }
  if (category === 'admin' && !workflowId.startsWith('ADMIN-')) {
    return <Navigate to={homePath} replace />;
  }

  const outputPath = result?.outputFiles[0] || result?.outputArtifacts?.[0]?.path;
  const outputBytes = result?.outputArtifacts?.[0]?.bytes;
  const outputName = outputPath ? displayFileName(outputPath) : '';
  const canRun =
    requiredReady &&
    !isRunLocked(status) &&
    status !== 'RUNNING' &&
    (status === 'READY' ||
      status === 'COMPLETED' ||
      status === 'NEEDS_REVIEW' ||
      status === 'FAILED' ||
      status === 'IDLE');

  const metricCards = result ? presentWorkflowResult(definition.id, result) : [];
  const isPayroll = definition.id === 'HR-PAYROLL-001';
  const isSocial = definition.id === 'HR-SOCIAL-INSURANCE-005';
  const isFinance = definition.id.startsWith('FIN-');
  const isEcommerce = definition.id.startsWith('ECOM-');
  const isLogistics = definition.id.startsWith('LOG-');
  const isAdmin = definition.id.startsWith('ADMIN-');
  const disclaimer = workflowDisclaimer(definition.id);
  const hideSocialComplete = Boolean(result && isSocial && socialPolicyMissing(result));
  const showCompletedBanner =
    status === 'COMPLETED' &&
    !hideSocialComplete &&
    !(isPayroll && payrollNeedsReview(result!)) &&
    !(isFinance && result && financeNeedsReview(result)) &&
    !(isEcommerce && result && ecommerceNeedsReview(result)) &&
    !(isLogistics && result && logisticsNeedsReview(result)) &&
    !(isAdmin && result && adminNeedsReview(result));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 px-5 py-4">
      <div>
        <PageBackButton
          onBack={() => navigate(WORKSTATION_PATH[category])}
          label="返回工作站"
        />
      </div>
      <header className={cn('rounded-2xl border bg-gradient-to-r via-white to-white px-4 py-3', theme.border, theme.soft)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn('text-[11px] font-medium', theme.text)}>{theme.label}</p>
              <h1 className="text-lg font-semibold text-slate-900">{definition.name}</h1>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{definition.businessGoal}</p>
          </div>
          <div className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            {statusLabel(status)}{phase ? ` · ${phase}` : ''}
          </div>
        </div>
        {disclaimer ? (
          <p className="mt-2 border-t border-amber-100 pt-2 text-[11px] leading-relaxed text-amber-800">
            免责边界：{disclaimer}
          </p>
        ) : null}
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={cn('text-xs font-medium', theme.text)}>1. 上传业务文件</p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              {workflowUploadCopy(category).title}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              {workflowUploadCopy(category).description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onPickBusinessFiles()}
            disabled={isRunLocked(status)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50',
              theme.btnBorder,
              theme.btnText,
              theme.btnHover,
            )}
          >
            <FileSpreadsheet className="size-4" />
            {uploadedFiles.length ? '继续添加文件' : '上传文件'}
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
          <p className="text-xs text-slate-500">支持 xlsx、xls、csv，可一次选择多个文件</p>
          {uploadedFiles.length ? (
            <div className="mt-3 flex flex-col gap-2">
              {uploadedFiles.map((file) => (
                <div key={file.sha256} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <span className="min-w-0 truncate">
                    {file.name} · {formatBytes(file.size)} · SHA {shortSha256(file.sha256)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-slate-400 hover:text-rose-600"
                    disabled={isRunLocked(status)}
                    onClick={() => void removeUploadedFile(file.sha256)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">尚未上传文件</p>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          AI 可自动识别：{workflowDataHintSummary(definition)}。这些数据可以在多个文件中，也可以在同一个 Excel 的不同 Sheet 中，文件名和 Sheet 名无需固定。
        </p>
        {uploadContext ? (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            <p className="font-medium text-slate-600">
              AI 识别结果 · {uploadContext.files.length} 个文件 · {uploadContext.detectedFields.length} 个数据表 · 总体置信度 {Math.round(uploadContext.confidence * 100)}%
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {uploadContext.matchedTemplates.map((match) => (
                <span key={match.role} className="rounded-full bg-white px-2 py-0.5">
                  {match.description} ← {match.sheetName}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {uploadContext?.clarifications.slice(0, 2).map((question) => (
          <div key={question.id} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">需要确认：{question.question}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {question.candidates.map((candidate) => (
                <button
                  key={`${candidate.fileId}:${candidate.sheetName}`}
                  type="button"
                  className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100"
                  onClick={() => void answerClarification(question.id, `${candidate.fileId}::${candidate.sheetName}`)}
                >
                  {candidate.fileName} / {candidate.sheetName}
                </button>
              ))}
            </div>
          </div>
        ))}

        {uploadError ? (
          <p className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{uploadError}</p>
        ) : null}
      </section>
      <details className="group rounded-xl border border-slate-200 bg-white px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">公司规则（可选）</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">默认使用公司已保存规则，需要调整时再展开</p>
          </div>
          <span className="text-xs text-slate-400 group-open:hidden">展开设置</span>
          <span className="hidden text-xs text-slate-400 group-open:inline">收起</span>
        </summary>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">工作区：{workspaceRoot}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onResetRules()}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="size-3.5" />恢复默认
              </button>
              <button
                type="button"
                onClick={() => void onSaveRules()}
                className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium', theme.btnBorder, theme.chip)}
              >
                <Save className="size-3.5" />保存为公司规则
              </button>
            </div>
          </div>
          {rulesError ? (
            <p className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{rulesError}</p>
          ) : null}        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(ruleFields.length > 0
            ? ruleFields
            : Object.keys(defaults)
                .filter((key) => {
                  const v = defaults[key];
                  if (isAutomaticExecutionRuleKey(key)) return false;
                  // 跳过数组/对象与重复点号键，避免界面堆砌英文结构字段
                  if (Array.isArray(v) || (v !== null && typeof v === 'object')) return false;
                  if (key.includes('.')) {
                    const leaf = key.slice(key.lastIndexOf('.') + 1);
                    if (Object.prototype.hasOwnProperty.call(defaults, leaf)) return false;
                  }
                  return true;
                })
                .map((key) => ({
                  key,
                  label: ruleKeyLabel(key),
                  type:
                    typeof defaults[key] === 'boolean'
                      ? ('boolean' as const)
                      : typeof defaults[key] === 'number'
                        ? ('number' as const)
                        : ('text' as const),
                }))
          ).map((field) => {
            const value = readEditableRuleValue(rulesDraft, field.key);
            const source = resolveRuleSource({
              key: field.key,
              defaults,
              company: companyRules,
              runtime: rulesDraft,
            });
            const defaultRaw = readRuleValue(defaults, field.key) ?? defaults[field.key];
            const isReadonly = field.type === 'readonly';
            const isBool = field.type === 'boolean';
            const isTextLike =
              field.type === 'number' ||
              field.type === 'decimal-string' ||
              field.type === 'text' ||
              field.type === 'enum';
            const constraint = fieldConstraintHint(field);
            const inputText =
              editingRuleKey === field.key
                ? editingRuleText
                : formatRuleInputText(value, field);
            const selectValue =
              field.key === 'groupBy'
                ? formatRuleInputText(value, field)
                : value === undefined || value === null
                  ? ''
                  : String(value);
            return (
              <label key={field.key} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                <span className="font-medium text-slate-600">{field.label}</span>
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  {isReadonly
                    ? '系统锁定 · 不可开启'
                    : `来源：${ruleSourceLabel(source)} · 默认：${formatRuleDisplayValue(defaultRaw, field)}`}
                </span>
                {constraint && !isReadonly ? (
                  <span className="mt-0.5 block text-[10px] text-slate-400">{constraint}</span>
                ) : null}
                {isReadonly ? (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600">
                    {formatRuleDisplayValue(defaultRaw ?? false, field)}（锁定）
                  </p>
                ) : field.type === 'enum' && field.options ? (
                  <select
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    value={selectValue}
                    onChange={(e) =>
                      setRulesDraft((prev) => writeRuleField(prev, field.key, e.target.value))
                    }
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : isBool ? (
                  <input
                    type="checkbox"
                    className="mt-2"
                    checked={Boolean(value)}
                    onChange={(e) =>
                      setRulesDraft((prev) => writeRuleField(prev, field.key, e.target.checked))
                    }
                  />
                ) : isTextLike ? (
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    type="text"
                    inputMode={
                      field.type === 'number' ||
                      field.type === 'decimal-string' ||
                      ('percent' in field && Boolean(field.percent))
                        ? 'decimal'
                        : undefined
                    }
                    value={inputText}
                    onFocus={() => {
                      setEditingRuleKey(field.key);
                      setEditingRuleText(formatRuleInputText(value, field));
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (editingRuleKey === field.key) {
                        setEditingRuleText(raw);
                        return;
                      }
                      if (field.type === 'decimal-string' || field.type === 'text') {
                        setRulesDraft((prev) => writeRuleField(prev, field.key, raw));
                        return;
                      }
                      setEditingRuleKey(field.key);
                      setEditingRuleText(raw);
                    }}
                    onBlur={() => {
                      if (editingRuleKey === field.key) {
                        commitRuleText(field, editingRuleText);
                        setEditingRuleKey(null);
                      }
                    }}
                  />
                ) : (
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    type="text"
                    value={value === undefined || value === null ? '' : String(value)}
                    onChange={(e) =>
                      setRulesDraft((prev) => writeRuleField(prev, field.key, e.target.value))
                    }
                  />
                )}
              </label>
            );
          })}
        </div>
          <details className="mt-3 text-xs text-slate-400">
            <summary className="cursor-pointer">高级设置 · 查看实际生效规则</summary>
            <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-emerald-100">
              {JSON.stringify(localizeRulesForDisplay(effectiveRules), null, 2)}
            </pre>
          </details>
        </div>
      </details>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">准备运行</h2>
            <p className="mt-1 text-xs text-slate-500">
              已上传 {uploadedFiles.length} 个文件 · {
                status === 'PARSING'
                  ? '正在识别数据'
                  : uploadContext?.clarifications.length
                    ? '等待确认识别结果'
                    : requiredReady
                      ? '数据识别完成，可以运行'
                      : uploadedFiles.length
                        ? '仍需补充必要数据'
                        : '请先上传至少一个业务文件'
              }
            </p>
          </div>
          <button
            type="button"
            data-testid="run-workflow"
            disabled={!canRun || !requiredReady}
            onClick={() => void runWorkflow()}
            className={cn(
              'inline-flex min-w-44 items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none',
              theme.runBg,
            )}
          >
            {status === 'RUNNING' ? <Loader2 className="size-4 animate-spin" /> : null}
            {status === 'RUNNING' ? '正在本地运行…' : '开始本地运行'}
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <p className="font-medium">{error.message}</p>
            {error.detail ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">技术详情</summary>
                <pre className="mt-1 whitespace-pre-wrap">{error.detail}</pre>
              </details>
            ) : null}
            {status === 'FAILED' ? (
              <button type="button" className="mt-2 text-xs font-medium underline" onClick={() => void runWorkflow()}>
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {result && (status === 'COMPLETED' || status === 'NEEDS_REVIEW') ? (
          <div className="mt-4 space-y-4">
            {status === 'NEEDS_REVIEW' ||
            (isPayroll && payrollNeedsReview(result)) ||
            (isFinance && financeNeedsReview(result)) ||
            (isEcommerce && ecommerceNeedsReview(result)) ||
            (isLogistics && logisticsNeedsReview(result)) ||
            (isAdmin && adminNeedsReview(result)) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <AlertTriangle className="size-4" />
                  需要人工确认（未全部成功）
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  {disclaimer ||
                    '结果文件已生成，但存在异常。不会执行付款、退款、放行、结案或 ERP 修改。'}
                </p>
                <div className="mt-3 overflow-hidden rounded-xl border border-amber-100 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-amber-50/80 text-amber-900">
                      <tr>
                        <th className="px-3 py-2">异常类型</th>
                        <th className="px-3 py-2">严重程度</th>
                        <th className="px-3 py-2">数量</th>
                        <th className="px-3 py-2">是否阻塞</th>
                        <th className="px-3 py-2">建议处理</th>
                        <th className="px-3 py-2">结果 Sheet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.exceptions.map((item) => (
                        <tr key={item.code} className="border-t border-slate-100">
                          <td className="px-3 py-2">{item.code}</td>
                          <td className="px-3 py-2">{item.severity}</td>
                          <td className="px-3 py-2">{item.count}</td>
                          <td className="px-3 py-2">
                            {item.severity === 'BLOCKING' ? '是' : '否'}
                          </td>
                          <td className="px-3 py-2">{exceptionAdvice(item.code)}</td>
                          <td className="px-3 py-2">{exceptionSheetHint(item.code)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : showCompletedBanner ? (
              <div className={cn('flex items-center gap-2 rounded-xl border p-3 text-sm', theme.okBorder)}>
                <CheckCircle2 className="size-4" />
                {isSocial ? '核对完成' : '运行完成'}
              </div>
            ) : hideSocialComplete ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                社保政策版本缺失，结果仅供参考，不显示「核对完成」。
              </div>
            ) : null}

            {metricCards.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {metricCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <p className="text-[11px] text-slate-400">{card.label}</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-800">{card.value}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {isPayroll ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <h3 className="font-semibold">发薪最终确认</h3>
                <p className="mt-2 text-xs leading-relaxed text-amber-900">
                  银行发薪表仅供人工导出核对。本工作流不会自动付款（autoPayment = false），也不会向支付网关或银行接口发起任何资金划转。请人工确认实发合计与银行发薪合计一致后再线下发薪。
                </p>
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-400">输出文件</dt>
                  <dd className="font-medium">{outputName || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">输出目录</dt>
                  <dd className="font-medium">
                    {workspaceRoot}/outputs/{definition.id}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">工作流</dt>
                  <dd>
                    {result.workflowId} · {result.workflowVersion}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">执行时间</dt>
                  <dd>{result.executedAt}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">输入文件数</dt>
                  <dd>
                    {Object.values(roleInputs).reduce((n, r) => n + r.files.length, 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">cloudUpload</dt>
                  <dd>false</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="open-result"
                  className={cn(
                    'rounded-full border bg-white px-3 py-1.5 text-xs font-medium',
                    theme.btnBorder,
                    theme.btnText,
                  )}
                  onClick={() =>
                    void bridge
                      .openFile(outputPath || '', outputBytes, outputName)
                      .catch((err) => setError(friendlyError(err)))
                  }
                >
                  打开结果文件
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                  onClick={() =>
                    void bridge
                      .revealInFolder(outputPath || '')
                      .catch((err) => setError(friendlyError(err)))
                  }
                >
                  <FolderOpen className="size-3.5" />
                  打开所在文件夹
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                  onClick={() => void runWorkflow()}
                >
                  重新运行
                </button>
                <Link
                  to={homePath}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                >
                  返回任务列表
                </Link>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                  onClick={() => setDebugOpen((v) => !v)}
                >
                  查看运行说明
                </button>
              </div>

              {debugOpen ? (
                <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] text-emerald-100">
                  {JSON.stringify(
                    {
                      metrics: result.metrics,
                      exceptions: result.exceptions,
                      effectiveRules: result.effectiveRules,
                      insideWorkspace: outputPath
                        ? isPathInsideWorkspace(outputPath, workspaceRoot) ||
                          outputPath.startsWith('memory://')
                        : false,
                    },
                    null,
                    2,
                  )}
                </pre>
              ) : null}
            </div>

            <WorkflowResultFollowUp
              key={result.runId}
              category={category}
              workflowName={definition.name}
              result={result}
              outputFileName={outputName || undefined}
            />
          </div>
        ) : null}
      </section>


    </div>
  );
}












