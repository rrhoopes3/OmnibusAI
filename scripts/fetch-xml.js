/**
 * fetch-xml.js - Download bill XML from GovInfo.gov
 *
 * Takes a bill ID (e.g., "118-hr-4366"), reads its metadata from data/bills/,
 * downloads the XML text, and saves it to data/parsed/{billId}/raw.xml
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function httpGetRaw(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetRaw(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function constructGovInfoUrl(congress, type, number, version = 'enr') {
  // USLM format (preferred, structured XML)
  const pkg = `BILLS-${congress}${type}${number}${version}`;
  return `https://www.govinfo.gov/content/pkg/${pkg}/uslm/${pkg}.xml`;
}

function constructLegacyXmlUrl(congress, type, number, version = 'enr') {
  const pkg = `BILLS-${congress}${type}${number}${version}`;
  return `https://www.govinfo.gov/content/pkg/${pkg}/xml/${pkg}.xml`;
}

async function fetchBillXml(billId) {
  const metaPath = path.join(DATA_DIR, 'bills', `${billId}.json`);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`No metadata found for bill ${billId}. Run monitor first.`);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const outDir = path.join(DATA_DIR, 'parsed', billId);
  const outPath = path.join(outDir, 'raw.xml');

  if (fs.existsSync(outPath)) {
    const stats = fs.statSync(outPath);
    if (stats.size > 1000) {
      console.log(`XML already downloaded for ${billId} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      return outPath;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  // Try USLM format first (best structure), then legacy XML, then metadata URL
  const urls = [
    constructGovInfoUrl(meta.congress, meta.type, meta.number),
    constructLegacyXmlUrl(meta.congress, meta.type, meta.number),
  ];

  if (meta.xmlUrl) {
    urls.push(meta.xmlUrl);
  }

  let xml = null;
  let usedUrl = null;

  for (const url of urls) {
    console.log(`  Trying: ${url}`);
    try {
      xml = await httpGetRaw(url);
      if (xml && xml.length > 500 && (xml.includes('<bill') || xml.includes('<legis-body') || xml.includes('<body'))) {
        usedUrl = url;
        break;
      }
      xml = null;
    } catch (err) {
      console.log(`    Failed: ${err.message}`);
    }
  }

  if (!xml) {
    throw new Error(`Could not download XML for ${billId} from any source.`);
  }

  fs.writeFileSync(outPath, xml);
  const sizeMB = (Buffer.byteLength(xml) / 1024 / 1024).toFixed(1);
  console.log(`Downloaded: ${outPath} (${sizeMB} MB from ${usedUrl})`);

  // Update metadata with actual URL used
  meta.xmlUrl = usedUrl;
  meta.xmlSize = Buffer.byteLength(xml);
  meta.fetchedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return outPath;
}

async function fetchAll() {
  const pendingPath = path.join(DATA_DIR, 'pending.txt');
  let billIds = [];

  if (process.argv[2]) {
    billIds = process.argv[2].split(',');
  } else if (fs.existsSync(pendingPath)) {
    billIds = fs.readFileSync(pendingPath, 'utf-8').trim().split(',').filter(Boolean);
  } else {
    // Fetch all bills with status 'ready'
    const billsDir = path.join(DATA_DIR, 'bills');
    if (fs.existsSync(billsDir)) {
      const files = fs.readdirSync(billsDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const meta = JSON.parse(fs.readFileSync(path.join(billsDir, f), 'utf-8'));
        if (meta.status === 'ready') billIds.push(meta.id);
      }
    }
  }

  if (billIds.length === 0) {
    console.log('No bills to fetch. Run monitor first or pass bill ID as argument.');
    return;
  }

  console.log(`Fetching XML for ${billIds.length} bill(s)...`);
  for (const id of billIds) {
    try {
      await fetchBillXml(id);
    } catch (err) {
      console.error(`Failed to fetch ${id}: ${err.message}`);
    }
  }
}

if (require.main === module) {
  fetchAll().catch(err => {
    console.error('Fetch failed:', err);
    process.exit(1);
  });
}

module.exports = { fetchBillXml };
