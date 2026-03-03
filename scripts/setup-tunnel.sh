#!/bin/bash
# setup-tunnel.sh — Set up Cloudflare Tunnel to expose Ollama remotely
#
# This lets GitHub Actions (or any remote machine) call your local
# Ollama instance via https://ollama.omnibusai.info
#
# Prerequisites:
#   - Ollama running on localhost:11434
#   - omnibusai.info domain on Cloudflare DNS
#   - cloudflared installed

set -e

TUNNEL_NAME="ollama-local"
HOSTNAME="ollama.omnibusai.info"
LOCAL_SERVICE="http://localhost:11434"

echo "=== OmnibusAI: Cloudflare Tunnel Setup ==="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
  echo "Installing cloudflared..."
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    curl -L --output /tmp/cloudflared.deb \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i /tmp/cloudflared.deb
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    brew install cloudflare/cloudflare/cloudflared
  else
    echo "Please install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
  fi
fi

echo "cloudflared version: $(cloudflared --version)"
echo ""

# Login if not already
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "Logging in to Cloudflare (opens browser)..."
  cloudflared tunnel login
  echo ""
fi

# Check if tunnel exists
if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
  echo "Tunnel '$TUNNEL_NAME' already exists."
  TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
else
  echo "Creating tunnel '$TUNNEL_NAME'..."
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
fi

echo "Tunnel ID: $TUNNEL_ID"
echo ""

# Create config
CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"

cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: $CONFIG_DIR/$TUNNEL_ID.json

ingress:
  - hostname: $HOSTNAME
    service: $LOCAL_SERVICE
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF

echo "Config written to $CONFIG_FILE"
echo ""

# Route DNS
echo "Routing DNS: $HOSTNAME → tunnel..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>/dev/null || \
  echo "DNS route may already exist (that's OK)"
echo ""

echo "=== Setup complete ==="
echo ""
echo "To start the tunnel:"
echo "  cloudflared tunnel run $TUNNEL_NAME"
echo ""
echo "To install as a system service (auto-start on boot):"
echo "  sudo cloudflared service install"
echo "  sudo systemctl start cloudflared"
echo ""
echo "To secure with Cloudflare Access (recommended):"
echo "  1. Go to: https://one.dash.cloudflare.com → Access → Applications"
echo "  2. Add Self-Hosted App: $HOSTNAME"
echo "  3. Create a Service Token (Access → Service Tokens)"
echo "  4. Add these to your .env and GitHub Secrets:"
echo "     CF_ACCESS_CLIENT_ID=<client_id>"
echo "     CF_ACCESS_CLIENT_SECRET=<client_secret>"
echo ""
echo "Test it:"
echo "  curl https://$HOSTNAME/api/tags"
echo ""
