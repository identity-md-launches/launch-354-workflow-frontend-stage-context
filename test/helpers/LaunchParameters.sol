// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Proposed manifest inputs: the supplied workflow has no numeric price or seed range.
/// @dev The manifest service must match these values or rerun the rehearsal with its final inputs.
library LaunchParameters {
    uint256 internal constant CHAIN_ID = 11155111;
    address internal constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    uint160 internal constant SQRT_PRICE_X96 = 79228162514264337593543950336000;
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -887220;
    int24 internal constant TICK_UPPER = 138120;
    uint256 internal constant TOKEN_SEED = 1_000_000_000 ether;
}
