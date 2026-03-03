#!/bin/bash
# setup-tailscale.sh — Set up Tailscale for secure remote access to Ollama
#
# Tailscale creates a private WireGuard mesh network between your devices.
# Your Ollama server is NEVER exposed to the public internet.
#
# Flow:
#   GitHub Actions runner → joins tailnet → calls your 3090's Tailscale IP → disconnects
#
# Prerequisites:
#   - Tailscale account (free: https://login.tailscale.com/start)
#   - Ollama running on localhost:11434

set -e

echo "=== OmnibusAI: Tailscale Setup ==="
echo ""

# Install Tailscale if not present
if ! command -v tailscale &> /dev/null; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
  echo ""
fi

echo "Tailscale version: $(tailscale version 2>/dev/null || echo 'unknown')"
echo ""

# Connect to tailnet
STATUS=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('BackendState',''))" 2>/dev/null || echo "")
if [ "$STATUS" != "Running" ]; then
  echo "Connecting to Tailscale..."
  echo "(This will open a browser to authenticate)"
  sudo tailscale up
else
  echo "Tailscale is already connected."
fi

echo ""

# Get this machine's Tailscale IP
TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
echo "Your Tailscale IP: $TS_IP"
echo ""

# Set Ollama to listen on all interfaces (needed for Tailscale access)
echo "Configuring Ollama to accept connections on Tailscale interface..."
echo ""
echo "Add to your Ollama environment (systemd or shell):"
echo ""
echo "  export OLLAMA_HOST=0.0.0.0:11434"
echo "  export OLLAMA_API_KEY=\"\$(openssl rand -hex 32)\"  # generate once, save it"
echo "  export OLLAMA_FLASH_ATTENTION=1"
echo "  export OLLAMA_KV_CACHE_TYPE=q8_0"
echo ""

if systemctl is-active ollama &>/dev/null; then
  echo "Ollama is running as a systemd service. To configure:"
  echo "  sudo systemctl edit ollama.service"
  echo ""
  echo "Add:"
  echo "  [Service]"
  echo "  Environment=\"OLLAMA_HOST=0.0.0.0:11434\""
  echo "  Environment=\"OLLAMA_API_KEY=YOUR_GENERATED_KEY\""
  echo "  Environment=\"OLLAMA_FLASH_ATTENTION=1\""
  echo "  Environment=\"OLLAMA_KV_CACHE_TYPE=q8_0\""
  echo ""
  echo "Then: sudo systemctl restart ollama"
fi

echo ""
echo "=== GitHub Actions Setup ==="
echo ""
echo "1. Create an OAuth client in Tailscale admin console:"
echo "   https://login.tailscale.com/admin/settings/oauth"
echo "   - Click 'Generate OAuth client'"
echo "   - Scopes: 'devices:read', 'devices:write'"
echo "   - Save the Client ID and Secret"
echo ""
echo "2. Add to your GitHub repo secrets:"
echo "   TS_OAUTH_CLIENT_ID=<client_id>"
echo "   TS_OAUTH_SECRET=<client_secret>"
echo "   OLLAMA_API_KEY=<the key you generated above>"
echo "   OLLAMA_BASE_URL=http://${TS_IP}:11434"
echo ""
echo "3. The process-bill.yml workflow already supports Tailscale."
echo "   Just add this step before 'Generate AI summaries':"
echo ""
echo "   - name: Connect to Tailscale"
echo "     uses: tailscale/github-action@v3"
echo "     with:"
echo "       oauth-client-id: \${{ secrets.TS_OAUTH_CLIENT_ID }}"
echo "       oauth-secret: \${{ secrets.TS_OAUTH_SECRET }}"
echo "       tags: tag:ci"
echo ""
echo "=== Quick test ==="
echo ""
echo "From another device on your tailnet, run:"
echo "  curl http://${TS_IP}:11434/api/tags"
echo ""
echo "If Ollama has API key auth enabled:"
echo "  curl -H \"Authorization: Bearer YOUR_KEY\" http://${TS_IP}:11434/api/tags"
echo ""
