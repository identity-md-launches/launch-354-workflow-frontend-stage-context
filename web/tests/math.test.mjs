import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, priceLimit, deltaOutput, integerSqrt, MAX_INPUT } from '../src/math.ts';
import { readFile } from 'node:fs/promises';
import { abiHash } from '../scripts/shared.mjs';

test('Amounts reject zero, exponent, negatives and excessive precision without rounding', () => {
  for (const input of ['0', '-1', '1e18', 'NaN', '1.0000000000000000001', ' 1', '.5']) assert.throws(() => parseAmount(input, 18));
  assert.equal(parseAmount('0.000000000000000001', 18), 1n);
  assert.equal(parseAmount('123.450', 3), 123450n);
  assert.throws(() => parseAmount((MAX_INPUT + 1n).toString(), 0));
});
test('Price limits bound actual squared prices and always move in the swap direction', () => {
  for (const bps of [50, 100, 300]) {
    const sqrt = 1000n * (1n << 96n);
    const buy = priceLimit(sqrt, true, bps), sell = priceLimit(sqrt, false, bps);
    assert(buy < sqrt && sell > sqrt);
    const buyTarget = sqrt * sqrt * BigInt(10000 - bps) / 10000n;
    assert(buy * buy <= buyTarget && (buy + 1n) * (buy + 1n) > buyTarget);
    assert.throws(() => priceLimit(1n, true, bps));
  }
  assert.throws(() => priceLimit(1000n * (1n << 96n), true, 9999));
});
test('Packed signed balance deltas decode the correct output leg', () => {
  const pack = (a, b) => BigInt.asIntN(256, (BigInt.asUintN(128, a) << 128n) | BigInt.asUintN(128, b));
  assert.equal(deltaOutput(pack(-100n, 10100n), true), 10100n);
  assert.equal(deltaOutput(pack(98n, -10000n), false), 98n);
  assert.throws(() => deltaOutput(pack(-100n, 0n), true));
  assert.equal(integerSqrt(10n ** 70n), 10n ** 35n);
});
test('Both exported ABIs bind to the handoff; tampering changes the canonical hash', async () => {
  const handoff = JSON.parse(await readFile(new URL('../config/deployment.json', import.meta.url), 'utf8'));
  for (const contract of handoff.contracts) {
    const abi = JSON.parse(await readFile(new URL(`../../dist/abi/${contract.name}.json`, import.meta.url), 'utf8'));
    assert.equal(abiHash(abi), contract.abiHash);
    assert.notEqual(abiHash([...abi, { type: 'error', name: 'Tampered', inputs: [] }]), contract.abiHash);
  }
});

test('nested quoter and PoolManager revert bytes expose the actionable hook error', async () => {
  const { errorMessage } = await import('../src/chain.ts');
  const { encodeErrorResult } = await import('viem');
  const { integrationAbis } = await import('../scripts/shared.mjs');
  const hook = JSON.parse(await readFile(new URL('../../docs/abi/AsymmetricTaxHook.json', import.meta.url), 'utf8'));
  const partial = encodeErrorResult({ abi: hook, errorName: 'PartialFill' });
  const wrapped = encodeErrorResult({ abi: integrationAbis.router, errorName: 'WrappedError', args: ['0x0000000000000000000000000000000000000001', '0x00000000', partial, '0x'] });
  const quoter = encodeErrorResult({ abi: integrationAbis.quoter, errorName: 'UnexpectedRevertBytes', args: [wrapped] });
  const config = { hook: { abi: hook }, token: { abi: [] }, abis: integrationAbis };
  assert.match(errorMessage({ shortMessage: 'The contract function reverted.', cause: { raw: quoter } }, config), /partial fill/);
});
