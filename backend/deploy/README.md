# Seam C 배포 runbook — Vercel(프론트) + Oracle 도쿄(백엔드)

토폴로지(마스터설계 §6): **프론트 Vercel(ICN 엣지) + 백엔드 Oracle 도쿄(FastAPI, always-on) + Supabase(ap-northeast-1, 도쿄)**.

> ## ⚠️ 2026-09-24 — 백엔드 박스가 이전됐다
>
> | | 구 (Stopped) | **현행** |
> |---|---|---|
> | 인스턴스 | `instance-20260710-0036` E2.1.Micro 1GB x86 | **`instance-20260924-1411` A1.Flex 2 OCPU/12GB aarch64** |
> | 주소 | `132-145-115-166.sslip.io` (Ephemeral, 반납됨) | **`158-179-177-51.sslip.io` (Reserved)** |
> | SSH 키 | `docs/ssh-key-2026-07-09.key` | **`docs/ssh-key-2026-09-24.key`** |
>
> **아래 본문에 남아 있는 `132.145.115.166`·E2.1.Micro·swap 2GB 서술은 구 박스 이야기다.**
> 구 인스턴스는 **Stopped 로 존치**한다(원복 자리). 지우지 말 것.
>
> 운영 절차 전반(콘솔 경로·원복·재해복구·Vercel 함정)은
> **`history/260924_운영_RUNBOOK_인프라이전_후.md`** 가 정본이다.

## ⚡ 이미 라이브 상태 — 평상시 배포는 이 한 줄

서버가 이미 떠 있다(2026-07-09 초기 배포, 2026-07-14 git 체크아웃으로 정착).
**코드만 바꾼 일상적인 배포는 아래 두 단계면 끝** — 이 문서의 [A]~[F]는 서버를
**처음부터 새로 만들 때만**(재해복구 등) 필요하다.

```bash
# 1) 로컬: import-credigraph 를 origin 에 push (main 도 필요하면 별도로 push — Vercel용)
git push origin import-credigraph

# 2) 서버: git pull + 재시작 + health 확인을 자동으로
backend/deploy/deploy.sh
```

**반드시 기억할 것**: 서버는 `origin/import-credigraph` 를 추적한다(main이 아님).
`git push origin HEAD:main`(Vercel 트리거용)만 하고 `git push origin import-credigraph`를
빼먹으면 — 프론트는 새 코드로 배포되는데 **백엔드는 조용히 이전 코드로 남는다.**
2026-08-27에 실제로 이 실수가 재발했다(§3.4 커밋이 main엔 갔는데 import-credigraph엔
안 가서 `deploy.sh`가 경고를 띄웠음). `deploy.sh`가 push 여부를 자동으로 비교해서
경고해주지만, 애초에 **두 브랜치 모두 push**하는 습관이 안전하다.

접속 정보:
```bash
ssh -i docs/ssh-key-2026-09-24.key ubuntu@158.179.177.51
# 또는 https://158-179-177-51.sslip.io/health
```
키는 repo 안 `docs/`에 있다(gitignore 처리, 커밋 금지 — 실수로 커밋하지 않게 주의).
구 박스 키 `docs/ssh-key-2026-07-09.key` 도 **원복용으로 보존**한다.

### 🚫 `--workers` 를 늘리지 말 것 (박스가 12GB 가 됐어도)

워커가 둘 이상이면 나중에 뜬 워커가 `api/rag/kb2_store.py:781-801` 의 리퍼를 돌려
**다른 워커의 살아있는 job 을 전부 error 처리**한다("단일 프로세스" 전제가 깨진다).
같은 이유로 **백엔드 인스턴스를 두 대 동시에 켜서도 안 된다** — 트래픽이 없어도
두 프로세스가 같은 Supabase 를 폴링하는 것만으로 사고가 난다.
워커 증설은 스케줄러·리퍼 분리가 선행 조건인 별도 과제다.

### 의존성은 lock 으로 설치한다

`requirements-api.txt` 는 전부 `>=` 하한이라 **설치하는 날짜에 따라 다른 버전이 깔린다**
(2026-09-24 실측: `openai` 2.44.0 → 3.19.2 메이저, httpx → httpx2 교체). 프로덕션은
`requirements-api.lock.txt` 로 설치할 것:

```bash
cd /opt/neo-luddite/backend && .venv/bin/pip install -r requirements-api.lock.txt
```

---

## 서버를 처음부터 새로 만들 때 (재해복구용, 평소엔 불필요)

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
