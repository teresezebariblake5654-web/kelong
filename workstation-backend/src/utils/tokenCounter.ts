export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 粗略估算：中文约 1.5 字符/token，英文约 4 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

export function tokensToCredits(tokens: number): number {
  return Math.max(1, Math.ceil(tokens / 1000));
}
