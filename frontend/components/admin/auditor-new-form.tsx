"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import * as auditorService from "@/services/auditor";

const PRESET_QUALIFICATIONS = [
  "세무사 자격 보유",
  "회계사 자격 보유",
  "병의원 5건 이상 경험",
  "소상공인 10건 이상 경험",
  "법인세 전문",
  "부가가치세 전문",
];

export function AuditorNewForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [quals, setQuals] = useState<string[]>([]);
  const [customQual, setCustomQual] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleQual = (q: string) =>
    setQuals((cur) =>
      cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q],
    );

  const addCustomQual = () => {
    const v = customQual.trim();
    if (!v) return;
    if (!quals.includes(v)) setQuals([...quals, v]);
    setCustomQual("");
  };

  const onSubmit = async () => {
    setError(null);
    if (!displayName.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    if (!email.trim()) {
      setError("이메일을 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const a = await auditorService.create({
        displayName: displayName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        qualifications: quals,
        note: note.trim() || undefined,
      });
      router.push(`/admin/auditors/${encodeURIComponent(a.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">새 평가자 등록</h1>
        <Button variant="ghost" render={<Link href="/admin/auditors" />}>
          취소
        </Button>
      </div>

      <Section title="기본 정보">
        <Field label="이름 *">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="예: 박감사"
            className="h-9"
          />
        </Field>
        <Field label="이메일 *">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@domain.com"
            className="h-9"
          />
        </Field>
        <Field label="휴대폰 (선택)">
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            className="h-9"
          />
        </Field>
      </Section>

      <Section title="자격" hint="해당하는 항목을 선택하거나 직접 입력하세요.">
        <div className="flex flex-wrap gap-2">
          {PRESET_QUALIFICATIONS.map((q) => (
            <Button
              key={q}
              size="sm"
              variant={quals.includes(q) ? "default" : "outline"}
              onClick={() => toggleQual(q)}
            >
              {q}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={customQual}
            onChange={(e) => setCustomQual(e.target.value)}
            placeholder="직접 입력 후 추가"
            className="h-9 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomQual();
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={addCustomQual}
            disabled={!customQual.trim()}
          >
            추가
          </Button>
        </div>
        {quals.length > 0 && (
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">선택된 자격</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {quals.map((q) => (
                <Badge key={q} variant="secondary" className="text-[10px]">
                  {q}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="메모 (선택)">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="관리자만 보는 메모"
        />
      </Section>

      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        PoC: 등록 즉시 활성 상태로 추가됩니다. 실제 시스템에서는 이메일/SMS
        인증 후 평가자 로그인이 가능하도록 확장됩니다.
      </p>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" render={<Link href="/admin/auditors" />}>
          취소
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "등록 중…" : "등록하기"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
