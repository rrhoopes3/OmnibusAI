/**
 * monitor.js - Poll Congress.gov API for new appropriations/omnibus bills
 *
 * Checks for new bills matching appropriations keywords, compares against
 * already-processed bills in data/bills/, and outputs new bill IDs.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'bills');
const API_BASE = 'https://api.congress.gov/v3';

const SEARCH_QUERIES = [
  '"consolidated appropriations"',
  '"omnibus appropriations"',
  '"full-year continuing appropriations"',
  '"further consolidated appropriations"',
  '"making appropriations"',
];

// Only care about these bill types
const BILL_TYPES = ['hr', 'hjres', 's', 'sjres'];

function getApiKey() {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) {
    console.error('Error: CONGRESS_API_KEY environment variable is required.');
    console.error('Sign up free at https://api.data.gov/');
    process.exit(1);
  }
  return key;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new Error('Rate limited. Try again later.'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function getProcessedBills() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return new Set();
  }
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return new Set(files.map(f => f.replace('.json', '')));
}

function billId(bill) {
  return `${bill.congress}-${bill.type.toLowerCase()}-${bill.number}`;
}

async function searchBills(apiKey, query) {
  const url = `${API_BASE}/bill?query=${encodeURIComponent(query)}&limit=50&sort=updateDate+desc&api_key=${apiKey}`;
  const resp = await httpGet(url);
  return resp.bills || [];
}

async function getBillText(apiKey, congress, type, number) {
  const url = `${API_BASE}/bill/${congress}/${type}/${number}/text?api_key=${apiKey}`;
  try {
    const resp = await httpGet(url);
    return resp.textVersions || [];
  } catch {
    return [];
  }
}

function findEnrolledVersion(textVersions) {
  // Prefer enrolled, then public law, then most recent
  const priority = ['Enrolled Bill', 'Public Law', 'Engrossed Amendment'];
  for (const pref of priority) {
    const match = textVersions.find(v => v.type && v.type.includes(pref));
    if (match) return match;
  }
  return textVersions[0] || null;
}

function extractGovInfoUrl(version) {
  if (!version || !version.formats) return null;
  const xml = version.formats.find(f => f.type === 'Formatted XML' || f.type === 'XML');
  if (xml) return xml.url;
  // Fallback: construct from what we know
  return null;
}

async function monitor() {
  const apiKey = getApiKey();
  const processed = getProcessedBills();
  const newBills = [];

  console.log(`Checking for new appropriations bills...`);
  console.log(`Already processed: ${processed.size} bills`);

  for (const query of SEARCH_QUERIES) {
    console.log(`  Searching: ${query}`);
    try {
      const bills = await searchBills(apiKey, query);
      for (const bill of bills) {
        const id = billId(bill);
        if (processed.has(id)) continue;
        if (!BILL_TYPES.includes(bill.type.toLowerCase())) continue;

        // Check if bill has text available
        const textVersions = await getBillText(apiKey, bill.congress, bill.type.toLowerCase(), bill.number);
        const enrolled = findEnrolledVersion(textVersions);
        const xmlUrl = extractGovInfoUrl(enrolled);

        const billData = {
          id,
          congress: bill.congress,
          type: bill.type.toLowerCase(),
          number: bill.number,
          title: bill.title,
          latestAction: bill.latestAction,
          updateDate: bill.updateDate,
          textVersion: enrolled ? enrolled.type : null,
          xmlUrl,
          discoveredAt: new Date().toISOString(),
          status: xmlUrl ? 'ready' : 'no_xml',
        };

        newBills.push(billData);
        console.log(`  Found: ${bill.title} [${id}] - ${billData.status}`);
      }
    } catch (err) {
      console.error(`  Error searching "${query}": ${err.message}`);
    }
  }

  // Save new bill metadata
  for (const bill of newBills) {
    const outPath = path.join(DATA_DIR, `${bill.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(bill, null, 2));
    console.log(`Saved: ${outPath}`);
  }

  console.log(`\nResults: ${newBills.length} new bills found`);
  const ready = newBills.filter(b => b.status === 'ready');
  console.log(`  Ready for processing: ${ready.length}`);

  // Output bill IDs for pipeline consumption
  if (ready.length > 0) {
    const ids = ready.map(b => b.id).join(',');
    console.log(`\nREADY_BILLS=${ids}`);
    // Write to file for GitHub Actions
    const outputPath = path.join(__dirname, '..', 'data', 'pending.txt');
    fs.writeFileSync(outputPath, ids);
  }

  return newBills;
}

if (require.main === module) {
  monitor().catch(err => {
    console.error('Monitor failed:', err);
    process.exit(1);
  });
}

module.exports = { monitor, httpGet, getProcessedBills };
