import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, toHex, type Abi, type Address } from 'viem';
import type { Page } from '@playwright/test';
export const deployment = JSON.parse(readFileSync(new URL('../../dist/imd-deployment.json', import.meta.url), 'utf8'));
export const user: Address = '0x1234567890123456789012345678901234567890';
const u = deployment.network.uniswapV4;
const token = deployment.contracts.find((c: { name: string }) => c.name === 'ONEW');
const hook = deployment.contracts.find((c: { name: string }) => c.name === 'AsymmetricTaxHook');
const abis = new Map<string, Abi>([
  ...deployment.contracts.map((c: { address: string; abiPath: string }) => [c.address, JSON.parse(readFileSync(new URL(`../../dist/${c.abiPath}`, import.meta.url), 'utf8'))]),
  ...Object.entries(deployment.integration.abiPaths).map(([role, path]) => [role === 'router' ? deployment.integration.poolSwapTest : role === 'quoter' ? u.quoter : u.stateView, JSON.parse(readFileSync(new URL(`../../dist/${path}`, import.meta.url), 'utf8'))]),
]);
export const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [deployment.pool.pairedCurrency, token.address, deployment.pool.fee, deployment.pool.tickSpacing, hook.address]));
const block = 11793000n, hash = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const pack = (a: bigint, b: bigint) => BigInt.asIntN(256, (BigInt.asUintN(128, a) << 128n) | BigInt.asUintN(128, b));
export async function mockChain(page: Page, options: { wallet?: boolean; wrongChain?: boolean; rejection?: boolean; codeMissing?: boolean; quoteFail?: boolean; swapFail?: boolean; readFail?: boolean; emptyEvents?: boolean } = {}) {
  const calls: { method: string; params: any[]; wallet: boolean }[] = [];
  let allowance = 0n;
  let chainId = options.wrongChain ? '0x1' : deployment.walletAddChain.chainId;
  let chainAdded = false;
  let lastTx: any;
  const event = (name: string, value: bigint, number: bigint, index: number) => ({ address: hook.address, blockHash: hash, blockNumber: toHex(number), transactionHash: hash,
    transactionIndex: '0x0', logIndex: toHex(index), removed: false,
    topics: encodeEventTopics({ abi: abis.get(hook.address)!, eventName: name, args: { poolId } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [10n ** 17n, value]),
  });
  const respond = (method: string, params: any[], wallet: boolean): any => {
    calls.push({ method, params, wallet });
    if (wallet && method === 'eth_requestAccounts' && options.rejection) throw { code: 4001, message: 'User rejected request' };
    if (method === 'eth_chainId') return wallet ? chainId : deployment.walletAddChain.chainId;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [user];
    if (method === 'wallet_switchEthereumChain') {
      if (!chainAdded && options.wrongChain) throw { code: 4902, message: 'Unknown chain' };
      chainId = params[0].chainId; return null;
    }
    if (method === 'wallet_addEthereumChain') { chainAdded = true; return null; }
    if (options.readFail && !wallet) throw { code: -32000, message: 'Fixture RPC unavailable. Retry reads.' };
    if (method === 'eth_getCode') return options.codeMissing ? '0x' : '0x60006000';
    if (method === 'eth_blockNumber') return toHex(block);
    if (method === 'eth_getBalance') return toHex(10n ** 20n);
    if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
    if (method === 'eth_estimateGas') return '0x33450';
    if (method === 'eth_getLogs') {
      if (options.emptyEvents) return [];
      const p = params[0];
      return [event('BuyBonus', 10n ** 15n, block - 1n, 0), event('SellTaxed', 2n * 10n ** 15n, block - 2n, 1)].filter(e => BigInt(e.blockNumber) >= BigInt(p.fromBlock) && BigInt(e.blockNumber) <= BigInt(p.toBlock));
    }
    if (method === 'eth_call') {
      const tx = params[0], abi = abis.get(tx.to.toLowerCase());
      if (!abi) throw new Error(`Unknown call destination ${tx.to}`);
      const decoded = decodeFunctionData({ abi, data: tx.data });
      const args = decoded.args as any[];
      let result: any;
      switch (decoded.functionName) {
        case 'manager': case 'poolManager': result = u.poolManager; break;
        case 'decimals': result = 18; break;
        case 'balanceOf': result = 100000n * 10n ** 18n; break;
        case 'allowance': result = allowance; break;
        case 'SELL_TAX_BPS': result = 200n; break;
        case 'BUY_BONUS_BPS': result = 100n; break;
        case 'pot': result = 10n ** 16n; break;
        case 'bonusFor': result = args[1] / 100n < 10n ** 16n ? args[1] / 100n : 10n ** 16n; break;
        case 'getSlot0': result = [1000n * (1n << 96n), 138162, 0, 3000]; break;
        case 'quoteExactInputSingle': {
          if (options.quoteFail) throw { code: 3, message: 'execution reverted: quote unavailable' };
          const q = args[0]; result = [q.zeroForOne ? q.exactAmount * 1000000n : q.exactAmount * 98n / 100000000n, 150000n]; break;
        }
        case 'approve': result = true; break;
        case 'swap': {
          if (options.swapFail) throw { code: 3, message: 'execution reverted: PartialFill' };
          const q = args[1], input = -q.amountSpecified;
          result = q.zeroForOne ? pack(-input, input * 1000000n) : pack(input * 98n / 100000000n, -input); break;
        }
        default: throw new Error(`Unhandled call ${decoded.functionName}`);
      }
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result });
    }
    if (method === 'eth_sendTransaction') {
      lastTx = params[0];
      if (lastTx.to.toLowerCase() === token.address) {
        const decoded = decodeFunctionData({ abi: abis.get(token.address)!, data: lastTx.data });
        allowance = decoded.args![1] as bigint;
      }
      return hash;
    }
    if (method === 'eth_getTransactionReceipt') return { transactionHash: hash, transactionIndex: '0x0', blockHash: hash, blockNumber: toHex(block), from: user, to: lastTx?.to || token.address,
      cumulativeGasUsed: '0x33450', gasUsed: '0x33450', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' };
    if (method === 'eth_getTransactionByHash') return { ...lastTx, hash, blockHash: hash, blockNumber: toHex(block), transactionIndex: '0x0', from: user, nonce: '0x0', gas: '0x33450', gasPrice: '0x3b9aca00', value: lastTx?.value || '0x0', input: lastTx?.data || '0x', type: '0x0', v: '0x1', r: hash, s: hash };
    if (method === 'eth_getBlockByNumber') return { number: toHex(block), hash, parentHash: hash, timestamp: '0x60000000', gasLimit: '0x1c9c380', gasUsed: '0x33450', transactions: [], baseFeePerGas: '0x3b9aca00' };
    throw new Error(`Unhandled RPC ${method}`);
  };
  await page.route('https://**/*', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request().postDataJSON();
    const handle = (q: any) => { try { return { jsonrpc: '2.0', id: q.id, result: respond(q.method, q.params || [], route.request().url().includes('wallet.test')) }; } catch (e: any) { return { jsonrpc: '2.0', id: q.id, error: { code: e.code || -32000, message: e.message } }; } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(request) ? request.map(handle) : handle(request)) });
  });
  if (options.wallet !== false) await page.addInitScript(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    (window as any).ethereum = {
      request: async ({ method, params }: any) => {
        const reply = await fetch('https://wallet.test/rpc', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(r => r.json());
        if (reply.error) throw reply.error;
        return reply.result;
      },
      on: (name: string, fn: any) => { (listeners[name] ||= []).push(fn); },
      removeListener: (name: string, fn: any) => { listeners[name] = (listeners[name] || []).filter(x => x !== fn); },
      emit: (name: string, value: any) => { for (const fn of listeners[name] || []) fn(value); },
    };
  });
  return { calls, abis, token, hook };
}
