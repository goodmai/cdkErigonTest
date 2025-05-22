const fs = require('fs');
const path = require('path');

const resultsDir = path.join(__dirname, '..', '..', 'results'); // Путь к папке results/ в корне hardhat_project
const resultsFilePath = path.join(resultsDir, 'results.json');

async function logResult(stageResult) {
    let results = [];
    try {
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        if (fs.existsSync(resultsFilePath)) {
            const fileContent = fs.readFileSync(resultsFilePath, 'utf-8');
            if (fileContent.trim() !== "") {
                results = JSON.parse(fileContent);
            }
        }
    } catch (error) {
        console.warn(`Warning: Could not read or parse existing results.json: ${error.message}. Creating a new one.`);
        results = [];
    }

    results.push({
        timestamp: new Date().toISOString(),
        networkUsed: process.env.HARDHAT_NETWORK || 'default', 
        ...stageResult
    });

    try {
        fs.writeFileSync(resultsFilePath, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`Results for stage ${stageResult.stage} logged to ${resultsFilePath} (inside container)`);
    } catch (error) {
        console.error(`Error writing results.json: ${error.message}`);
    }
}

module.exports = { logResult };
