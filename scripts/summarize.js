/**
 * summarize.js - AI summarization orchestrator
 *
 * Reads parsed bill structure, chunks text for AI processing,
 * generates summaries at division/title/section levels,
 * and writes results to data/summaries/{billId}/
 */

const fs = require('fs');
const path = require('path');
const { completeWithFallback } = require('../providers');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROMPTS_DIR = path.join(__dirname, '..', 'providers', 'prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.txt`), 'utf-8');
}

function loadRawXml(billId) {
  const xmlPath = path.join(DATA_DIR, 'parsed', billId, 'raw.xml');
  return fs.readFileSync(xmlPath, 'utf-8');
}

function extractDivisionXml(fullXml, divNum) {
  // Extract the XML chunk for a specific division
  const divPatterns = [
    // USLM format
    new RegExp(`<division[^>]*>\\s*<num>${divNum}</num>[\\s\\S]*?</division>`, 'i'),
    new RegExp(`<division[^>]*>\\s*<enum>${divNum}</enum>[\\s\\S]*?</division>`, 'i'),
    // Legacy format
    new RegExp(`<division[^>]*enum="${divNum}"[^>]*>[\\s\\S]*?</division>`, 'i'),
  ];

  for (const pattern of divPatterns) {
    const match = fullXml.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractTitleXml(divXml, titleNum) {
  const patterns = [
    new RegExp(`<title[^>]*>\\s*<num>${titleNum}</num>[\\s\\S]*?</title>`, 'i'),
    new RegExp(`<title[^>]*>\\s*<enum>${titleNum}</enum>[\\s\\S]*?</title>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = divXml.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// Rough token estimate: ~4 chars per token for English
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function truncateForContext(text, maxTokens = 150000) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated for context window ...]';
}

async function summarizeDivision(billId, divNum, divHeader, divXml) {
  const prompt = loadPrompt('division-overview');
  const content = truncateForContext(divXml);

  console.log(`    Summarizing Division ${divNum}: ${divHeader} (${estimateTokens(content)} est. tokens)`);

  const result = await completeWithFallback(
    prompt,
    `Here is Division ${divNum} — "${divHeader}" of the bill:\n\n${content}`,
    { quality: 'high', maxTokens: 4096 }
  );

  console.log(`      Done (${result.provider}, ${result.usage.inputTokens + result.usage.outputTokens} tokens)`);
  return result;
}

async function summarizeTitle(billId, divNum, titleNum, titleHeader, titleXml) {
  const prompt = loadPrompt('title-detail');
  const content = truncateForContext(titleXml, 100000);

  console.log(`      Summarizing Title ${titleNum}: ${titleHeader} (${estimateTokens(content)} est. tokens)`);

  const result = await completeWithFallback(
    prompt,
    `Here is Title ${titleNum} — "${titleHeader}" from Division ${divNum}:\n\n${content}`,
    { quality: 'low', maxTokens: 2048 }
  );

  console.log(`        Done (${result.provider}, ${result.usage.inputTokens + result.usage.outputTokens} tokens)`);
  return result;
}

async function summarizeBillOverview(billId, structure, divisionSummaries) {
  const prompt = loadPrompt('bill-overview');

  // Build context from structure + division summaries
  let context = `Bill: ${structure.meta.officialTitle}\n`;
  context += `Congress: ${structure.meta.congress}\n`;
  context += `Divisions: ${structure.divisionCount}\n\n`;

  for (const div of structure.divisions) {
    context += `## Division ${div.num} — ${div.header}\n`;
    context += `Titles: ${div.titleCount}, Text length: ${div.textLength} chars\n`;
    if (div.totalDollars.length > 0) {
      const top3 = div.totalDollars.slice(0, 3).map(d => d.raw).join(', ');
      context += `Largest amounts: ${top3}\n`;
    }
    const divSummary = divisionSummaries[div.num];
    if (divSummary) {
      context += `AI Summary:\n${divSummary.text.slice(0, 1000)}\n`;
    }
    context += '\n';
  }

  console.log(`  Generating bill overview (${estimateTokens(context)} est. tokens)...`);

  const result = await completeWithFallback(
    prompt,
    context,
    { quality: 'high', maxTokens: 4096 }
  );

  console.log(`    Done (${result.provider}, ${result.usage.inputTokens + result.usage.outputTokens} tokens)`);
  return result;
}

async function summarizeBill(billId) {
  const structPath = path.join(DATA_DIR, 'parsed', billId, 'structure.json');
  if (!fs.existsSync(structPath)) {
    throw new Error(`No structure.json for ${billId}. Run parse-bill first.`);
  }

  const structure = JSON.parse(fs.readFileSync(structPath, 'utf-8'));
  const rawXml = loadRawXml(billId);
  const outDir = path.join(DATA_DIR, 'summaries', billId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Summarizing ${billId}: ${structure.divisionCount} divisions`);

  let totalCost = 0;
  const divisionSummaries = {};

  // Summarize each division
  for (const div of structure.divisions) {
    const divXml = extractDivisionXml(rawXml, div.num);
    if (!divXml) {
      console.log(`    Skipping Division ${div.num}: could not extract XML`);
      continue;
    }

    const divResult = await summarizeDivision(billId, div.num, div.header, divXml);
    divisionSummaries[div.num] = divResult;

    const divOut = {
      division: div.num,
      header: div.header,
      summary: divResult.text,
      provider: divResult.provider,
      model: divResult.model,
      usage: divResult.usage,
      titles: [],
      generatedAt: new Date().toISOString(),
    };

    // Summarize each title within the division
    for (const title of div.titles) {
      const titleXml = extractTitleXml(divXml, title.num);
      if (!titleXml) continue;

      try {
        const titleResult = await summarizeTitle(billId, div.num, title.num, title.header, titleXml);
        divOut.titles.push({
          num: title.num,
          header: title.header,
          summary: titleResult.text,
          provider: titleResult.provider,
          model: titleResult.model,
          usage: titleResult.usage,
        });
        totalCost += (titleResult.usage.inputTokens * 0.001 + titleResult.usage.outputTokens * 0.005) / 1000;
      } catch (err) {
        console.error(`      Error on Title ${title.num}: ${err.message}`);
        divOut.titles.push({
          num: title.num,
          header: title.header,
          summary: `Error generating summary: ${err.message}`,
          error: true,
        });
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    // Write division summary
    const divPath = path.join(outDir, `div-${div.num.toLowerCase()}.json`);
    fs.writeFileSync(divPath, JSON.stringify(divOut, null, 2));
    console.log(`    Wrote: ${divPath}`);

    totalCost += (divResult.usage.inputTokens * 0.001 + divResult.usage.outputTokens * 0.005) / 1000;
  }

  // Generate overall bill summary
  const overview = await summarizeBillOverview(billId, structure, divisionSummaries);
  const overviewOut = {
    billId,
    meta: structure.meta,
    divisionCount: structure.divisionCount,
    summary: overview.text,
    provider: overview.provider,
    model: overview.model,
    usage: overview.usage,
    generatedAt: new Date().toISOString(),
  };

  const overviewPath = path.join(outDir, 'overview.json');
  fs.writeFileSync(overviewPath, JSON.stringify(overviewOut, null, 2));
  console.log(`  Wrote: ${overviewPath}`);

  console.log(`\nDone. Estimated API cost: $${totalCost.toFixed(4)}`);
  return overviewOut;
}

async function main() {
  const billId = process.argv[2];
  if (!billId) {
    // Process all bills that have structure but no summaries
    const parsedDir = path.join(DATA_DIR, 'parsed');
    if (!fs.existsSync(parsedDir)) {
      console.log('No parsed bills found.');
      return;
    }
    const dirs = fs.readdirSync(parsedDir);
    for (const dir of dirs) {
      const structPath = path.join(parsedDir, dir, 'structure.json');
      const summaryPath = path.join(DATA_DIR, 'summaries', dir, 'overview.json');
      if (fs.existsSync(structPath) && !fs.existsSync(summaryPath)) {
        await summarizeBill(dir);
      }
    }
  } else {
    await summarizeBill(billId);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Summarization failed:', err);
    process.exit(1);
  });
}

module.exports = { summarizeBill };
