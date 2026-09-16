import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workspace = await mkdtemp(join(tmpdir(), 'hermeious-'));
process.env.HERMEIOUS_WORKSPACE = workspace;
const { fileReadCapability, fileWriteCapability, fileBrowserCapability, realCapabilities } = await import('../src/real-capabilities.js');

test('real capability manifests include file and provider capabilities', () => {
  const ids = realCapabilities.map(capability => capability.manifest.id);
  assert.deepEqual(ids, [
    'file.read', 'file.write', 'file.list', 'search.web', 'code.execute',
    'document.pdf', 'document.docx', 'document.xlsx', 'image.generate', 'video.generate'
  ]);
});

test('file write and read stay inside workspace', async () => {
  await fileWriteCapability.execute({ path: 'nested.txt', content: 'hello' }, { requestId: 'test', approved: true });
  const result = await fileReadCapability.execute({ path: 'nested.txt' }, { requestId: 'test', approved: true }) as { content: string };
  assert.equal(result.content, 'hello');
  assert.equal(await readFile(join(workspace, 'nested.txt'), 'utf8'), 'hello');
  await assert.rejects(() => fileReadCapability.execute({ path: '../outside.txt' }, { requestId: 'test', approved: true }));
});

test('file browser lists workspace entries', async () => {
  const result = await fileBrowserCapability.execute({ path: '.' }, { requestId: 'test', approved: true }) as Array<{ name: string }>;
  assert.ok(result.some(entry => entry.name === 'nested.txt'));
});

after(async () => { await rm(workspace, { recursive: true, force: true }); });
