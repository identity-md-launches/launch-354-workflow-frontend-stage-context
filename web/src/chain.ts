import { createWalletClient, custom, decodeErrorResult, formatUnits, type Abi, type Address, type Hex } from 'viem';
import type { Client, Config, Provider } from './config';
import { deltaOutput, priceLimit } from './math.ts';

export async function verifyDeployment(client: Client, config: Config) {
  const d = config.deployment, u = d.network.uniswapV4;
  if (await client.getChainId() !== d.chainId) throw new Error('RPC returned the wrong network. Trading is disabled.');
  const addresses = [config.token.address, config.hook.address, u.poolManager, u.stateView, u.quoter, d.integration.poolSwapTest];
  const codes = await Promise.all(addresses.map(address => client.getCode({ address })));
  if (codes.some(code => !code || code === '0x')) throw new Error('A required contract has no code. Trading is disabled.');
  const [manager, hookManager] = await Promise.all([
    client.readContract({ address: d.integration.poolSwapTest, abi: config.abis.router, functionName: 'manager' }),
    client.readContract({ address: config.hook.address, abi: config.hook.abi, functionName: 'poolManager' }),
  ]);
  if ([manager, hookManager].some(address => String(address).toLowerCase() !== u.poolManager.toLowerCase())) throw new Error('PoolManager verification failed. Trading is disabled.');
}
export async function readState(client: Client, config: Config, account?: Address) {
  await verifyDeployment(client, config);
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const hookRead = (functionName: string, args?: readonly unknown[]) => client.readContract({ address: config.hook.address, abi: config.hook.abi, functionName, args, blockNumber: block });
  const tokenRead = (functionName: string, args?: readonly unknown[]) => client.readContract({ address: config.token.address, abi: config.token.abi, functionName, args, blockNumber: block });
  const [pot, decimals, tax, bonusBps, slot, tokenBalance, ethBalance, allowance] = await Promise.all([
    hookRead('pot', [config.poolId]), tokenRead('decimals'), hookRead('SELL_TAX_BPS'), hookRead('BUY_BONUS_BPS'),
    client.readContract({ address: config.deployment.network.uniswapV4.stateView, abi: config.abis.stateView, functionName: 'getSlot0', args: [config.poolId], blockNumber: block }),
    account ? tokenRead('balanceOf', [account]) : undefined,
    account ? client.getBalance({ address: account, blockNumber: block }) : undefined,
    account ? tokenRead('allowance', [account, config.deployment.integration.poolSwapTest]) : undefined,
  ]);
  if (Number(decimals) !== config.deployment.token.decimals || tax !== 200n || bonusBps !== 100n) throw new Error('Contract properties differ from this launch. Trading is disabled.');
  const [sqrtPrice, tick, protocolFee, lpFee] = slot as readonly [bigint, number, number, number];
  if (!sqrtPrice) throw new Error('The pool is not initialized. Trading is disabled.');
  return { block, pot: pot as bigint, decimals: Number(decimals), tax: tax as bigint, bonusBps: bonusBps as bigint, sqrtPrice, tick, protocolFee, lpFee,
    tokenBalance: tokenBalance as bigint | undefined, ethBalance, allowance: allowance as bigint | undefined, updatedAt: Date.now() };
}
export type State = Awaited<ReturnType<typeof readState>>;
export type Activity = { name: string; block: bigint; hash: Hex; index: number; value: bigint; leg: bigint };
export async function readEvents(client: Client, config: Config, block: bigint) {
  const start = block > BigInt(config.deployment.deploymentBlock + 1499) ? block - 1499n : BigInt(config.deployment.deploymentBlock);
  const events: Activity[] = [];
  for (let from = start; from <= block; from += 500n) {
    const logs = await client.getContractEvents({ address: config.hook.address, abi: config.hook.abi,
      fromBlock: from, toBlock: from + 499n < block ? from + 499n : block, strict: true });
    for (const log of logs) {
      const args = log.args as { poolId?: string; tax?: bigint; bonus?: bigint; ethLeg?: bigint; input?: bigint };
      if (args.poolId?.toLowerCase() !== config.poolId.toLowerCase() || !log.blockNumber || !log.transactionHash) continue;
      if (log.eventName !== 'SellTaxed' && log.eventName !== 'BuyBonus') continue;
      events.push({ name: log.eventName, block: log.blockNumber, hash: log.transactionHash, index: log.logIndex, value: args.tax ?? args.bonus ?? 0n, leg: args.ethLeg ?? args.input ?? 0n });
    }
  }
  return { start, end: block, items: events.sort((a, b) => a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1).slice(0, 20) };
}
export async function getQuote(client: Client, config: Config, input: bigint, buy: boolean, bps: number) {
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const [slot, quote, bonus] = await Promise.all([
    client.readContract({ address: config.deployment.network.uniswapV4.stateView, abi: config.abis.stateView, functionName: 'getSlot0', args: [config.poolId], blockNumber: block }),
    client.simulateContract({ address: config.deployment.network.uniswapV4.quoter, abi: config.abis.quoter, functionName: 'quoteExactInputSingle',
      args: [{ poolKey: config.key, zeroForOne: buy, exactAmount: input, hookData: '0x' }], blockNumber: block }),
    buy ? client.readContract({ address: config.hook.address, abi: config.hook.abi, functionName: 'bonusFor', args: [config.poolId, input], blockNumber: block }) : 0n,
  ]);
  const output = (quote.result as readonly [bigint, bigint])[0];
  if (!output) throw new Error('No output available. Try a smaller amount.');
  return { input, buy, bps, output, bonus: bonus as bigint, limit: priceLimit((slot as readonly [bigint])[0], buy, bps), createdAt: Date.now(), block };
}
export type Quote = Awaited<ReturnType<typeof getQuote>>;
export async function switchChain(provider: Provider, config: Config) {
  const chainId = config.deployment.walletAddChain.chainId;
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(e.message || '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [config.deployment.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}
export async function assertWallet(provider: Provider, config: Config, account: Address) {
  const [chain, accounts] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]);
  if (Number(chain) !== config.deployment.chainId || accounts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('Wallet changed. Reconnect and review the swap again.');
}
export async function transact(client: Client, config: Config, provider: Provider, account: Address, quote: Quote, approval: boolean, status: (text: string, hash?: Hex) => void) {
  await assertWallet(provider, config, account);
  if (Date.now() - quote.createdAt > 45000) throw new Error('Quote expired. Refresh the quote and review again.');
  await verifyDeployment(client, config);
  const wallet = createWalletClient({ account, chain: config.chain, transport: custom(provider) });
  status(approval ? 'Simulating token approval…' : 'Simulating swap…');
  const request: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; account: Address; value?: bigint } = approval ? {
    address: config.token.address, abi: config.token.abi, functionName: 'approve',
    args: [config.deployment.integration.poolSwapTest, quote.input], account,
  } : {
    address: config.deployment.integration.poolSwapTest, abi: config.abis.router, functionName: 'swap',
    args: [config.key, { zeroForOne: quote.buy, amountSpecified: -quote.input, sqrtPriceLimitX96: quote.limit }, { takeClaims: false, settleUsingBurn: false }, '0x'],
    value: quote.buy ? quote.input : 0n, account,
  };
  const simulated = await client.simulateContract(request);
  if (!approval) {
    const output = deltaOutput(simulated.result as bigint, quote.buy);
    if (output < quote.output * BigInt(10000 - quote.bps) / 10000n) throw new Error('Output changed since the quote. Refresh the quote and review again.');
  }
  await assertWallet(provider, config, account);
  if (Date.now() - quote.createdAt > 45000) throw new Error('Quote expired during simulation. Refresh and review again.');
  const gas = await client.estimateContractGas(request);
  const gasPrice = await client.getGasPrice();
  const eth = await client.getBalance({ address: account });
  if (eth < (approval || !quote.buy ? 0n : quote.input) + gas * gasPrice * 120n / 100n) throw new Error('Keep more Sepolia ETH available for network gas, then retry.');
  await assertWallet(provider, config, account);
  if (Date.now() - quote.createdAt > 45000) throw new Error('Quote expired while estimating gas. Refresh and review again.');
  status('Confirm the transaction in your wallet…');
  const hash = await wallet.writeContract({ ...simulated.request, chain: config.chain, gas: gas * 120n / 100n });
  status('Transaction submitted. Waiting for confirmation…', hash);
  let replacedWithDifferentTransaction = false;
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180000,
    onReplaced: replacement => {
      replacedWithDifferentTransaction = replacement.reason !== 'repriced';
      status('Transaction replaced. Waiting for confirmation…', replacement.transaction.hash);
    } });
  if (replacedWithDifferentTransaction) throw new Error('The transaction was cancelled or replaced with a different action. Check the explorer before trying again.');
  if (receipt.status !== 'success') throw new Error('Transaction reverted. Refresh the pool and try a smaller amount.');
  status(approval ? `Approval confirmed for ${formatUnits(quote.input, config.deployment.token.decimals)} ONEW. Review the sell next.` : 'Swap confirmed. Pool data is refreshing.', receipt.transactionHash);
}
export function errorMessage(error: unknown, config?: Config) {
  const e = error as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  let message = e.shortMessage || e.message || 'Request failed. Check your connection and retry.';
  if (config) {
    const abi = [...config.hook.abi, ...config.token.abi, ...config.abis.router, ...config.abis.quoter];
    let cause = error as { raw?: Hex; data?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; cause && depth < 8; depth++) {
      let raw = cause.raw || (typeof cause.data === 'string' ? cause.data as Hex : undefined);
      for (let wrapper = 0; raw && wrapper < 6; wrapper++) {
        try {
          const decoded = decodeErrorResult({ abi, data: raw });
          if (decoded.errorName === 'UnexpectedRevertBytes') raw = decoded.args?.[0] as Hex;
          else if (decoded.errorName === 'WrappedError') raw = decoded.args?.[2] as Hex;
          else { message = `Contract reverted: ${decoded.errorName}. Refresh the pool and try a smaller amount.`; raw = undefined; }
        } catch { break; }
      }
      cause = cause.cause as typeof cause;
    }
  }
  if (e.code === 4001 || e.cause?.code === 4001 || /user rejected|user denied/i.test(message)) return 'Request declined in your wallet. Nothing new was submitted. You can try again.';
  if (/PartialFill/.test(message)) return 'The pool would produce a partial fill at its available liquidity or price limit. Try a smaller amount, refresh after liquidity changes, or adjust the limit.';
  return message.length > 450 ? message.slice(0, 450) + '… Refresh and retry.' : message;
}
