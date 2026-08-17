/** 从岗位聊天用户气泡中拆出可编辑正文与附件后缀 */
export function splitDepartmentUserMessageContent(content: string) {
  const marker = '\n附件：';
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) {
    return { text: content.trim(), attachmentSuffix: '' };
  }
  return {
    text: content.slice(0, markerIndex).trim(),
    attachmentSuffix: content.slice(markerIndex),
  };
}

export function joinDepartmentUserMessageContent(text: string, attachmentSuffix: string) {
  const main =
    text.trim() ||
    (attachmentSuffix ? '（请基于已上传表格给出分析结论）' : '');
  return `${main}${attachmentSuffix}`;
}
