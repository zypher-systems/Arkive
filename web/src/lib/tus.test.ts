import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TusError,
  TusUpload,
  encodeMetadata,
  resolveUrl,
  resumeKey,
  type KeyValueStore,
  type TusTransport,
  type TusTransportRequest,
} from './tus.ts';

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

function fakeFile(size: number, name = 'big.bin') {
  const bytes = new Uint8Array(size).map((_, i) => i % 251);
  return { name, size, type: 'application/octet-stream', lastModified: 42, slice: (a: number, b: number) => new Blob([bytes.slice(a, b)]) };
}

type Session = { length: number; offset: number; data: Uint8Array; metadata: string };

/** In-memory tus server with knobs for failure injection. */
function fakeServer(opts: { failPatchOnce?: 'network' | 500 | 409; supported?: boolean } = {}) {
  const sessions = new Map<string, Session>();
  const log: string[] = [];
  let seq = 0;
  let failed = false;
  const headers = (h: Record<string, string>) => (n: string) => h[n] ?? h[n.toLowerCase()] ?? null;
  const transport: TusTransport = async (req: TusTransportRequest) => {
    log.push(`${req.method} ${req.url}`);
    assert.equal(req.headers['Tus-Resumable'], '1.0.0');
    if (req.method === 'POST') {
      if (opts.supported === false) return { status: 404, header: headers({}) };
      const id = `u${++seq}`;
      const length = Number(req.headers['Upload-Length']);
      sessions.set(id, { length, offset: 0, data: new Uint8Array(length), metadata: req.headers['Upload-Metadata'] });
      return { status: 201, header: headers({ Location: `/api/uploads/${id}` }) };
    }
    const id = req.url.split('/').pop()!;
    const s = sessions.get(id);
    if (!s) return { status: 404, header: headers({}) };
    if (req.method === 'HEAD') {
      return { status: 200, header: headers({ 'Upload-Offset': String(s.offset), 'Upload-Length': String(s.length) }) };
    }
    if (req.method === 'DELETE') {
      sessions.delete(id);
      return { status: 204, header: headers({}) };
    }
    if (req.method === 'PATCH') {
      if (opts.failPatchOnce && !failed) {
        failed = true;
        if (opts.failPatchOnce === 'network') throw new TypeError('network down');
        if (opts.failPatchOnce === 409) return { status: 409, header: headers({}) };
        return { status: 500, header: headers({}) };
      }
      const off = Number(req.headers['Upload-Offset']);
      if (off !== s.offset) return { status: 409, header: headers({}) };
      const buf = new Uint8Array(await req.body!.arrayBuffer());
      req.onProgress?.(buf.length);
      s.data.set(buf, off);
      s.offset += buf.length;
      const h: Record<string, string> = { 'Upload-Offset': String(s.offset) };
      if (s.offset === s.length) h['Arkive-Node-Id'] = `node-${id}`;
      return { status: 204, header: headers(h) };
    }
    return { status: 405, header: headers({}) };
  };
  return { transport, sessions, log };
}

const noSleep = async () => {};

describe('tus helpers', () => {
  it('encodes metadata as key + base64(utf8)', () => {
    const enc = encodeMetadata({ filename: 'ünï.txt', parent_id: '', workspace_id: 'w1', skip: undefined });
    const parts = enc.split(',');
    assert.equal(parts.length, 3);
    assert.equal(parts[1], 'parent_id');
    const [key, b64] = parts[0].split(' ');
    assert.equal(key, 'filename');
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'ünï.txt');
  });
  it('builds the contract resume key', () => {
    assert.equal(
      resumeKey({ workspaceId: 'w', parentId: 'p', name: 'a.bin', size: 10, lastModified: 5 }),
      'arkive.tus.w.p.a.bin.10.5',
    );
    assert.equal(resumeKey({ workspaceId: 'w', parentId: null, name: 'a', size: 1 }), 'arkive.tus.w..a.1.0');
  });
  it('resolves relative Location headers', () => {
    assert.equal(resolveUrl('/api/uploads/x', '/api/uploads'), '/api/uploads/x');
    assert.equal(resolveUrl('abc', '/api/uploads/'), '/api/uploads/abc');
    assert.equal(resolveUrl('https://cdn.example/u/1', '/api/uploads'), 'https://cdn.example/u/1');
  });
});

