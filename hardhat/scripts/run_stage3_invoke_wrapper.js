const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const { logResult } = require("./lib/result_logger.js");
const fs = require('fs');
const path = require('path');

const bigIntReplacer = (key, value) => {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value instanceof ethers.Result) {
        const obj = {};
        value.forEach((val, index) => {
            obj[index] = bigIntReplacer(index.toString(), val);
        });
        Object.keys(value).forEach(k => {
             if (isNaN(parseInt(k))) { // Только именованные свойства
                obj[k] = bigIntReplacer(k, value[k]);
            }
        });
        return obj;
    }
    return value;
};

const safeJsonStringify = (obj) => {
    return JSON.stringify(obj, bigIntReplacer, 2);
};

async function logTransactionDebugInfo(provider, txResponse, receipt, contractInterface, callContext = "N/A") {
    console.log(`\nDEBUG INFO for call context: ${callContext} (TX Hash: ${txResponse?.hash || 'N/A'})`);

    if (txResponse) {
        console.log(`  TX Response JSON: ${safeJsonStringify(txResponse)}`);
        if (txResponse.data && contractInterface) {
            try {
                const decodedInput = contractInterface.parseTransaction({ data: txResponse.data, value: txResponse.value });
                if (decodedInput) {
                    console.log("  Decoded TX Input Data:");
                    console.log(`    Function: ${decodedInput.name}`);
                    console.log(`    Args: ${safeJsonStringify(decodedInput.args)}`);
                    console.log(`    Signature: ${decodedInput.signature}`);
                    console.log(`    Value: ${ethers.formatEther(decodedInput.value || 0n)} ETH`);
                } else {
                     console.log("  TX Input Data: Could not decode (e.g. ETH transfer). Data:", txResponse.data);
                }
            } catch (e) {
                console.log(`  WARN: Could not parse transaction input data: ${e.message}. Data: ${txResponse.data}`);
            }
        }
    } else {
        console.log("  TX Response: Not available (e.g. for a view/static call or pre-flight check).");
    }


    if (receipt) {
        console.log(`  TX Receipt JSON: ${safeJsonStringify(receipt)}`);
        if (receipt.logs && contractInterface) {
            console.log("  Decoded Logs from Receipt:");
            receipt.logs.forEach((log, i) => {
                try {
                    const parsedLog = contractInterface.parseLog({ topics: Array.from(log.topics), data: log.data });
                    if (parsedLog) {
                        console.log(`    Log ${i}: Name=${parsedLog.name}, Args=${safeJsonStringify(parsedLog.args)}`);
                    } else {
                        console.log(`    Log ${i}: Not matched by ABI or anonymous. Topics: ${log.topics[0]}`);
                    }
                } catch (e) {
                    console.log(`    Log ${i}: Could not parse (not from this contract's ABI or anonymous event): ${log.topics[0]}. Error: ${e.message}`);
                }
            });
        }

        if (receipt.blockHash) {
            console.log(`  Fetching Block Details (Block Hash: ${receipt.blockHash}):`);
            try {
                const block = await provider.getBlock(receipt.blockHash);
                if (block) {
                    console.log(`  Block JSON: ${safeJsonStringify(block)}`);
                } else {
                    console.log(`    WARN: Block with hash ${receipt.blockHash} not found.`);
                }
            } catch (e) {
                console.log(`    ERROR: Could not fetch block ${receipt.blockHash}: ${e.message}`);
            }
        }
    } else {
         console.log("  TX Receipt: Not available (e.g. for a view/static call or if transaction was not mined).");
    }
}


