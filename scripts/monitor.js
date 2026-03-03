/**
 * monitor.js - Poll Congress.gov API for new large spending bills
 *
 * Targets omnibus, minibus, consolidated appropriations, and major
 * supplemental bills. Filters out small single-purpose bills by
 * requiring enrolled/public law status and verifying bill size.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'bills');
const API_BASE = 'https://api.congress.gov/v3';

// Tight search queries targeting actual mega-spending bills
const SEARCH_QUERIES = [
  '"consolidated appropriations act"',
  '"omnibus appropriations act"',
  '"further consolidated appropriations"',
  '"full-year continuing appropriations act"',
  '"making consolidated appropriations"',
  '"supplemental appropriations act"',
  '"additional supplemental appropriations"',
];

// Only care about these bill types
const BILL_TYPES = ['hr', 'hjres'];

// Bill must have one of these text versions to qualify (actually passed)
const REQUIRED_VERSIONS = ['Enrolled Bill', 'Public Law'];

// Title must match at least one of these patterns
const TITLE_PATTERNS = [
  /appropriations?\s+act/i,
  /omnibus/i,
  /consolidated/i,
  /continuing\s+(appropriations?|resolution)/i,
  /supplemental\s+appropriations?/i,
  /government\s+funding/i,
];

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

function titleMatchesSpendingBill(title) {
  return TITLE_PATTERNS.some(pattern => pattern.test(title));
}

function hasEnrolledVersion(textVersions) {
  return textVersions.some(v =>
    v.type && REQUIRED_VERSIONS.some(req => v.type.includes(req))
  );
}

function findEnrolledVersion(textVersions) {
  // Prefer enrolled, then public law
  for (const pref of REQUIRED_VERSIONS) {
    const match = textVersions.find(v => v.type && v.type.includes(pref));
    if (match) return match;
  }
  return null;
}

function extractGovInfoUrl(version) {
  if (!version || !version.formats) return null;
  const xml = version.formats.find(f => f.type === 'Formatted XML' || f.type === 'XML');
  if (xml) return xml.url;
  return null;
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

async function monitor() {
  const apiKey = getApiKey();
  const processed = getProcessedBills();
  const newBills = [];
  const seen = new Set();
  const rejected = { noTitle: 0, noEnrolled: 0, noXml: 0, duplicate: 0 };

  console.log(`Checking for new large spending bills...`);
  console.log(`Already processed: ${processed.size} bills`);

  for (const query of SEARCH_QUERIES) {
    console.log(`  Searching: ${query}`);
    try {
      const bills = await searchBills(apiKey, query);
      for (const bill of bills) {
        const id = billId(bill);
        if (processed.has(id)) continue;
        if (seen.has(id)) { rejected.duplicate++; continue; }
        if (!BILL_TYPES.includes(bill.type.toLowerCase())) continue;
        seen.add(id);

        // Filter 1: Title must look like a spending bill
        if (!titleMatchesSpendingBill(bill.title)) {
          console.log(`    Skip [${id}]: title doesn't match — "${bill.title.slice(0, 80)}"`);
          rejected.noTitle++;
          continue;
        }

        // Filter 2: Must have enrolled/public law text version
        const textVersions = await getBillText(apiKey, bill.congress, bill.type.toLowerCase(), bill.number);
        if (!hasEnrolledVersion(textVersions)) {
          console.log(`    Skip [${id}]: no enrolled/public law version`);
          rejected.noEnrolled++;
          continue;
        }

        const enrolled = findEnrolledVersion(textVersions);
        const xmlUrl = extractGovInfoUrl(enrolled);

        if (!xmlUrl) {
          console.log(`    Skip [${id}]: no XML URL found`);
          rejected.noXml++;
          continue;
        }

        const billData = {
          id,
          congress: bill.congress,
          type: bill.type.toLowerCase(),
          number: bill.number,
          title: bill.title,
          latestAction: bill.latestAction,
          updateDate: bill.updateDate,
          textVersion: enrolled.type,
          xmlUrl,
          discoveredAt: new Date().toISOString(),
          status: 'ready',
        };

        newBills.push(billData);
        console.log(`  MATCH: ${bill.title} [${id}]`);
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

  console.log(`\nResults: ${newBills.length} bills qualified`);
  console.log(`  Rejected: ${rejected.noTitle} wrong title, ${rejected.noEnrolled} not enrolled, ${rejected.noXml} no XML, ${rejected.duplicate} duplicates`);

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
