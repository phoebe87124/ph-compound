const { expect } = require('chai');

describe("Week12", async function(){
  let comptroller, erc20, interestRateModel, cErc20, simplePriceOracle, pUsd, cPUSD
  const mantissa = 10 ** 18

  it("Deploy CErc20, Comptroller and related contracts", async function(){
    const comptrollerFactory = await ethers.getContractFactory("Comptroller")
    comptroller = await comptrollerFactory.deploy()
    await comptroller.deployed()
    
    const erc20Factory = await ethers.getContractFactory("phToken")
    erc20 = await erc20Factory.deploy(ethers.utils.parseUnits("10000000", 18), "phToken", "PH")
    await erc20.deployed()

    const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel")
    interestRateModel = await interestRateModelFactory.deploy(ethers.utils.parseUnits("0", 18), ethers.utils.parseUnits("0", 18),)
    await interestRateModel.deployed()

    const cErc20Factory = await ethers.getContractFactory("CErc20")
    cErc20 = await cErc20Factory.deploy()
    await cErc20.deployed()

    await cErc20["initialize(address,address,address,uint256,string,string,uint8)"](
      erc20.address,
      comptroller.address,
      interestRateModel.address,
      ethers.utils.parseUnits("1", 18),
      "compound phToken",
      "cPH",
      18
    )
  })

  it("Deploy pUSD contract", async function(){
    const usdFactory = await ethers.getContractFactory("phToken")
    pUsd = await usdFactory.deploy(ethers.utils.parseUnits("10000000", 18), "pUSD", "pUSD")
    await pUsd.deployed()

    const cErc20Factory = await ethers.getContractFactory("CErc20")
    cPUSD = await cErc20Factory.deploy()
    await cPUSD.deployed()

    await cPUSD["initialize(address,address,address,uint256,string,string,uint8)"](
      pUsd.address,
      comptroller.address,
      interestRateModel.address,
      ethers.utils.parseUnits("1", 18),
      "compound pUSD",
      "cPUSD",
      18
    )
  })

  it ("set simplePriceOracle as comptroller oracle", async function(){
    const simplePriceOracleFactory = await ethers.getContractFactory("SimplePriceOracle")
    simplePriceOracle = await simplePriceOracleFactory.deploy()
    await simplePriceOracle.deployed()
    await expect(comptroller._setPriceOracle(simplePriceOracle.address))
    .to.emit(comptroller, "NewPriceOracle")
  });

  it ("[owner] mint 10000 erc20 to cErc20", async function(){
    const [owner, user] = await ethers.getSigners();

    await expect(comptroller._supportMarket(cErc20.address))
    .to.emit(comptroller, "MarketListed")
    .withArgs(cErc20.address)

    // [owner] erc20 approve cErc20 to use
    await erc20.approve(cErc20.address, ethers.utils.parseUnits("1000000", 18))

    // [owner] use 10000 erc20 to mint 10000 cErc20
    await cErc20.mint(ethers.utils.parseUnits("10000", 18));
    expect(await cErc20.balanceOf(owner.address))
    .to.equal(ethers.utils.parseUnits("10000", 18))
  })

  it ("[owner] set phToken & pUSD's oracle price", async function(){
    // 在 Oracle 中設定一顆 token A 的價格為 $1，一顆 token B 的價格為 $100
    // await expect(simplePriceOracle.setDirectPrice(erc20.address, 100))
    // .to.emit(simplePriceOracle, "PricePosted")
    // .withArgs(erc20.address, 0, 100, 100)

    // await expect(simplePriceOracle.setDirectPrice(pUsd.address, 1))
    // .to.emit(simplePriceOracle, "PricePosted")
    // .withArgs(pUsd.address, 0, 1, 1)
    
    await expect(simplePriceOracle.setUnderlyingPrice(cErc20.address, 100))
    .to.emit(simplePriceOracle, "PricePosted")
    .withArgs(erc20.address, 0, 100, 100)

    await expect(simplePriceOracle.setUnderlyingPrice(cPUSD.address, 1))
    .to.emit(simplePriceOracle, "PricePosted")
    .withArgs(pUsd.address, 0, 1, 1)
  })

  it ("[owner] set phToken's collateral factor to 50%", async function(){
    // Token B 的 collateral factor 為 50%
    await expect(comptroller._setCollateralFactor(cErc20.address, ethers.utils.parseUnits("0.5", 18)))
    .to.emit(comptroller, "NewCollateralFactor")
    .withArgs(cErc20.address, 0, ethers.utils.parseUnits("0.5", 18))
  })

  it ("[user1] use 1 phToken to mint cPH", async function(){
    const [owner, user1] = await ethers.getSigners();

    // [owner] send user 10000 erc20
    await erc20.transfer(user1.address, ethers.utils.parseUnits("10000", 18))

    // [user1] erc20 approve cErc20 to use
    await erc20.connect(user1).approve(cErc20.address, ethers.utils.parseUnits("1000000", 18))

    // [user1] 使用 1 顆 token B 來 mint cToken => deposit phToken
    await cErc20.connect(user1).mint(ethers.utils.parseUnits("1", 18));
    expect(await cErc20.balanceOf(user1.address))
    .to.equal(ethers.utils.parseUnits("1", 18))
  })

  it ("[user1] use token B as collateral to borrow 50 token A", async function(){
    // User1 使用 token B 作為抵押品來借出 50 顆 token A
    const [owner, user1] = await ethers.getSigners();

    // [owner] list pUsd in market
    await expect(comptroller._supportMarket(cPUSD.address))
    .to.emit(comptroller, "MarketListed")
    .withArgs(cPUSD.address)

    // [owner] deposit 10000 token A
    await pUsd.approve(cPUSD.address, ethers.utils.parseUnits("1000000", 18))
    await cPUSD.mint(ethers.utils.parseUnits("10000", 18));
    expect(await cPUSD.totalSupply())
    .to.equal(ethers.utils.parseUnits("10000", 18))

    // [user1] set token B as collateral
    await expect(comptroller.connect(user1).enterMarkets([cErc20.address]))
    .to.emit(comptroller, "MarketEntered")
    .withArgs(cErc20.address, user1.address)
    
    // [user1] borrow 50 token A(pUSD) (with all collateral)
    await expect(cPUSD.connect(user1).borrow(ethers.utils.parseUnits("50", 18)))
    .to.emit(cPUSD, "Borrow")
    .withArgs(user1.address, ethers.utils.parseUnits("50", 18), ethers.utils.parseUnits("50", 18), ethers.utils.parseUnits("50", 18))

    expect(await pUsd.balanceOf(user1.address))
    .to.equal(ethers.utils.parseUnits("50", 18))

    // [user1] can not be liquidated
    let accountLiquidity = await comptroller.getAccountLiquidity(user1.address)
    expect(accountLiquidity[2])
    .to.equal(ethers.utils.parseUnits("0", 0))
  })

  // it ("[owner] update phToken's collateral factor to 40%", async function(){
  //   const [owner, user1] = await ethers.getSigners();

  //   // 調整 token B 的 collateral factor，讓 user1 被 user2 清算
  //   await expect(comptroller._setCollateralFactor(cErc20.address, ethers.utils.parseUnits("0.4", 18)))
  //   .to.emit(comptroller, "NewCollateralFactor")
  //   .withArgs(cErc20.address, ethers.utils.parseUnits("0.5", 18), ethers.utils.parseUnits("0.4", 18))

  //   // [user1] can be liquidated => shortfail > 0
  //   let accountLiquidity = await comptroller.getAccountLiquidity(user1.address)
  //   expect(accountLiquidity[2])
  //   .to.above(ethers.utils.parseUnits("0", 0))
  // })

  it ("[owner] update phToken's price to 90", async function(){
    const [owner, user1] = await ethers.getSigners();

    // 調整 oracle 中的 token B 的價格，讓 user1 被 user2 清算
    await expect(simplePriceOracle.setUnderlyingPrice(cErc20.address, 90))
    .to.emit(simplePriceOracle, "PricePosted")
    .withArgs(erc20.address, 100, 90, 90)

    // [user1] can be liquidated => shortfail > 0
    let accountLiquidity = await comptroller.getAccountLiquidity(user1.address)
    expect(accountLiquidity[2])
    .to.above(ethers.utils.parseUnits("0", 0))
  })

  it ("[user2] liquidate user1's assets", async function(){
    // 調整 token B 的 collateral factor，讓 user1 被 user2 清算
    const [owner, user1, user2] = await ethers.getSigners();

    // [owner] set close factor to 50%
    await expect(comptroller._setCloseFactor(ethers.utils.parseUnits("0.5", 18)))
    .to.emit(comptroller, "NewCloseFactor")
    .withArgs(0, ethers.utils.parseUnits("0.5", 18))

    // [owner] send user2 10000 pUSD
    await pUsd.transfer(user2.address, ethers.utils.parseUnits("10000", 18))

    // [user2] user2 approve cPUSD to use pUSD for liquidating
    await pUsd.connect(user2).approve(cPUSD.address, ethers.utils.parseUnits("1000000", 18))

    // [owner] set liquidation incentive
    await expect(comptroller._setLiquidationIncentive(ethers.utils.parseUnits("1.1", 18)))
    .to.emit(comptroller, "NewLiquidationIncentive")
    .withArgs(0, ethers.utils.parseUnits("1.1", 18))

    // [user2] liquidate user1
    await expect(cPUSD.connect(user2).liquidateBorrow(user1.address, ethers.utils.parseUnits("25", 18), cErc20.address))
    .to.emit(cPUSD, "LiquidateBorrow")

    // [user2] liquidate user1 => repay 25 pUSD and get cErc20
    expect(await pUsd.balanceOf(user2.address))
    .to.equal(ethers.utils.parseUnits("9975", 18))

    expect(await cErc20.balanceOf(user2.address))
    .to.above(ethers.utils.parseUnits("0", 18))
  })
})