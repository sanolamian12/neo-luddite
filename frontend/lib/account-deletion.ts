import { getSupabase } from "./supabase/client";
import { useAccountStore } from "./account-store";

/** 탈퇴 확인 문구 — 실수로 누르는 것을 막는다. */
export const DELETE_CONFIRM_WORD = "탈퇴";

/**
 * 회원 탈퇴(0048 delete_my_account) — 계정과 상담 기록을 서버에서 파기한 뒤
 * 이 브라우저에 남은 로그인 정보와 대화 사본도 지운다.
 */
export async function deleteMyAccount(): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw new Error("탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
  // 계정이 이미 지워졌으므로 서버 로그아웃은 실패할 수 있다 — 로컬 세션만 정리한다.
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  useAccountStore.setState({ session: null, authReady: true, authError: null });
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* 저장소 접근이 막힌 브라우저 */ }
}
