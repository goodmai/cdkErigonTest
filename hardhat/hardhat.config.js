require("@nomicfoundation/hardhat-toolbox");
const { ethers } = require("ethers"); 
const getCdkErigonTestAccounts = () => {
  const accounts = [];
  const primaryPrivateKeyInput = process.env.PRIVATE_KEY;

  if (!primaryPrivateKeyInput) {
    console.error(
      "ERROR: process.env.PRIVATE_KEY is not set for the cdkErigon network. " +
      "This key is essential for the primary account (chairperson)."
    );
    return 'remote'; // Fallback to let Hardhat use node's accounts or fail
  }

  // Ensure the private key starts with 0x for BigInt conversion and is 66 chars long (0x + 64 hex)
  let basePrivateKeyHex = primaryPrivateKeyInput.startsWith('0x') ? primaryPrivateKeyInput : `0x${primaryPrivateKeyInput}`;
  if (basePrivateKeyHex.length !== 66) {
      console.error(
          `ERROR: PRIVATE_KEY (currently: ${primaryPrivateKeyInput}) must be a 32-byte hex string, optionally prefixed with 0x (total 64 hex chars or 66 with 0x).`
      );
      return 'remote';
  }
  
  accounts.push(basePrivateKeyHex); // Add the primary account
  const primaryWallet = new ethers.Wallet(basePrivateKeyHex);
  console.log(`INFO: Using primary private key for cdkErigon chairperson: ${primaryWallet.address}`);

  try {
    let currentKeyBigInt = BigInt(basePrivateKeyHex);

    console.log("INFO: Generating 4 additional test accounts for cdkErigon by incrementing the primary private key.");
    console.warn("WARNING: This method of key generation is insecure and for local testing ONLY.");

    for (let i = 0; i < 4; i++) { // Generate 4 additional accounts
      currentKeyBigInt += 1n; // Increment the BigInt value
      const newPrivateKeyHex = '0x' + currentKeyBigInt.toString(16).padStart(64, '0');
      
      if (newPrivateKeyHex.length > 66) { // Basic overflow check for 32-byte key
          console.error(`ERROR: Incrementing private key resulted in an overflow for key ${i+1}. Cannot generate more keys this way.`);
          break;
      }
      accounts.push(newPrivateKeyHex);
      const newWallet = new ethers.Wallet(newPrivateKeyHex);
      console.log(`  INFO: Added derived account ${i + 1}: ${newWallet.address} (PK derived by increment)`);
    }
  } catch (error) {
      console.error(`ERROR: Failed to process or increment the primary private key: ${error.message}`);
      console.error("Ensure PRIVATE_KEY is a valid hexadecimal string.");
  }

  if (accounts.length > 0 && accounts.length < 5) {
    console.warn(
        `WARNING: Only ${accounts.length} account(s) configured for cdkErigon due to previous errors or stopping condition. Stage 3 tests expect 5.`
    );
  }
  
  if (accounts.length === 0) {
      return 'remote'; // Should not happen if primaryPrivateKey was valid
  }

  return accounts;
};

const cdkErigonConfiguredAccounts = getCdkErigonTestAccounts();
module.exports = {
  solidity: "0.8.29",
  networks: {
    cdkErigon: {
      url: process.env.CDK_ERIGON_RPC_URL,
      accounts: cdkErigonConfiguredAccounts,
      chainId: parseInt(process.env.CHAIN_ID)
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    results: "./results"
  }
};
