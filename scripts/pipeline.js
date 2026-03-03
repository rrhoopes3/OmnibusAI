/**
 * pipeline.js - Full end-to-end pipeline
 *
 * Runs: monitor → fetch → parse → summarize → build
 * Used by GitHub Actions or manual invocation.
 */

const { monitor } = require('./monitor');
const { fetchBillXml } = require('./fetch-xml');
const { parseBillFile } = require('./parse-bill');
const { summarizeBill } = require('./summarize');
const { buildSite } = require('./build-site');
const fs = require('fs');
const path = require('path');

async function pipeline(options = {}) {
  const { skipMonitor = false, billIds = [], skipSummarize = false } = options;

  console.log('=== OmniBill Pipeline ===\n');

  // Step 1: Monitor for new bills
  let newBills = [];
  if (!skipMonitor && billIds.length === 0) {
    console.log('Step 1: Monitoring for new bills...');
    newBills = await monitor();
    console.log();
  }

  // Determine which bills to process
  let toProcess = billIds.length > 0
    ? billIds
    : newBills.filter(b => b.status === 'ready').map(b => b.id);

  if (toProcess.length === 0) {
    // Check for any bills that need processing
    const parsedDir = path.join(__dirname, '..', 'data', 'parsed');
    const summariesDir = path.join(__dirname, '..', 'data', 'summaries');
    if (fs.existsSync(parsedDir)) {
      const dirs = fs.readdirSync(parsedDir);
      for (const dir of dirs) {
        const hasXml = fs.existsSync(path.join(parsedDir, dir, 'raw.xml'));
        const hasSummary = fs.existsSync(path.join(summariesDir, dir, 'overview.json'));
        if (hasXml && !hasSummary) toProcess.push(dir);
      }
    }
  }

  if (toProcess.length === 0) {
    console.log('No bills to process. Building site with existing data...');
  } else {
    console.log(`Processing ${toProcess.length} bill(s): ${toProcess.join(', ')}\n`);

    for (const billId of toProcess) {
      try {
        // Step 2: Fetch XML
        console.log(`Step 2: Fetching XML for ${billId}...`);
        await fetchBillXml(billId);
        console.log();

        // Step 3: Parse
        console.log(`Step 3: Parsing ${billId}...`);
        parseBillFile(billId);
        console.log();

        // Step 4: Summarize
        if (!skipSummarize) {
          console.log(`Step 4: Summarizing ${billId}...`);
          await summarizeBill(billId);
          console.log();
        }
      } catch (err) {
        console.error(`Error processing ${billId}: ${err.message}`);
        console.error(err.stack);
      }
    }
  }

  // Step 5: Build static site
  console.log('Step 5: Building static site...');
  buildSite();
  console.log('\n=== Pipeline complete ===');
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  if (args.includes('--skip-monitor')) options.skipMonitor = true;
  if (args.includes('--skip-summarize')) options.skipSummarize = true;

  const billArgs = args.filter(a => !a.startsWith('--'));
  if (billArgs.length > 0) options.billIds = billArgs;

  pipeline(options).catch(err => {
    console.error('Pipeline failed:', err);
    process.exit(1);
  });
}

module.exports = { pipeline };
