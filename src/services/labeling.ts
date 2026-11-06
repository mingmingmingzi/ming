import { STORAGE_KEYS, storage } from '@/utils/storage';

export type Page<T> = { items: T[]; nextCursor?: string | null };
export type Label = { id: string; name: string };
export type Spec = { specVersionId: string; versionNo: number; labels: Label[]; instructions: string };
export type Project = { projectId: string; name: string; description?: string; status: string; taskType: string; specVersions?: Spec[] };
export type ImportIssue = { sourcePath: string; code: string; message: string };
export type Batch = { batchId: string; projectId: string; status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED'; chunkSizeBytes: number; receivedBytes: number; sizeBytes: number; originalComplete: boolean; validSampleCount: number; errorCount: number; errors: ImportIssue[]; errorCode?: string | null };
export type Sample = { sampleId: string; projectId?: string; batchId?: string; sourcePath?: string; relativePath?: string; mediaType?: string; contentSha256?: string; fileUrl?: string; metadata?: { width: number; height: number; sizeBytes: number } };
export type Draft = { revision: number; savedAt?: string; result?: { value: { choices: string[] } }[] };
export type AssignmentItem = Sample & { specVersionId?: string; draft?: Draft; readOnly?: boolean; editable?: boolean };
export class LabelingError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const root = '/api/labeling/v1';
export const segment = encodeURIComponent;
export async function labelingRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = storage.get<string>(STORAGE_KEYS.TOKEN);
  if (!token) throw new LabelingError(401, 'UNAUTHENTICATED', '请先登录后使用标注平台');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(root + path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(120000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new LabelingError(response.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `请求失败（${response.status}），请核对接口和代理配置`);
  }
  return response;
}
export async function labelingJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await labelingRequest(path, init);
  const body = await response.json();
  if (!body || !Object.hasOwn(body, 'data')) throw new Error('接口响应不符合约定：缺少 data，请核对标注服务路由');
  return body.data as T;
}
export function post<T>(path: string, body: unknown, key: string): Promise<T> {
  return labelingJson(path, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
export async function sha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('分片校验需要 HTTPS 或 localhost 安全上下文');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Replay recorded chunks as well: the API verifies their hashes without appending.
// This verifies the chosen file's entire prefix without requiring undisclosed metadata.
export async function uploadChunks(batch: Batch, file: File, signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
  if (!Number.isSafeInteger(batch.chunkSizeBytes) || batch.chunkSizeBytes <= 0) throw new Error('服务端未返回有效的 chunkSizeBytes');
  let offset = 0;
  if (!Number.isSafeInteger(batch.receivedBytes) || batch.receivedBytes < 0 || batch.receivedBytes > file.size) throw new Error('服务端上传偏移无效');
  progress(batch.receivedBytes);
  while (offset < file.size) {
    signal.throwIfAborted();
    const chunk = file.slice(offset, offset + batch.chunkSizeBytes);
    const digest = await sha256(chunk);
    const next = await labelingJson<{ receivedBytes: number }>(`/imports/${segment(batch.batchId)}/chunks?offset=${offset}`, {
      method: 'PUT', signal, headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-SHA256': digest }, body: chunk,
    });
    if (!Number.isSafeInteger(next.receivedBytes) || next.receivedBytes < Math.max(batch.receivedBytes, offset + chunk.size) || next.receivedBytes > file.size) throw new Error('服务端分片偏移异常，请重新查询导入状态');
    offset += chunk.size;
    progress(next.receivedBytes);
  }
}
