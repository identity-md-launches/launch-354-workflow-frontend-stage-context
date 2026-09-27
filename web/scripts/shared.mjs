import { keccak256, toHex, parseAbi } from 'viem';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
export const abiHash = abi => keccak256(toHex(canonical(abi))).slice(2);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function inventory(root, prefix = '') {
  const entries = await readdir(`${root}/${prefix}`, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not an export asset: ${path}`);
    if (entry.isDirectory()) result.push(...await inventory(root, `${path}/`));
    else if (path !== 'imd-deployment.json') {
      const bytes = await readFile(`${root}/${path}`);
      if (bytes.length > 8388608) throw new Error(`Asset too large: ${path}`);
      result.push({ path, sha256: sha256(bytes) });
    }
  }
  return result;
}
const key = 'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }';
export const integrationAbis = {
  router: parseAbi([key,
    'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }',
    'struct TestSettings { bool takeClaims; bool settleUsingBurn; }',
    'function manager() view returns (address)',
    'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)',
    'error NoSwapOccurred()',
    'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
    'error PartialFill()',
  ]),
  stateView: parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)']),
  quoter: parseAbi([key,
    'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
    'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
    'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
    'error UnexpectedRevertBytes(bytes revertData)',
    'error PartialFill()',
  ]),
};
