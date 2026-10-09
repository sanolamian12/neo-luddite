"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicHeader } from "@/components/layout/public-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { loginHref, routeForAccount } from "@/lib/account-route";
import { isPrototype } from "@/lib/data-mode";
import { cn } from "@/lib/utils";
import {
  type ApplicationForm,
  type MyApplication,
  SPECIALTY_PRESETS,
  applicationErrorMessage,
  getMyApplication,
  submitApplication,
  withdrawApplication,
} from "@/services/expert-application";

const EMPTY: ApplicationForm = {
  name: "", registrationNo: "", officeName: "", officeRegion: "", email: "", phone: "",
  yearsExperience: 0, specialties: [], bio: "",
};

/**
 * 세무사 가입 신청 — 소셜 가입한 회원이 신청서를 내면 관리자가 세무사 등록번호를 직접 조회해 승인한다.
 * 승인되면 같은 계정이 세무사 계정이 된다(0049). 자격증 사본은 받지 않는다.
 */
export default function ExpertApplyPage() {
  const hydrated = useAccountHydrated();
  const session = useAccountStore((s) => s.session);

  return <>
    <PublicHeader />
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-14 sm:px-6">
      <h1 className="text-2xl font-semibold">세무사 가입 신청</h1>
      {isPrototype ? <p className="text-muted-foreground">세무사 가입 신청은 운영 환경에서만 할 수 있어요.</p>
        : !hydrated ? <p role="status">계정을 확인하는 중…</p>
        : session === null ? <SignInFirst />
        : session !== "viewer" ? <AlreadyStaff role={session} />
        : <ApplicationFlow />}
    </main>
  </>;
}

function SignInFirst() {
  return <>
    <p className="leading-relaxed text-muted-foreground">
      먼저 Google 또는 카카오 계정으로 가입·로그인한 뒤 신청서를 작성해 주세요.
      관리자가 세무사 등록 정보를 확인하고 승인하면 같은 계정이 세무사 계정으로 바뀌어요.
    </p>
    <Link href={loginHref("/expert/apply")} className={buttonVariants({ size: "lg" })}>로그인하고 신청하기</Link>
  </>;
}

function AlreadyStaff({ role }: { role: "auditor" | "admin" }) {
  return role === "auditor" ? <>
    <p className="leading-relaxed text-muted-foreground">
      세무사 가입이 승인된 계정이에요. [내 프로필]에서 소개·전문 분야·연락처 공개 범위를 확인하고
      &ldquo;카드에 노출&rdquo;을 켜면 상담 화면의 세무사 카드에 표시돼요.
    </p>
    <Link href="/audit/profile" className={buttonVariants({ size: "lg" })}>내 프로필로</Link>
  </> : <p className="text-muted-foreground">관리자 계정은 신청할 수 없어요.</p>;
}

