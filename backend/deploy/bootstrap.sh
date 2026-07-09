#!/usr/bin/env bash
# Seam A 백엔드 서버 부트스트랩 (Oracle 춘천 Ubuntu ARM).
# 인스턴스에 SSH 접속 후 한 번 실행. 코드는 git clone 으로 가져온다는 전제.
#
#   ssh ubuntu@<공인IP>
#   sudo bash bootstrap.sh
#
# 이 스크립트가 하는 일:
#   1) 시스템 패키지(python3-venv, git, caddy)
#   2) /opt/neo-luddite 에 repo clone
#   3) backend 가상환경 + requirements-api.txt 설치
#   4) systemd 유닛 등록(아직 .env 없으면 안내만)
set -euo pipefail

REPO_URL="https://github.com/sanolamian12/neo-luddite.git"
BRANCH="import-credigraph"
APP_DIR="/opt/neo-luddite"

echo "== 0. swap 2GB (E2.1.Micro 1GB RAM 보강) =="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 1. 시스템 패키지 =="
apt-get update -y
apt-get install -y python3-venv python3-pip git debian-keyring debian-archive-keyring apt-transport-https curl

echo "== 2. Caddy 설치(자동 HTTPS용) =="
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 3. repo clone =="
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull
fi
chown -R ubuntu:ubuntu "$APP_DIR"

echo "== 4. 파이썬 venv + 의존성 =="
cd "$APP_DIR/backend"
sudo -u ubuntu python3 -m venv .venv
sudo -u ubuntu .venv/bin/pip install --upgrade pip
sudo -u ubuntu .venv/bin/pip install -r requirements-api.txt

echo "== 5. systemd 유닛 등록 =="
cp deploy/neo-luddite-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable neo-luddite-api

echo ""
echo "=================================================================="
echo " 남은 수동 단계:"
echo "  1) $APP_DIR/backend/.env 를 만든다:"
echo "       cp deploy/env.production.example .env  &&  nano .env"
echo "     → UPSTAGE_API_KEY / SUPABASE_DB_PASSWORD / CORS_ORIGINS 채우기"
echo "  2) sudo systemctl start neo-luddite-api"
echo "     curl http://127.0.0.1:8787/health  → {\"ok\":true} 확인"
echo "  3) /etc/caddy/Caddyfile 도메인 수정 후:"
echo "       sudo systemctl reload caddy"
echo "     curl https://<도메인>/health  → HTTPS 로 동작 확인"
echo "=================================================================="
