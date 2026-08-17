import {
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MessageSquarePlus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ALLOWED_UPLOAD_TYPES_MESSAGE,
  getUploadAcceptAttribute,
  isAllowedUploadExtension,
} from '@aw/shared';
import type { ChatAttachment } from '@aw/shared';
import { PageContainer } from '@workstation/components/layout/PageContainer';
import { Button } from '@workstation/components/ui/button';
import { Input } from '@workstation/components/ui/input';
import { formatBytes } from '@workstation/services/workflow/pathSafety';
import { cn } from '@workstation/lib/utils';
import { useChatStore, type LibraryFile } from '@workstation/state/chatStore';

type FileFilter = 'all' | 'image' | 'document' | 'sheet';

const FILTERS: { id: FileFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'document', label: '文档' },
  { id: 'sheet', label: '表格' },
];

function classifyFile(fileName: string): Exclude<FileFilter, 'all'> {
  const lower = fileName.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(lower)) return 'image';
  if (/\.(xlsx|xls|csv)$/.test(lower)) return 'sheet';
  return 'document';
}

function fileIcon(kind: Exclude<FileFilter, 'all'>) {
  if (kind === 'image') return ImageIcon;
  if (kind === 'sheet') return FileSpreadsheet;
  return FileText;
}

function fileAccent(kind: Exclude<FileFilter, 'all'>) {
  if (kind === 'image') return 'bg-[#E8F3EC] text-[#4F8A6B]';
  if (kind === 'sheet') return 'bg-[#EAF2FB] text-[#5B8FC4]';
  return 'bg-[#F3EEE6] text-[#8B7355]';
}

function formatAddedAt(iso?: string) {
  if (!iso) return '已保存';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '已保存';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function FileLibraryPage() {
  const navigate = useNavigate();
  const recentFiles = useChatStore((s) => s.recentFiles);
  const addRecentFile = useChatStore((s) => s.addRecentFile);
  const removeRecentFile = useChatStore((s) => s.removeRecentFile);
  const useFileInChat = useChatStore((s) => s.useFileInChat);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FileFilter>('all');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingestFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setError(null);
      for (const file of list) {
        if (!isAllowedUploadExtension(file.name)) {
          setError(ALLOWED_UPLOAD_TYPES_MESSAGE);
          continue;
        }
        const attachment: ChatAttachment = {
          fileId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          status: 'ready',
        };
        addRecentFile(attachment);
      }
    },
    [addRecentFile],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recentFiles.filter((file) => {
      const kind = classifyFile(file.fileName);
      if (filter !== 'all' && kind !== filter) return false;
      if (!q) return true;
      return file.fileName.toLowerCase().includes(q);
    });
  }, [recentFiles, filter, query]);

  const handleUseInChat = (file: LibraryFile) => {
    useFileInChat(file);
    navigate('/chat');
  };

  return (
    <PageContainer width="wide" className="min-h-full gap-0 pb-10">
      <div
        className={cn(
          'relative flex min-h-[calc(100vh-5rem)] flex-col rounded-2xl bg-[#F7FAFD] px-4 py-6 sm:px-8',
          dragOver && "ring-2 ring-[#7BA4D4]",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (event.dataTransfer.files?.length) ingestFiles(event.dataTransfer.files);
        }}
      >
        {/* ChatGPT Library 风格顶栏 */}
        <div className="flex flex-col gap-5 border-b border-[#E6EEF6] pb-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">文件库</h1>
              <p className="mt-1 text-sm text-slate-500">
                聊天上传与本机加入的文件会保存在这里，可随时搜索并再次用于对话。
              </p>
            </div>
            <Button
              className="rounded-full bg-[#3B82F6] px-4 hover:bg-[#2563EB]"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-4" />
              上传文件
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={getUploadAcceptAttribute()}
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) ingestFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-sm transition-colors',
                    filter === item.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件名…"
                className="h-9 rounded-full border-[#D7E4F2] bg-white pl-9"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        {/* 文件网格 */}
        <div className="mt-6 flex-1">
          {filtered.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((file) => {
                const kind = classifyFile(file.fileName);
                const Icon = fileIcon(kind);
                return (
                  <article
                    key={file.fileId ?? file.fileName}
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#E6EEF6] bg-white transition-shadow hover:shadow-md"
                  >
                    <div
                      className={cn(
                        'flex h-28 items-center justify-center',
                        kind === 'image' ? 'bg-[#F0F7F3]' : 'bg-[#F8FBFE]',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-14 items-center justify-center rounded-2xl',
                          fileAccent(kind),
                        )}
                      >
                        <Icon className="size-7" strokeWidth={1.5} />
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1 px-3.5 py-3">
                      <h3 className="truncate text-sm font-medium text-slate-800" title={file.fileName}>
                        {file.fileName}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {formatBytes(file.sizeBytes)} · {formatAddedAt(file.addedAt)}
                      </p>
                      <div className="mt-2 flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 flex-1 rounded-full text-xs"
                          onClick={() => handleUseInChat(file)}
                        >
                          <MessageSquarePlus className="size-3.5" />
                          用于对话
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-slate-400 hover:text-destructive"
                          onClick={() => file.fileId && removeRecentFile(file.fileId)}
                          aria-label="删除文件"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-white shadow-sm ring-1 ring-[#E6EEF6]">
                <Upload className="size-7 text-[#7BA4D4]" />
              </div>
              <h2 className="text-base font-medium text-slate-800">
                {recentFiles.length ? '没有匹配的文件' : '文件库还是空的'}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm text-slate-500">
                {recentFiles.length
                  ? '试试换个关键词或筛选条件。'
                  : '在对话中上传附件，或把文件拖到此处，之后就能像 ChatGPT 一样随时复用。'}
              </p>
              {!recentFiles.length ? (
                <Button
                  className="mt-5 rounded-full bg-[#3B82F6] hover:bg-[#2563EB]"
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload className="size-4" />
                  上传第一个文件
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {dragOver ? (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#7BA4D4] bg-[#EAF2FB]/80">
            <p className="text-sm font-medium text-[#3B6FA0]">松开以上传到文件库</p>
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}
