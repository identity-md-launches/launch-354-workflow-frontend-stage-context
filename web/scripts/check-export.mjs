import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { inventory, abiHash } from './shared.mjs';
const root = resolve(import.meta.dirname, '../..');
const json = async path => JSON.parse(await readFile(`${root}/${path}`, 'utf8'));
const m = await json('dist/imd-deployment.json');
const h = await json('web/config/deployment.json');
for (const key of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.deepEqual(m[key], h[key]);
assert.deepEqual(m.network, (await json('web/config/network.json')).network);
assert.deepEqual(m.walletAddChain, (await json('web/config/network.json')).walletAddChain);
assert.deepEqual(m.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })), h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));
assert.deepEqual(m.assets, await inventory(`${root}/dist`));
assert(m.assets.some(a => a.path === 'index.html'));
assert(m.assets.length <= 128);
let bytes = (await stat(`${root}/dist/imd-deployment.json`)).size;
for (const a of m.assets) {
  assert(/^(?!.*\.\.)(?!\/)[\w./-]+$/.test(a.path));
  assert(/^[a-f0-9]{64}$/.test(a.sha256));
  bytes += (await stat(`${root}/dist/${a.path}`)).size;
}
for (const c of m.contracts) {
  assert(m.assets.some(a => a.path === c.abiPath));
  assert.equal(abiHash(await json(`dist/${c.abiPath}`)), c.abiHash);
}
assert(bytes < 8 * 1024 * 1024, 'Export must leave room in the complete 8 MiB submission');
console.log(`PASS: exact handoff, network, ABI bindings and all ${m.assets.length} SHA-256 hashes; export ${bytes} bytes.`);
