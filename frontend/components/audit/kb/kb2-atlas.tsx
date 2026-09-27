"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Compass,
  Home,
  List,
  Map,
  Search,
} from "lucide-react";
import * as api from "@/services/kb2";
import type {
  Kb2Document,
  Kb2Group,
  Kb2SearchResult,
  Kb2Sentence,
} from "@/services/kb2";
import { AtlasInspector } from "./kb2-atlas-inspector";
import styles from "./kb2-atlas.module.css";

type Region = { id: string; label: string; documents: Kb2Document[] };
const UNGROUPED = "ungrouped";
const EXCLUDED = "excluded";
const RECENT_EVENT = "kb2-atlas-recents";
function subscribeRecents(callback: () => void) {
  window.addEventListener(RECENT_EVENT, callback);
  return () => window.removeEventListener(RECENT_EVENT, callback);
}
function recentSnapshot() {
  try {
    return sessionStorage.getItem("kb2-atlas-recent") ?? "[]";
  } catch {
    return "[]";
  }
}
const serverRecents = () => "[]";

export function Kb2Atlas() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const documentId = params.get("document");
  const sentenceId = params.get("sentence");
  const groupId = params.get("group");
  const reading = params.get("view") === "reading";
  const [groups, setGroups] = useState<Kb2Group[]>([]);
  const [documents, setDocuments] = useState<Kb2Document[]>([]);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error" | "unconfigured"
  >("loading");
  const [reload, setReload] = useState(0);
  const [sentenceData, setSentenceData] = useState<{
    documentId: string;
    sentences: Kb2Sentence[];
  } | null>(null);
  const [sentenceError, setSentenceError] = useState(false);
  const [sentenceRetry, setSentenceRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    query: string;
    results: Kb2SearchResult[];
    error: boolean;
  } | null>(null);
  const storedRecents = useSyncExternalStore(
    subscribeRecents,
    recentSnapshot,
    serverRecents,
  );
  const recents = useMemo<string[]>(() => {
    try {
      const ids: unknown = JSON.parse(storedRecents);
      return Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string").slice(0, 5)
        : [];
    } catch {
      return [];
    }
  }, [storedRecents]);
  const [editing, setEditing] = useState(false);
  const contentHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchQuery = query.trim();

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listKb2Groups(), api.listKb2Documents()])
      .then(([g, d]) => {
        if (cancelled) return;
        setGroups(g.groups);
        setDocuments(d.documents);
        setLoadState(
          g.dbConfigured && d.dbConfigured ? "ready" : "unconfigured",
        );
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    api
      .listKb2Sentences(documentId)
      .then((result) => {
        if (cancelled) return;
        if (!result.dbConfigured) throw new Error("unavailable");
        setSentenceData({ documentId, sentences: result.sentences });
        setSentenceError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSentenceData({ documentId, sentences: [] });
          setSentenceError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, sentenceRetry]);

  useEffect(() => {
    if (searchQuery.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchKb2Atlas(searchQuery)
        .then((result) => {
          if (!cancelled)
            setSearch({
              query: searchQuery,
              results: result.results,
              error: !result.dbConfigured,
            });
        })
        .catch(() => {
          if (!cancelled)
            setSearch({ query: searchQuery, results: [], error: true });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    // Store only IDs, not knowledge content. Browser storage is optional.
    try {
      const previous: unknown = JSON.parse(
        sessionStorage.getItem("kb2-atlas-recent") ?? "[]",
      );
      const ids = Array.isArray(previous)
        ? previous.filter((id): id is string => typeof id === "string")
        : [];
      const next = documentId
        ? [documentId, ...ids.filter((id) => id !== documentId)].slice(0, 5)
        : ids;
      sessionStorage.setItem("kb2-atlas-recent", JSON.stringify(next));
      window.dispatchEvent(new Event(RECENT_EVENT));
    } catch {
      /* Continue without history when storage is unavailable. */
    }
  }, [documentId]);

  useEffect(() => {
    if (sentenceId) return;
    contentHeading.current?.focus({ preventScroll: true });
    if (
      (documentId || groupId) &&
      window.matchMedia("(max-width: 900px)").matches
    )
      contentHeading.current?.scrollIntoView({ block: "start" });
  }, [documentId, groupId, sentenceId]);

  const regions = useMemo(() => {
    const items: Region[] = groups.map((g) => ({
      id: g.id,
      label: g.label,
      documents: [],
    }));
    items.push(
      { id: UNGROUPED, label: "미분류", documents: [] },
      { id: EXCLUDED, label: "검색 제외", documents: [] },
    );
    const index = new globalThis.Map(items.map((g) => [g.id, g]));
    for (const document of documents) {
      const key =
        document.status !== "active"
          ? EXCLUDED
          : index.has(document.groupId ?? "")
            ? document.groupId!
            : UNGROUPED;
      index.get(key)!.documents.push(document);
    }
    for (const item of items)
      item.documents.sort(
        (a, b) =>
          a.title.localeCompare(b.title, "ko") || a.id.localeCompare(b.id),
      );
    return items.filter((g) => g.documents.length > 0);
  }, [groups, documents]);
  const selectedDocument = documents.find((d) => d.id === documentId);
  const region = selectedDocument
    ? regions.find((g) => g.documents.some((d) => d.id === documentId))
    : regions.find((g) => g.id === groupId);
  const sentences =
    sentenceData?.documentId === documentId ? sentenceData.sentences : null;
  const selectedSentence = sentences?.find((s) => s.id === sentenceId);
  const matchingDocuments = searchQuery
    ? documents
        .filter(
          (d) =>
            d.status === "active" &&
            `${d.title} ${d.taxCategory}`
              .toLocaleLowerCase()
              .includes(searchQuery.toLocaleLowerCase()),
        )
        .slice(0, 12)
    : [];

  function navigate(next: {
    group?: string;
    document?: string;
    sentence?: string;
    view?: string;
  }) {
    if (
      editing &&
      !window.confirm("편집 중입니다. 초안을 이 탭에 남기고 이동할까요?")
    )
      return;
    setQuery("");
    const updated = new URLSearchParams();
    if (next.group) updated.set("group", next.group);
    if (next.document) updated.set("document", next.document);
    if (next.sentence) updated.set("sentence", next.sentence);
    if ((next.view ?? (reading ? "reading" : "map")) === "reading")
      updated.set("view", "reading");
    router.push(`${pathname}${updated.size ? `?${updated}` : ""}`, {
      scroll: false,
    });
  }
  function openDocument(id: string) {
    navigate({ document: id });
  }
  function selectSentence(id: string) {
    navigate({ document: documentId!, sentence: id });
  }

  const documentButton = (d: Kb2Document) => (
    <button
      key={d.id}
      className={styles.documentNode}
      aria-label={`${d.title} 열기`}
      onClick={() => openDocument(d.id)}
    >
      <span className={styles.nodeDot} />
      <span>
        {d.title}
        {d.status !== "active" && (
          <small>{d.status === "unsorted" ? "분류 대기" : "연결 끊김"}</small>
        )}
      </span>
      <ArrowUpRight size={16} />
    </button>
  );

  return (
    <div className={styles.atlas}>
      <header className={styles.header}>
        <div>
          <div className={styles.titleLine}>
            <Compass size={28} />
            <h1>지식 지도</h1>
            <span className={styles.kbLabel}>KB2</span>
          </div>
          <p>주제를 따라 탐색하고, 문장의 근거를 함께 살펴보세요.</p>
        </div>
        <Link href="/audit/kb2" className={styles.managerLink}>
          문서 관리 <ArrowUpRight size={16} />
        </Link>
      </header>
      <div className={styles.searchRow}>
        <Search size={20} />
        <label className="sr-only" htmlFor="atlas-search">
          지식 검색
        </label>
        <input
          id="atlas-search"
          ref={searchInput}
          type="search"
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="주제 또는 문장 검색"
          autoComplete="off"
        />
        <span className={styles.searchHint}>활성 지식에서 찾기</span>
      </div>
      {searchQuery && (
        <section className={styles.searchResults} aria-label="검색 결과">
          <div className={styles.resultHeader}>
            <strong>검색 결과</strong>
            <button
              onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}
            >
              검색 닫기
            </button>
          </div>
          {matchingDocuments.map((d) => (
            <button key={d.id} onClick={() => openDocument(d.id)}>
              <BookOpen size={17} />
              <span>
                {d.title}
                <small>주제</small>
              </span>
            </button>
          ))}
          {searchQuery.length < 2 ? (
            <p>문장 검색은 두 글자 이상 입력하세요.</p>
          ) : search?.query !== searchQuery ? (
            <p role="status">문장을 찾는 중…</p>
          ) : search.error ? (
            <p role="alert">
              검색에 연결하지 못했습니다. 검색어를 다시 입력해 주세요.
            </p>
          ) : (
            <>
              {search.results.map((r) => (
                <button
                  key={r.id}
                  onClick={() =>
                    navigate({ document: r.documentId, sentence: r.id })
                  }
                >
                  <Search size={17} />
                  <span>
                    <strong>{r.documentTitle}</strong>
                    <small>{r.content}</small>
                  </span>
                </button>
              ))}
              {!search.results.length && !matchingDocuments.length && (
                <p>일치하는 지식이 없습니다. 더 짧은 검색어로 찾아보세요.</p>
              )}
              {search.results.length === 40 && (
                <p>
                  앞의 40개 문장입니다. 검색어를 구체적으로 입력해 범위를
                  좁혀보세요.
                </p>
              )}
            </>
          )}
        </section>
      )}
      <div className={styles.toolbar}>
        <nav aria-label="현재 위치">
          <button onClick={() => navigate({})} aria-label="전체 지도">
            <Home size={16} />
            <span>전체</span>
          </button>
          {region && (
            <>
              <ChevronRight size={14} />
              <button onClick={() => navigate({ group: region.id })}>
                {region.label}
              </button>
            </>
          )}
          {selectedDocument && (
            <>
              <ChevronRight size={14} />
              <span aria-current="page">{selectedDocument.title}</span>
            </>
          )}
        </nav>
        <div className={styles.viewSwitch}>
          <button
            aria-pressed={!reading}
            aria-label="지도 보기"
            onClick={() =>
              navigate({
                group: groupId ?? undefined,
                document: documentId ?? undefined,
                sentence: sentenceId ?? undefined,
                view: "map",
              })
            }
          >
            <Map size={16} />
            지도
          </button>
          <button
            aria-pressed={reading}
            aria-label="읽기 보기"
            onClick={() =>
              navigate({
                group: groupId ?? undefined,
                document: documentId ?? undefined,
                sentence: sentenceId ?? undefined,
                view: "reading",
              })
            }
          >
            <List size={16} />
            읽기
          </button>
        </div>
      </div>
      {loadState === "loading" ? (
        <p className={styles.empty} role="status">
          지식 지도를 불러오는 중…
        </p>
      ) : loadState === "error" || loadState === "unconfigured" ? (
        <div className={styles.empty} role="alert">
          <p>
            {loadState === "unconfigured"
              ? "지식베이스에 아직 연결되지 않았습니다."
              : "지식 지도를 불러오지 못했습니다."}
          </p>
          <button
            onClick={() => {
              setLoadState("loading");
              setReload((n) => n + 1);
            }}
          >
            다시 불러오기
          </button>
        </div>
      ) : (
        <div
          className={`${styles.workspace} ${selectedSentence ? styles.withInspector : ""}`}
        >
          <aside className={styles.navigator} aria-label="주제 탐색">
            <h2>탐색할 주제</h2>
            <label className={styles.mobilePicker}>
              주제 선택
              <select
                value={documentId ?? ""}
                onChange={(e) =>
                  e.target.value ? openDocument(e.target.value) : navigate({})
                }
              >
                <option value="">전체 지도</option>
                {regions.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {g.documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className={styles.desktopTopics}>
              {regions.map((g) => (
                <details key={g.id} open={g.id === region?.id || undefined}>
                  <summary>
                    {g.label}
                    <span>{g.documents.length}</span>
                  </summary>
                  {g.documents.map((d) => (
                    <button
                      key={d.id}
                      aria-current={d.id === documentId ? "page" : undefined}
                      onClick={() => openDocument(d.id)}
                    >
                      {d.title}
                    </button>
                  ))}
                </details>
              ))}
              {recents.length > 0 && (
                <div className={styles.recents}>
                  <h3>최근 본 주제</h3>
                  {recents.map((id) => {
                    const doc = documents.find((d) => d.id === id);
                    return doc ? (
                      <button key={id} onClick={() => openDocument(id)}>
                        {doc.title}
                      </button>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </aside>
          <section
            className={`${styles.canvas} ${reading ? styles.reading : ""}`}
            aria-label={reading ? "지식 읽기" : "지식 지도 탐색"}
          >
            <div className={styles.canvasHeader}>
              <div>
                <h2 ref={contentHeading} tabIndex={-1}>
                  {selectedDocument?.title ??
                    region?.label ??
                    "어디에서 시작할까요?"}
                </h2>
                <p>
                  {selectedDocument
                    ? "문장을 선택하면 출처와 수정 이력을 확인할 수 있습니다."
                    : region
                      ? `${region.documents.length}개 주제에서 지식의 범위를 좁혀보세요.`
                      : `${documents.length}개 주제 · 분야를 선택해 한 단계씩 살펴보세요.`}
                </p>
              </div>
              {(documentId || groupId) && (
                <button
                  aria-label="상위 주제로"
                  onClick={() =>
                    navigate(
                      selectedDocument && region ? { group: region.id } : {},
                    )
                  }
                >
                  <ArrowLeft size={18} />
                </button>
              )}
            </div>
            {(documentId && !selectedDocument) || (groupId && !region) ? (
              <p className={styles.empty}>
                이 위치를 찾을 수 없습니다. 전체 지도에서 다시 선택하세요.
              </p>
            ) : selectedDocument ? (
              <>
                {selectedDocument.status !== "active" && (
                  <p className={styles.excluded}>
                    이 주제는 검색에 포함되지 않습니다.{" "}
                    {selectedDocument.status === "unsorted"
                      ? "분류되지 않은 원문을 보관합니다."
                      : "연결이 끊긴 지식입니다."}
                  </p>
                )}
                {!sentences ? (
                  <p role="status" className={styles.empty}>
                    문장을 불러오는 중…
                  </p>
                ) : sentenceError ? (
                  <div role="alert" className={styles.empty}>
                    <p>문장을 불러오지 못했습니다.</p>
                    <button
                      onClick={() => {
                        setSentenceData(null);
                        setSentenceRetry((n) => n + 1);
                      }}
                    >
                      다시 불러오기
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.branchLabel}>
                      <span />
                      주제에 속한 문장 {sentences.length}개
                    </div>
                    <div className={styles.sentenceBranch}>
                      {sentences.map((s, i) => (
                        <button
                          key={s.id}
                          className={styles.sentenceNode}
                          aria-pressed={s.id === sentenceId}
                          onClick={() => selectSentence(s.id)}
                        >
                          <span className={styles.sentenceNumber}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <span className={styles.sentenceText}>
                              {s.content}
                            </span>
                            <small>
                              출처 {s.sourcePassageIds.length}개
                              {s.lockedByAuditor ? " · 전문가 수정" : ""}
                              {s.status === "retired" ? " · 연결 끊김" : ""}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                    </div>
                    {sentences.length === 0 && (
                      <p className={styles.empty}>
                        아직 문장이 없습니다. 다른 주제를 탐색해 보세요.
                      </p>
                    )}
                    {sentenceId && !selectedSentence && (
                      <p role="status" className={styles.excluded}>
                        이 문장이 이동되었거나 더 이상 이 주제에 속하지
                        않습니다.
                      </p>
                    )}
                  </>
                )}
                {region && region.documents.length > 1 && (
                  <div className={styles.neighbors}>
                    <h3>같은 분야의 다른 주제</h3>
                    <p>같은 분류에 속한 주제입니다.</p>
                    {region.documents
                      .filter((d) => d.id !== documentId)
                      .map((d) => (
                        <button key={d.id} onClick={() => openDocument(d.id)}>
                          {d.title}
                          <ArrowUpRight size={15} />
                        </button>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className={styles.regions}>
                {(region ? [region] : regions).map((g) => (
                  <section key={g.id} className={styles.region}>
                    <div className={styles.regionHeading}>
                      <span className={styles.regionMark} />
                      <button
                        aria-label={`${g.label} 탐색`}
                        onClick={() => navigate({ group: g.id })}
                      >
                        {g.label}
                        <ArrowUpRight size={17} />
                      </button>
                      <span>{g.documents.length}개 주제</span>
                    </div>
                    <div className={styles.documentBranch}>
                      {(region || reading
                        ? g.documents
                        : g.documents.slice(0, 4)
                      ).map(documentButton)}
                    </div>
                    {!region && !reading && g.documents.length > 4 && (
                      <button
                        className={styles.more}
                        onClick={() => navigate({ group: g.id })}
                      >
                        주제 {g.documents.length}개 모두 보기
                      </button>
                    )}
                  </section>
                ))}
                {regions.length === 0 && (
                  <p className={styles.empty}>
                    아직 등록된 주제가 없습니다. 문서 관리에서 지식을 추가해
                    주세요.
                  </p>
                )}
              </div>
            )}
            {!reading && (
              <footer className={styles.legend}>
                <span className={styles.legendLine} />
                분류에 따른 연결 <span className={styles.legendDot} />
                주제 · 문장
              </footer>
            )}
          </section>
          {selectedSentence && (
            <AtlasInspector
              key={selectedSentence.id}
              sentence={selectedSentence}
              onEditing={setEditing}
              onClose={() => {
                navigate({ document: documentId! });
                requestAnimationFrame(() => contentHeading.current?.focus());
              }}
              onSaved={(updated) =>
                setSentenceData((current) =>
                  current
                    ? {
                        ...current,
                        sentences: current.sentences.map((s) =>
                          s.id === updated.id ? updated : s,
                        ),
                      }
                    : current,
                )
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
