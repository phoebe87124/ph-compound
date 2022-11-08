const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require('chai');

describe("Week11", function(){
  // Deploy CErc20, Comptroller and related contracts
  async function deployFixture() {
    const comptrollerFactory = await ethers.getContractFactory("Comptroller")
    const comptroller = await comptrollerFactory.deploy()
    await comptroller.deployed()
    
    // 需部署一個 CErc20 的 underlying ERC20 token，decimals 為 18
    const erc20Factory = await ethers.getContractFactory("phToken")
    const erc20 = await erc20Factory.deploy(
      ethers.utils.parseUnits("10000000", 18),
      "phToken",
      "PH"
    )
    await erc20.deployed()

    const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel")
    // 將利率模型合約中的借貸利率設定為 0%
    const interestRateModel = await interestRateModelFactory.deploy(
      ethers.utils.parseUnits("0", 18),
      ethers.utils.parseUnits("0", 18),
    )
    await interestRateModel.deployed()

    const cErc20Factory = await ethers.getContractFactory("CErc20")
    const cErc20 = await cErc20Factory.deploy()
    await cErc20.deployed()

    await cErc20["initialize(address,address,address,uint256,string,string,uint8)"](
      erc20.address,
      comptroller.address,
      interestRateModel.address,
      ethers.utils.parseUnits("1", 18),       // 初始 exchangeRate 為 1:1
      "compound phToken",
      "cPH",
      18      // CToken 的 decimals 皆為 18
    )

    const [owner, user] = await ethers.getSigners();

    // 使用 SimplePriceOracle 作為 Oracle
    const simplePriceOracleFactory = await ethers.getContractFactory("SimplePriceOracle")
    const simplePriceOracle = await simplePriceOracleFactory.deploy()
    await simplePriceOracle.deployed()
    await expect(comptroller._setPriceOracle(simplePriceOracle.address))
    .to.emit(comptroller, "NewPriceOracle")

    return { comptroller, erc20, interestRateModel, cErc20, simplePriceOracle, owner, user };
  }

  it ("Should be able to mint/redeem with phToken", async function(){
    const { comptroller, erc20, cErc20, user } = await loadFixture(deployFixture);
    // send user erc20
    await erc20.transfer(user.address, ethers.utils.parseUnits("10000", 18))
    // erc20 approve cErc20 to use
    await erc20.connect(user).approve(cErc20.address, ethers.utils.parseUnits("1000000", 18))

    // error MintComptrollerRejection => markets[cToken].isListed => true
    await expect(comptroller._supportMarket(cErc20.address))
    .to.emit(comptroller, "MarketListed")
    .withArgs(cErc20.address)

    // user use 100 erc20 to mint 100 cErc20
    await expect(cErc20.connect(user).mint(ethers.utils.parseUnits("100", 18)))
    .to.changeTokenBalances(
      cErc20,
      [user.address],
      [ethers.utils.parseUnits("100", 18)]
    );

    await expect(cErc20.connect(user).mint(ethers.utils.parseUnits("100", 18)))
    .to.changeTokenBalances(
      erc20,
      [user.address],
      ["-100000000000000000000"]
    );

    // user use 100 cErc20 to redeem 100 erc20
    await expect(cErc20.connect(user).redeem(ethers.utils.parseUnits("100", 18)))
    .to.changeTokenBalances(
      cErc20,
      [user.address],
      ["-100000000000000000000"]
    );

    await expect(cErc20.connect(user).redeem(ethers.utils.parseUnits("100", 18)))
    .to.changeTokenBalances(
      erc20,
      [user.address],
      [ethers.utils.parseUnits("100", 18)]
    );
  })
})

// 進階(Optional)： 使用 Compound 的 Proxy 合約（CErc20Delegator.sol and Unitroller.sol)