async function getDeploymentData() {
    const resultsPath = path.join(__dirname, '..', 'results', 'results.json');
    console.log(`INFO: [getDeploymentData] Attempting to read results from: ${resultsPath}`);

    if (!fs.existsSync(resultsPath)) {
        const errMsg = `ERROR: [getDeploymentData] Results file not found at ${resultsPath}. Ensure Stage 2 successfully saved its output.`;
        console.error(errMsg);
        throw new Error(errMsg);
    }

    const rawData = fs.readFileSync(resultsPath, 'utf-8');
    if (rawData.trim() === "") {
        const errMsg = "ERROR: [getDeploymentData] Results file is empty. Stage 2 might have failed to write its results.";
        console.error(errMsg);
        throw new Error(errMsg);
    }

    let data;
    try {
        data = JSON.parse(rawData);
    } catch (e) {
        const errMsg = `ERROR: [getDeploymentData] Failed to parse results.json: ${e.message}. Content preview (first 200 chars): "${rawData.substring(0, 200)}"`;
        console.error(errMsg);
        throw new Error(errMsg);
    }

    if (!Array.isArray(data)) {
        const errMsg = "ERROR: [getDeploymentData] Parsed results.json is not an array. The file structure is unexpected.";
        console.error(errMsg);
        throw new Error(errMsg);
    }
    
    console.log(`INFO: [getDeploymentData] Successfully read and parsed results.json. Found ${data.length} entries.`);

    const stage2Success = data.find(r => r && typeof r.stage === 'string' && r.stage.includes("Stage 2: Contract Deployment (Ballot)") && r.verdict === "success");

    if (!stage2Success) {
        const errMsg = "ERROR: [getDeploymentData] Successful Stage 2 deployment data (matching 'Stage 2: Contract Deployment (Ballot)' and verdict 'success') not found in results.json.";
        console.error(errMsg);
        console.error("DEBUG: Listing current entries in results.json to help diagnose:");
        data.forEach((item, index) => {
            console.error(`  Entry ${index}: stage='${item.stage}', verdict='${item.verdict}', contractAddress='${item.contractAddress}'`);
        });
        throw new Error(errMsg);
    }
    
    console.log("INFO: [getDeploymentData] Found Stage 2 success entry.");

    if (!stage2Success.contractAddress) {
        const errMsg = "ERROR: [getDeploymentData] Stage 2 data found, but 'contractAddress' field is missing or null. Cannot proceed.";
        console.error(errMsg);
        console.error("Problematic Stage 2 entry:", safeJsonStringify(stage2Success));
        throw new Error(errMsg);
    }
    if (!stage2Success.contractAbi) {
        const errMsg = "ERROR: [getDeploymentData] Stage 2 data found, but 'contractAbi' field is missing. Cannot proceed.";
        console.error(errMsg);
        console.error("Problematic Stage 2 entry:", safeJsonStringify(stage2Success));
        throw new Error(errMsg);
    }
    
    console.log(`INFO: [getDeploymentData] Successfully retrieved Stage 2 data. Contract address: ${stage2Success.contractAddress}.`);
    return stage2Success;
}

async function displayBalances(label, accounts, provider) {
    console.log(`\n=== ${label} ===`);
    for (const account of accounts) {
        if (account && account.address) {
            try {
                const balance = await provider.getBalance(account.address);
                console.log(`  Balance of ${account.address} (${account.label || 'N/A'}): ${ethers.formatEther(balance)} ETH`);
            } catch (e) {
                console.log(`  Could not get balance for ${account.address} (${account.label || 'N/A'}): ${e.message}`);
            }
        } else {
            console.log(`  Account ${account?.label || 'N/A'} is undefined or has no address.`);
        }
    }
}

