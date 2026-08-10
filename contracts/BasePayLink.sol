// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IERC20{function transferFrom(address from,address to,uint256 amount)external returns(bool);}
contract BasePayLink{
 IERC20 public immutable usdc;
 event Payment(bytes32 indexed linkId,address indexed payer,address indexed recipient,uint256 amount,string memo);
 constructor(address _usdc){usdc=IERC20(_usdc);}
 function pay(bytes32 linkId,address recipient,uint256 amount,string calldata memo)external{
  require(recipient!=address(0),"Invalid recipient"); require(amount>0,"Amount is zero");
  require(usdc.transferFrom(msg.sender,recipient,amount),"USDC transfer failed");
  emit Payment(linkId,msg.sender,recipient,amount,memo);
 }
}