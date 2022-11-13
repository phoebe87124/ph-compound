pragma solidity ^0.8.17;

import "./base/FlashLoanReceiverBase.sol";
import "./interfaces/ILendingPoolAddressesProvider.sol";
import "./interfaces/ILendingPool.sol";
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {CErc20} from '../CErc20.sol';
// uniswap related
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';

contract Flashloan is FlashLoanReceiverBase, Ownable {
    constructor(address _addressProvider) FlashLoanReceiverBase(ILendingPoolAddressesProvider(_addressProvider)) public {}

    function executeOperation(
      address[] calldata assets,
      uint256[] calldata amounts,
      uint256[] calldata premiums,
      address initiator,
      bytes calldata params
    ) external override returns (bool){
      // any logic with funds

      uint amountOwed = amounts[0] + premiums[0];
      IERC20 TOKEN = IERC20(assets[0]);
      TOKEN.approve(address(LENDING_POOL), amountOwed);

      // ==================== liquidate logic ====================
      // get compound liquidate params
      (
        address cTokenAddress,
        address borrower,
        address seizeTokenAddress,
        address seizeUnderlyingTokenAddress,
        address swapAddress
      ) = abi.decode(params, (address, address, address, address, address));

      // approve cUSDC to use USDC for liquidating
      TOKEN.approve(cTokenAddress, amountOwed);

      // liquidate user1 get cUNI
      {
        CErc20 cTOKEN = CErc20(seizeTokenAddress);
        CErc20(cTokenAddress).liquidateBorrow(borrower, amounts[0], cTOKEN);
        
        // swap cUNI to UNI
        cTOKEN.redeem(cTOKEN.balanceOf(address(this)));
      }
    
      uint uniAmount = IERC20(seizeUnderlyingTokenAddress).balanceOf(address(this));

      // approve uniswap to use UNI
      IERC20(seizeUnderlyingTokenAddress).approve(swapAddress, uniAmount);

      // swap UNI to USDC
      {
        uint256 amountOut = ISwapRouter(swapAddress).exactInputSingle(
          ISwapRouter.ExactInputSingleParams({
            tokenIn: seizeUnderlyingTokenAddress,
            tokenOut: assets[0],
            fee: 3000, // 0.3%
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: uniAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
          }
        ));

        require(amountOut > amountOwed, "unbeneficial transaction");
      }
      return true;
    }

    function requestFlashloan(address _token, uint _amount, bytes calldata params) public {
      address[] memory assets = new address[](1);
      uint256[] memory amounts = new uint256[](1);
      uint256[] memory modes = new uint256[](1);
      address receiverAddress = address(this);
      assets[0] = _token;
      amounts[0] = _amount;
      modes[0] = 0;
      address onBehalfOf = address(this);
      uint16 referralCode = 0;

      IERC20(_token).approve(address(LENDING_POOL), _amount);
      LENDING_POOL.flashLoan(
        receiverAddress,
        assets,
        amounts,
        modes,
        onBehalfOf,
        params,
        referralCode
      );
    }

    function getBalance(address _tokenAddress) external view returns (uint256) {
      return IERC20(_tokenAddress).balanceOf(address(this));
    }

    function withdraw(address _tokenAddress) external onlyOwner {
      IERC20 token = IERC20(_tokenAddress);
      token.transfer(msg.sender, token.balanceOf(address(this)));
    }

    receive() external payable {}
}