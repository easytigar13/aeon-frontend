// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * AeonPairRegistry
 *
 * Emits standard Uniswap-V2-compatible PairCreated events for every AeonDEX pool.
 * On-chain MEV bots and aggregators that scan for PairCreated on Avalanche
 * will discover all pools automatically once registerPairs() is called.
 *
 * Deploy via Remix → call registerPairs() with all pool addresses.
 */
contract AeonPairRegistry {

    // Same event signature as Uniswap V2 factory
    // topic0 = 0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9
    event PairCreated(
        address indexed token0,
        address indexed token1,
        address pair,
        uint256 index
    );

    address public immutable owner;
    address[] public allPairs;
    mapping(address => mapping(address => address)) public getPair;

    constructor() {
        owner = msg.sender;
    }

    /**
     * Register existing pools and emit PairCreated for each.
     * Call once with all pool addresses — bots will index the events.
     */
    function registerPairs(address[] calldata pairs) external {
        require(msg.sender == owner, "only owner");
        for (uint256 i = 0; i < pairs.length; i++) {
            address pair = pairs[i];
            require(pair != address(0), "zero addr");

            address t0 = IPair(pair).token0();
            address t1 = IPair(pair).token1();

            // Skip duplicates (same pair address registered twice)
            if (getPair[t0][t1] == pair) continue;

            allPairs.push(pair);
            getPair[t0][t1] = pair;
            getPair[t1][t0] = pair;

            emit PairCreated(t0, t1, pair, allPairs.length);
        }
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }
}
