/**
 * 物料日清 AI 仅允许三种操作，全部走统一后端 analyze（AI 积分扣费）。
 * 禁止发送完整原始文件与全量正常记录。
 */
import { getTaskTemplate } from '@aw/task-templates';
import {
  buildAiOperationPayload,
  parseAiExceptionExplanations,
  parseAiFieldSuggestions,
  parseAiRemarkResults,
  type AiAllowedOperation,
} from '@aw/task-workflows';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import { notifyCreditsChanged } from '@workstation/user-center/creditDisplay';

const TEMPLATE_CODE = 'PRODUCTION_MATERIAL_DAILY_CLOSE';

async function callAnalyze(operation: AiAllowedOperation, body: Record<string, unknown>) {
  const template = getTaskTemplate(TEMPLATE_CODE);
  const payload = buildAiOperationPayload(operation, body);
  const client = getUserCloudClient();
  const response = await client.analyze({
    taskCode: TEMPLATE_CODE,
    templateCode: TEMPLATE_CODE,
    templateVersion: template?.version ?? '1.0.0',
    clientRequestId: crypto.randomUUID(),
    structuredData: payload.structuredData,
    userInstruction: payload.userInstruction,
  });
  if (response.creditsCharged > 0) {
    notifyCreditsChanged();
    try {
      const { notifyCowPetCreditsConsumed } = await import(
        '../../components/pet/petSignals'
      );
      notifyCowPetCreditsConsumed(response.creditsCharged);
    } catch {
      /* decorative pet layer — never block billing path */
    }
  }
  return response;
}

export async function recognizeFieldsWithAi(aiFieldPayload: Record<string, unknown>) {
  const response = await callAnalyze('FIELD_RECOGNITION', aiFieldPayload);
  return {
    taskId: response.taskId,
    creditsCharged: response.creditsCharged,
    suggestions: parseAiFieldSuggestions(response.result),
  };
}

export async function classifyRemarksWithAi(
  remarks: Array<{ recordCode: string; remark: string; materialCode?: string; materialName?: string }>,
  confidenceThreshold = 0.7,
) {
  const response = await callAnalyze('REMARK_CLASSIFICATION', { remarks });
  return {
    taskId: response.taskId,
    creditsCharged: response.creditsCharged,
    results: parseAiRemarkResults(response.result, confidenceThreshold),
  };
}

export async function explainExceptionsWithAi(
  exceptions: Array<{ code: string; severity: string; message: string }>,
) {
  const response = await callAnalyze('EXCEPTION_EXPLANATION', {
    exceptions: exceptions.slice(0, 40),
  });
  return {
    taskId: response.taskId,
    creditsCharged: response.creditsCharged,
    explanations: parseAiExceptionExplanations(response.result),
  };
}
