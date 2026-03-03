#!/bin/bash
# setup-ollama.sh — Set up Ollama + recommended models for OmnibusAI
#
# Run on your RTX 3090 machine:
#   chmod +x scripts/setup-ollama.sh
#   ./scripts/setup-ollama.sh

set -e

echo "=== OmnibusAI: Ollama Setup ==="
echo ""

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
  echo "Ollama not found. Installing..."
  curl -fsSL https://ollama.com/install.sh | sh
  echo ""
fi

echo "Ollama version: $(ollama --version 2>/dev/null || echo 'unknown')"
echo ""

# VRAM optimization: enable flash attention + quantized KV cache
# These significantly reduce VRAM usage for large context windows
echo "Setting VRAM optimizations..."
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0

# Start Ollama if not running (with optimizations)
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "Starting Ollama server with VRAM optimizations..."
  echo "  OLLAMA_FLASH_ATTENTION=1 (reduces KV cache memory)"
  echo "  OLLAMA_KV_CACHE_TYPE=q8_0 (halves KV cache vs FP16)"
  OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve &
  sleep 3
fi

echo ""
echo "Pulling recommended models for RTX 3090 (24GB VRAM)..."
echo ""
echo "RTX 3090 VRAM budget:"
echo "  24GB total = model weights + KV cache"
echo "  KV cache grows with context length"
echo "  With q8_0 KV cache: ~50% less KV memory"
echo ""

# Quality model for division overviews
# gemma3:27b-it-q4_K_M — ~20GB weights, leaves ~4GB for KV cache
# With q8_0 KV: fits 16-24K context comfortably
echo "1/3: gemma3:27b-it-q4_K_M (quality model, ~20GB weights)"
echo "     Best for: division-level overviews (16K context)"
echo "     Speed: ~18-25 tokens/sec generation"
ollama pull gemma3:27b-it-q4_K_M

echo ""

# Fast model for title/section summaries
# qwen2.5:14b — ~10GB weights, leaves ~14GB for KV cache
# With q8_0 KV: fits 32-64K context easily
echo "2/3: qwen2.5:14b-instruct-q5_K_M (fast model, ~10GB weights)"
echo "     Best for: title and section summaries (32-64K context)"
echo "     Speed: ~40-55 tokens/sec generation"
ollama pull qwen2.5:14b-instruct-q5_K_M

echo ""

# Fastest model for individual sections
# llama3.1:8b — ~5GB weights, leaves ~19GB for KV cache
# Fits the full 128K context window with room to spare
echo "3/3: llama3.1:8b-instruct (fastest model, ~5GB weights)"
echo "     Best for: quick section-level summaries (128K context)"
echo "     Speed: ~80-112 tokens/sec generation"
ollama pull llama3.1:8b-instruct

echo ""
echo "=== Models installed ==="
ollama list
echo ""

# Quick test
echo "Running quick test with 14b model..."
RESPONSE=$(curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5:14b-instruct-q5_K_M",
    "messages": [{"role": "user", "content": "Summarize in one sentence: The Department of Defense is allocated $886 billion for fiscal year 2024."}],
    "max_tokens": 100,
    "stream": false,
    "options": {"num_ctx": 4096}
  }')

if echo "$RESPONSE" | grep -q "choices"; then
  echo "Test passed! Ollama is working."
  echo "Response: $(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])" 2>/dev/null || echo "$RESPONSE")"
else
  echo "Test failed. Response: $RESPONSE"
fi

echo ""
echo "=== IMPORTANT: VRAM optimization ==="
echo ""
echo "Add these to your shell profile or systemd service for Ollama:"
echo ""
echo "  export OLLAMA_FLASH_ATTENTION=1"
echo "  export OLLAMA_KV_CACHE_TYPE=q8_0"
echo ""
echo "If using systemd (sudo systemctl edit ollama.service):"
echo "  [Service]"
echo "  Environment=\"OLLAMA_FLASH_ATTENTION=1\""
echo "  Environment=\"OLLAMA_KV_CACHE_TYPE=q8_0\""
echo ""
echo "=== Next steps ==="
echo ""
echo "1. Local use (no tunnel needed):"
echo "   cp .env.example .env"
echo "   # Edit .env: AI_PROVIDER=ollama"
echo "   npm run pipeline -- 118-hr-4366"
echo ""
echo "2. Remote access for GitHub Actions (pick one):"
echo ""
echo "   a) Tailscale (RECOMMENDED — private mesh, no public exposure):"
echo "      curl -fsSL https://tailscale.com/install.sh | sh"
echo "      sudo tailscale up"
echo "      # Your machine gets a 100.x.y.z IP on your tailnet"
echo "      # See: scripts/setup-tailscale.sh"
echo ""
echo "   b) Cloudflare Tunnel (public URL on your domain):"
echo "      ./scripts/setup-tunnel.sh"
echo ""
