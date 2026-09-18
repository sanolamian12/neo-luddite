"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useAccountStore } from "@/lib/account-store";
import {
  useAuditorRegistryHydrated,
  useAuditorRegistryStore,
} from "@/lib/auditor-registry-store";
import {
  CONTACT_CHANNELS,
  type ConsultationAvailability,
  type ContactChannel,
  type ContactVisibility,
  type ExpertCard,
  type ExpertProfile,
} from "@/lib/poc-schema";
import * as expertService from "@/services/expert";
import {
  AVATAR_PRESETS,
  CONTACT_LABEL,
  VISIBILITY_LABEL,
} from "@/services/expert";
import { AVAILABILITY_LABEL, ExpertAvatar, ExpertCardView } from "@/components/expert/expert-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * 세무사 "상담 프로필" — 사장님 채팅의 세무사 연결 카드에 뜰 정보를 직접 기입한다.
 * 연락처는 채널별로 공개 범위를 고르고, DB(list_experts)가 그 범위대로 걸러 사장님에게 보낸다.
 */

const CONTACT_PLACEHOLDER: Record<ContactChannel, string> = {
  phone: "010-0000-0000",
  email: "name@example.com",
  kakao: "https://open.kakao.com/o/…",
};

const VISIBILITIES: ContactVisibility[] = ["public", "after_accept", "hidden"];
const AVAILABILITIES: ConsultationAvailability[] = ["available", "busy", "offline"];

function Segmented<T extends string>({
  value,
  options,
  label,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Button
          key={o}
          type="button"
          size="xs"
          role="radio"
          aria-checked={value === o}
          variant={value === o ? "default" : "outline"}
          onClick={() => onChange(o)}
        >
          {label(o)}
        </Button>
      ))}
    </div>
  );
}

function sameProfile(a: ExpertProfile, b: ExpertProfile): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

