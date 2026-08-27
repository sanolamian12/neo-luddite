#!/usr/bin/env bash
# 백엔드 배포 — 로컬에서 실행. Oracle 도쿄 서버(git 체크아웃 상시가동)에 SSH로 붙어
# git pull + systemctl restart + health 확인까지 한 번에 한다.
#
# 사용:
#   backend/deploy/deploy.sh
#
# 접속 정보는 환경변수로 오버라이드 가능(기본값은 2026-08-27 기준 실측 확정값,
# history/260714_서버배포_git체크아웃복구_RAG임계값적용.md 에서 git 체크아웃으로 정착):
#   DEPLOY_HOST=ubuntu@132.145.115.166
#   DEPLOY_KEY=docs/ssh-key-2026-07-09.key   (repo 안, gitignore 처리됨 — 커밋 금지)
#   DEPLOY_BRANCH=import-credigraph          (서버가 추적하는 브랜치. main 아님!)
#
# 전제: 배포할 커밋이 이미 origin/$DEPLOY_BRANCH 에 push 되어 있어야 한다
# (서버는 pull만 하지 push는 안 받는다). .env 를 바꿨다면 이 스크립트로는 반영 안 됨 —
# 서버에 직접 SSH 해서 .env 수정 후 별도로 systemctl restart 해야 한다(§ 아래 참고).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-ubuntu@132.145.115.166}"
DEPLOY_KEY="${DEPLOY_KEY:-$REPO_ROOT/docs/ssh-key-2026-07-09.key}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-import-credigraph}"
APP_DIR="/opt/neo-luddite"
SERVICE="neo-luddite-api"

if [ ! -f "$DEPLOY_KEY" ]; then
  echo "[deploy] SSH 키를 찾을 수 없습니다: $DEPLOY_KEY" >&2
  echo "[deploy] DEPLOY_KEY=<경로> 로 지정하거나 docs/ 에 키를 두세요." >&2
  exit 1
fi

echo "[deploy] 로컬에서 $DEPLOY_BRANCH 가 origin 에 push 됐는지 확인 중…"
LOCAL_SHA="$(git -C "$REPO_ROOT" rev-parse "$DEPLOY_BRANCH" 2>/dev/null || true)"
REMOTE_SHA="$(git -C "$REPO_ROOT" rev-parse "origin/$DEPLOY_BRANCH" 2>/dev/null || true)"
if [ -z "$REMOTE_SHA" ]; then
  echo "[deploy] origin/$DEPLOY_BRANCH 를 찾을 수 없습니다 — git fetch 후 재시도하세요." >&2
  exit 1
fi
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "[deploy] 경고: 로컬 $DEPLOY_BRANCH($LOCAL_SHA)와 origin($REMOTE_SHA)이 다릅니다."
  echo "[deploy]        push 를 안 했다면 서버는 이전 코드를 그대로 pull 합니다."
fi

echo "[deploy] $DEPLOY_HOST 에 SSH 접속해 배포 실행…"
ssh -i "$DEPLOY_KEY" -o ConnectTimeout=10 "$DEPLOY_HOST" bash -s <<EOF
set -euo pipefail
cd "$APP_DIR"
echo "[server] 배포 전 커밋: \$(git log --oneline -1)"
git fetch origin "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"
echo "[server] 배포 후 커밋: \$(git log --oneline -1)"

echo "[server] 의존성 변경 시 재설치(requirements-api.txt 해시 비교 없이 매번 안전하게 재실행)…"
cd "$APP_DIR/backend"
.venv/bin/pip install -q -r requirements-api.txt

echo "[server] 서비스 재시작…"
sudo systemctl restart "$SERVICE"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -sf http://127.0.0.1:8787/health >/dev/null 2>&1; then break; fi
done
sudo systemctl is-active "$SERVICE"

echo "[server] health 확인…"
curl -sf http://127.0.0.1:8787/health && echo
curl -sf http://127.0.0.1:8787/rag/health && echo
EOF

echo "[deploy] 완료."
