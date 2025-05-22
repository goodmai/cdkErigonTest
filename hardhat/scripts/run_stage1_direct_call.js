// Файл: hh/hardhat/scripts/run_stage1_direct_call.js
const { ethers } = require("hardhat");
const { logResult } = require("./lib/result_logger.js");

async function main() {
    const stageName = "Stage 1: Raw Precompile Invocation (sha256)";
    console.log(`\n🚀 Executing ${stageName}...`);

    const precompileAddress = "0x0000000000000000000000000000000000000002";
    const inputDataString = "Hello, CDK Erigon Precompile!";
    const inputDataBytes = ethers.toUtf8Bytes(inputDataString);
    
    const provider = ethers.provider;
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();

    let resultData;
    let verdict = "failure";
    let validationNotes = "";

    const stageExecutionResult = {
        stage: stageName,
        inputs: {
            precompileAddress: precompileAddress,
            inputDataHex: ethers.hexlify(inputDataBytes),
            inputDataString: inputDataString,
            callerAddress: signerAddress
        },
        callDetails: {},
        decodedOutput: null,
        expectedOutput: null,
        transactionHash: null,
        receiverAddress: precompileAddress,
        blockNumber: null,
        validationNotes: "",
        verdict: "pending"
    };

    try {
        const callParams = {
            to: precompileAddress,
            data: ethers.hexlify(inputDataBytes)
        };
        
        console.log(`Attempting direct call to ${precompileAddress} with data: ${ethers.hexlify(inputDataBytes)} from ${signerAddress}`);
        
        const block = await provider.getBlock("latest");
        stageExecutionResult.blockNumber = block.number;
        stageExecutionResult.callDetails.blockHash = block.hash;
        stageExecutionResult.callDetails.blockTimestamp = new Date(block.timestamp * 1000).toISOString();

        resultData = await provider.call(callParams);

        const expectedOutputHash = ethers.sha256(inputDataBytes);
        stageExecutionResult.expectedOutput = expectedOutputHash;
        stageExecutionResult.decodedOutput = resultData;

        if (resultData === expectedOutputHash) {
            verdict = "success";
            validationNotes = "Direct call successful. Returned data matches expected SHA256 hash.";
            console.log(`✅ Success! Precompile returned: ${resultData}`);
            console.log(`Expected hash: ${expectedOutputHash}`);
        } else {
            validationNotes = `Direct call failed. Returned data ${resultData} does not match expected SHA256 hash ${expectedOutputHash}.`;
            console.error(`❌ Failure! Precompile returned: ${resultData}, Expected: ${expectedOutputHash}`);
        }
    } catch (error) {
        console.error(`Error during direct precompile call: ${error.message}`);
        validationNotes = `Error during direct precompile call: ${error.message}`;
        stageExecutionResult.callDetails.error = error.message;
        if (error.data) {
             validationNotes += ` | Revert data: ${error.data}`;
            stageExecutionResult.callDetails.revertData = error.data;
        }
        resultData = `Error: ${error.message}`;
    }

    stageExecutionResult.verdict = verdict;
    stageExecutionResult.validationNotes = validationNotes;
    
    await logResult(stageExecutionResult);
}

main().catch((error) => {
    console.error("Unhandled error in Stage 1 script:", error);
    const errorResult = {
        stage: "Stage 1: Raw Precompile Invocation (sha256) - ERROR",
        inputs: {},
        callDetails: { error: error.message },
        decodedOutput: null,
        expectedOutput: null,
        transactionHash: null,
        receiverAddress: "0x0000000000000000000000000000000000000002",
        blockNumber: null,
        validationNotes: `Script crashed: ${error.message}`,
        verdict: "failure"
    };
    logResult(errorResult).finally(() => process.exit(1));
});
