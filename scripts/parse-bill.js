/**
 * parse-bill.js - Parse bill XML into structured JSON
 *
 * Takes raw XML from GovInfo and extracts the hierarchical structure:
 * divisions → titles → sections, plus all dollar amounts.
 *
 * Outputs: data/parsed/{billId}/structure.json and spending.json
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const DATA_DIR = path.join(__dirname, '..', 'data');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  preserveOrder: false,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => {
    // These elements can appear multiple times
    return ['division', 'title', 'section', 'subsection', 'paragraph',
            'subparagraph', 'appropriations-major', 'appropriations-intermediate',
            'appropriations-small', 'toc-entry'].includes(name);
  },
});

function extractText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node['#text']) return node['#text'];

  // Recursively collect text from child nodes
  let text = '';
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_')) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      text += child.map(extractText).join(' ');
    } else {
      text += extractText(child);
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function extractDollarAmounts(text) {
  const amounts = [];
  const regex = /\$[\d,]+(?:\.\d{2})?(?:\s*(?:million|billion|thousand))?/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    let value = parseFloat(raw.replace(/[$,]/g, ''));
    const lower = raw.toLowerCase();
    if (lower.includes('billion')) value *= 1_000_000_000;
    else if (lower.includes('million')) value *= 1_000_000;
    else if (lower.includes('thousand')) value *= 1_000;
    amounts.push({ raw, value });
  }
  return amounts;
}

function parseSection(sectionNode) {
  const num = extractText(sectionNode.enum || sectionNode['@_identifier'] || '');
  const header = extractText(sectionNode.header || '');
  const fullText = extractText(sectionNode);
  const dollars = extractDollarAmounts(fullText);

  const subsections = [];
  if (sectionNode.subsection) {
    const subs = Array.isArray(sectionNode.subsection) ? sectionNode.subsection : [sectionNode.subsection];
    for (const sub of subs) {
      subsections.push({
        num: extractText(sub.enum || ''),
        header: extractText(sub.header || ''),
        text: extractText(sub),
      });
    }
  }

  return {
    num: num.replace(/\.$/, ''),
    header,
    text: fullText.slice(0, 2000), // Truncate for structure.json; full text used in summarization
    fullTextLength: fullText.length,
    dollars,
    subsections,
  };
}

function parseAppropriations(node, level = 'major') {
  const items = [];
  if (!node) return items;

  const nodes = Array.isArray(node) ? node : [node];
  for (const n of nodes) {
    const header = extractText(n.header || '');
    const text = extractText(n);
    const dollars = extractDollarAmounts(text);

    const item = {
      level,
      header,
      dollars,
      textPreview: text.slice(0, 500),
    };

    // Recurse into sub-levels
    if (n['appropriations-intermediate']) {
      item.children = parseAppropriations(n['appropriations-intermediate'], 'intermediate');
    }
    if (n['appropriations-small']) {
      item.children = (item.children || []).concat(
        parseAppropriations(n['appropriations-small'], 'small')
      );
    }

    items.push(item);
  }
  return items;
}

function parseTitle(titleNode) {
  const num = extractText(titleNode.enum || '');
  const header = extractText(titleNode.header || '');

  const sections = [];
  if (titleNode.section) {
    const secs = Array.isArray(titleNode.section) ? titleNode.section : [titleNode.section];
    for (const sec of secs) {
      sections.push(parseSection(sec));
    }
  }

  const appropriations = parseAppropriations(titleNode['appropriations-major']);
  const fullText = extractText(titleNode);
  const dollars = extractDollarAmounts(fullText);

  return {
    num,
    header,
    sectionCount: sections.length,
    sections,
    appropriations,
    totalDollars: dollars,
    textLength: fullText.length,
  };
}

function parseDivision(divNode) {
  const num = extractText(divNode.enum || '');
  const header = extractText(divNode.header || '');

  const titles = [];
  if (divNode.title) {
    const ts = Array.isArray(divNode.title) ? divNode.title : [divNode.title];
    for (const t of ts) {
      titles.push(parseTitle(t));
    }
  }

  // Some divisions have sections directly (no titles)
  const directSections = [];
  if (divNode.section) {
    const secs = Array.isArray(divNode.section) ? divNode.section : [divNode.section];
    for (const sec of secs) {
      directSections.push(parseSection(sec));
    }
  }

  const fullText = extractText(divNode);
  const dollars = extractDollarAmounts(fullText);

  return {
    num,
    header,
    titleCount: titles.length,
    titles,
    directSections,
    totalDollars: dollars,
    textLength: fullText.length,
  };
}

function parseBill(xmlString) {
  const parsed = xmlParser.parse(xmlString);

  // Navigate to the bill root - handle different XML formats
  let bill = parsed.bill || parsed.resolution || parsed;
  let legisBody = bill['legis-body'] || bill.body || bill;

  // Extract metadata
  const form = bill.form || {};
  const meta = {
    congress: extractText(form.congress || ''),
    session: extractText(form.session || ''),
    legisNum: extractText(form['legis-num'] || ''),
    legisType: extractText(form['legis-type'] || ''),
    officialTitle: extractText(form['official-title'] || ''),
  };

  // Parse divisions
  const divisions = [];
  if (legisBody.division) {
    const divs = Array.isArray(legisBody.division) ? legisBody.division : [legisBody.division];
    for (const div of divs) {
      divisions.push(parseDivision(div));
    }
  }

  // Top-level sections (before divisions, like short title & TOC)
  const topSections = [];
  if (legisBody.section) {
    const secs = Array.isArray(legisBody.section) ? legisBody.section : [legisBody.section];
    for (const sec of secs) {
      topSections.push(parseSection(sec));
    }
  }

  // Aggregate spending
  const allDollars = [];
  for (const div of divisions) {
    allDollars.push(...div.totalDollars);
    for (const title of div.titles) {
      allDollars.push(...title.totalDollars);
    }
  }

  return {
    meta,
    divisionCount: divisions.length,
    divisions,
    topSections,
    spending: {
      totalMentions: allDollars.length,
      largestAmounts: allDollars
        .sort((a, b) => b.value - a.value)
        .slice(0, 50),
    },
    parsedAt: new Date().toISOString(),
  };
}

function parseBillFile(billId) {
  const xmlPath = path.join(DATA_DIR, 'parsed', billId, 'raw.xml');
  if (!fs.existsSync(xmlPath)) {
    throw new Error(`No XML found for ${billId}. Run fetch-xml first.`);
  }

  console.log(`Parsing ${billId}...`);
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  console.log(`  XML size: ${(xml.length / 1024 / 1024).toFixed(1)} MB`);

  const structure = parseBill(xml);
  console.log(`  Divisions: ${structure.divisionCount}`);
  console.log(`  Total spending mentions: ${structure.spending.totalMentions}`);

  for (const div of structure.divisions) {
    console.log(`    Division ${div.num}: ${div.header} (${div.titleCount} titles, ${div.textLength} chars)`);
  }

  // Write structure
  const structPath = path.join(DATA_DIR, 'parsed', billId, 'structure.json');
  fs.writeFileSync(structPath, JSON.stringify(structure, null, 2));
  console.log(`  Wrote: ${structPath}`);

  // Write spending summary
  const spendPath = path.join(DATA_DIR, 'parsed', billId, 'spending.json');
  fs.writeFileSync(spendPath, JSON.stringify(structure.spending, null, 2));
  console.log(`  Wrote: ${spendPath}`);

  return structure;
}

function parseAll() {
  const billId = process.argv[2];
  if (billId) {
    parseBillFile(billId);
    return;
  }

  // Parse all bills that have raw.xml but no structure.json
  const parsedDir = path.join(DATA_DIR, 'parsed');
  if (!fs.existsSync(parsedDir)) return;

  const dirs = fs.readdirSync(parsedDir);
  for (const dir of dirs) {
    const xmlPath = path.join(parsedDir, dir, 'raw.xml');
    const structPath = path.join(parsedDir, dir, 'structure.json');
    if (fs.existsSync(xmlPath) && !fs.existsSync(structPath)) {
      try {
        parseBillFile(dir);
      } catch (err) {
        console.error(`Error parsing ${dir}: ${err.message}`);
      }
    }
  }
}

if (require.main === module) {
  parseAll();
}

module.exports = { parseBill, parseBillFile, extractDollarAmounts, extractText };
