# 운영 RUNBOOK — 2026-09-24 인프라 이전 이후

> 이 문서는 **"어디에 들어가서 무엇을 바꾸나"** 를 적은 실무용 안내서다.
> 왜 그렇게 했는지(의사결정·검증 기록)는 `260924_Phase0_인프라이전_A1_12GB_ARM64_이관완료.md`,
> 원래 계획은 `docs/doing/260916_Oracle유료이관_착수계획.md` 에 있다.
>
> ⚠️ 이 파일은 GitHub 에 올라간다. **비밀값(API 키·DB 비번·SSH 키·복구 코드)을 여기 적지 말 것.**

---

## 0. 지금 무엇이 어디서 돌고 있나

```
브라우저
  └─ 프론트  Vercel          https://neo-luddite.vercel.app
       └─ 백엔드 Oracle 도쿄  https://158-179-177-51.sslip.io      ← 2026-09-24 이전됨
            ├─ Caddy (자동 HTTPS) → 127.0.0.1:8787
            ├─ systemd  neo-luddite-api  (uvicorn, --workers 1)
            └─ Supabase 도쿄 + Upstage Solar (solar-pro3)
```

| 자원 | 값 |
|---|---|
| Oracle 테넌시 | `ai-champion` · 리전 **Japan East (Tokyo) / ap-tokyo-1** · 요금제 **Pay As You Go**(2026-07-07~) |
| 현행 인스턴스 | `instance-20260924-1411` · VM.Standard.A1.Flex · **2 OCPU / 12GB** · **aarch64(ARM)** · Ubuntu 22.04 |
| 공인 IP | **`158.179.177.51`** — Reserved(`reserved-ip-neo-luddite`). 인스턴스를 껐다 켜도 **안 바뀐다** |
| 구 인스턴스 | `instance-20260710-0036` · E2.1.Micro 1GB · **Stopped** — 지우지 말 것(원복 자리) |
| SSH | `ssh -i docs/ssh-key-2026-09-24.key ubuntu@158.179.177.51` |
| 앱 경로 | `/opt/neo-luddite` (git clone, 브랜치 `import-credigraph`) |

`docs/` 폴더는 `.gitignore` 로 GitHub 에 올라가지 않는다. **SSH 키·복구 코드는 이 PC 의 `docs/` 에만 있다** — PC 를 잃으면 같이 잃는다.

---

## 1. 코드를 고쳤을 때 — 평상시 배포

**두 군데를 각각 배포해야 한다. 한쪽만 하면 조용히 반쪽만 반영된다.**

### 프론트 (Vercel)

```bash
git push origin HEAD:main        # main push 가 Vercel 자동배포의 방아쇠
```

### 백엔드 (Oracle)

```bash
git push origin import-credigraph          # 서버는 이 브랜치를 추적한다
DEPLOY_KEY=docs/ssh-key-2026-09-24.key bash backend/deploy/deploy.sh
```

`deploy.sh` 가 서버에서 `git pull` → 서비스 재시작 → `/health` 확인까지 한다.

> ⚠️ **`deploy.sh` 안의 접속 정보가 구 서버(`132.145.115.166`)로 남아 있으면 갱신해야 한다.** 이전 직후이므로 처음 배포할 때 확인할 것.

**보통 백엔드 먼저, 단 응답 모양이 바뀌는 변경(프론트 Zod 스키마가 모르는 필드)이면 프론트 먼저.**

---

## 2. 서버에서 직접 손볼 때

```bash
ssh -i docs/ssh-key-2026-09-24.key ubuntu@158.179.177.51

# 상태·로그
systemctl status neo-luddite-api
sudo journalctl -u neo-luddite-api -f
sudo journalctl -u neo-luddite-api --no-pager -n 100

# 재시작
sudo systemctl restart neo-luddite-api

# 건강 확인
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/rag/health
```

### 바꿀 일이 있는 파일 세 개

| 파일 | 무엇 | 바꾼 뒤 |
|---|---|---|
| `/opt/neo-luddite/backend/.env` | Upstage 키·Supabase·`CORS_ORIGINS`·`RAG_SOURCE`·`AUTH_MODE` | `sudo systemctl restart neo-luddite-api` |
| `/etc/caddy/Caddyfile` | 도메인(지금 `158-179-177-51.sslip.io`) | `sudo systemctl reload caddy` |
| `/etc/systemd/system/neo-luddite-api.service` | 실행 옵션 | `sudo systemctl daemon-reload && sudo systemctl restart neo-luddite-api` |

> `.env` 는 git 에 없다. **서버 실물이 원본**이다(로컬 사본은 낡았을 수 있다 — 실제로 2개월 드리프트가 있었다).

### 🚫 절대 하지 말 것 — `--workers` 를 늘리는 것

