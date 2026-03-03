/**
 * claude.js - Anthropic Claude AI provider
 *
 * Uses the Anthropic Messages API directly via HTTPS (no SDK dependency).
 */

const https = require('https');
const { AIProvider } = require('./base');

const MODELS = {
  fast: process.env.CLAUDE_FAST_MODEL || 'claude-haiku-4-5-20251001',
  smart: process.env.CLAUDE_SMART_MODEL || 'claude-sonnet-4-6-20250514',
};

class ClaudeProvider extends AIProvider {
  constructor() {
    super('Claude');
    this.apiKey = process.env.ANTHROPIC_API_KEY;
  }

  get maxContext() {
    return 200000; // 200K tokens
  }

  get inputCostPer1k() {
    return 0.001; // Haiku pricing
  }

  get outputCostPer1k() {
    return 0.005;
  }

  isAvailable() {
    return !!this.apiKey;
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const model = options.model || (options.quality === 'high' ? MODELS.smart : MODELS.fast);
    const maxTokens = options.maxTokens || 4096;

    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Claude API ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const resp = JSON.parse(data);
            const text = resp.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('');
            resolve({
              text,
              model,
              usage: {
                inputTokens: resp.usage?.input_tokens || 0,
                outputTokens: resp.usage?.output_tokens || 0,
              },
            });
          } catch (e) {
            reject(new Error(`Claude parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { ClaudeProvider, MODELS };