function ApplicationFlow() {
  const [app, setApp] = useState<MyApplication | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setApp(await getMyApplication()); }
    catch (cause) { setError(applicationErrorMessage(cause)); }
  }, []);
  useEffect(() => {
    // 조회 결과를 state 에 담는 마운트·조건 변경 시 조회(kb3-share-view 와 같은 패턴)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && app === undefined) return <p role="alert" className="text-destructive">{error}</p>;
  if (app === undefined) return <p role="status">신청 내역을 불러오는 중…</p>;
  if (app?.status === "pending") return <PendingApplication app={app} onChange={setApp} />;
  if (app?.status === "approved") return <ApprovedApplication />;
  return <ApplicationFormView previous={app} onSubmitted={setApp} />;
}

function PendingApplication({ app, onChange }: { app: MyApplication; onChange: (a: MyApplication) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function withdraw() {
    if (pending || !window.confirm("신청을 철회할까요? 철회한 뒤에도 다시 신청할 수 있어요.")) return;
    setPending(true);
    setError(null);
    try { onChange(await withdrawApplication(app.id)); }
    catch (cause) { setError(applicationErrorMessage(cause)); setPending(false); }
  }
  return <>
    <div role="status" className="rounded-lg border bg-muted/40 px-4 py-3 leading-relaxed">
      <p className="font-medium">신청서를 검토하고 있어요.</p>
      <p className="text-sm text-muted-foreground">
        {new Date(app.createdAt).toLocaleDateString("ko-KR")}에 접수했어요. 관리자가 세무사 등록 정보를 확인한 뒤 승인하면
        이 화면과 계정 메뉴에서 바로 세무사 화면으로 들어갈 수 있어요.
      </p>
    </div>
    <ApplicationSummary app={app} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" onClick={withdraw} disabled={pending}>{pending ? "철회하는 중…" : "신청 철회"}</Button>
  </>;
}

function ApprovedApplication() {
  const router = useRouter();
  const syncSession = useAccountStore((s) => s.syncSession);
  const [pending, setPending] = useState(false);
  async function enter() {
    setPending(true);
    try {
      const role = await syncSession();
      const account = role ? useAccountStore.getState()[role] : null;
      router.replace(account ? routeForAccount(account) : "/login");
    } catch { setPending(false); }
  }
  return <>
    <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 leading-relaxed">
      <p className="font-medium">세무사 가입이 승인되었어요.</p>
      <p className="text-sm text-muted-foreground">
        세무사 화면의 [내 프로필]에서 소개·전문 분야·연락처 공개 범위를 확인하고 &ldquo;카드에 노출&rdquo;을 켜면
        상담 화면의 세무사 카드에 표시돼요. 연락처는 처음에 모두 비공개예요.
      </p>
    </div>
    <Button size="lg" onClick={enter} disabled={pending}>{pending ? "전환하는 중…" : "세무사 화면으로"}</Button>
  </>;
}

function ApplicationSummary({ app }: { app: MyApplication }) {
  const rows: [string, string][] = [
    ["이름", app.name], ["등록번호", app.registrationNo], ["사무소", `${app.officeName} · ${app.officeRegion}`],
    ["연락 이메일", app.email], ["휴대폰", app.phone], ["경력", `${app.yearsExperience}년`],
    ["전문 분야", app.specialties.join(", ") || "—"],
  ];
  return <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
    {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v}</dd></div>)}
  </dl>;
}

