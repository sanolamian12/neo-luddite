import sys

from api.prompts import export_to_md, main

# python -m api.prompts                  → 배포 전 점검(DB 확정본 + md 폴백)
# python -m api.prompts export [--dry-run] → DB 확정본을 md 폴백에 덮어쓰기
if sys.argv[1:2] == ["export"]:
    raise SystemExit(export_to_md(dry_run="--dry-run" in sys.argv[2:]))
raise SystemExit(main())
