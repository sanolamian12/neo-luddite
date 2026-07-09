# Seam C 배포 runbook — Vercel(프론트) + Oracle 춘천(백엔드)

날짜 2026-07-07 · 브랜치 `import-credigraph` · 대상: 7/31 데모(4인 역할극, RAG 0→100 실증)

토폴로지(마스터설계 §6): **프론트 Vercel(ICN 엣지) + 백엔드 Oracle 춘천(FastAPI, always-on) + Supabase(ap-northeast-1, 이미 라이브)**.

> ✅ **Vercel 빌드 호환 확인 완료** — 설치본은 진짜 `vercel/next.js` 16.2.9(포크 아님). `next build` 33 라우트 정상 생성 → Vercel 네이티브 배포 가능, self-host 폴백 불요.

---

## 0. 전체 순서 (의존관계)

```
[A] Oracle 회원가입 + ARM 인스턴스 생성      ← 당신(콘솔). 가장 험한 구간.
        │  공인 IP 확보
        ▼
[B] 서버 부트스트랩(bootstrap.sh)            ← 코드 clone·venv·systemd
        │
        ▼
[C] .env 채우기 + 서비스 start               ← UPSTAGE·SUPABASE·CORS
        │  http://127.0.0.1:8787/health OK
        ▼
[D] HTTPS 노출(Caddy 또는 Cloudflare Tunnel)  ← 프론트가 HTTPS라 필수
        │  https://<도메인>/health OK
        ▼
[E] Vercel 프론트 배포                        ← Root Dir=frontend, env 4개
        │  NEXT_PUBLIC_API_BASE=<백엔드 HTTPS>
        ▼
[F] 양방향 배선 확정 + E2E                    ← CORS_ORIGINS←vercel, CHAT_MODE=remote
```

---

## [A] Oracle Cloud 인스턴스 생성 (당신이 콘솔에서)

1. **회원가입**: https://www.oracle.com/kr/cloud/free/ → "무료로 시작하기".
   - ⚠️ 신용/체크카드 필요(본인확인용, Always Free는 청구 안 됨). 홈 리전을 **춘천(Chuncheon)** 선택.
2. **인스턴스 생성**: 콘솔 → Compute → Instances → Create instance.
   - Image: **Ubuntu 22.04** (또는 24.04)
   - Shape: **Ampere / VM.Standard.A1.Flex** (Always Free), OCPU 2~4 / RAM 12~24GB
   - ⚠️ ARM 무료가 "out of capacity" 로 막히면: shape 확인 후 몇 시간 뒤/다른 AD 로 재시도. 계속 막히면 담당 세션에서 대안(Fly.io 도쿄) 논의.
   - SSH keys: **키 새로 생성 → private key 다운로드**(이게 서버 접속 열쇠, 분실 금지).
3. **방화벽(ingress) 열기**: 인스턴스의 VCN → Security List → Ingress Rules 추가
   - 0.0.0.0/0, TCP **80**, TCP **443** (Caddy HTTPS용). SSH 22 는 기본 열림.
   - ⚠️ Ubuntu 자체 방화벽(iptables)도 있음 — 필요 시 `sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT` 후 저장.
4. **공인 IP 확보**: 인스턴스 상세에 Public IP 표시됨 → 이 IP 를 다음 단계에 사용.

## [B]+[C] 서버 세팅

```bash
ssh -i <다운받은키> ubuntu@<공인IP>
curl -O https://raw.githubusercontent.com/sanolamian12/neo-luddite/import-credigraph/backend/deploy/bootstrap.sh
sudo bash bootstrap.sh            # clone·venv·systemd 등록
cd /opt/neo-luddite/backend
cp deploy/env.production.example .env
nano .env                          # UPSTAGE_API_KEY / SUPABASE_DB_PASSWORD / CORS_ORIGINS
sudo systemctl start neo-luddite-api
curl http://127.0.0.1:8787/health          # {"ok":true,...}
curl http://127.0.0.1:8787/rag/health      # dbConfigured:true, kbPassages:<n>
```

## [D] HTTPS 노출 — 두 갈래

**옵션 1 · Caddy + 무료 도메인(권장, 인증서 유효):**
```bash
# 도메인 없으면 sslip.io 사용: <공인IP>.sslip.io  (예: 152-70-1-2.sslip.io)
sudo nano /etc/caddy/Caddyfile     # api.example.com → 위 이름으로 교체
sudo systemctl reload caddy
curl https://<그 이름>/health       # 유효한 HTTPS 로 응답
```

**옵션 2 · Cloudflare Tunnel(포트 개방 불필요, 도메인 없이도):**
```bash
# cloudflared 설치 후
cloudflared tunnel --url http://127.0.0.1:8787
# → https://<random>.trycloudflare.com 발급(임시). 상시용은 named tunnel + CF 계정.
```
→ 여기서 나온 **HTTPS URL 이 프론트의 `NEXT_PUBLIC_API_BASE`**.

## [E] Vercel 프론트 배포 (당신이 대시보드에서)

1. https://vercel.com → GitHub `sanolamian12/neo-luddite` import.
2. ⚠️ **Root Directory = `frontend`** (모노레포라 반드시 지정). Framework: Next.js 자동감지.
3. **Environment Variables** 4개 등록:
   ```
   NEXT_PUBLIC_SUPABASE_URL       = https://hvnvxfakdhhbakdjkxos.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY  = <frontend/.env.local 의 anon key>
   NEXT_PUBLIC_API_BASE           = <[D]의 백엔드 HTTPS URL>
   NEXT_PUBLIC_CHAT_MODE          = remote      ← ⚠️ 데모는 replay, 라이브는 remote
   ```
4. Deploy → `https://neo-luddite.vercel.app` 류 도메인 확보.

## [F] 양방향 배선 확정 + E2E

1. 백엔드 `.env` 의 `CORS_ORIGINS` 를 **[E]의 실제 Vercel 도메인**으로 → `sudo systemctl restart neo-luddite-api`.
2. 한국에서 브라우저로 Vercel URL 접속 → 로그인 → 챗에서 라이브 질문 → Upstage 응답 왕복.
3. 검수 최종승인 → `/rag/health` 의 `kbPassages` 증가 확인(RAG 성장 루프 폐합).

---

## 체크리스트
- [ ] Oracle 인스턴스 생성 + 공인 IP + 80/443 ingress
- [ ] bootstrap.sh 완료, `/health` 200
- [ ] `.env`: UPSTAGE_API_KEY / SUPABASE_DB_URL(+PASSWORD) / CORS_ORIGINS
- [ ] HTTPS `/health` 200 (Caddy 또는 Tunnel)
- [ ] Vercel: Root=frontend, env 4개, CHAT_MODE=remote
- [ ] CORS_ORIGINS ← Vercel 도메인, 재시작
- [ ] 한국 브라우저 E2E: 챗 라이브 + 검수→RAG 적재