export function ExpertProfileView() {
  const auditorAccount = useAccountStore((s) => s.auditor);
  const auditorId = auditorAccount.id;
  const registryHydrated = useAuditorRegistryHydrated();
  const registryEntry = useAuditorRegistryStore((s) =>
    s.auditors.find((a) => a.id === auditorId),
  );

  const [saved, setSaved] = useState<ExpertProfile | null>(null);
  const [draft, setDraft] = useState<ExpertProfile | null>(null);
  const [specialtiesText, setSpecialtiesText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    expertService
      .getMyProfile(auditorId)
      .then((p) => {
        if (!active) return;
        const initial = p ?? expertService.emptyProfile(auditorId);
        setSaved(initial);
        setDraft(initial);
        setSpecialtiesText(initial.specialties.join(", "));
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [auditorId]);

  const displayName =
    registryEntry?.displayName ?? auditorAccount.reviewerName ?? auditorId;

  // 미리보기 — 사장님 화면과 같은 카드. 공개 범위 반영: 공개만 값 노출, 수락 후 공개는 가림.
  const preview: ExpertCard | null = useMemo(() => {
    if (!draft) return null;
    const contacts = {} as ExpertCard["contacts"];
    for (const ch of CONTACT_CHANNELS) {
      const c = draft.contacts[ch];
      contacts[ch] = {
        visibility: c.visibility,
        value: c.visibility === "public" ? c.value : undefined,
      };
    }
    return {
      auditorId,
      displayName,
      qualifications: registryEntry?.qualifications ?? [],
      bio: draft.bio,
      specialties: draft.specialties,
      yearsExperience: draft.yearsExperience,
      availability: draft.availability,
      avatarUrl: draft.avatarUrl,
      avatarColor: auditorAccount.avatarColor,
      contacts,
      likeCount: 0,
      likedByMe: false,
      reviewedCount: 0,
      reviewedThisCase: false,
    };
  }, [draft, auditorId, displayName, registryEntry, auditorAccount.avatarColor]);

  if (loadError) {
    return (
      <div className="px-6 py-6 text-sm text-destructive">
        프로필을 불러오지 못했습니다: {loadError}
      </div>
    );
  }
  if (!draft || !saved || !preview) {
    return <div className="px-6 py-6 text-sm text-muted-foreground">불러오는 중…</div>;
  }

  const dirty = !sameProfile(draft, saved);
  const patch = (p: Partial<ExpertProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchContact = (
    ch: ContactChannel,
    p: Partial<ExpertProfile["contacts"][ContactChannel]>,
  ) =>
    setDraft((d) =>
      d ? { ...d, contacts: { ...d.contacts, [ch]: { ...d.contacts[ch], ...p } } } : d,
    );

  const publicButEmpty = CONTACT_CHANNELS.filter(
    (ch) => draft.contacts[ch].visibility !== "hidden" && !draft.contacts[ch].value?.trim(),
  );

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const next = await expertService.saveMyProfile(draft);
      setSaved(next);
      setDraft(next);
      setSpecialtiesText(next.specialties.join(", "));
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">상담 프로필</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          사장님이 AI 상담 중 세무사 연결을 원할 때 채팅에 뜨는 카드입니다. 연락처는 항목마다
          공개 범위를 정할 수 있습니다.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          {/* 노출 */}
          <section className="flex items-start justify-between gap-4 rounded-xl border p-4">
            <div>
              <p className="font-medium">채팅 카드에 노출</p>
              <p className="text-xs text-muted-foreground">
                끄면 사장님 채팅의 세무사 목록에 나타나지 않습니다.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={draft.listed ? "default" : "outline"}
              aria-pressed={draft.listed}
              onClick={() => patch({ listed: !draft.listed })}
            >
              {draft.listed ? "노출 중" : "숨김"}
            </Button>
          </section>

          {/* 아바타 */}
          <section className="flex flex-col gap-2">
            <Label>프로필 그림</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => patch({ avatarUrl: undefined })}
                aria-pressed={!draft.avatarUrl}
                className={cn(
                  "rounded-full p-0.5 ring-2 transition",
                  !draft.avatarUrl ? "ring-primary" : "ring-transparent hover:ring-border",
                )}
                aria-label="이니셜 사용"
              >
                <ExpertAvatar
                  expert={{ displayName, avatarColor: auditorAccount.avatarColor }}
                  className="size-12"
                />
              </button>
              {AVATAR_PRESETS.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => patch({ avatarUrl: src })}
                  aria-pressed={draft.avatarUrl === src}
                  aria-label={`프로필 그림 ${i + 1}`}
                  className={cn(
                    "relative rounded-full p-0.5 ring-2 transition",
                    draft.avatarUrl === src
                      ? "ring-primary"
                      : "ring-transparent hover:ring-border",
                  )}
                >
                  <ExpertAvatar
                    expert={{ displayName, avatarUrl: src }}
                    className="size-12"
                  />
                  {draft.avatarUrl === src && (
                    <Check className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* 소개 */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="expert-bio">한 줄 소개</Label>
              <Input
                id="expert-bio"
                value={draft.bio}
                maxLength={80}
                placeholder="예: 병·의원 세무 10년, 경비 처리 분쟁 전문"
                onChange={(e) => patch({ bio: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expert-specialties">전문 분야 (쉼표로 구분)</Label>
              <Input
                id="expert-specialties"
                value={specialtiesText}
                placeholder="예: 병의원, 접대비, 차량"
                onChange={(e) => {
                  setSpecialtiesText(e.target.value);
                  patch({
                    specialties: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expert-years">경력 (년)</Label>
              <Input
                id="expert-years"
                type="number"
                min={0}
                max={60}
                value={draft.yearsExperience}
                onChange={(e) =>
                  patch({
                    yearsExperience: Math.max(0, Math.min(60, Number(e.target.value) || 0)),
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>상담 상태</Label>
              <Segmented
                ariaLabel="상담 상태"
                value={draft.availability}
                options={AVAILABILITIES}
                label={(v) => AVAILABILITY_LABEL[v]}
                onChange={(v) => patch({ availability: v })}
              />
            </div>
          </section>

          {/* 연락처 */}
          <section className="flex flex-col gap-3">
            <div>
              <p className="font-medium">연락처와 공개 범위</p>
              <p className="text-xs text-muted-foreground">
                공개: 카드에 바로 표시 · 상담 수락 후 공개: 신청을 수락한 사장님에게만 표시 ·
                비공개: 표시하지 않음
              </p>
            </div>
            {CONTACT_CHANNELS.map((ch) => (
              <div key={ch} className="flex flex-col gap-2 rounded-xl border p-3">
                <Label htmlFor={`contact-${ch}`}>{CONTACT_LABEL[ch]}</Label>
                <Input
                  id={`contact-${ch}`}
                  value={draft.contacts[ch].value ?? ""}
                  placeholder={CONTACT_PLACEHOLDER[ch]}
                  inputMode={ch === "phone" ? "tel" : ch === "email" ? "email" : "url"}
                  onChange={(e) => patchContact(ch, { value: e.target.value })}
                />
                <Segmented
                  ariaLabel={`${CONTACT_LABEL[ch]} 공개 범위`}
                  value={draft.contacts[ch].visibility}
                  options={VISIBILITIES}
                  label={(v) => VISIBILITY_LABEL[v]}
                  onChange={(v) => patchContact(ch, { visibility: v })}
                />
              </div>
            ))}
            {publicButEmpty.length > 0 && (
              <p className="text-xs text-brand-amber">
                {publicButEmpty.map((ch) => CONTACT_LABEL[ch]).join(", ")}: 공개 범위를
                정했지만 값이 비어 있습니다.
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? "저장 중…" : "저장"}
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(saved);
                  setSpecialtiesText(saved.specialties.join(", "));
                }}
                disabled={saving}
              >
                되돌리기
              </Button>
            )}
            {!dirty && savedAt && <span className="text-xs text-muted-foreground">저장됨</span>}
            {saveError && <span className="text-sm text-destructive">{saveError}</span>}
          </div>
        </div>

        {/* 미리보기 */}
        <aside className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start">
          <p className="text-sm font-medium">사장님 채팅에 보이는 모습</p>
          <ExpertCardView expert={preview} />
          <p className="text-xs text-muted-foreground">
            하트 수와 누적 검수 건수는 실제 기록에서 자동으로 채워집니다.
            {!registryHydrated && " (자격 정보를 불러오는 중)"}
          </p>
          {!draft.listed && (
            <p className="text-xs text-brand-amber">
              지금은 숨김 상태라 사장님 채팅에 나타나지 않습니다.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
