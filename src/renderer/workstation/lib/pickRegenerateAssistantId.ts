import type { ChatMessage } from '@aw/shared';

/** 可重新生成的 assistant：优先最后一条已有内容或失败的回复，跳过末尾空占位消息 */
export function pickRegenerateAssistantId(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user' || msg.role === 'system') continue;
    if (msg.content.trim() || msg.status === 'failed') {
      return msg.id;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user' || msg.role === 'system') continue;
    return msg.id;
  }

  return undefined;
}
