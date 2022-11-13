const { expect } = require('chai');
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const UNI_ABI = require("../abi/uni");
const USDC_ABI = require("../abi/usdc");

describe("Week12", function(){
  const UNI_ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const BINANCE_WALLET = '0x28C6c06298d514Db089934071355E5743bf21d60'
  const AAVE_LENDING_POOL_ADDRESS = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9'
  const AAVE_LENDING_POOL_PROVIDER_ADDRESS = '0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5'
  const SWAP_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'

  const CLOSE_FACTOR = ethers.utils.parseUnits("0.5", 18)
  const COLLATERAL_FACTOR = ethers.utils.parseUnits("0.5", 18)
  const LIQUIDATION_INCENTIVE = ethers.utils.parseUnits("1.1", 18)
  const UNI_PRICE = ethers.utils.parseUnits("10", 18)
  const USDC_PRICE = ethers.utils.parseUnits("1", 18 + 12)
  const MANTISSA = 10 ** 18

  const DEPOSIT_UNI_AMOUNT = ethers.utils.parseUnits("1000", 18)
  const BORROW_USDC_AMOUNT = ethers.utils.parseUnits("5000", 6)

  async function setup(){
    // ============================ compound ============================
    // Deploy CErc20, Comptroller and related contracts
    const comptrollerFactory = await ethers.getContractFactory("Comptroller")
    const comptroller = await comptrollerFactory.deploy()
    await comptroller.deployed()

    const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel")
    const interestRateModel = await interestRateModelFactory.deploy(ethers.utils.parseUnits("0", 18), ethers.utils.parseUnits("0", 18),)
    await interestRateModel.deployed()

    const cErc20Factory = await ethers.getContractFactory("CErc20")

    // deploy cUNI
    const cUNI = await cErc20Factory.deploy()
    await cUNI.deployed()
    await cUNI["initialize(address,address,address,uint256,string,string,uint8)"](
      UNI_ADDRESS,
      comptroller.address,
      interestRateModel.address,
      ethers.utils.parseUnits("1", 18),
      "compound UNI",
      "cUNI",
      18
    )

    // deploy cUSDC
    const cUSDC = await cErc20Factory.deploy()
    await cUSDC.deployed()
    await cUSDC["initialize(address,address,address,uint256,string,string,uint8)"](
      USDC_ADDRESS,
      comptroller.address,
      interestRateModel.address,
      ethers.utils.parseUnits('0.000000000001', 18), // 10 ** (6 - 18)
      "compound USDC",
      "cUSDC",
      18
    )

    // set simplePriceOracle as comptroller oracle
    const simplePriceOracleFactory = await ethers.getContractFactory("SimplePriceOracle")
    const simplePriceOracle = await simplePriceOracleFactory.deploy()
    await simplePriceOracle.deployed()
    await expect(comptroller._setPriceOracle(simplePriceOracle.address))
    .to.emit(comptroller, "NewPriceOracle")

    // set close factor to 50%
    await expect(comptroller._setCloseFactor(CLOSE_FACTOR))
    .to.emit(comptroller, "NewCloseFactor")
    .withArgs(0, CLOSE_FACTOR)

    // set liquidation incentive to 10%
    await expect(comptroller._setLiquidationIncentive(LIQUIDATION_INCENTIVE))
    .to.emit(comptroller, "NewLiquidationIncentive")
    .withArgs(0, LIQUIDATION_INCENTIVE)

    // set UNI & USDC price
    await expect(simplePriceOracle.setUnderlyingPrice(cUNI.address, UNI_PRICE))
    .to.emit(simplePriceOracle, "PricePosted")
    .withArgs(UNI_ADDRESS, 0, UNI_PRICE, UNI_PRICE)

    await expect(simplePriceOracle.setUnderlyingPrice(cUSDC.address, USDC_PRICE))
    .to.emit(simplePriceOracle, "PricePosted")
    .withArgs(USDC_ADDRESS, 0, USDC_PRICE, USDC_PRICE)
    
    // support market
    await expect(comptroller._supportMarket(cUNI.address))
    .to.emit(comptroller, "MarketListed")
    .withArgs(cUNI.address)

    await expect(comptroller._supportMarket(cUSDC.address))
    .to.emit(comptroller, "MarketListed")
    .withArgs(cUSDC.address)
    
    // set UNI's collateral factor to 50%
    await expect(comptroller._setCollateralFactor(cUNI.address, COLLATERAL_FACTOR))
    .to.emit(comptroller, "NewCollateralFactor")
    .withArgs(cUNI.address, 0, COLLATERAL_FACTOR)

    // get UNI & USDC contract instance
    const uni = await ethers.getContractAt(UNI_ABI, UNI_ADDRESS);
    const usdc = await ethers.getContractAt(USDC_ABI, USDC_ADDRESS);


    // ============================ aave ============================
    // Deploy related contracts
    const lendingPool = await ethers.getContractAt("ILendingPool", AAVE_LENDING_POOL_ADDRESS);

    const flashloanFactory = await ethers.getContractFactory("Flashloan")
    const flashloan = await flashloanFactory.deploy(AAVE_LENDING_POOL_PROVIDER_ADDRESS)
    await flashloan.deployed()


    // ============================ other ============================
    // get account
    const [owner, user1, user2] = await ethers.getSigners();
    return { comptroller, interestRateModel, simplePriceOracle, cUNI, cUSDC, uni, usdc, lendingPool, flashloan, owner, user1, user2 };
  }

  describe("use AAVE's flash loan to liquidate user1", function(){
    // 將 UNI 價格改為 $6.2 使 User1 產生 Shortfall，並讓 User2 透過 AAVE 的 Flash loan 來清算 User1
    // 可以自行檢查清算 50% 後是不是大約可以賺 121 USD
    // 在合約中如需將 UNI 換成 USDC 可以使用以下程式碼片段：
    var COMTROLLER, SIMPLE_PRICE_ORACLE, UNI, CUNI, USDC, CUSDC, LENDING_POOL, FLASHLOAN, OWNER, USER1, USER2
    before(async () => {
      console.log('================ before each ================')
      const { comptroller, simplePriceOracle, uni, cUNI, usdc, cUSDC, lendingPool, flashloan, owner, user1, user2 } = await loadFixture(setup);
      const binanceSigner = await ethers.getImpersonatedSigner(BINANCE_WALLET)

      const TRANSFER_AMOUNT_UNI = ethers.utils.parseUnits("2000", 18)
      const TRANSFER_AMOUNT_USDC = ethers.utils.parseUnits("20000", 6)
      
      // ============================ compound ============================
      // [user1] get 2000 UNI
      await expect(uni.connect(binanceSigner).transfer(user1.address, TRANSFER_AMOUNT_UNI))
      .to.changeTokenBalances(
        uni,
        [user1.address],
        [TRANSFER_AMOUNT_UNI]
      );

      // [owner] get 20000 USDC
      await expect(usdc.connect(binanceSigner).transfer(owner.address, TRANSFER_AMOUNT_USDC))
      .to.changeTokenBalances(
        usdc,
        [owner.address],
        [TRANSFER_AMOUNT_USDC]
      );

      // [owner] deposit 10000 USDC into market
      // - USDC approve cUSDC to use
      await usdc.approve(cUSDC.address, TRANSFER_AMOUNT_USDC)
      // - use 10000 USDC to mint 10000 cUSDC
      await cUSDC.mint(ethers.utils.parseUnits("10000", 6));
      expect(await cUSDC.balanceOf(owner.address))
      .to.equal(ethers.utils.parseUnits("10000", 18))

      // [user2] get 20000 USDC
      await expect(usdc.connect(binanceSigner).transfer(user2.address, TRANSFER_AMOUNT_USDC))
      .to.changeTokenBalances(
        usdc,
        [user2.address],
        [TRANSFER_AMOUNT_USDC]
      );


      // ============================ aave ============================
      // deposit 10000 USDC to aave pool
      await usdc.approve(lendingPool.address, TRANSFER_AMOUNT_USDC)
      await usdc.approve(flashloan.address, TRANSFER_AMOUNT_USDC)

      UNI = uni
      CUNI = cUNI
      USDC = usdc
      CUSDC = cUSDC
      OWNER = owner
      USER1 = user1
      USER2 = user2
      COMTROLLER = comptroller
      SIMPLE_PRICE_ORACLE = simplePriceOracle
      LENDING_POOL = lendingPool
      FLASHLOAN = flashloan
    });

    it("user1 borrow 5000 USDC with 1000 UNI as collateral", async function(){
      // [user1] deposit 1000 UNI
      // - UNI approve cUNI to use
      await UNI.connect(USER1).approve(CUNI.address, DEPOSIT_UNI_AMOUNT)
      // - deposit UNI
      await CUNI.connect(USER1).mint(DEPOSIT_UNI_AMOUNT);
      expect(await CUNI.balanceOf(USER1.address))
      .to.equal(DEPOSIT_UNI_AMOUNT)
      
      // [user1] set UNI as collateral
      await expect(COMTROLLER.connect(USER1).enterMarkets([CUNI.address]))
      .to.emit(COMTROLLER, "MarketEntered")
      .withArgs(CUNI.address, USER1.address)

      // [user1] borrow 5000 USDC
      await expect(CUSDC.connect(USER1).borrow(BORROW_USDC_AMOUNT))
      .to.emit(CUSDC, "Borrow")
      .withArgs(USER1.address, BORROW_USDC_AMOUNT, BORROW_USDC_AMOUNT, BORROW_USDC_AMOUNT)

      // [check] user1's USDC balance
      expect(await USDC.balanceOf(USER1.address))
      .to.equal(BORROW_USDC_AMOUNT)

      // [check] user1 can not be liquidated
      let accountLiquidity = await COMTROLLER.getAccountLiquidity(USER1.address)
      expect(accountLiquidity[2])
      .to.equal(ethers.utils.parseUnits("0", 0))
    })

    it("set UNI price to 6.2 and user1's shortfall greater than 0", async function(){
      const NEW_UNI_PRICE = ethers.utils.parseUnits("6.2", 18)

      // [owner] update UNI price
      await expect(SIMPLE_PRICE_ORACLE.setUnderlyingPrice(CUNI.address, NEW_UNI_PRICE))
      .to.emit(SIMPLE_PRICE_ORACLE, "PricePosted")
      .withArgs(UNI_ADDRESS, UNI_PRICE, NEW_UNI_PRICE, NEW_UNI_PRICE)

      // [check] user1 can be liquidated => shortfail > 0
      let accountLiquidity = await COMTROLLER.getAccountLiquidity(USER1.address)
      expect(accountLiquidity[2])
      .to.above(ethers.utils.parseUnits("0", 0))
    })

    it ("liquidate with flash loan", async function(){
      console.log('await USDC.balanceOf(USER2.address)', await USDC.balanceOf(USER2.address))
      console.log('await USDC.balanceOf(LENDING_POOL.address)', await USDC.balanceOf(LENDING_POOL.address))
      // console.log('LENDING_POOL', LENDING_POOL)
      await USDC.connect(USER2).transfer(FLASHLOAN.address, ethers.utils.parseUnits("100", 6))
      console.log('await USDC.balanceOf(FLASHLOAN.address)', await USDC.balanceOf(FLASHLOAN.address))
      console.log('CUSDC.address', CUSDC.address)
      console.log('CUNI.address', CUNI.address)
      const abiCoder = new ethers.utils.AbiCoder()
      await expect(FLASHLOAN.connect(USER2).requestFlashloan(
        USDC_ADDRESS, // assets
        BORROW_USDC_AMOUNT * 0.5, // amounts
        abiCoder.encode(
          ['address', 'address', 'address', 'address', 'address'],
          [CUSDC.address, USER1.address, CUNI.address, UNI_ADDRESS, SWAP_ADDRESS],
        ),
      ))
      .to.emit(LENDING_POOL, "FlashLoan")
    })

    // it ("check liquidate result", async function(){
    //   // [user2] approve cUSDC to use USDC for liquidating
    //   await USDC.connect(USER2).approve(CUSDC.address, ethers.utils.parseUnits("1000000", 6))

    //   // [user2] liquidate user1
    //   await expect(CUSDC.connect(USER2).liquidateBorrow(USER1.address, BORROW_USDC_AMOUNT * 0.5, CUNI.address))
    //   .to.emit(CUSDC, "LiquidateBorrow")

    //   // [user2] liquidate user1 => repay 2500 USDC and get cUNI
    //   expect(await USDC.balanceOf(USER2.address))
    //   .to.equal(ethers.utils.parseUnits("17500", 6))
    
    //   expect(await CUNI.balanceOf(USER2.address))
    //   .to.above(ethers.utils.parseUnits("0", 18))
    //   // get 431.12903225806457 cUNI
    // })
  })

  

  // it ("[owner] mint 10000 erc20 to cErc20", async function(){
  //   const [owner, user] = await ethers.getSigners();

  

  

  // it ("[owner] set phToken & pUSD's oracle price", async function(){
  //   // 在 Oracle 中設定一顆 token A 的價格為 $1，一顆 token B 的價格為 $100
  //   // await expect(simplePriceOracle.setDirectPrice(erc20.address, 100))
  //   // .to.emit(simplePriceOracle, "PricePosted")
  //   // .withArgs(erc20.address, 0, 100, 100)

  //   // await expect(simplePriceOracle.setDirectPrice(pUsd.address, 1))
  //   // .to.emit(simplePriceOracle, "PricePosted")
  //   // .withArgs(pUsd.address, 0, 1, 1)
    
  
  // })



  // it ("[user1] use 1 phToken to mint cPH", async function(){
  //   const [owner, user1] = await ethers.getSigners();

  //   // [owner] send user 10000 erc20
  //   await erc20.transfer(user1.address, ethers.utils.parseUnits("10000", 18))

  
  // })

  // it ("[user1] use token B as collateral to borrow 50 token A", async function(){
  //   // User1 使用 token B 作為抵押品來借出 50 顆 token A
  //   const [owner, user1] = await ethers.getSigners();

  //   // [owner] list pUsd in market
  //   await expect(comptroller._supportMarket(cPUSD.address))
  //   .to.emit(comptroller, "MarketListed")
  //   .withArgs(cPUSD.address)

  //   // [owner] deposit 10000 token A
  //   await pUsd.approve(cPUSD.address, ethers.utils.parseUnits("1000000", 18))
  //   await cPUSD.mint(ethers.utils.parseUnits("10000", 18));
  //   expect(await cPUSD.totalSupply())
  //   .to.equal(ethers.utils.parseUnits("10000", 18))

  
    
  

  //   expect(await pUsd.balanceOf(user1.address))
  //   .to.equal(ethers.utils.parseUnits("50", 18))

  

  // // it ("[owner] update phToken's collateral factor to 40%", async function(){
  // //   const [owner, user1] = await ethers.getSigners();

  // //   // 調整 token B 的 collateral factor，讓 user1 被 user2 清算
  // //   await expect(comptroller._setCollateralFactor(cErc20.address, ethers.utils.parseUnits("0.4", 18)))
  // //   .to.emit(comptroller, "NewCollateralFactor")
  // //   .withArgs(cErc20.address, ethers.utils.parseUnits("0.5", 18), ethers.utils.parseUnits("0.4", 18))

  // //   // [user1] can be liquidated => shortfail > 0
  // //   let accountLiquidity = await comptroller.getAccountLiquidity(user1.address)
  // //   expect(accountLiquidity[2])
  // //   .to.above(ethers.utils.parseUnits("0", 0))
  // // })

  // it ("[owner] update phToken's price to 90", async function(){
  //   const [owner, user1] = await ethers.getSigners();

  
  // })

  // it ("[user2] liquidate user1's assets", async function(){
  //   // 調整 token B 的 collateral factor，讓 user1 被 user2 清算
  //   const [owner, user1, user2] = await ethers.getSigners();

  

  

  

  
  // })
})


// V Fork Ethereum mainnet at block 15815693 (Reference)
// V cToken 的 decimals 皆為 18，初始 exchangeRate 為 1:1
// V Close factor 設定為 50%
// V Liquidation incentive 設為 10%（1.1 * 1e18)
// 使用 USDC 以及 UNI 代幣來作為 token A 以及 Token B
// V 在 Oracle 中設定 USDC 的價格為 $1，UNI 的價格為 $10
// V 設定 UNI 的 collateral factor 為 50%
// V User1 使用 1000 顆 UNI 作為抵押品借出 5000 顆 USDC
// 將 UNI 價格改為 $6.2 使 User1 產生 Shortfall，並讓 User2 透過 AAVE 的 Flash loan 來清算 User1
// 可以自行檢查清算 50% 後是不是大約可以賺 121 USD
// 在合約中如需將 UNI 換成 USDC 可以使用以下程式碼片段：