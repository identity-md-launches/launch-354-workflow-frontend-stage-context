import { formatUnits, parseUnits } from 'viem';
export const MAX_INPUT = ((1n << 127n) - 1n) * 100n / 101n;
export function parseAmount(text: string, decimals: number): bigint {
  if (!/^\d+(\.\d*)?$/.test(text) || (text.split('.')[1]?.length || 0) > decimals) throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const result = parseUnits(text, decimals);
  if (result <= 0n || result > MAX_INPUT) throw new Error('Enter an amount greater than zero within the pool’s supported range.');
  return result;
}
export function amount(value: bigint | undefined, decimals = 18, precision = 6) {
  if (value === undefined) return '—';
  const raw = formatUnits(value, decimals);
  const [whole, fraction] = raw.split('.');
  if (value > 0n && Number(raw) < 10 ** -precision) return `<${(10 ** -precision).toFixed(precision)}`;
  return Number(whole).toLocaleString('en-US', { maximumFractionDigits: 0 }) + (fraction ? '.' + fraction.slice(0, precision).replace(/0+$/, '') : '').replace(/\.$/, '');
}
export function integerSqrt(n: bigint) {
  if (n < 0n) throw new Error('Negative square root');
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
export function priceLimit(sqrtPrice: bigint, buy: boolean, bps: number) {
  if (![50, 100, 300].includes(bps)) throw new Error('Choose a supported price movement limit.');
  const limit = integerSqrt(sqrtPrice * sqrtPrice * BigInt(10000 + (buy ? -bps : bps)) / 10000n);
  const min = 4295128739n + 1n;
  const max = 1461446703485210103287273052203988822378723970342n - 1n;
  if (limit <= min || limit >= max || (buy ? limit >= sqrtPrice : limit <= sqrtPrice)) throw new Error('Pool price is outside the supported trading range.');
  return limit;
}
export function poolPrice(sqrtPrice: bigint, tokenDecimals: number) {
  return Number(sqrtPrice * sqrtPrice) / Number(1n << 192n) * 10 ** (18 - tokenDecimals);
}
export function deltaOutput(delta: bigint, buy: boolean) {
  const signed = BigInt.asIntN(256, delta);
  const output = buy ? BigInt.asIntN(128, signed) : BigInt.asIntN(128, signed >> 128n);
  if (output <= 0n) throw new Error('Simulation returned no output. Try a smaller amount.');
  return output;
}
