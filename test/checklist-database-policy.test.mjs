import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../server/database/001_checklist.sql', import.meta.url);

test('allows signed public callbacks to update but not create or delete checklists', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const anonymousPolicies = [...migration.matchAll(
    /CREATE POLICY[\s\S]*?\bTO\s+anon\b[\s\S]*?;/giu,
  )].map((match) => match[0]);

  assert.equal(
    anonymousPolicies.some((policy) => /\bFOR\s+UPDATE\b/iu.test(policy)),
    true,
  );
  assert.equal(
    anonymousPolicies.some((policy) => /\bFOR\s+(?:INSERT|DELETE)\b/iu.test(policy)),
    false,
  );
});