async function main() {
    const stageName = "Stage 3: Contract Invocation and Tests (Ballot)";
    console.log(`\n🚀 Executing ${stageName}...`);

    const executionResult = {
        stage: stageName,
        actions: [],
        testResults: [],
        finalState: {},
        verdict: "pending",
        error: null,
        timestamp: new Date().toISOString()
    };

    let contractInterface;

    try {
        const stage2Data = await getDeploymentData();
        
        const contractAddress = stage2Data.contractAddress;
        contractInterface = new ethers.Interface(stage2Data.contractAbi);
        
        const signers = await ethers.getSigners();
        console.log(`INFO: Retrieved ${signers.length} signers for network ${network.name}.`);

        if (signers.length === 0) {
            throw new Error("No signers returned from ethers.getSigners(). Check network configuration and node connection.");
        }
        const [chairperson, voter1, voter2, voter3, unauthorizedSigner] = signers;

        const accountsWithRoles = [
            {signer: chairperson, role: "Chairperson"},
            {signer: voter1, role: "Voter 1"},
            {signer: voter2, role: "Voter 2"},
            {signer: voter3, role: "Voter 3 (no rights initially)"},
            {signer: unauthorizedSigner, role: "Unauthorized Signer"}
        ];

        accountsWithRoles.forEach(acc => {
            console.log(`INFO: ${acc.role}: ${acc.signer?.address || 'undefined'}`);
        });
        
        if (!chairperson) throw new Error("Chairperson signer is undefined. Critical for tests.");

        await displayBalances("Initial Account Balances", 
            accountsWithRoles.map(a => ({address: a.signer?.address, label: a.role})), 
            ethers.provider
        );

        const accountsToFund = [voter1, voter2, voter3, unauthorizedSigner].filter(acc => acc && acc.address);
        const amountToSend = ethers.parseEther("0.05");

        if (accountsToFund.length > 0 && chairperson.address) {
            console.log(`\n=== Funding Test Accounts from Chairperson (${chairperson.address}) ===`);
            for (const account of accountsToFund) {
                if (account.address.toLowerCase() === chairperson.address.toLowerCase()) {
                    console.log(`INFO: Skipping self-funding for ${account.address}`);
                    continue; 
                }
                const actionKey = `FundAccount_${account.address}`;
                executionResult.actions.push({ 
                    action: actionKey,
                    from: chairperson.address,
                    to: account.address,
                    value: amountToSend.toString(),
                    status: "pending_fund"
                });
                let txResponse, receipt;
                try {
                    console.log(`INFO: Funding account ${account.address}. Attempting to send ${ethers.formatEther(amountToSend)} ETH...`);
                    txResponse = await chairperson.sendTransaction({
                        to: account.address,
                        value: amountToSend
                    });
                    const currentAction = executionResult.actions.find(a=>a.action === actionKey);
                    currentAction.txHash = txResponse.hash;

                    console.log(`  ⏳ Funding transaction sent: ${txResponse.hash}. Waiting for confirmation...`);
                    receipt = await txResponse.wait(1);
                    
                    if (receipt.status === 1) {
                        console.log(`  ✅ Sent ${ethers.formatEther(amountToSend)} ETH to ${account.address}. Tx: ${receipt.hash}`);
                        currentAction.status = "success_fund";
                        currentAction.receipt = safeJsonStringify(receipt);
                    } else {
                        console.error(`  ❌ Funding transaction ${txResponse.hash} to ${account.address} FAILED. Receipt status: ${receipt.status}.`);
                        currentAction.status = "failure_fund";
                        currentAction.receipt = safeJsonStringify(receipt);
                        currentAction.error = `Transaction reverted with status ${receipt.status}`;
                    }
                    await logTransactionDebugInfo(ethers.provider, txResponse, receipt, null, `Funding ${account.address}`);
                } catch (fundError) {
                    console.error(`  ❌ Exception while trying to send ETH to ${account.address}: ${fundError.message}`);
                    const currentAction = executionResult.actions.find(a=>a.action === actionKey);
                    currentAction.status = "exception_fund";
                    currentAction.error = fundError.message;
                    if (txResponse) await logTransactionDebugInfo(ethers.provider, txResponse, receipt, null, `Failed Funding ${account.address}`);
                }
            }
            await displayBalances("Account Balances After Funding", 
                accountsWithRoles.map(a => ({address: a.signer?.address, label: a.role})), 
                ethers.provider
            );
        }

        const ballot = await ethers.getContractAt("Ballot", contractAddress, chairperson);
        
        const requiredSignersMap = { chairperson, voter1, voter2, voter3, unauthorizedSigner };
        for (const [name, signerInstance] of Object.entries(requiredSignersMap)) {
            if (!signerInstance) {
                throw new Error(`Required signer "${name}" is undefined. Cannot proceed. Check Hardhat config and account generation for network ${network.name}. Ensure at least 5 accounts are configured if all tests are to be run.`);
            }
        }
        
        console.log(`\n=== Initial State Checks ===`);
        await checkInitialState(ballot, chairperson, voter1, executionResult);
        
        console.log(`\n=== Grant Voting Rights ===`);
        await grantVotingRights(ballot, chairperson, [voter1, voter2], executionResult);
        
        console.log(`\n=== Voting Process ===`);
        await processVoting(ballot, voter1, voter2, executionResult);
        
        console.log(`\n=== Negative Tests ===`);
        await performNegativeTests(ballot, voter3, unauthorizedSigner, executionResult);
        
        console.log(`\n=== Final State Checks ===`);
        await verifyFinalState(ballot, executionResult);

        executionResult.verdict = "success";
        console.log("\n✅ All Stage 3 checks completed successfully!");

    } catch (error) {
        console.error(`\n❌ Stage 3 Execution FAILED: ${error.message}`);
        executionResult.verdict = "failure";
        executionResult.error = error.message;
        if (error.stack) {
            console.error("Stack Trace:\n", error.stack);
            executionResult.stack = error.stack;
        }
    } finally {
        await logResult(executionResult);
        console.log(`INFO: Stage 3 results logged. Verdict: ${executionResult.verdict}`);
    }
}

