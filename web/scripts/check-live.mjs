// Read-only validation. This script never connects a wallet or broadcasts a transaction.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, defineChain, http, encodeAbiParameters, keccak256 } from 'viem';
import { errorMessage } from '../src/chain.ts';
const root = resolve(import.meta.dirname, '../..');
const m = JSON.parse(await readFile(`${root}/dist/imd-deployment.json`, 'utf8'));
const abi = async path => JSON.parse(await readFile(`${root}/dist/${path}`, 'utf8'));
const token = m.contracts.find(c => c.name === m.token.contract), hook = m.contracts.find(c => c.name === m.hookContract);
const tokenAbi = await abi(token.abiPath), hookAbi = await abi(hook.abiPath);
const routerAbi = await abi(m.integration.abiPaths.router), stateAbi = await abi(m.integration.abiPaths.stateView), quoterAbi = await abi(m.integration.abiPaths.quoter);
const chain = defineChain({ id: m.chainId, name: m.network.name, nativeCurrency: m.network.nativeCurrency, rpcUrls: { default: { http: m.network.rpcUrls } } });
const key = { currency0: m.pool.pairedCurrency, currency1: token.address, fee: m.pool.fee, tickSpacing: m.pool.tickSpacing, hooks: hook.address };
const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], Object.values(key)));
const results = { checkedAt: new Date().toISOString(), sourceCommit: m.sourceCommit, poolId, noTransactionsBroadcast: true, endpoints: [] };
for (const url of m.network.rpcUrls) {
  const client = createPublicClient({ chain, transport: http(url, { timeout: 9000, retryCount: 0 }) });
  const item = { url };
  try {
    item.chainId = await client.getChainId();
    if (item.chainId !== m.chainId) throw new Error('Wrong RPC chain');
    item.block = await client.getBlockNumber();
    const addresses = [...m.contracts.map(c => ({ name: c.name, address: c.address })), { name: 'PoolManager', address: m.network.uniswapV4.poolManager }, { name: 'StateView', address: m.network.uniswapV4.stateView }, { name: 'Quoter', address: m.network.uniswapV4.quoter }, { name: 'PoolSwapTest', address: m.integration.poolSwapTest }];
    item.code = await Promise.all(addresses.map(async c => ({ ...c, bytes: ((await client.getCode({ address: c.address }))?.length - 2) / 2 })));
    if (item.code.some(c => !(c.bytes > 0))) throw new Error('Missing contract code');
    item.routerManager = await client.readContract({ address: m.integration.poolSwapTest, abi: routerAbi, functionName: 'manager' });
    item.hookManager = await client.readContract({ address: hook.address, abi: hookAbi, functionName: 'poolManager' });
    if ([item.routerManager, item.hookManager].some(a => a.toLowerCase() !== m.network.uniswapV4.poolManager.toLowerCase())) throw new Error('Wrong manager');
    item.slot0 = await client.readContract({ address: m.network.uniswapV4.stateView, abi: stateAbi, functionName: 'getSlot0', args: [poolId] });
    item.pot = await client.readContract({ address: hook.address, abi: hookAbi, functionName: 'pot', args: [poolId] });
    item.decimals = await client.readContract({ address: token.address, abi: tokenAbi, functionName: 'decimals' });
    item.sellTaxBps = await client.readContract({ address: hook.address, abi: hookAbi, functionName: 'SELL_TAX_BPS' });
    item.bonusFor001ETH = await client.readContract({ address: hook.address, abi: hookAbi, functionName: 'bonusFor', args: [poolId, 10n ** 16n] });
    item.quote = {};
    for (const [name, zeroForOne, exactAmount] of [['buy', true, 10n ** 14n], ['sell', false, 10n ** 18n]]) {
      try {
        const q = await client.simulateContract({ address: m.network.uniswapV4.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey: key, zeroForOne, exactAmount, hookData: '0x' }] });
        item.quote[name] = { input: exactAmount, output: q.result[0], gasEstimate: q.result[1] };
      } catch (error) { item.quote[name] = { input: exactAmount, error: error.shortMessage || error.message, decoded: errorMessage(error, { hook: { abi: hookAbi }, token: { abi: tokenAbi }, abis: { router: routerAbi, quoter: quoterAbi } }) }; }
    }
    item.status = 'verified reads';
  } catch (error) { item.status = 'unavailable'; item.error = error.shortMessage || error.message; }
  results.endpoints.push(item);
  console.log(url, item.status);
}
await writeFile(`${root}/docs/frontend/live-read-results.json`, JSON.stringify(results, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
if (!results.endpoints.some(e => e.status === 'verified reads')) process.exitCode = 1;