박스가 12GB 가 됐어도 **`--workers 1` 을 유지한다.** 워커가 둘 이상이면 나중에 뜬 워커가
`kb2_store.py:781-801` 리퍼를 돌려 **다른 워커의 살아있는 job 을 전부 error 처리**한다.
유닛 파일 주석에 근거를 적어뒀다. 워커 증설은 스케줄러·리퍼 분리가 선행 조건인 별도 과제다.

같은 이유로 **백엔드 인스턴스를 두 대 동시에 켜서도 안 된다.**

---

## 3. Oracle 콘솔 — 어디로 들어가나

https://cloud.oracle.com · 테넌시 `ai-champion` · **우상단 리전이 Japan East (Tokyo) 인지 항상 확인**

| 하고 싶은 일 | 경로 |
|---|---|
| 인스턴스 보기·끄기·켜기 | **Compute → Instances** |
| 셰이프 변경 (2/12 → 4/24 등) | 인스턴스 → **Actions → Edit → Shape** (A1.Flex 는 **변경 가능**) |
| 공인 IP 확인·교체 | 인스턴스 → **Networking 탭** → Attached VNICs → VNIC 클릭 → **IP administration 탭** |
| Reserved IP 목록 | **Networking → IP management → Reserved public IPs** |
| 방화벽(ingress 80/443) | 인스턴스 → Networking → Subnet 링크 → Security Lists |
| 비용 보기 | **Billing & Cost Management → Cost Management → Cost Analysis** |
| 예산·알림 | **Billing & Cost Management → Cost Management → Budgets** |
| 영수증(환급용) | **Billing & Cost Management → Billing → Invoices / Usage Statements** |
| A1 한도 | **Governance & Administration → Limits, quotas and usage** (Service=Compute, 검색어 `standard-a1`) |

### 비용에 관해 알아둘 것

- 예상 청구는 **월 $2.76 (부트 볼륨만)**. 2 OCPU/12GB 는 **A1 Always Free 한도(4 OCPU/24GB) 안**이라 컴퓨트 요금이 0이다.
- **청구 통화는 SGD** 다(테넌시 개설 시 고정, 변경 불가). 환급이 필요하면 카드 청구서의 원화 결제액을 함께 보관.
- 인보이스는 **다음 달 발행** — 11월 사용분 영수증은 12월 초에 나온다.
- 대회 종료 후 정리 대상: **인스턴스 · Reserved IP · 부트 볼륨**. 인스턴스만 지우면 나머지가 남아 계속 과금될 수 있다.

### 콘솔 표시 함정 (버그가 아니라 표시 방식)

- VNIC 의 `IP lifetime` 열이 Reserved 인데도 `Ephemeral` 로 보인다
- Reserved public IPs 목록의 `VNIC` 열이 비어 보인다
- → **판단 근거는 Reserved IP 의 `State = Assigned`** 와 실제 접속 여부다

---

## 4. Vercel — 어디로 들어가나

https://vercel.com → 프로젝트 **`neo-luddite`**

| 하고 싶은 일 | 경로 |
|---|---|
| 환경변수 | **Settings → Environments → `Production` 행 클릭 → Environment Variables** |
| 재배포 | **Deployments → 최신 배포 → ⋯ → Redeploy** |
| 도메인 | Settings → Domains (`neo-luddite.vercel.app`) |

현재 변수 4개:

```
NEXT_PUBLIC_SUPABASE_URL        (Secret — 건드리지 말 것)
NEXT_PUBLIC_SUPABASE_ANON_KEY   (Secret — 건드리지 말 것)
NEXT_PUBLIC_API_BASE            = https://158-179-177-51.sslip.io   (Config)
NEXT_PUBLIC_CHAT_MODE           = remote      ← replay 로 바꾸면 데모(녹화) 모드
```

### ⚠️ `NEXT_PUBLIC_*` 변수를 고칠 때의 함정

1. **Vercel 은 이제 `NEXT_PUBLIC_` 접두사 변수를 Secret 타입으로 저장하지 못한다.** 저장하려 하면 거부된다.
2. **이미 Secret 으로 저장된 변수는 Config 로 전환도 안 된다.** → **지우고 Config 타입으로 새로 만드는 수밖에 없다.** 이때 Environments 를 `Production` + `Preview` 둘 다로 다시 잡아줘야 한다(안 그러면 프리뷰 배포가 조용히 깨진다).
3. 🚫 **`NEXT_PUBLIC_SUPABASE_ANON_KEY` 와 `_URL` 은 지금 건드리지 말 것.** Secret 은 **열람이 안 되므로**, 지우고 나서 값을 다시 못 넣으면 프론트가 통째로 죽는다. 값을 따로 확보한 뒤에 할 일이다.
4. **`NEXT_PUBLIC_*` 는 빌드 시점에 번들에 박힌다** — 값만 저장하고 **재배포를 안 하면 반영되지 않는다.**

### 백엔드 주소를 바꿨는지 확인하는 법

