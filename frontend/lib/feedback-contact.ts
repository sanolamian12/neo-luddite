export const FEEDBACK_EMAIL = "credigraph.contact@gmail.com";

const subject = "[Credigraph] 사용 의견";
const body = [
  "Credigraph를 사용하며 느낀 점을 전합니다.",
  "",
  "• 어떤 기능을 사용해 보셨나요?",
  "",
  "• 어떤 점이 도움이 되었거나 불편했나요?",
  "",
  "• 어떻게 바뀌면 좋을까요? (선택)",
  "",
  "※ 개인정보나 민감한 사업 자료는 제외해 주세요.",
].join("\r\n");

export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export async function copyFeedbackAddress(clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<"copied" | "unavailable"> {
  if (!clipboard) return "unavailable";
  try {
    await clipboard.writeText(FEEDBACK_EMAIL);
    return "copied";
  } catch {
    return "unavailable";
  }
}