function handleTestError(result, context, error) {
    const errorMessage = error.message || "Unknown error in test context";
    console.error(`  ❌ ERROR during "${context}": ${errorMessage}`);
    
    let testEntry = result.testResults.find(tr => tr.test === context && tr.status === "pending_test");
    if (testEntry) {
        testEntry.status = "failed";
        testEntry.reason = errorMessage;
    } else {
         result.testResults.push({
            test: context,
            status: "failed",
            reason: errorMessage
        });
    }
    throw error;
}

async function checkInitialState(contract, chairperson, voter, result) {
    const context = "Initial State Checks";
    result.testResults.push({ test: context, status: "pending_test" });
    try {
        console.log(`INFO: [${context}] Calling contract.voters("${chairperson.address}")`);
        const chairpersonVoterData = await contract.voters(chairperson.address);
        console.log(`DEBUG: Response from contract.voters("${chairperson.address}"): ${safeJsonStringify(chairpersonVoterData)}`);
        const chairpersonWeight = chairpersonVoterData.weight;
        expect(chairpersonWeight.toString()).to.equal("1", "Chairperson initial weight should be 1");
        
        console.log(`INFO: [${context}] Calling contract.voters("${voter.address}")`);
        const voterVoterData = await contract.voters(voter.address);
        console.log(`DEBUG: Response from contract.voters("${voter.address}"): ${safeJsonStringify(voterVoterData)}`);
        const voterWeight = voterVoterData.weight;
        expect(voterWeight.toString()).to.equal("0", "Voter initial weight should be 0");
        
        result.testResults.find(t=>t.test === context).status = "passed";
        console.log(`  ✅ ${context} passed.`);
    } catch (error) {
        handleTestError(result, context, error);
    }
}

async function grantVotingRights(contract, chairperson, votersToGrant, result) {
    const contextPrefix = "Grant Voting Rights";
    for (const voter of votersToGrant) {
        const specificContext = `${contextPrefix} to ${voter.address.substring(0,10)}...`;
        result.testResults.push({ test: specificContext, status: "pending_test" });
        const action = { action: "GrantVoteRight", by: chairperson.address, to: voter.address, status: "pending_action" };
        result.actions.push(action);
        let txResponse, receipt;
        try {
            console.log(`INFO: [${specificContext}] Attempting... (Input: to=${voter.address})`);
            txResponse = await contract.connect(chairperson).giveRightToVote(voter.address);
            action.txHash = txResponse.hash;
            receipt = await txResponse.wait(1);
            action.receipt = safeJsonStringify(receipt);

            if (receipt.status !== 1) throw new Error(`Transaction reverted for ${voter.address}`);
            
            const weight = (await contract.voters(voter.address)).weight;
            console.log(`DEBUG: Response from contract.voters("${voter.address}") after grant: Weight=${weight}`);
            expect(weight.toString()).to.equal("1", `Voter ${voter.address} weight should be 1 after grant`);
            
            result.testResults.find(t=>t.test === specificContext).status = "passed";
            action.status = "success_action";
            console.log(`  ✅ ${specificContext} successful.`);
            await logTransactionDebugInfo(ethers.provider, txResponse, receipt, contract.interface, specificContext);
        } catch (error) {
            action.status = "failure_action";
            action.error = error.message;
            handleTestError(result, specificContext, error);
            if (txResponse) await logTransactionDebugInfo(ethers.provider, txResponse, receipt, contract.interface, `Failed ${specificContext}`);
        }
    }
}

