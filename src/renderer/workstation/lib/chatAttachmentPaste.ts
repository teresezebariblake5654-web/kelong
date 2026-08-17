import { isChatAttachmentExtension } from '@aw/shared';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function extensionFromMime(mime: string): string | null {
  const normalized = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_EXT[normalized] ?? null;
}

export function isAcceptedChatAttachment(file: File): boolean {
  if (isChatAttachmentExtension(file.name)) return true;
  const ext = extensionFromMime(file.type);
  return ext ? isChatAttachmentExtension(`.${ext}`) : false;
}

function normalizePastedFile(file: File): File {
  if (file.name && isChatAttachmentExtension(file.name)) return file;

  const ext = extensionFromMime(file.type);
  if (!ext) return file;

  return new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
}

function collectFilesFromList(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  for (const file of Array.from(list)) {
    if (!file || !isAcceptedChatAttachment(file)) continue;
    const normalized = normalizePastedFile(file);
    const key = `${normalized.name}:${normalized.size}:${normalized.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(normalized);
  }
  return files;
}

/** 从剪贴板提取可上传的附件（截图、复制的文件等） */
export function extractPastedFiles(clipboard: ClipboardEvent): File[] {
  const seen = new Set<string>();
  const files: File[] = [];

  const push = (file: File | null) => {
    if (!file || !isAcceptedChatAttachment(file)) return;
    const normalized = normalizePastedFile(file);
    const key = `${normalized.name}:${normalized.size}:${normalized.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(normalized);
  };

  const items = clipboard.clipboardData?.items;
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      push(item.getAsFile());
    }
  }

  if (files.length) return files;

  const fileList = clipboard.clipboardData?.files;
  if (fileList) {
    for (const file of Array.from(fileList)) {
      push(file);
    }
  }

  return files;
}

/** Drag-and-drop file extraction for the chat composer. */
export function extractDroppedFiles(dataTransfer: DataTransfer | null): File[] {
  return collectFilesFromList(dataTransfer?.files);
}

export function handleComposerPaste(
  event: React.ClipboardEvent,
  onUploadFiles: (files: File[]) => void,
): boolean {
  const files = extractPastedFiles(event.nativeEvent);
  if (!files.length) return false;
  event.preventDefault();
  onUploadFiles(files);
  return true;
}

export function handleComposerDrop(
  event: React.DragEvent,
  onUploadFiles: (files: File[]) => void,
): boolean {
  const files = extractDroppedFiles(event.dataTransfer);
  if (!files.length) return false;
  event.preventDefault();
  event.stopPropagation();
  onUploadFiles(files);
  return true;
}