describe('TusUpload', () => {
  it('uploads in chunks and returns the node id', async () => {
    const srv = fakeServer();
    const store = new MemoryStore();
    const file = fakeFile(2500);
    const progress: number[] = [];
    const up = new TusUpload(file, {
      endpoint: '/api/uploads',
      metadata: { workspace_id: 'w', filename: file.name },
      transport: srv.transport,
      chunkSize: 1000,
      storage: store,
      storageKey: 'k',
      onProgress: (sent) => progress.push(sent),
      sleep: noSleep,
    });
    const res = await up.start();
    assert.equal(res.nodeId, 'node-u1');
    assert.equal(up.state, 'done');
    assert.deepEqual(
      srv.log.filter((l) => l.startsWith('PATCH')).length,
      3,
    );
    assert.equal(progress.at(-1), 2500);
    assert.equal(store.getItem('k'), null, 'resume key is cleared on success');
    const s = srv.sessions.get('u1')!;
    assert.deepEqual(Array.from(s.data.slice(0, 5)), [0, 1, 2, 3, 4]);
  });

  it('resumes from a stored session after a "reload"', async () => {
    const srv = fakeServer();
    const store = new MemoryStore();
    const file = fakeFile(3000);
    const opts = {
      endpoint: '/api/uploads',
      metadata: { workspace_id: 'w', filename: file.name },
      transport: srv.transport,
      chunkSize: 1000,
      storage: store,
      storageKey: 'resume',
      sleep: noSleep,
    };
    // First page: abort (without terminating) after the first chunk lands.
    let first: TusUpload | null = null;
    first = new TusUpload(file, {
      ...opts,
      onProgress: (sent) => {
        if (sent >= 1000 && first?.state === 'uploading') void first.abort(false);
      },
    });
    await assert.rejects(first.start(), (e: unknown) => e instanceof TusError && e.code === 'aborted');
    assert.equal(store.getItem('resume'), '/api/uploads/u1');

    // Second page: a fresh instance finds the key, HEADs, continues.
    const second = new TusUpload(file, opts);
    const res = await second.start();
    assert.equal(second.resumed, true);
    assert.equal(res.nodeId, 'node-u1');
    assert.equal(srv.log.filter((l) => l.startsWith('POST')).length, 1, 'no second session created');
    assert.ok(srv.log.includes('HEAD /api/uploads/u1'));
  });

  it('starts over when the stored session expired', async () => {
    const srv = fakeServer();
    const store = new MemoryStore();
    store.setItem('k', '/api/uploads/gone');
    const up = new TusUpload(fakeFile(10), {
      endpoint: '/api/uploads',
      metadata: {},
      transport: srv.transport,
      storage: store,
      storageKey: 'k',
      sleep: noSleep,
    });
    const res = await up.start();
    assert.equal(res.nodeId, 'node-u1');
    assert.equal(up.resumed, false);
  });

  it('retries after a network error and a 500, resyncing the offset', async () => {
    for (const fail of ['network', 500, 409] as const) {
      const srv = fakeServer({ failPatchOnce: fail });
      const up = new TusUpload(fakeFile(1500), {
        endpoint: '/api/uploads',
        metadata: {},
        transport: srv.transport,
        chunkSize: 1000,
        sleep: noSleep,
      });
      const res = await up.start();
      assert.equal(res.nodeId, 'node-u1', `recovered from ${fail}`);
    }
  });

  it('reports unsupported servers so callers can fall back', async () => {
    const srv = fakeServer({ supported: false });
    const up = new TusUpload(fakeFile(10), { endpoint: '/api/uploads', metadata: {}, transport: srv.transport });
    await assert.rejects(up.start(), (e: unknown) => e instanceof TusError && e.code === 'unsupported');
  });

  it('terminates the remote session on abort', async () => {
    const srv = fakeServer();
    const store = new MemoryStore();
    let up: TusUpload | null = null;
    up = new TusUpload(fakeFile(3000), {
      endpoint: '/api/uploads',
      metadata: {},
      transport: srv.transport,
      chunkSize: 1000,
      storage: store,
      storageKey: 'k',
      onProgress: (sent) => {
        if (sent >= 1000 && up?.state === 'uploading') void up.abort(true);
      },
    });
    await assert.rejects(up.start());
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(srv.log.includes('DELETE /api/uploads/u1'));
    assert.equal(srv.sessions.size, 0);
    assert.equal(store.getItem('k'), null);
  });
});