async function processVoting(contract, voter1, voter2, result) {
    const contextVote = "Voting Process - Voter1 Votes";
    const contextDelegate = "Voting Process - Voter2 Delegates to Voter1";
    const contextVerify = "Voting Process - Verify Vote Count";
    let txVoteResponse, voteReceipt, txDelegateResponse, delegateReceipt;

    result.testResults.push({ test: contextVote, status: "pending_test" });
    const actionVote = { action: "Vote", voter: voter1.address, proposalIndex: 0, status: "pending_action" };
    result.actions.push(actionVote);
    try {
        console.log(`INFO: [${contextVote}] Voter1 (${voter1.address}) voting for proposal 0... (Input: proposalIdx=0)`);
        txVoteResponse = await contract.connect(voter1).vote(0);
        actionVote.txHash = txVoteResponse.hash;
        voteReceipt = await txVoteResponse.wait(1);
        actionVote.receipt = safeJsonStringify(voteReceipt);
        if (voteReceipt.status !== 1) throw new Error("Vote transaction reverted");
        result.testResults.find(t=>t.test === contextVote).status = "passed";
        actionVote.status = "success_action";
        console.log(`  ✅ ${contextVote} successful.`);
        await logTransactionDebugInfo(ethers.provider, txVoteResponse, voteReceipt, contract.interface, contextVote);
    } catch (error) {
        actionVote.status = "failure_action";
        actionVote.error = error.message;
        if (txVoteResponse) await logTransactionDebugInfo(ethers.provider, txVoteResponse, voteReceipt, contract.interface, `Failed ${contextVote}`);
        handleTestError(result, contextVote, error);
    }

    result.testResults.push({ test: contextDelegate, status: "pending_test" });
    const actionDelegate = { action: "Delegate", delegator: voter2.address, to: voter1.address, status: "pending_action" };
    result.actions.push(actionDelegate);
    try {
        console.log(`INFO: [${contextDelegate}] Voter2 (${voter2.address}) delegating to Voter1 (${voter1.address})... (Input: toDelegate=${voter1.address})`);
        txDelegateResponse = await contract.connect(voter2).delegate(voter1.address);
        actionDelegate.txHash = txDelegateResponse.hash;
        delegateReceipt = await txDelegateResponse.wait(1);
        actionDelegate.receipt = safeJsonStringify(delegateReceipt);
        if (delegateReceipt.status !== 1) throw new Error("Delegate transaction reverted");
        result.testResults.find(t=>t.test === contextDelegate).status = "passed";
        actionDelegate.status = "success_action";
        console.log(`  ✅ ${contextDelegate} successful.`);
        await logTransactionDebugInfo(ethers.provider, txDelegateResponse, delegateReceipt, contract.interface, contextDelegate);
    } catch (error) {
        actionDelegate.status = "failure_action";
        actionDelegate.error = error.message;
        if (txDelegateResponse) await logTransactionDebugInfo(ethers.provider, txDelegateResponse, delegateReceipt, contract.interface, `Failed ${contextDelegate}`);
        handleTestError(result, contextDelegate, error);
    }
    
    result.testResults.push({ test: contextVerify, status: "pending_test" });
    try {
        console.log(`INFO: [${contextVerify}] Verifying vote count for proposal 0...`);
        const proposal = await contract.proposals(0);
        console.log(`DEBUG: Response from contract.proposals(0): ${safeJsonStringify(proposal)}`);
        expect(proposal.voteCount.toString()).to.equal("2", "Vote count for proposal 0 should be 2 after delegation");
        result.testResults.find(t=>t.test === contextVerify).status = "passed";
        console.log(`  ✅ ${contextVerify} successful.`);
    } catch (error) {
        handleTestError(result, contextVerify, error);
    }
}

