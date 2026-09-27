// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ONEW} from "../src/ONEW.sol";

contract ONEWTest is Test {
    ONEW internal token;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        token = new ONEW();
    }

    function test_fixedSupplyAndMetadata() public view {
        assertEq(token.name(), "Oneway");
        assertEq(token.symbol(), "ONEW");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(this)), token.totalSupply());
    }

    function testFuzz_transferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, token.totalSupply());
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), token.totalSupply() - amount);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }

    function test_allowanceAndTransferFrom() public {
        assertTrue(token.approve(ALICE, 100 ether));
        vm.prank(ALICE);
        assertTrue(token.transferFrom(address(this), BOB, 40 ether));
        assertEq(token.allowance(address(this), ALICE), 60 ether);
        assertEq(token.balanceOf(BOB), 40 ether);
        assertEq(token.balanceOf(address(this)), token.totalSupply() - 40 ether);
    }

    function test_transferFailures() public {
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidReceiver(address)", address(0)));
        token.transfer(address(0), 1);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSignature("ERC20InsufficientBalance(address,uint256,uint256)", ALICE, 0, 1)
        );
        token.transfer(BOB, 1);
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSignature("ERC20InsufficientAllowance(address,uint256,uint256)", ALICE, 0, 1)
        );
        token.transferFrom(address(this), BOB, 1);
    }

    function test_noAdministrativeOrMintEntrypoints() public {
        bytes4[10] memory selectors = [
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("mint(uint256)")),
            bytes4(keccak256("mint()")),
            bytes4(keccak256("issue(uint256)")),
            bytes4(keccak256("setOwner(address)")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("upgradeTo(address)")),
            bytes4(keccak256("initialize(address)")),
            bytes4(keccak256("unpause()")),
            bytes4(keccak256("setMinter(address)"))
        ];
        for (uint256 i; i < selectors.length; ++i) {
            (bool deployerSucceeded,) =
                address(token).call(abi.encodeWithSelector(selectors[i], ALICE, 1 ether));
            assertFalse(deployerSucceeded);
            vm.prank(ALICE);
            (bool attackerSucceeded,) =
                address(token).call(abi.encodeWithSelector(selectors[i], ALICE, 1 ether));
            assertFalse(attackerSucceeded);
        }
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(ALICE), 0);
    }
}