```bash
curl -s https://neo-luddite.vercel.app/chat/clinic \
  | grep -oE '/_next/static/[^"]+\.js' | sort -u \
  | while read c; do curl -s "https://neo-luddite.vercel.app$c"; done \
  | grep -c "158-179-177-51"
```

0 이 아니면 반영된 것이다. 동시에 옛 주소가 0 인지도 같이 보면 확실하다.

---

## 5. 건강 확인 — 무엇이 정상인가

```bash
curl -s https://158-179-177-51.sslip.io/health
# {"ok":true,"service":"seam-a","model":"solar-pro3","upstageGate":{"capacity":3,...}}

curl -s https://158-179-177-51.sslip.io/rag/health
# {"ragEnabled":true,"dbConfigured":true,"kbPassages":418,"norms":{"source":"db","chars":1314,...}}
```

- `kbPassages` 는 **검수 최종승인을 할 때만 늘어난다**(그 외엔 안 늘어나는 게 정상이다)
- `upstageGate.capacity: 3` — Upstage 동시호출 게이트. 턴 대기 상한 30초
- `norms.source: "db"` — 규범을 DB 원본에서 읽고 있다는 뜻(`md` 면 폴백 상태)

**전체 경로 확인(브라우저)**: `neo-luddite.vercel.app` 로그인 → 챗 화면 우상단이 **`라이브 (Upstage)`** 인지 확인 → 질문 → 응답. 데모 계정 비밀번호는 전부 `demo1234`.

---

## 6. 되돌리기 (구 박스로 원복)

새 박스에 문제가 생겼을 때. **구 인스턴스를 terminate 하지 않은 이유가 이것이다.**

1. 새 박스 서비스 정지: `sudo systemctl disable --now neo-luddite-api`
   → **먼저 이걸 한다.** 두 백엔드가 같은 Supabase 를 보면 리퍼가 서로의 작업을 죽인다.
2. Oracle 콘솔 → 구 인스턴스 `instance-20260710-0036` **Start**
3. **구 박스의 새 공인 IP 를 확인한다** — 구 박스 IP 는 Ephemeral 이라 stop 할 때 반납됐고, 켜면 **다른 주소**를 받는다
4. 구 박스 접속(`docs/ssh-key-2026-07-09.key`) → `/etc/caddy/Caddyfile` 도메인을 `<새IP>.sslip.io` 로 → `sudo systemctl reload caddy`
5. 구 박스 서비스 기동: `sudo systemctl enable --now neo-luddite-api`
6. Vercel `NEXT_PUBLIC_API_BASE` = `https://<구박스 새IP>.sslip.io` → **재배포**

`CORS_ORIGINS` 는 프론트 도메인 기준이라 **어느 경우에도 안 바꿔도 된다.**

---

## 7. 서버를 통째로 새로 만들 때 (재해복구)

```bash
ssh -i <키> ubuntu@<새IP>
curl -O https://raw.githubusercontent.com/sanolamian12/neo-luddite/import-credigraph/backend/deploy/bootstrap.sh
sudo bash bootstrap.sh
```

`bootstrap.sh` 가 **안 해주는 것 세 가지** — 빠뜨리면 조용히 안 된다:

1. **`backend/.env`** — 구 서버에서 회수해 온다(`scp`). git 에 없다.
2. **iptables 80/443** — 없으면 Caddy 가 떠도 외부에서 안 붙는다:
   ```bash
   sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
   sudo iptables -I INPUT 2 -p tcp --dport 80  -j ACCEPT
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```
3. **의존성 고정** — `requirements-api.txt` 는 `>=` 하한뿐이라 만드는 날짜에 따라 다른 버전이 깔린다.
   반드시 **lock 으로 설치**할 것:
   ```bash
   cd /opt/neo-luddite/backend
   .venv/bin/pip install -r requirements-api.lock.txt
   ```
   (2026-09-24 에 그냥 깔았더니 `openai` 가 2.44.0 → 3.19.2 메이저로 올라갔다)

그리고 Caddyfile 도메인을 새 IP 의 `sslip.io` 로 바꾸고 reload.

---

## 8. 아직 안 된 것 (다음에 할 일)

- [ ] **Budget + 임계 알림** — Billing → Cost Management → Budgets. 기준선은 현재 0.00 (SGD)
- [ ] **부하 실측** — 동시 20~50. 병목이 RAM 이면 12GB 로 충분하고, **Upstage 레이트리밋이면 박스를 키워도 소용없다**(그 경우 진짜 과제는 스케줄러 분리)
- [ ] **청구 실측** — 며칠 뒤 Cost Analysis 가 정말 0 에 가까운지
- [x] ~~`deploy.sh` 접속 정보~~ — ✅ 교정 완료(구 서버를 가리키고 있었다)
- [x] ~~`backend/deploy/README.md`~~ — ✅ 이전 배너 + 새 주소·키 반영
- [ ] Vercel 의 `NEXT_PUBLIC_SUPABASE_*` Secret → Config 정리 (값 확보가 선행)
