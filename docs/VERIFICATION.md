# Local verification record

Verified with Foundry 1.8.3 and the configured Solidity 0.8.26 compiler. These are contributor-run checks, not an independent review or admission result.

| Check | Result |
| --- | --- |
| `forge build` | Passed |
| `forge test --threads 4 -vv` | 44 reported tests passed; zero failures or skips |
| Stateful accounting and supply invariants | 128 sequences, depth 64; 8,192 handler calls, zero reverts or discarded calls |
| Fuzz tests | 256 runs per test |
| `forge fmt --check` | Passed |
| Exported ABI versus compiled artifact | Exact JSON-array equality for both contracts |
| ONEW runtime size | 1,722 bytes |
| AsymmetricTaxHook runtime size | 3,198 bytes |

Foundry's build lint emits cast and event-after-external-call warnings. The casts are bounded by the explicit signed-amount checks, fractional rates and core's nonnegative sell-output leg. The external calls preceding events are the immutable PoolManager's `mint` and `burn`, neither of which invokes user code. Runtime opcode tests cover both contracts and exclude SELFDESTRUCT, DELEGATECALL and CALLCODE outside PUSH data.

The protected input files were read as the acceptance floor. This repository's corresponding tests cover constructor permissions, unauthorized before/after callbacks, ERC-20 supply and transfer behavior, lack of privileged entrypoints and runtime opcodes without reading test environment variables. The service-owned protected harness itself was not run with fabricated attestation inputs.

The launch tests use an actual freshly deployed manager, mined hook address and factory-owned one-sided position. They verify a manager with zero native ETH before its first buy. The provided material does not include a final manifest or factory source, so the parameter assumptions in `DEPLOYMENT.md` remain part of the handoff. No remote fork, production deployment or independent adversarial review was performed by this source assignment.