async function performNegativeTests(contract, voterWithoutRights, nonChairperson, result) {
    const contextUnauthorizedVote = `Negative Test - Unauthorized Vote by ${voterWithoutRights.address.substring(0,10)}`;
    const contextUnauthorizedGrant = `Negative Test - Unauthorized Grant by ${nonChairperson.address.substring(0,10)}`;
    let txUnauthorizedVote, receiptUnauthorizedVote, txUnauthorizedGrant, receiptUnauthorizedGrant;

    result.testResults.push({ test: contextUnauthorizedVote, status: "pending_test" });
    const actionUnauthorizedVote = { action: "UnauthorizedVoteAttempt", voter: voterWithoutRights.address, status: "pending_action" };
    result.actions.push(actionUnauthorizedVote);
    try {
        console.log(`INFO: [${contextUnauthorizedVote}] Attempting... (Input: proposalIdx=0)`);
        const txPromise = contract.connect(voterWithoutRights).vote(0);
        await expect(txPromise).to.be.revertedWith("Has no right to vote");
        
        result.testResults.find(t=>t.test === contextUnauthorizedVote).status = "passed_reverted_expectedly";
        actionUnauthorizedVote.status = "success_reverted_expectedly";
        console.log(`  ✅ ${contextUnauthorizedVote} successful (reverted as expected).`);
        try {
            txUnauthorizedVote = await txPromise.catch(e => e.transaction || null); // Try to get tx if available in error
            if (txUnauthorizedVote && txUnauthorizedVote.hash) {
                 actionUnauthorizedVote.txHash = txUnauthorizedVote.hash;
                 receiptUnauthorizedVote = await ethers.provider.getTransactionReceipt(txUnauthorizedVote.hash).catch(()=>null);
                 actionUnauthorizedVote.receipt = safeJsonStringify(receiptUnauthorizedVote);
                 await logTransactionDebugInfo(ethers.provider, txUnauthorizedVote, receiptUnauthorizedVote, contract.interface, contextUnauthorizedVote + " (reverted)");
            } else {
                 console.log(`DEBUG: No transaction response available for reverted call ${contextUnauthorizedVote}`);
                 await logTransactionDebugInfo(ethers.provider, {data: contract.interface.encodeFunctionData("vote", [0])}, null, contract.interface, contextUnauthorizedVote + " (reverted, no tx hash)");
            }
        } catch (e) { console.log(`DEBUG: Error fetching tx info for reverted call: ${e.message}`);}

    } catch (error) {
        actionUnauthorizedVote.status = "failure_action";
        actionUnauthorizedVote.error = error.message;
        handleTestError(result, contextUnauthorizedVote, error);
    }

    result.testResults.push({ test: contextUnauthorizedGrant, status: "pending_test" });
    const actionUnauthorizedGrant = { action: "UnauthorizedGrantAttempt", granter: nonChairperson.address, to: voterWithoutRights.address, status: "pending_action" };
    result.actions.push(actionUnauthorizedGrant);
    try {
        console.log(`INFO: [${contextUnauthorizedGrant}] Attempting grant right to ${voterWithoutRights.address}... (Input: toVoter=${voterWithoutRights.address})`);
        const txPromiseGrant = contract.connect(nonChairperson).giveRightToVote(voterWithoutRights.address);
        await expect(txPromiseGrant).to.be.revertedWith("Only chairperson can give right to vote.");
        result.testResults.find(t=>t.test === contextUnauthorizedGrant).status = "passed_reverted_expectedly";
        actionUnauthorizedGrant.status = "success_reverted_expectedly";
        console.log(`  ✅ ${contextUnauthorizedGrant} successful (reverted as expected).`);
         try {
            txUnauthorizedGrant = await txPromiseGrant.catch(e => e.transaction || null);
            if (txUnauthorizedGrant && txUnauthorizedGrant.hash) {
                actionUnauthorizedGrant.txHash = txUnauthorizedGrant.hash;
                receiptUnauthorizedGrant = await ethers.provider.getTransactionReceipt(txUnauthorizedGrant.hash).catch(()=>null);
                actionUnauthorizedGrant.receipt = safeJsonStringify(receiptUnauthorizedGrant);
                await logTransactionDebugInfo(ethers.provider, txUnauthorizedGrant, receiptUnauthorizedGrant, contract.interface, contextUnauthorizedGrant + " (reverted)");
            } else {
                console.log(`DEBUG: No transaction response available for reverted call ${contextUnauthorizedGrant}`);
                await logTransactionDebugInfo(ethers.provider, {data: contract.interface.encodeFunctionData("giveRightToVote", [voterWithoutRights.address])}, null, contract.interface, contextUnauthorizedGrant + " (reverted, no tx hash)");
            }
        } catch (e) { console.log(`DEBUG: Error fetching tx info for reverted grant call: ${e.message}`);}


    } catch (error) {
        actionUnauthorizedGrant.status = "failure_action";
        actionUnauthorizedGrant.error = error.message;
        handleTestError(result, contextUnauthorizedGrant, error);
    }
}

