import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
const { stripTypeScriptTypes } = nodeModule;

// Runs without app dependencies; replace only the application's token storage.
const source = readFileSync(new URL('./labeling.ts', import.meta.url), 'utf8')
  .replace("import { STORAGE_KEYS, storage } from '@/utils/storage';", "const STORAGE_KEYS = { TOKEN: 'token' }; const storage = { get: () => 'test-token' };");
const api = stripTypeScriptTypes ? await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`) : null;
const originalFetch = globalThis.fetch;
test('labeling transport and upload contract', { skip: !api && 'Run with Node 22.13+ or 24 for built-in TypeScript transform' }, async t => {
  t.after(() => { globalThis.fetch = originalFetch; });
  await t.test('preserves envelope, bearer auth and idempotency key', async () => {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/labeling/v1/projects');
      assert.equal(init.headers.get('Authorization'), 'Bearer test-token');
      assert.equal(init.headers.get('Idempotency-Key'), 'stable-key');
      return Response.json({ data: { projectId: 'p1' }, requestId: 'r1' });
    };
    assert.deepEqual(await api.post('/projects', { name: 'demo' }, 'stable-key'), { projectId: 'p1' });
  });
  await t.test('rejects HTML proxy responses and revision conflicts', async () => {
    globalThis.fetch = async () => Response.json({ success: true });
    await assert.rejects(api.labelingJson('/me'), /缺少 data/);
    globalThis.fetch = async () => Response.json({ error: { code: 'REVISION_CONFLICT', message: '版本冲突' } }, { status: 409 });
    await assert.rejects(api.labelingJson('/me'), error => error.code === 'REVISION_CONFLICT' && error.status === 409);
  });
  await t.test('uploads ordered chunks with hashes and validates returned offsets', async () => {
    const file = new File(['abcde'], 'images.zip'); const offsets = []; const progress = [];
    globalThis.fetch = async (url, init) => {
      offsets.push(Number(new URL(url, 'http://localhost').searchParams.get('offset')));
      assert.equal(init.headers.get('X-Chunk-SHA256'), await api.sha256(init.body));
      return Response.json({ data: { receivedBytes: offsets.at(-1) + init.body.size } });
    };
    await api.uploadChunks({ batchId: 'b1', receivedBytes: 0, chunkSizeBytes: 2 }, file, new AbortController().signal, n => progress.push(n));
    assert.deepEqual(offsets, [0, 2, 4]); assert.deepEqual(progress, [0, 2, 4, 5]);
    globalThis.fetch = async () => Response.json({ data: { receivedBytes: 0 } });
    await assert.rejects(api.uploadChunks({ batchId: 'b1', receivedBytes: 0, chunkSizeBytes: 2 }, file, new AbortController().signal, () => {}), /偏移异常/);
  });
  await t.test('complete and retry send no JSON body', async () => {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.body, undefined);
      assert.equal(init.headers.has('Content-Type'), false);
      assert.equal(init.headers.get('Idempotency-Key'), 'empty-post-key');
      return Response.json({ data: { status: 'PROCESSING' } });
    };
    await api.post('/imports/b1/complete', undefined, 'empty-post-key');
    await api.post('/imports/b1/retry', undefined, 'empty-post-key');
  });
  await t.test('resume verifies every persisted chunk even when replay returns current total', async () => {
    const file = new File(['abcdef'], 'images.zip'); const offsets = [];
    globalThis.fetch = async (url, init) => {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      offsets.push(offset);
      assert.equal(init.headers.get('X-Chunk-SHA256'), await api.sha256(file.slice(offset, offset + 2)));
      return Response.json({ data: { receivedBytes: Math.max(4, offset + init.body.size) } });
    };
    await api.uploadChunks({ batchId: 'b1', receivedBytes: 4, chunkSizeBytes: 2 }, file, new AbortController().signal, () => {});
    assert.deepEqual(offsets, [0, 2, 4]);
  });
  await t.test('wrong resume file stops on server upload conflict', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: { code: 'UPLOAD_CONFLICT', message: '分片与原文件不符' } }, { status: 409 });
    };
    await assert.rejects(api.uploadChunks({ batchId: 'b1', receivedBytes: 2, chunkSizeBytes: 2 }, new File(['wrong'], 'wrong.zip'), new AbortController().signal, () => {}), error => error.code === 'UPLOAD_CONFLICT');
    assert.equal(calls, 1);
  });
  await t.test('aborted upload never sends another chunk', async () => {
    const abort = new AbortController(); abort.abort();
    globalThis.fetch = async () => { throw new Error('must not fetch'); };
    await assert.rejects(api.uploadChunks({ batchId: 'b1', receivedBytes: 0, chunkSizeBytes: 2 }, new File(['abc'], 'a.zip'), abort.signal, () => {}), { name: 'AbortError' });
  });
});
