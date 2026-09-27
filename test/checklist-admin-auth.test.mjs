import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Reflector } from '@nestjs/core';

const require = createRequire(import.meta.url);
const { AbilityFactory, AuthZPaasGuard, PermissionService } = require('@lark-apaas/nestjs-authzpaas');
const source = readFileSync(new URL('../server/modules/checklist/checklist.controller.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)((id) => {
  if (id === '../../../shared/api.interface') return { CHECKLIST_ADMIN_ROLE: 'checklist_admin' };
  if (id.startsWith('./')) return {};
  return require(id);
}, module, module.exports);
const { ChecklistController } = module.exports;

for (const [label, roles, allowed] of [
  ['ordinary user', [], false], ['unrelated role', ['editor'], false],
  ['checklist administrator', ['checklist_admin'], true],
]) {
  test(`real platform guard ${allowed ? 'allows' : 'denies'} ${label} on global endpoint`, async () => {
    const service = new PermissionService({}, new AbilityFactory(), {}, {
      getContext: () => ({ userId: 'test-user' }),
    });
    const guard = new AuthZPaasGuard(new Reflector(), service, {
      trace: (_name, callback) => callback({ setAttributes() {}, setAttribute() {} }),
    });
    const request = { headers: {}, protocol: 'https', get: () => 'example.com', userContext: { roles } };
    const context = { switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ChecklistController.prototype.listAdmin, getClass: () => ChecklistController };
    assert.equal(await guard.canActivate(context), allowed);
  });
}
