"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Search,
  X,
} from "lucide-react";
import type { ExpertCard } from "@/lib/poc-schema";
import { CONTACT_CHANNELS } from "@/lib/poc-schema";
import {
  filterExperts,
  paginateExperts,
  type ExpertFilters,
} from "@/lib/expert-directory";
import { CONTACT_LABEL } from "@/services/expert";
import { AVAILABILITY_LABEL, ExpertAvatar } from "./expert-card";
import { Button } from "@/components/ui/button";
import { PopoverClose } from "@/components/ui/popover";
import styles from "./expert-directory.module.css";

const PAGE_SIZE = 6;

export function ExpertDirectory({
  experts,
  selectedId,
  onSelect,
  onRequest,
  onToggleLike,
  likeBusyId,
  canAct,
  requestHref,
}: {
  experts: ExpertCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequest: () => void;
  onToggleLike: (id: string) => void;
  likeBusyId: string | null;
  canAct: boolean;
  requestHref?: string;
}) {
  const id = useId();
  const [filters, setFilters] = useState<ExpertFilters>({});
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const specialties = useMemo(
    () =>
      [...new Set(experts.flatMap((e) => e.specialties))].sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [experts],
  );
  const filtered = useMemo(
    () => filterExperts(experts, filters),
    [experts, filters],
  );
  const results = paginateExperts(filtered, page, PAGE_SIZE);
  const selected = experts.find((e) => e.auditorId === selectedId);
  const hasFilters = Boolean(
    filters.query ||
    filters.specialty ||
    (filters.availability && filters.availability !== "all"),
  );
  const start = (results.page - 1) * PAGE_SIZE;

  function updateFilters(next: ExpertFilters) {
    setFilters(next);
    setPage(1);
    listRef.current?.scrollTo({ top: 0 });
  }

  function changePage(next: number) {
    setPage(next);
    listRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className={styles.directory}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <div>
            <h2>내 고민에 맞는 세무사</h2>
            <p>전문 분야와 경력을 살펴보고 선택하세요.</p>
          </div>
          <PopoverClose
            aria-label="세무사 목록 닫기"
            className={styles.iconButton}
          >
            <X size={20} />
          </PopoverClose>
        </div>
        <div className={styles.search}>
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            aria-label="세무사 검색"
            placeholder="이름, 전문 분야, 소개로 검색"
            value={filters.query ?? ""}
            onChange={(e) =>
              updateFilters({ ...filters, query: e.target.value })
            }
          />
          {filters.query && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="검색어 지우기"
              onClick={() => {
                updateFilters({ ...filters, query: "" });
                searchRef.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className={styles.filters}>
          <label htmlFor={`${id}-specialty`}>
            <span>전문 분야</span>
            <select
              id={`${id}-specialty`}
              value={filters.specialty ?? ""}
              onChange={(e) =>
                updateFilters({ ...filters, specialty: e.target.value })
              }
            >
              <option value="">전체 분야</option>
              {specialties.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${id}-availability`}>
            <span>상담 상태</span>
            <select
              id={`${id}-availability`}
              value={filters.availability ?? "all"}
              onChange={(e) =>
                updateFilters({
                  ...filters,
                  availability: e.target.value as ExpertFilters["availability"],
                })
              }
            >
              <option value="all">모든 상태</option>
              {Object.entries(AVAILABILITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.resultSummary}>
          <p role="status" aria-live="polite" aria-atomic="true">
            <strong>{filtered.length}명</strong>
            {hasFilters ? " 검색 결과" : "의 세무사"}
            <span>
              {filtered.length > 0
                ? ` / ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)}명 표시`
                : ""}
            </span>
          </p>
          {hasFilters && (
            <button type="button" onClick={() => updateFilters({})}>
              초기화
            </button>
          )}
        </div>
      </header>

      <div
        className={styles.results}
        ref={listRef}
        role="region"
        aria-label="세무사 검색 결과"
        tabIndex={0}
      >
        {results.items.length ? (
          <ul className={styles.list}>
            {results.items.map((expert) => (
              <ExpertDirectoryRow
                key={expert.auditorId}
                expert={expert}
                selected={expert.auditorId === selectedId}
                onSelect={() => onSelect(expert.auditorId)}
                onToggleLike={
                  canAct ? () => onToggleLike(expert.auditorId) : undefined
                }
                likeBusy={likeBusyId !== null}
              />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <Search size={28} aria-hidden="true" />
            <h3>조건에 맞는 세무사가 없어요</h3>
            <p>다른 검색어를 입력하거나 필터를 초기화해 보세요.</p>
            <Button
              variant="outline"
              onClick={() => {
                updateFilters({});
                searchRef.current?.focus();
              }}
            >
              전체 세무사 보기
            </Button>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <nav className={styles.pagination} aria-label="세무사 목록 페이지">
          <button
            type="button"
            className={styles.pageButton}
            disabled={results.page === 1}
            onClick={() => changePage(results.page - 1)}
            aria-label="이전 페이지"
          >
            <ChevronLeft size={16} /> 이전
          </button>
          <span aria-live="polite" aria-atomic="true">
            <strong>{results.page}</strong> / {results.pageCount}
            <span className="sr-only"> 페이지</span>
          </span>
          <button
            type="button"
            className={styles.pageButton}
            disabled={results.page === results.pageCount}
            onClick={() => changePage(results.page + 1)}
            aria-label="다음 페이지"
          >
            다음 <ChevronRight size={16} />
          </button>
        </nav>
        <div className={styles.selection}>
          <div
            className={styles.selectedExpert}
            aria-live="polite"
            aria-atomic="true"
          >
            {selected ? (
              <>
                <ExpertAvatar
                  expert={selected}
                  className="size-9 shrink-0 text-xs"
                />
                <div>
                  <span className={styles.selectionLabel}>선택한 세무사</span>
                  <strong>{selected.displayName}</strong>
                </div>
              </>
            ) : (
              <p>
                상담할 세무사를
                <br />
                선택해 주세요
              </p>
            )}
          </div>
          {!canAct && requestHref ? <Button nativeButton={false} render={<Link href={requestHref} />} className={styles.requestButton}>로그인하고 상담 신청 <ChevronRight size={16} aria-hidden="true" /></Button> : <Button
            disabled={!selected || !canAct}
            onClick={onRequest}
            className={styles.requestButton}
          >
            상담 신청 <ChevronRight size={16} aria-hidden="true" />
          </Button>}
        </div>
      </footer>
    </div>
  );
}

function ExpertDirectoryRow({
  expert,
  selected,
  onSelect,
  onToggleLike,
  likeBusy,
}: {
  expert: ExpertCard;
  selected: boolean;
  onSelect: () => void;
  onToggleLike?: () => void;
  likeBusy: boolean;
}) {
  return (
    <li className={styles.expert} data-selected={selected || undefined}>
      <button
        type="button"
        className={styles.chooseExpert}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${expert.displayName} 세무사 선택`}
      >
        <ExpertAvatar expert={expert} className="size-12 shrink-0 sm:size-14" />
        <div className={styles.profile}>
          <div className={styles.identity}>
            <h3>
              {expert.displayName}
              <span>세무사</span>
            </h3>
            <span
              className={styles.availability}
              data-availability={expert.availability}
            >
              {AVAILABILITY_LABEL[expert.availability]}
            </span>
          </div>
          <div className={styles.credentials}>
            {expert.yearsExperience > 0 && (
              <span>경력 {expert.yearsExperience}년</span>
            )}
            {expert.qualifications.length > 0 && (
              <span>{expert.qualifications.join(" · ")}</span>
            )}
          </div>
          {expert.bio && <p className={styles.bio}>{expert.bio}</p>}
          {expert.specialties.length > 0 && (
            <p className={styles.specialties}>
              {expert.specialties.join(" · ")}
            </p>
          )}
        </div>
        <span className={styles.selectionMark} aria-hidden="true">
          {selected && <Check size={14} strokeWidth={3} />}
        </span>
      </button>
      <div className={styles.rowDetails}>
        <div className={styles.evidence}>
          {expert.reviewedThisCase ? (
            <span className={styles.reviewedCase}>이 상담을 검수한 세무사</span>
          ) : expert.reviewedCount > 0 ? (
            <span>
              상담 검수 {expert.reviewedCount.toLocaleString("ko-KR")}건
            </span>
          ) : null}
          {CONTACT_CHANNELS.map((channel) => {
            const contact = expert.contacts[channel];
            if (
              contact.visibility === "hidden" ||
              (!contact.value && contact.visibility !== "after_accept")
            )
              return null;
            if (!contact.value)
              return (
                <span key={channel}>{CONTACT_LABEL[channel]} 수락 후 공개</span>
              );
            const href =
              channel === "phone"
                ? `tel:${contact.value.replace(/[^0-9+]/g, "")}`
                : channel === "email"
                  ? `mailto:${contact.value}`
                  : contact.value;
            return (
              <a
                key={channel}
                href={href}
                target={channel === "kakao" ? "_blank" : undefined}
                rel={channel === "kakao" ? "noopener noreferrer" : undefined}
              >
                {CONTACT_LABEL[channel]}{" "}
                {channel === "kakao" ? "채팅방 열기" : contact.value}
              </a>
            );
          })}
        </div>
        {onToggleLike ? (
          <button
            type="button"
            className={styles.like}
            aria-label={`${expert.displayName} ${expert.likedByMe ? "하트 취소" : "하트 누르기"}`}
            aria-pressed={expert.likedByMe}
            disabled={likeBusy}
            onClick={onToggleLike}
          >
            <Heart
              size={15}
              fill={expert.likedByMe ? "currentColor" : "none"}
            />
            {expert.likeCount.toLocaleString("ko-KR")}
          </button>
        ) : (
          <span className={styles.like}>
            <Heart size={15} />
            {expert.likeCount.toLocaleString("ko-KR")}
          </span>
        )}
      </div>
    </li>
  );
}
