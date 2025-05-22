const { ethers, network } = require("hardhat");
const { formatEther } = require("ethers");
const { logResult } = require("./lib/result_logger.js");
const fs = require('fs');
const path = require('path');

const bigIntReplacer = (key, value) => {
  return typeof value === 'bigint' ? value.toString() : value;
};

const processReceiptForLogging = (receipt) => {
  if (!receipt) return null;
  
  const safeReceipt = {
    ...receipt,
    gasUsed: receipt.gasUsed?.toString(),
    cumulativeGasUsed: receipt.cumulativeGasUsed?.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
    blockNumber: receipt.blockNumber?.toString(),
    logs: receipt.logs?.map(log => ({
      ...log,
      blockNumber: log.blockNumber?.toString(),
      transactionIndex: log.transactionIndex?.toString(),
      logIndex: log.logIndex?.toString(),
    }))
  };

  return safeReceipt;
};

async function showBalance(address, label = "Balance") {
  try {
    const balance = await ethers.provider.getBalance(address);
    console.log(`┌─ ${label.padEnd(35, '─')}─┐`);
    console.log(`│ ${formatEther(balance).padEnd(40)} ETH │`);
    console.log(`└${'─'.repeat(37)}┘\n`);
    return balance;
  } catch (e) {
    console.error(`❌ Error getting balance: ${e.message}`);
    return 0n;
  }
}

async function main() {
  const stageName = "Stage 2: Contract Deployment (Ballot)";
  console.log(`\n🚀 Executing ${stageName}...`);

  const resultTemplate = {
    stage: stageName,
    contractAddress: null,
    transactionHash: null,
    blockNumber: null,
    gasUsed: null,
    contractAbi: null,
    deploymentDetails: {
      network: network.name,
      chainId: network.config.chainId.toString(),
      deployer: null,
      gasPrice: null,
      gasLimit: null,
      receipt: null
    },
    error: null,
    verdict: "pending",
    timestamp: new Date().toISOString()
  };

  try {
    const contractName = "Ballot";
    const proposals = ["Proposal A", "Proposal B", "Proposal C"];
    const proposalBytes = proposals.map(p => ethers.encodeBytes32String(p));

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY environment variable not set!");
    
    const provider = ethers.getDefaultProvider(network.config.url);
    const deployer = new ethers.Wallet(privateKey, provider);
    resultTemplate.deploymentDetails.deployer = deployer.address;

    console.log(`\n📡 Deployer: ${deployer.address}`);
    await showBalance(deployer.address, "Initial balance");

    console.log(`📦 Deploying ${contractName} with proposals:`);
    console.table(proposals.map((p, i) => ({
      Proposal: p,
      Bytes32: proposalBytes[i]
    })));

    const ContractFactory = await ethers.getContractFactory(contractName, deployer);
    const contract = await ContractFactory.deploy(proposalBytes);
    const deploymentTx = contract.deploymentTransaction();
    
    console.log(`\n🎯 Transaction hash: ${deploymentTx.hash}`);
    console.log(`⏳ Waiting for confirmations...`);

    const receipt = await deploymentTx.wait(2);
    
    resultTemplate.contractAddress = await contract.getAddress();
    resultTemplate.transactionHash = deploymentTx.hash;
    resultTemplate.blockNumber = receipt.blockNumber.toString();
    resultTemplate.gasUsed = receipt.gasUsed.toString();
    resultTemplate.contractAbi = ContractFactory.interface.format("full");
    resultTemplate.deploymentDetails.gasPrice = deploymentTx.gasPrice?.toString();
    resultTemplate.deploymentDetails.gasLimit = deploymentTx.gasLimit?.toString();
    resultTemplate.deploymentDetails.receipt = processReceiptForLogging(receipt);

    const code = await ethers.provider.getCode(resultTemplate.contractAddress);
    resultTemplate.deploymentDetails.codeSize = code.length;

    if (code.length > 2) {
      resultTemplate.verdict = "success";
      console.log(`\n✅ Successfully deployed at ${resultTemplate.contractAddress}`);
      await showBalance(deployer.address, "Balance after deployment");
    } else {
      throw new Error("Empty contract code");
    }

  } catch (error) {
    console.error(`\n❌ Deployment failed: ${error.message}`);
    resultTemplate.error = error.message;
    resultTemplate.verdict = "failure";
    
    if (error.transactionHash) {
      try {
        const tx = await ethers.provider.getTransaction(error.transactionHash);
        resultTemplate.transactionHash = error.transactionHash;
        resultTemplate.deploymentDetails.receipt = {
          from: tx.from,
          to: tx.to,
          value: tx.value.toString(),
          data: tx.data
        };
      } catch (e) {
        console.warn("Error retrieving failed tx:", e.message);
      }
    }
  } finally {
    const resultsPath = path.join(__dirname, '..', 'results', 'results.json');
    try {
      let existingData = [];
      
      if (fs.existsSync(resultsPath)) {
        existingData = JSON.parse(
          fs.readFileSync(resultsPath, 'utf-8'),
          (key, value) => key.endsWith('At') ? value : value
        );
      }

      const filteredData = existingData.filter(
        item => !item.stage?.includes(stageName)
      );

      fs.writeFileSync(
        resultsPath,
        JSON.stringify([...filteredData, resultTemplate], bigIntReplacer, 2),
        { flag: 'w', encoding: 'utf-8' }
      );

      console.log(`\n📊 Results saved to: ${resultsPath}`);
    } catch (fileError) {
      console.error("File system error:", fileError.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
