/**
 * providers/index.js - Provider factory with automatic fallback
 *
 * Provider priority:
 *   AI_PROVIDER=ollama  → Ollama first, then cloud fallback
 *   AI_PROVIDER=claude  → Claude first, then OpenAI, then Ollama
 *   AI_PROVIDER=openai  → OpenAI first, then Claude, then Ollama
 */

const { ClaudeProvider } = require('./claude');
const { OpenAIProvider } = require('./openai');
const { OllamaProvider } = require('./ollama');

function getProviders() {
  const providers = [];
  const preferred = (process.env.AI_PROVIDER || 'claude').toLowerCase();

  const claude = new ClaudeProvider();
  const openai = new OpenAIProvider();
  const ollama = new OllamaProvider();

  const all = { claude, openai, ollama };

  // Add preferred provider first
  if (all[preferred] && all[preferred].isAvailable()) {
    providers.push(all[preferred]);
  }

  // Add remaining as fallbacks (in order: claude, openai, ollama)
  for (const [name, provider] of Object.entries(all)) {
    if (name !== preferred && provider.isAvailable()) {
      providers.push(provider);
    }
  }

  if (providers.length === 0) {
    throw new Error(
      'No AI provider configured. Set one of:\n' +
      '  AI_PROVIDER=ollama + OLLAMA_BASE_URL (local/free)\n' +
      '  ANTHROPIC_API_KEY (Claude)\n' +
      '  OPENAI_API_KEY (OpenAI)'
    );
  }

  console.log(`  AI providers: ${providers.map(p => p.name).join(' → ')}`);
  return providers;
}

/**
 * Run a completion with automatic fallback between providers.
 */
async function completeWithFallback(systemPrompt, userPrompt, options = {}) {
  const providers = getProviders();
  let lastError;

  for (const provider of providers) {
    try {
      const result = await provider.complete(systemPrompt, userPrompt, options);
      result.provider = provider.name;
      return result;
    } catch (err) {
      console.error(`  ${provider.name} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`All providers failed. Last error: ${lastError.message}`);
}

module.exports = { getProviders, completeWithFallback };
