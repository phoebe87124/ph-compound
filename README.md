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
Run mintAndRedeem
```
npx hardhat test test/mintAndRedeem.js
```

Run borrow
```
npx hardhat test test/borrow.js
```

## Run Test with Gas Report
```
REPORT_GAS=true npx hardhat test test/mintAndRedeem.js
```