function ApplicationFormView({ previous, onSubmitted }: { previous: MyApplication | null; onSubmitted: (a: MyApplication) => void }) {
  const [form, setForm] = useState<ApplicationForm>(() => previous ? {
    name: previous.name, registrationNo: previous.registrationNo, officeName: previous.officeName,
    officeRegion: previous.officeRegion, email: previous.email, phone: previous.phone,
    yearsExperience: previous.yearsExperience, specialties: previous.specialties, bio: previous.bio,
  } : EMPTY);
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ApplicationForm>(key: K, value: ApplicationForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (error) setError(null);
  };
  const toggleSpecialty = (s: string) =>
    set("specialties", form.specialties.includes(s) ? form.specialties.filter((x) => x !== s) : [...form.specialties, s].slice(0, 8));
  const addCustom = () => {
    const v = customSpecialty.trim().slice(0, 20);
    if (v && !form.specialties.includes(v)) set("specialties", [...form.specialties, v].slice(0, 8));
    setCustomSpecialty("");
  };

  const required = form.name.trim() && form.registrationNo.trim() && form.officeName.trim()
    && form.officeRegion.trim() && form.email.trim() && form.phone.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!required || !agreed || pending) return;
    setPending(true);
    setError(null);
    try { onSubmitted(await submitApplication(form)); }
    catch (cause) { setError(applicationErrorMessage(cause)); setPending(false); }
  }

  return <>
    {previous?.status === "rejected" && <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-relaxed">
      <p className="font-medium">이전 신청이 반려되었어요.</p>
      {previous.rejectReason && <p className="mt-1 whitespace-pre-wrap">사유: {previous.rejectReason}</p>}
      <p className="mt-1 text-muted-foreground">내용을 고쳐 다시 신청할 수 있어요.</p>
    </div>}
    {previous?.status === "revoked" && <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-relaxed">
      <p className="font-medium">세무사 승인이 취소되어 일반 회원 계정으로 바뀌었어요.</p>
      {previous.rejectReason && <p className="mt-1 whitespace-pre-wrap">사유: {previous.rejectReason}</p>}
      <p className="mt-1 text-muted-foreground">사유가 해소됐다면 다시 신청할 수 있어요. 승인되면 이전 검수·정산 기록이 이어져요.</p>
    </div>}
    <p className="leading-relaxed text-muted-foreground">
      관리자가 입력한 등록번호와 이름으로 세무사 등록 여부를 직접 확인한 뒤 승인해요. 자격증 사본은 받지 않아요.
      승인되면 <strong className="text-foreground">이 계정이 세무사 계정으로 바뀌고</strong>, 고객으로 나눈 상담 기록은 더 이상 고객 화면에서 볼 수 없어요.
    </p>
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field id="name" label="이름 (세무사 등록 이름)" required>
        <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={40} autoComplete="name" className="h-10 text-base" />
      </Field>
      <Field id="registrationNo" label="세무사 등록번호" required>
        <Input id="registrationNo" value={form.registrationNo} onChange={(e) => set("registrationNo", e.target.value)} maxLength={20} autoComplete="off" className="h-10 text-base" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="officeName" label="사무소명" required>
          <Input id="officeName" value={form.officeName} onChange={(e) => set("officeName", e.target.value)} maxLength={80} autoComplete="organization" className="h-10 text-base" />
        </Field>
        <Field id="officeRegion" label="사무소 소재지 (시·구)" required>
          <Input id="officeRegion" value={form.officeRegion} onChange={(e) => set("officeRegion", e.target.value)} maxLength={40} placeholder="예: 서울 강남구" className="h-10 text-base" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="email" label="연락 이메일" required>
          <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={120} autoComplete="email" className="h-10 text-base" />
        </Field>
        <Field id="phone" label="휴대폰" required>
          <Input id="phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={13} autoComplete="tel" placeholder="010-0000-0000" className="h-10 text-base" />
        </Field>
      </div>
      <Field id="years" label="세무 업무 경력 (년)">
        <Input id="years" type="number" min={0} max={70} value={form.yearsExperience}
          onChange={(e) => set("yearsExperience", Math.max(0, Math.min(70, Number(e.target.value) || 0)))} className="h-10 w-28 text-base" />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">전문 분야 (최대 8개)</legend>
        <div className="flex flex-wrap gap-2">
          {[...new Set([...SPECIALTY_PRESETS, ...form.specialties])].map((s) => (
            <Button key={s} type="button" size="sm" variant={form.specialties.includes(s) ? "default" : "outline"}
              aria-pressed={form.specialties.includes(s)} onClick={() => toggleSpecialty(s)}>{s}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={customSpecialty} onChange={(e) => setCustomSpecialty(e.target.value)} maxLength={20} placeholder="직접 입력" aria-label="전문 분야 직접 입력"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} className="h-9 flex-1" />
          <Button type="button" size="sm" variant="outline" onClick={addCustom} disabled={!customSpecialty.trim()}>추가</Button>
        </div>
      </fieldset>
      <Field id="bio" label="한 줄 소개 (선택)">
        <Textarea id="bio" value={form.bio} onChange={(e) => set("bio", e.target.value)} maxLength={500} rows={3} />
      </Field>
      <label className="flex items-start gap-2 text-sm leading-relaxed">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-4" />
        <span>
          세무사 자격 확인을 위해 위 정보(이름·등록번호·사무소·연락처·경력)를 수집·이용하는 데 동의합니다.
          반려·철회되거나 승인이 취소된 신청서는 30일 뒤 파기돼요.{" "}
          <Link href="/privacy" className="underline underline-offset-4">개인정보처리방침</Link>
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={!required || !agreed || pending}>{pending ? "보내는 중…" : "신청서 보내기"}</Button>
    </form>
  </>;
}

function Field({ id, label, required, children }: { id: string; label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">
    <Label htmlFor={id} className={cn(required && "after:ml-0.5 after:text-destructive after:content-['*']")}>{label}</Label>
    {children}
  </div>;
}
