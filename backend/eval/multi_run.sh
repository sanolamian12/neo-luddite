#!/usr/bin/env bash
# 시간대 분산 재측정(10/19 사용자 결정) — 같은 측정 묶음을 INTERVAL 초 간격으로 ROUNDS 회.
# 한 시간대를 골라 한 번 재는 것도 '고르기'라서, 여러 시간대 분포를 합쳐 보고한다(합산 = 본 숫자, 회차별 범위 병기).
# 회차마다(약 35~40분): 데모 세트 2회 → report_check · 시민 48 → citizen_check · 정의형 6문항.
#
# 사용자 터미널에서(세션을 닫아도 계속 돈다 — PC 절전은 꺼 둘 것):
#   PowerShell:  & "C:\Program Files\Git\bin\bash.exe" backend/eval/multi_run.sh mr1019 5 7200
#   인자: <태그 접두> <회차 수> <간격 초>   → 태그 = <접두>_r1 … , 진행 로그 = docs/doing/demo_eval_1010/<접두>_progress.log
# 합산(끝난 뒤, backend/에서):
#   .\.venv\Scripts\python.exe -m eval.report_check --files (ls ..\docs\doing\demo_eval_1010\<접두>_r*_*.jsonl)
#   .\.venv\Scripts\python.exe -m eval.citizen_check --files (ls ..\docs\doing\demo_eval_1010\cit_<접두>_r*_*.jsonl)
set -u
PREFIX="${1:-mr1019}"
ROUNDS="${2:-5}"
INTERVAL="${3:-7200}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PYTHONIOENCODING=utf-8
P=.venv/Scripts/python.exe
LOG="../docs/doing/demo_eval_1010/${PREFIX}_progress.log"
T0=$(date -u +%s)
for N in $(seq 1 "$ROUNDS"); do
  START=$((T0 + (N - 1) * INTERVAL))
  NOW=$(date -u +%s)
  if [ "$NOW" -lt "$START" ]; then sleep $((START - NOW)); fi
  echo "=== ${PREFIX} 회차 $N 시작 $(date -u '+%F %T') UTC" | tee -a "$LOG"
  $P -m eval.run_demo_eval --tag "${PREFIX}_r$N" > /dev/null 2>&1
  $P -m eval.run_demo_eval --tag "${PREFIX}_r$N" > /dev/null 2>&1
  $P -m eval.report_check --tag "${PREFIX}_r$N" 2>&1 | tail -1 | tee -a "$LOG"
  $P -m eval.run_demo_eval --tag "cit_${PREFIX}_r$N" --set eval/citizen48_1016.jsonl --prefix eval-cit > /dev/null 2>&1
  $P -m eval.citizen_check --tag "cit_${PREFIX}_r$N" 2>&1 | tail -1 | tee -a "$LOG"
  $P -m eval.run_demo_eval --tag "defn_${PREFIX}_r$N" --set eval/defn_questions_1019.jsonl --prefix eval-defn > /dev/null 2>&1
  echo "=== ${PREFIX} 회차 $N 끝 $(date -u '+%F %T') UTC" | tee -a "$LOG"
done
echo "=== ${PREFIX} 전체 끝 $(date -u '+%F %T') UTC" | tee -a "$LOG"
