"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { copyFeedbackAddress, FEEDBACK_EMAIL } from "@/lib/feedback-contact";
import styles from "@/app/feedback/feedback.module.css";

export function FeedbackAddress() {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "unavailable">("idle");

  async function copyAddress() {
    setStatus("copying");
    setStatus(await copyFeedbackAddress(navigator.clipboard));
  }

  return <div className={styles.addressBlock}>
    <p id="feedback-address-label" className={styles.addressLabel}>이메일이 열리지 않으면 이 주소로 보내주세요.</p>
    <p className={styles.address} aria-labelledby="feedback-address-label">{FEEDBACK_EMAIL}</p>
    <button type="button" className={styles.copyButton} onClick={copyAddress} disabled={status === "copying"}>
      <Copy size={16} aria-hidden="true" />{status === "copying" ? "복사 중…" : "이메일 주소 복사"}
    </button>
    <p className={styles.copyStatus} role="status">{status === "copied" ? "이메일 주소를 복사했어요." : status === "unavailable" ? "주소를 복사하지 못했어요. 위 주소를 선택해 복사해 주세요." : "주소를 직접 선택해 복사할 수도 있어요."}</p>
  </div>;
}
