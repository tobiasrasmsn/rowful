#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/tobiasrasmsn/planar.git"
REPO_BRANCH="main"
INSTALL_DIR="${PLANAR_INSTALL_DIR:-/opt/planar}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Error: This installer supports Ubuntu/Debian systems with apt-get."
  exit 1
fi

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "Error: Run as root or install sudo."
    exit 1
  fi
fi

CURRENT_USER="${SUDO_USER:-${USER:-ubuntu}}"

log() {
  echo "[install] $*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

get_public_ip() {
  local ip=""
  ip="$(curl -4fsS --max-time 6 https://api.ipify.org || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -4fsS --max-time 6 https://ifconfig.me || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  echo "$ip"
}

set_env_var() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

install_docker() {
  if has_cmd docker && docker --version >/dev/null 2>&1; then
    log "Docker already installed."
    return
  fi

  log "Installing Docker Engine + Compose plugin..."
  $SUDO apt-get update -y
  $SUDO apt-get install -y ca-certificates curl gnupg lsb-release
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  local codename
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
}

ensure_compose() {
  if docker compose version >/dev/null 2>&1; then
    return
  fi
  log "Installing docker-compose-plugin..."
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-compose-plugin
}

configure_docker_permissions() {
  if getent group docker >/dev/null 2>&1; then
    true
  else
    $SUDO groupadd docker
  fi

  if id -nG "$CURRENT_USER" | tr ' ' '\n' | grep -qx docker; then
    return
  fi

  log "Adding ${CURRENT_USER} to docker group..."
  $SUDO usermod -aG docker "$CURRENT_USER" || true
}

maybe_open_firewall() {
  if has_cmd ufw; then
    if $SUDO ufw status | grep -q "Status: active"; then
      log "Opening firewall ports 80/tcp and 8080/tcp via ufw..."
      $SUDO ufw allow 80/tcp >/dev/null || true
      $SUDO ufw allow 8080/tcp >/dev/null || true
    fi
  fi
}

wait_for_backend() {
  local backend_url="$1"
  local attempts=90
  local delay=2
  local i

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "${backend_url}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

log "Installing base packages..."
$SUDO apt-get update -y
$SUDO apt-get install -y curl git ca-certificates

log "Fetching repository ${REPO_URL} (${REPO_BRANCH}) into ${INSTALL_DIR}..."
$SUDO mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  $SUDO git -C "$INSTALL_DIR" fetch --all --tags
  $SUDO git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
  $SUDO git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"
else
  if [[ -e "$INSTALL_DIR" ]]; then
    echo "Error: $INSTALL_DIR exists but is not a git repository. Remove it or set PLANAR_INSTALL_DIR."
    exit 1
  fi
  $SUDO git clone --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

$SUDO chown -R "$CURRENT_USER":"$CURRENT_USER" "$INSTALL_DIR" || true
cd "$INSTALL_DIR"

if [[ ! -f "docker-compose.yml" ]]; then
  echo "Error: docker-compose.yml not found in $INSTALL_DIR"
  exit 1
fi

install_docker
ensure_compose
configure_docker_permissions
maybe_open_firewall

PUBLIC_IP="$(get_public_ip)"
if [[ -z "$PUBLIC_IP" ]]; then
  log "Could not detect a public IP automatically. Falling back to localhost."
  PUBLIC_IP="localhost"
fi

FRONTEND_PORT="${FRONTEND_PORT:-80}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_ORIGIN="http://${PUBLIC_IP}"
if [[ "$FRONTEND_PORT" != "80" ]]; then
  FRONTEND_ORIGIN="${FRONTEND_ORIGIN}:${FRONTEND_PORT}"
fi

if [[ ! -f .env ]]; then
  cat > .env <<ENVEOF
FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}
VITE_API_BASE_URL=http://${PUBLIC_IP}:${BACKEND_PORT}
ALLOWED_ORIGINS=${FRONTEND_ORIGIN},http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173
MAX_FILE_SIZE_MB=25
DB_PATH=/data/planar.db
UPLOAD_DIR=/data/uploads
ENVEOF
else
  set_env_var "FRONTEND_PORT" "${FRONTEND_PORT}"
  set_env_var "BACKEND_PORT" "${BACKEND_PORT}"
  set_env_var "VITE_API_BASE_URL" "http://${PUBLIC_IP}:${BACKEND_PORT}"
  set_env_var "ALLOWED_ORIGINS" "${FRONTEND_ORIGIN},http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173"
  set_env_var "MAX_FILE_SIZE_MB" "25"
  set_env_var "DB_PATH" "/data/planar.db"
  set_env_var "UPLOAD_DIR" "/data/uploads"
fi

log "Building and starting containers..."
$SUDO docker compose down >/dev/null 2>&1 || true
$SUDO docker compose up -d --build

log "Waiting for backend health check..."
if ! wait_for_backend "http://${PUBLIC_IP}:${BACKEND_PORT}"; then
  echo
  echo "Install finished, but backend health check did not pass yet."
  echo "Inspect with: sudo docker compose -f ${INSTALL_DIR}/docker-compose.yml logs --tail=200"
  exit 1
fi

echo
log "Install complete."
echo "Frontend URL: http://${PUBLIC_IP}:${FRONTEND_PORT}"
echo "Backend API:  http://${PUBLIC_IP}:${BACKEND_PORT}"
echo "Healthcheck:  http://${PUBLIC_IP}:${BACKEND_PORT}/health"
echo

echo "Project directory: ${INSTALL_DIR}"
echo "If docker fails without sudo in a new shell, run: newgrp docker"
