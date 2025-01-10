// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";

abstract contract WeekMath {
    
    uint48 public constant WEEK = 1 weeks;
    uint48 constant MIN_TIME = 2 weeks;        // Min lock time is 2 weeks
    uint48 constant MAX_TIME = 208 weeks;      // Max lock time is 4 years (208 weeks)

    function getWeekStart(uint48 timestamp) public pure returns (uint48) {
        return (timestamp / WEEK) * WEEK;
    }

    function getNextWeekStart(uint48 timestamp) public pure returns (uint48) {
        return getWeekStart(timestamp + WEEK);
    }

    function getCurrentWeekStart() public view returns (uint48) {
        return getWeekStart(SafeCast.toUint48(block.timestamp));
    }

    function getCurrentNextWeekStart() public view returns (uint48) {
        return getWeekStart(SafeCast.toUint48(block.timestamp) + WEEK);
    }

    function isValidWeekTime(uint48 time) public pure returns (bool) {
        return time % WEEK == 0;
    }
}
