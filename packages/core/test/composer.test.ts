import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityComposer } from '../src/composer.js';

test('composes requirements into an executable dependency plan', () => {
  const composer = new CapabilityComposer();
  const plan = composer.compose('make report', [
    { capability: 'research.search' },
    { capability: 'document.pdf' }
  ]);
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(composer.topologicalOrder(plan).map(step => step.capability), ['research.search', 'document.pdf']);
});

test('supports reusable composite templates', () => {
  const composer = new CapabilityComposer();
  composer.registerTemplate({
    id: 'book.create',
    description: 'Research and package a book',
    requires: ['topic'],
    produces: ['pdf'],
    steps: [
      { id: 'research', capability: 'research.search' },
      { id: 'write', capability: 'content.write', dependsOn: ['research'] },
      { id: 'pdf', capability: 'document.pdf', dependsOn: ['write'] }
    ]
  });
  const plan = composer.compose('create a book', [], 'book.create');
  assert.deepEqual(composer.topologicalOrder(plan).map(step => step.id), ['research', 'write', 'pdf']);
});

test('rejects dependency cycles', () => {
  const composer = new CapabilityComposer();
  composer.registerTemplate({
    id: 'cycle', description: 'invalid', requires: [], produces: [],
    steps: [
      { id: 'a', capability: 'a', dependsOn: ['b'] },
      { id: 'b', capability: 'b', dependsOn: ['a'] }
    ]
  });
  assert.throws(() => composer.compose('bad', [], 'cycle'), /dependency cycle/);
});
