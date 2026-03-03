/**
 * grok.js - xAI Grok provider
 *
 * Uses the xAI Chat Completions API (OpenAI-compatible) via HTTPS.
 */

const https = require('https');
const { AIProvider } = require('./base');

const MODELS = {
  fast: process.env.GROK_FAST_MODEL || 'grok-4-1-fast-reasoning',
  smart: process.env.GROK_SMART_MODEL || 'grok-4-1-fast-reasoning',
};

class GrokProvider extends AIProvider {
  constructor() {
    super('Grok');
    this.apiKey = process.env.XAI_API_KEY;
  }

  get maxContext() {
    return 2000000;
  }

  get inputCostPer1k() {
    return 0.0002;
  }

  get outputCostPer1k() {
    return 0.0005;
  }

  isAvailable() {
    return !!this.apiKey;
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) throw new Error('XAI_API_KEY not set');

    const model = options.model || (options.quality === 'high' ? MODELS.smart : MODELS.fast);
    const maxTokens = options.maxTokens || 4096;

    const body = JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.x.ai',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`xAI API ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const resp = JSON.parse(data);
            const text = resp.choices[0]?.message?.content || '';
            resolve({
              text,
              model,
              usage: {
                inputTokens: resp.usage?.prompt_tokens || 0,
                outputTokens: resp.usage?.completion_tokens || 0,
              },
            });
          } catch (e) {
            reject(new Error(`xAI parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { GrokProvider, MODELS };
