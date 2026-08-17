/** Browser-safe stub for node:fs used by Vite when bundling @aw/data-engine. */

type WriteSink = (path: string, data: Uint8Array | string) => void;

let writeSink: WriteSink | null = null;

export function __setFsWriteSink(sink: WriteSink | null): void {
  writeSink = sink;
}

export function readFileSync(path: string, encoding?: BufferEncoding): Buffer | string {
  void encoding;
  throw new Error(
    `浏览器模式无法直接读取本地路径：${path}。请通过文件选择器加载文件内容。`,
  );
}

export function writeFileSync(path: string, data: string | Uint8Array | Buffer): void {
  if (writeSink) {
    const bytes =
      typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    writeSink(path, bytes);
    return;
  }
  throw new Error(`浏览器模式无法写入本地路径：${path}`);
}

export function mkdirSync(_path: string, _options?: { recursive?: boolean }): void {
  // no-op in browser; capture sink handles outputs
}

export function existsSync(_path: string): boolean {
  return false;
}

export function renameSync(_oldPath: string, _newPath: string): void {
  throw new Error('浏览器模式不支持 renameSync');
}

export default {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
};
