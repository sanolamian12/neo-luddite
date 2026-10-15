"""run_demo_eval 원자료(jsonl) → 3차 평가 요청용 원문(md). 사용: python d_format.py <out.md> <커밋> <a.jsonl> ..."""
import json, sys
sys.stdout.reconfigure(encoding="utf-8")
out, commit, files = sys.argv[1], sys.argv[2], sys.argv[3:]
LABEL = {"X01": "세무사 문항 Q1 — 종합소득세율", "X02": "세무사 문항 Q2 — 연봉 5천 근로소득세 계산",
         "X03": "세무사 문항 Q3 — 제조업 간이과세", "X04": "세무사 문항 Q4 — 익금의 뜻",
         "X05": "세무사 문항 Q1~Q4 한 대화 연속(실제 사용 방식)", "X06": "추가 질문 1 — 법인세율",
         "X07": "추가 질문 2 — 증여세 세율", "W03": "추가 질문 3 — 연봉 7천 실수령액"}
ORDER = ["X01", "X02", "X03", "X04", "X05", "X06", "X07", "W03"]
rows = [json.loads(l) for f in files for l in open(f, encoding="utf-8")]
by = {}
for r in rows:
    by.setdefault(r["scenario"], []).append(r)
L = ["# 네오러다이트 AI 답변 — 3차 평가용 원문", "",
     f"- 재현: 운영 서버 `/api/chat`, 커밋 `{commit}` · 계측 원자료 {', '.join(f.split('/')[-1].split(chr(92))[-1] for f in files)}",
     "- 질문은 2차 평가(10/12)와 같은 4문항 + 추가 3문항. 질문 세트는 내부 제작.",
     "- 각 문장 끝 [ ] 은 화면의 출처 배지(조문·심판례·해석 문서번호). 표는 화면에서 표로 그려진다.",
     "- '■ 세무사 연결' 은 답 아래 붙는 세무사 상담 신청 박스.", ""]
for sid in ORDER:
    rs = sorted(by.get(sid, []), key=lambda r: r["turn"])
    if not rs:
        continue
    L += [f"## {LABEL[sid]}", ""]
    for r in rs:
        L += [f"### 질문{f' ({r['turn']}턴째)' if len(rs) > 1 else ''}", "", "> " + r["user"].replace("\n", "\n> "), "",
              f"### 답변 (응답 {r['latency_ms']/1000:.1f}초)", ""]
        for s in r.get("segments", []):
            t = s["t"]
            cite = f" [{' · '.join(s['c'])}]" if s["c"] else ""
            L.append(t + cite if t.startswith("|") is False else t)
            if t.startswith("|") and cite:
                L.append(f"(표 근거{cite})")
            L.append("")
        if "expert_handoff" in (r.get("ui_blocks") or []):
            L += ["■ 세무사 연결 박스 표시", ""]
        L.append("")
open(out, "w", encoding="utf-8").write("\n".join(L))
print("written", out, sum(len(v) for v in by.values()), "turns")
