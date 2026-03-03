/**
 * base.js - Abstract AI provider interface
 *
 * All providers implement this interface. The orchestrator picks
 * a provider based on config and falls back on errors.
 */

class AIProvider {
  constructor(name) {
    this.name = name;
  }

  /** Maximum input tokens this provider/model combo supports */
  get maxContext() {
    throw new Error(`${this.name}: maxContext not implemented`);
  }

  /** Cost per 1K input tokens (USD) */
  get inputCostPer1k() {
    return 0;
  }

  /** Cost per 1K output tokens (USD) */
  get outputCostPer1k() {
    return 0;
  }

  /**
   * Send a prompt to the AI and get a response.
   * @param {string} systemPrompt - System/context instructions
   * @param {string} userPrompt - The actual content to process
   * @param {object} options - { maxTokens, temperature, model }
   * @returns {Promise<{text: string, usage: {inputTokens: number, outputTokens: number}}>}
   */
  async complete(systemPrompt, userPrompt, options = {}) {
    throw new Error(`${this.name}: complete() not implemented`);
  }

  /**
   * Check if this provider is configured and available.
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}

module.exports = { AIProvider };
