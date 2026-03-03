/**
 * openai.js - OpenAI GPT provider
 *
 * Uses the OpenAI Chat Completions API directly via HTTPS (no SDK dependency).
 */

const https = require('https');
const { AIProvider } = require('./base');

const MODELS = {
  fast: process.env.OPENAI_FAST_MODEL || 'gpt-4o-mini',
  smart: process.env.OPENAI_SMART_MODEL || 'gpt-4o',
};

class OpenAIProvider extends AIProvider {
  constructor() {
    super('OpenAI');
    this.apiKey = process.env.OPENAI_API_KEY;
  }

  get maxContext() {
    return 128000; // GPT-4o context
  }

  get inputCostPer1k() {
    return 0.00015; // gpt-4o-mini pricing
  }

  get outputCostPer1k() {
    return 0.0006;
  }

  isAvailable() {
    return !!this.apiKey;
  }

  async complete(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');

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
        hostname: 'api.openai.com',
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
            reject(new Error(`OpenAI API ${res.statusCode}: ${data.slice(0, 300)}`));
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
            reject(new Error(`OpenAI parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = { OpenAIProvider, MODELS };
