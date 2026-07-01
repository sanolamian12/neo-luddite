"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMailHydrated, useMailStore } from "@/lib/mail-store";
import { useAccountStore } from "@/lib/account-store";
import { formatDateTime } from "@/lib/poc-format";
import { cn } from "@/lib/utils";
import * as mailService from "@/services/mail";
import type { MailKind } from "@/lib/poc-schema";

const KIND_LABEL: Record<MailKind, string> = {
  notice: "공지",
  inquiry_reply: "이의 답변",
  settlement: "정산 안내",
};

const KIND_VARIANT: Record<MailKind, "default" | "secondary" | "outline"> = {
  notice: "secondary",
  inquiry_reply: "default",
  settlement: "outline",
};

export function MailView() {
  const hydrated = useMailHydrated();
  const mails = useMailStore((s) => s.mails);
  const adminId = useAccountStore((s) => s.admin.id);
  const auditor = useAccountStore((s) => s.auditor);

  const [filter, setFilter] = useState<MailKind | "all">("all");
  const [showCompose, setShowCompose] = useState(false);
  const [recipient, setRecipient] = useState<"all" | "auditor">("auditor");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => {
    const all = mails.slice().sort((a, b) => b.sentAt - a.sentAt);
    if (filter === "all") return all;
    return all.filter((m) => m.kind === filter);
  }, [mails, filter]);

  if (!hydrated) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">로딩 중…</div>;
  }

  const onSend = async () => {
    setError(null);
    if (!subject.trim()) {
      setError("제목이 필요합니다.");
      return;
    }
    setSending(true);
    try {
      await mailService.send({
        recipientId: recipient === "all" ? "auditor" : auditor.id, // PoC: 단일 평가자
        senderId: adminId,
        kind: "notice",
        subject: subject.trim(),
        body: body.trim(),
      });
      setSubject("");
      setBody("");
      setShowCompose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">발송함</h1>
        <Button onClick={() => setShowCompose((v) => !v)}>
          {showCompose ? "취소" : "새 공지"}
        </Button>
      </header>

      {showCompose && (
        <section className="rounded-xl border bg-card">
          <header className="border-b px-4 py-2 text-sm font-semibold">새 공지 작성</header>
          <div className="flex flex-col gap-3 p-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">수신인</label>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant={recipient === "all" ? "default" : "outline"}
                  onClick={() => setRecipient("all")}
                >
                  전체 평가자
                </Button>
                <Button
                  size="sm"
                  variant={recipient === "auditor" ? "default" : "outline"}
                  onClick={() => setRecipient("auditor")}
                >
                  {auditor.reviewerName}
                </Button>
                <p className="self-center text-xs text-muted-foreground">
                  (PoC: 단일 평가자만 존재)
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">제목</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="예: 시스템 점검 안내"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">본문</label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="공지 본문 (plain text)"
                className="mt-1"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCompose(false)}>
                취소
              </Button>
              <Button onClick={onSend} disabled={sending || !subject.trim()}>
                {sending ? "발송 중…" : "발송하기"}
              </Button>
            </div>
          </div>
        </section>
      )}

      <div className="flex items-center gap-1.5">
        {(["all", "notice", "inquiry_reply", "settlement"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "default" : "outline"}
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "전체" : KIND_LABEL[s as MailKind]}
          </Button>
        ))}
        <p className="ml-auto text-xs text-muted-foreground">{list.length}건</p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th>종류</Th>
              <Th>제목</Th>
              <Th>수신인</Th>
              <Th>발송일</Th>
              <Th>읽음</Th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-muted-foreground">
                  발송한 우편이 없습니다.
                </td>
              </tr>
            ) : (
              list.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">
                    <Badge variant={KIND_VARIANT[m.kind]} className="text-[10px]">
                      {KIND_LABEL[m.kind]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 max-w-[360px] truncate font-medium">
                    {m.subject}
                    {m.ref?.kind === "inquiry" && (
                      <Link
                        href={`/admin/inquiries`}
                        className="ml-2 text-xs text-muted-foreground underline"
                      >
                        이의 →
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{m.recipientId}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(m.sentAt)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.readAt ? (
                      <span className="text-muted-foreground">
                        {formatDateTime(m.readAt)}
                      </span>
                    ) : (
                      <span className={cn("text-primary")}>● 미확인</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className ?? ""}`}>{children}</th>;
}
