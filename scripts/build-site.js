/**
 * build-site.js - Generate static HTML from JSON summaries
 *
 * Reads data/summaries/ and data/parsed/, renders HTML using
 * simple template functions, outputs to public/
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const STATIC_DIR = path.join(__dirname, '..', 'static');
const OUT_DIR = path.join(__dirname, '..', 'public');

const SITE = {
  name: 'OmnibusAI',
  tagline: 'AI-powered plain-English breakdowns of federal spending bills',
  url: 'https://omnibusai.info',
  version: '0.1.0',
};

function stripMarkdown(md) {
  return md
    .replace(/^#{1,6}\s+/gm, '')      // headers
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g, '$1')      // italic
    .replace(/^- /gm, '')             // list bullets
    .replace(/\|[^|]+/g, '')          // table syntax
    .replace(/\n{2,}/g, ' ')          // collapse newlines
    .trim();
}

// Simple template engine: replaces {{key}} and {{#each items}}...{{/each}}
function render(template, data) {
  let result = template;

  // Handle {{#each key}}...{{/each}} blocks
  result = result.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, key, body) => {
    const items = data[key];
    if (!Array.isArray(items)) return '';
    return items.map((item, index) => {
      const itemData = typeof item === 'object' ? { ...item, _index: index } : { value: item, _index: index };
      return render(body, { ...data, ...itemData });
    }).join('');
  });

  // Handle {{#if key}}...{{/if}} blocks
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, body) => {
    return data[key] ? render(body, data) : '';
  });

  // Handle {{key}} replacements
  result = result.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, keyPath) => {
    const keys = keyPath.split('.');
    let val = data;
    for (const k of keys) {
      if (val == null) return '';
      val = val[k];
    }
    return val != null ? String(val) : '';
  });

  return result;
}

function loadTemplate(name) {
  const filePath = path.join(TEMPLATE_DIR, `${name}.html`);
  return fs.readFileSync(filePath, 'utf-8');
}

function markdownToHtml(md) {
  if (!md) return '';
  return md
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`)
    .replace(/<\/ul>\s*<ul>/g, '')
    // Tables
    .replace(/\|(.+)\|/g, (match, content) => {
      const cells = content.split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
      const tag = 'td';
      const row = cells.map(c => `<${tag}>${c}</${tag}>`).join('');
      return `<tr>${row}</tr>`;
    })
    .replace(/(<tr>[\s\S]*?<\/tr>)/g, (m) => `<table>${m}</table>`)
    .replace(/<\/table>\s*<table>/g, '')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hultop])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '')
    // Dollar highlights
    .replace(/(\$[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|thousand))?)/gi,
      '<span class="dollar">$1</span>');
}

function getAllBills() {
  const summariesDir = path.join(DATA_DIR, 'summaries');
  if (!fs.existsSync(summariesDir)) return [];

  const bills = [];
  const dirs = fs.readdirSync(summariesDir);
  for (const dir of dirs) {
    const overviewPath = path.join(summariesDir, dir, 'overview.json');
    if (!fs.existsSync(overviewPath)) continue;

    const overview = JSON.parse(fs.readFileSync(overviewPath, 'utf-8'));
    const structPath = path.join(DATA_DIR, 'parsed', dir, 'structure.json');
    const structure = fs.existsSync(structPath)
      ? JSON.parse(fs.readFileSync(structPath, 'utf-8'))
      : null;

    bills.push({ id: dir, overview, structure });
  }

  return bills.sort((a, b) => (b.overview.generatedAt || '').localeCompare(a.overview.generatedAt || ''));
}

function getDivisionSummaries(billId) {
  const summaryDir = path.join(DATA_DIR, 'summaries', billId);
  if (!fs.existsSync(summaryDir)) return [];

  return fs.readdirSync(summaryDir)
    .filter(f => f.startsWith('div-') && f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(summaryDir, f), 'utf-8')))
    .sort((a, b) => (a.division || '').localeCompare(b.division || ''));
}

function buildIndex(bills) {
  const layout = loadTemplate('layout');
  const index = loadTemplate('index');

  const billCards = bills.map(b => {
    const meta = b.overview.meta || {};
    return {
      id: b.id,
      title: meta.officialTitle || meta.legisNum || b.id,
      shortTitle: (meta.officialTitle || b.id).slice(0, 100),
      congress: meta.congress || '',
      divisionCount: b.overview.divisionCount || 0,
      generatedAt: b.overview.generatedAt ? new Date(b.overview.generatedAt).toLocaleDateString() : '',
      summaryPreview: stripMarkdown((b.overview.summary || '')).slice(0, 300) + '...',
    };
  });

  const content = render(index, { bills: billCards, billCount: bills.length });
  const page = render(layout, {
    title: `${SITE.name} — ${SITE.tagline}`,
    content,
    siteName: SITE.name,
    siteUrl: SITE.url,
    pageUrl: SITE.url,
    description: SITE.tagline,
    version: SITE.version,
  });

  const outPath = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(outPath, page);
  console.log(`  Built: ${outPath}`);
}

function buildBillPage(bill) {
  const layout = loadTemplate('layout');
  const billTemplate = loadTemplate('bill');

  const divisions = getDivisionSummaries(bill.id);
  const meta = bill.overview.meta || {};

  const divCards = divisions.map(d => ({
    num: d.division,
    header: d.header,
    summaryHtml: markdownToHtml(d.summary),
    titleCount: d.titles ? d.titles.length : 0,
    slug: `div-${d.division.toLowerCase()}`,
  }));

  const content = render(billTemplate, {
    billId: bill.id,
    title: meta.officialTitle || bill.id,
    congress: meta.congress,
    legisNum: meta.legisNum,
    summaryHtml: markdownToHtml(bill.overview.summary),
    divisions: divCards,
    divisionCount: divisions.length,
    generatedAt: bill.overview.generatedAt ? new Date(bill.overview.generatedAt).toLocaleDateString() : '',
    provider: bill.overview.provider || '',
  });

  const page = render(layout, {
    title: `${meta.legisNum || bill.id} — ${SITE.name}`,
    content,
    siteName: SITE.name,
    siteUrl: SITE.url,
    pageUrl: `${SITE.url}/bill/${bill.id}/`,
    description: `AI breakdown of ${meta.officialTitle || bill.id}`,
    version: SITE.version,
  });

  const billDir = path.join(OUT_DIR, 'bill', bill.id);
  fs.mkdirSync(billDir, { recursive: true });
  fs.writeFileSync(path.join(billDir, 'index.html'), page);
  console.log(`  Built: bill/${bill.id}/index.html`);

  // Build individual division pages
  for (const div of divisions) {
    buildDivisionPage(bill, div);
  }
}

function buildDivisionPage(bill, div) {
  const layout = loadTemplate('layout');
  const divTemplate = loadTemplate('division');

  const titles = (div.titles || []).map(t => ({
    num: t.num,
    header: t.header,
    summaryHtml: markdownToHtml(t.summary),
    hasError: t.error ? 'true' : '',
  }));

  const content = render(divTemplate, {
    billId: bill.id,
    divNum: div.division,
    divHeader: div.header,
    summaryHtml: markdownToHtml(div.summary),
    titles,
    titleCount: titles.length,
    provider: div.provider || '',
    generatedAt: div.generatedAt ? new Date(div.generatedAt).toLocaleDateString() : '',
  });

  const meta = bill.overview.meta || {};
  const page = render(layout, {
    title: `Division ${div.division}: ${div.header} — ${SITE.name}`,
    content,
    siteName: SITE.name,
    siteUrl: SITE.url,
    pageUrl: `${SITE.url}/bill/${bill.id}/div-${div.division.toLowerCase()}/`,
    description: `AI breakdown of Division ${div.division}: ${div.header}`,
    version: SITE.version,
  });

  const divDir = path.join(OUT_DIR, 'bill', bill.id, `div-${div.division.toLowerCase()}`);
  fs.mkdirSync(divDir, { recursive: true });
  fs.writeFileSync(path.join(divDir, 'index.html'), page);
  console.log(`  Built: bill/${bill.id}/div-${div.division.toLowerCase()}/index.html`);
}

function buildAboutPage() {
  const layout = loadTemplate('layout');
  const about = loadTemplate('about');

  const content = render(about, { siteName: SITE.name, siteUrl: SITE.url });
  const page = render(layout, {
    title: `About — ${SITE.name}`,
    content,
    siteName: SITE.name,
    siteUrl: SITE.url,
    pageUrl: `${SITE.url}/about/`,
    description: `How ${SITE.name} works — automated AI breakdowns of federal spending bills`,
    version: SITE.version,
  });

  const aboutDir = path.join(OUT_DIR, 'about');
  fs.mkdirSync(aboutDir, { recursive: true });
  fs.writeFileSync(path.join(aboutDir, 'index.html'), page);
  console.log(`  Built: about/index.html`);
}

function copyStaticFiles() {
  // Recursively copy static/ to public/
  function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  copyDir(STATIC_DIR, OUT_DIR);
  console.log('  Copied static files');
}

function buildSite() {
  console.log('Building site...');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  copyStaticFiles();

  const bills = getAllBills();
  console.log(`  Found ${bills.length} bill(s) with summaries`);

  buildIndex(bills);
  for (const bill of bills) {
    buildBillPage(bill);
  }
  buildAboutPage();

  // Build RSS feed
  buildRssFeed(bills);

  console.log(`Site built: ${OUT_DIR}/`);
}

function buildRssFeed(bills) {
  const items = bills.slice(0, 20).map(b => {
    const meta = b.overview.meta || {};
    return `    <item>
      <title>${escapeXml(meta.officialTitle || b.id)}</title>
      <link>${SITE.url}/bill/${b.id}/</link>
      <description>${escapeXml((b.overview.summary || '').slice(0, 500))}</description>
      <pubDate>${new Date(b.overview.generatedAt || Date.now()).toUTCString()}</pubDate>
      <guid>${SITE.url}/bill/${b.id}/</guid>
    </item>`;
  }).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE.name}</title>
    <link>${SITE.url}</link>
    <description>${SITE.tagline}</description>
    <atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  fs.writeFileSync(path.join(OUT_DIR, 'feed.xml'), rss);
  console.log('  Built: feed.xml');
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

if (require.main === module) {
  buildSite();
}

module.exports = { buildSite };