async function getAllProposals(contract) {
    const proposals = [];
    const proposalCount = 3;
    for (let i = 0; i < proposalCount; i++) {
        try {
            const p = await contract.proposals(i);
            proposals.push({
                name: ethers.decodeBytes32String(p.name),
                voteCount: p.voteCount.toString()
            });
        } catch (e) {
            proposals.push({ name: `Error fetching P[${i}]`, voteCount: "N/A" });
        }
    }
    return proposals;
}

async function verifyFinalState(contract, result) {
    const context = "Final State Verification";
    result.testResults.push({ test: context, status: "pending_test" });
    try {
        console.log(`INFO: [${context}] Calling contract.winningProposal()...`);
        const winnerIndex = await contract.winningProposal();
        console.log(`DEBUG: Response from contract.winningProposal(): ${winnerIndex.toString()}`);
        
        console.log(`INFO: [${context}] Calling contract.winnerName()...`);
        const winnerNameBytes32 = await contract.winnerName();
        const winnerName = ethers.decodeBytes32String(winnerNameBytes32);
        console.log(`DEBUG: Response from contract.winnerName(): "${winnerName}" (bytes32: ${winnerNameBytes32})`);
        
        const winningProposalData = await contract.proposals(winnerIndex);
        console.log(`DEBUG: Response from contract.proposals(${winnerIndex}): ${safeJsonStringify(winningProposalData)}`);

        console.log(`INFO: Winning proposal index: ${winnerIndex.toString()}, Name: "${winnerName}", Votes: ${winningProposalData.voteCount.toString()}`);
        
        expect(winnerIndex.toString()).to.equal("0", "Winning proposal index should be 0");
        expect(winnerName).to.equal("Proposal A", "Winning proposal name should be 'Proposal A'");
        
        result.finalState = {
            winnerIndex: winnerIndex.toString(),
            winnerName: winnerName,
            winningProposalVoteCount: winningProposalData.voteCount.toString(),
            allProposals: await getAllProposals(contract)
        };
        result.testResults.find(t=>t.test === context).status = "passed";
        console.log(`  ✅ ${context} passed.`);
    } catch (error) {
        handleTestError(result, context, error);
    }
}

main().catch((error) => {
    console.error("CRITICAL UNHANDLED ERROR in Stage 3 main execution:", error.message);
    if (error.stack) console.error(error.stack);
    const criticalErrorResult = {
        stage: "Stage 3: Contract Invocation and Tests (Ballot) - CRITICAL FAILURE",
        actions: [], testResults: [], finalState: {},
        verdict: "failure",
        error: error.message || "Unknown critical unhandled error",
        stack: error.stack,
        timestamp: new Date().toISOString()
    };
    logResult(criticalErrorResult)
        .then(() => console.log("INFO: Logged critical failure."))
        .catch(logErr => console.error("ERROR: Failed to log critical failure:", logErr))
        .finally(() => process.exit(1));
});
