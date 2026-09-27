import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { abiHash, inventory, integrationAbis } from './shared.mjs';
const root = resolve(import.meta.dirname, '../..');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const handoff = await read('web/config/deployment.json');
const { network, walletAddChain } = await read('web/config/network.json');
const integration = await read('web/config/integration.json');
if (handoff.chainId !== network.chainId || BigInt(walletAddChain.chainId) !== BigInt(handoff.chainId)) throw new Error('Chain IDs disagree');
if (!/^[a-f0-9]{40}$/.test(handoff.sourceCommit)) throw new Error('Invalid source commit');
await mkdir(`${root}/dist/abi`, { recursive: true });
const contracts = [];
for (const { name, address, abiHash: expected } of handoff.contracts) {
  if (!/^\w+$/.test(name)) throw new Error('Invalid contract name');
  const bytes = execFileSync('git', ['show', `${handoff.sourceCommit}:docs/abi/${name}.json`], { cwd: root });
  const abi = JSON.parse(bytes);
  if (!Array.isArray(abi) || abiHash(abi) !== expected) throw new Error(`Pinned ABI hash mismatch: ${name}`);
  const current = await read(`docs/abi/${name}.json`);
  if (abiHash(current) !== expected) throw new Error(`Working ABI differs from pinned source: ${name}`);
  const abiPath = `abi/${name}.json`;
  await writeFile(`${root}/dist/${abiPath}`, bytes);
  contracts.push({ name, address, abiHash: expected, abiPath });
  console.log(`Verified ${name}: ${expected}`);
}
for (const [name, abi] of Object.entries(integrationAbis)) await writeFile(`${root}/dist/${integration.abiPaths[name]}`, JSON.stringify(abi, null, 2) + '\n');
const manifest = {
  version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, network, walletAddChain, integration,
  pool: handoff.manifest.pool,
  token: handoff.manifest.token,
  hookContract: handoff.manifest.hook.contract,
  deploymentBlock: Math.min(...handoff.contracts.map(c => c.blockNumber)),
  assets: await inventory(`${root}/dist`),
};
if (manifest.assets.length > 128) throw new Error('Too many assets');
await writeFile(`${root}/dist/imd-deployment.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Deployment manifest written: ${manifest.assets.length} assets`);
