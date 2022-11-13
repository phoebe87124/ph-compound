# Installation
```
npm install --save-dev hardhat
npx hardhat
```

# How to Use
## Step 1: Run Node
```
npx hardhat node
```
## Step 2: Run Test
Run mint and redeem
```
npx hardhat test test/mintAndRedeem.js
```

Run borrow and liquidate
```
npx hardhat test test/borrow.js
```

Run borrow and liquidate with flashloan
```
// set api key in .env
API_KEY = xxxxxx

// run script
npx hardhat test test/flashloan
```

## Run Test with Gas Report
```
REPORT_GAS=true npx hardhat test test/mintAndRedeem.js
```