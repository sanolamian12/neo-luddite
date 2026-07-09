# Seam C 배포 — 라이브 완료 (Vercel + Oracle 도쿄)

날짜: 2026-07-09 · 브랜치: `import-credigraph`(→main fast-forward) · 목적: 호주 개발 → 한국 저지연 서비스 배포. 7/31 데모(4인 역할극, RAG 0→100 실증)의 게이트.

## 결과 — 전체 스택 공개 인터넷 E2E 검증됨

```
브라우저(한국) → Vercel 프론트  https://neo-luddite.vercel.app     (Next.js 16, ICN 엣지)
             → Oracle 백엔드  https://132-145-115-166.sslip.io   (FastAPI always-on, 도쿄, HTTPS)
             → Supabase(도쿄) + Upstage Solar
```
- `/health`·`/rag/health`(kbPassages 12)·`POST /api/chat`(실 Upstage 판정 응답) 전부 외부 HTTPS로 확인.
- CORS: `https://neo-luddite.vercel.app` 프리플라이트/실요청 ACAO 확인. CHAT_MODE=remote.

## 핵심 결정·발견

1. **Vercel 빌드 호환 = 문제없음.** 설치 `next`는 진짜 `vercel/next.js` 16.2.9(포크 아님, AGENTS.md 경고는 API 최신성 의미). 로컬 `next build` 33라우트 정상 → **self-host 폴백 불요.**
2. **리전 춘천 → 도쿄(ap-tokyo-1).** Oracle 가입 홈리전에 한국 없음. 도쿄는 Supabase(도쿄)와 동일 리전이라 백엔드↔DB 이득. 한국↔도쿄 ~30-40ms(마스터 §6 허용).
3. **Shape: ARM A1.Flex 용량부족(out of capacity, 도쿄 AD-1) → AMD E2.1.Micro(1GB) 확정.** Always Free. 1GB 보강 = swap 2GB + uvicorn `--workers 1`. (임베딩·벡터·LLM 전부 원격이라 박스 footprint≈0 → 1GB로 충분.)
4. **가입/인프라 험로**: 계정생성 거부(VPN·사기탐지), ARM 용량막힘, 인스턴스 마법사의 인라인 서브넷이 인터넷게이트웨이를 안 만들어 공인IP 토글 잠김 → **VCN 마법사로 "Create VCN with Internet Connectivity" 별도 생성** 후 선택으로 우회.
5. **Vercel 멀티서비스 오탐**: repo에 frontend(Next)+backend(Python) 둘 다라 "Services" 모드로 잡아 Deploy 잠김 → **Root Directory=`frontend`로 좁혀 단일 Next.js**로. 백엔드는 Vercel에 안 올림.
6. **브랜치**: 작업이 `import-credigraph`인데 Vercel 초기 import는 기본브랜치(main) 고정 + main엔 frontend/ 없음 → `git push origin import-credigraph:main`(fast-forward, 무손실)로 main 갱신.

## 서버 구성 (재현용)

- 공인 IP `132.145.115.166`, Ubuntu 22.04, ssh 키 `docs/ssh-key-2026-07-09.key`(gitignore).
- 코드 `/opt/neo-luddite/backend`(로컬 backend/ tar-pipe, data/ 제외), venv `.venv`, 의존성 `requirements-api.txt`.
- `.env` = 로컬 검증본 복사 + CORS_ORIGINS만 프로덕션값. systemd `neo-luddite-api`(always-on, Restart=always).
- Caddy 자동TLS(`132-145-115-166.sslip.io`), 포트 80/443 = OCI 보안목록 ingress + iptables 둘 다 개방.
- 배포 산출물: `backend/deploy/`(README·env.production.example·systemd·Caddyfile·bootstrap.sh).

## 남은 것

- **팀 계정 8개(세무사3/손님4/관리자1) 시딩** — 로그인 E2E 선결.
- **OCI 공인 IP 영구화**(Reserved Public IP) — stop/start 시 IP 바뀌면 sslip.io·API_BASE·인증서 깨짐.
- 브라우저 로그인→라이브챗→검수→RAG적재 육안 E2E. RAG 0→100 성장 실증(7/31 전).
- `backend/deploy/` 커밋(현재 untracked).

관련: 메모리 `project_deployment_plan` · 마스터설계 §6 · `260702_마스터설계_ABC_워크스트림_분리실행.md`
