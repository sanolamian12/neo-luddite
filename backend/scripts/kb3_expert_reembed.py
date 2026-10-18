"""A8(10/16) — 이미 저장된 세무사 사례(kb3_expert)를 새 검색 텍스트(결론·예외 포함)로 재임베딩하고, 비어 있는
근거 조문(law_articles)을 법령 선택기로 채운다. 기본은 dry-run(읽기만), --apply 일 때만 운영 DB 에 쓴다.

    cd backend && .venv\\Scripts\\python.exe -X utf8 scripts\\kb3_expert_reembed.py           # 무엇이 바뀌는지만
    cd backend && .venv\\Scripts\\python.exe -X utf8 scripts\\kb3_expert_reembed.py --apply   # 규칙 8 회신 뒤, 사용자 실행

쓰는 것: kb3.chunks(content·embedding·content_hash) + kb3.documents(content_hash·law_articles). 게시·공유 상태는
건드리지 않는다 — 공용 노출이 안 바뀌니 기여 원장 트리거(0056)도 안 돈다. 문서 content_hash 를 save_expert_case 와
같은 식(카드 + \\x1f + 검색 텍스트)으로 맞춰 둔다 — 안 맞추면 세무사가 같은 내용을 다시 저장할 때 '바뀜'으로 보고
게시·공유를 초안으로 되돌린다. 세무사 사례는 메모리 벡터 밖(DB 직접 검색)이라 서버 재시작은 필요 없다.
"""
import hashlib
import sys

sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")
from eval.run_demo_eval import load_env  # noqa: E402

load_env()
from api.rag import embeddings, kb3_store  # noqa: E402


def main():
    apply = "--apply" in sys.argv
    conn = kb3_store._get_conn()
    with conn.cursor() as cur:
        cur.execute("select d.id, d.title, d.card, d.content, d.law_articles, c.id, c.content "
                    "from kb3.documents d join kb3.chunks c on c.document_id = d.id "
                    "where d.corpus = 'kb3_expert' and d.status = 'active' and c.status = 'active' order by d.updated_at")
        rows = cur.fetchall()
    n_text = n_law = 0
    for doc_id, title, card, content, laws, chunk_id, old_text in rows:
        card = card or {}
        f = {k: card.get(k) or "" for k in kb3_store.EXPERT_FIELDS}
        new_text = kb3_store.expert_embed_text(title, f)
        text_changed = new_text != old_text
        new_laws = list(laws or []) or kb3_store.expert_law_articles(title, f)
        law_changed = new_laws != list(laws or [])
        n_text += text_changed
        n_law += law_changed
        print(f"{doc_id} {title} · 검색 텍스트 {'바뀜' if text_changed else '그대로'} · 조문 {list(laws or [])} → {new_laws}")
        if not apply or not (text_changed or law_changed):
            continue
        chash = hashlib.sha1((content + "\x1f" + new_text).encode("utf-8")).hexdigest()
        with conn.transaction(), conn.cursor() as cur:
            if text_changed:
                cur.execute("update kb3.chunks set content = %s, embedding = %s, content_hash = %s where id = %s",
                            (new_text, embeddings.embed_passage(new_text),
                             hashlib.sha1(new_text.encode("utf-8")).hexdigest(), chunk_id))
            cur.execute("update kb3.documents set content_hash = %s, law_articles = %s::jsonb where id = %s",
                        (chash, kb3_store.json.dumps(new_laws, ensure_ascii=False), doc_id))
    print(f"\n{len(rows)}건 중 재임베딩 {n_text} · 조문 채움 {n_law}" + ("" if apply else " — dry-run(쓰지 않음)"))


if __name__ == "__main__":
    main()
