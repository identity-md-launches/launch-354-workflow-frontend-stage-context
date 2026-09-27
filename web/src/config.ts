import { createPublicClient, custom, defineChain, encodeAbiParameters, fallback, http, keccak256, toHex, type Abi, type Address, type EIP1193Provider } from 'viem';

export type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }
export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: { poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address; positionManager: Address; permit2: Address } };
  walletAddChain: { chainId: `0x${string}`; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
  integration: { routerKind: string; poolSwapTest: Address; abiPaths: { router: string; stateView: string; quoter: string } };
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number; initialPrice: string };
  token: { contract: string; name: string; symbol: string; decimals: number };
  hookContract: string; deploymentBlock: number;
};
export function canonical(value: unknown): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, sorted(item)])) : v;
  return JSON.stringify(sorted(value));
}
const safePath = (path: string) => typeof path === 'string' && /^(?!.*\.\.)(?!\/)[\w./-]+$/.test(path);
async function readJson(path: string) {
  if (!safePath(path)) throw new Error('Unsafe deployment asset path.');
  const response = await fetch(new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Unable to load ${path}. Reload the page to retry.`);
  return response.json();
}
export async function loadConfig() {
  const deployment = await readJson('imd-deployment.json') as Deployment;
  if (deployment.version !== 1 || deployment.chainId !== deployment.network.chainId || BigInt(deployment.walletAddChain.chainId) !== BigInt(deployment.chainId)) throw new Error('Deployment network mismatch. Trading is unavailable.');
  if (!deployment.network.rpcUrls.length || deployment.integration.routerKind !== 'PoolSwapTest') throw new Error('Missing supported network configuration.');
  const contracts = await Promise.all(deployment.contracts.map(async c => {
    const abi = await readJson(c.abiPath) as Abi;
    if (!Array.isArray(abi) || keccak256(toHex(canonical(abi))).slice(2) !== c.abiHash) throw new Error(`ABI verification failed for ${c.name}. Trading is unavailable.`);
    return { ...c, abi: abi as Abi };
  }));
  const token = contracts.find(c => c.name === deployment.token.contract);
  const hook = contracts.find(c => c.name === deployment.hookContract);
  if (!token || !hook || deployment.pool.pairedCurrency !== '0x0000000000000000000000000000000000000000') throw new Error('Unsupported pool configuration.');
  const [router, stateView, quoter] = await Promise.all(['router', 'stateView', 'quoter'].map(role => readJson(deployment.integration.abiPaths[role as 'router' | 'stateView' | 'quoter']))) as Abi[];
  const abis = { router, stateView, quoter };
  const chain = defineChain({ id: deployment.chainId, name: deployment.network.name, nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } }, testnet: deployment.network.testnet,
    blockExplorers: { default: { name: 'Explorer', url: deployment.network.explorer } } });
  const key = { currency0: deployment.pool.pairedCurrency, currency1: token.address, fee: deployment.pool.fee, tickSpacing: deployment.pool.tickSpacing, hooks: hook.address };
  const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], Object.values(key) as [Address, Address, number, number, Address]));
  return { deployment, token, hook, abis, chain, key, poolId };
}
export type Config = Awaited<ReturnType<typeof loadConfig>>;
export function getClient(config: Config, wallet?: Provider) {
  const transports = config.deployment.network.rpcUrls.map(url => http(url, { timeout: 7000, retryCount: 0 }));
  // Only a connected wallet on the configured chain is passed here.
  return createPublicClient({ chain: config.chain, transport: fallback([...transports, ...(wallet ? [custom(wallet, { retryCount: 0 })] : [])], { retryCount: 0 }), pollingInterval: 2000 });
}
export type Client = ReturnType<typeof getClient>;
