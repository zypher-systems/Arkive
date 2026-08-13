import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canWriteFiles, rangeSelect } from './access.ts';

describe('canWriteFiles', () => {
  it('allows members and owners', () => {
    assert.equal(canWriteFiles({ workspaceRole: 'owner' }), true);
    assert.equal(canWriteFiles({ workspaceRole: 'member' }), true);
    assert.equal(canWriteFiles({ workspaceRole: 'viewer' }), false);
  });

  it('honors shared-folder permission', () => {
    assert.equal(canWriteFiles({ viewKind: 'shared-folder', sharePermission: 'write' }), true);
    assert.equal(canWriteFiles({ viewKind: 'shared-folder', sharePermission: 'read' }), false);
  });
});

describe('rangeSelect', () => {
  it('selects inclusive range', () => {
    assert.deepEqual(rangeSelect(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
    assert.deepEqual(rangeSelect(['a', 'b', 'c'], 'c', 'a'), ['a', 'b', 'c']);
  });

  it('falls back when ids are missing', () => {
    assert.deepEqual(rangeSelect(['a', 'b'], 'x', 'b'), ['b']);
  });
});
