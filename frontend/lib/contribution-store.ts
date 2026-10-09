"use client";

import { useMemo, useSyncExternalStore } from "react";
import { boardSchema, emptyBoard, type ContributionBoard } from "./knowledge-contributions";
import { useDemo } from "@/components/demo/runtime";

const key = "neo-knowledge-contributions-v1";
const changed = "neo-contributions-changed";
const unavailable = "storage-unavailable";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changed, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(changed, callback); };
}
function snapshot() { try { return window.localStorage.getItem(key) ?? ""; } catch { return unavailable; } }
const serverSnapshot = () => "";
export function useContributionBoard(enabled = true) {
  const demo = useDemo();
  const raw = useSyncExternalStore(subscribe, enabled && !demo ? snapshot : serverSnapshot, serverSnapshot);
  const state = useMemo(() => {
    try { return { board: raw ? boardSchema.parse(JSON.parse(raw)) : emptyBoard(), error: "" }; }
    catch { return { board: emptyBoard(), error: "기여 내역을 읽을 수 없습니다. 저장된 내용은 보존했습니다. 브라우저 저장소를 확인한 뒤 다시 불러와 주세요." }; }
  }, [raw]);
  function transact(change: (board: ContributionBoard) => ContributionBoard) {
    if (demo) return demo.transact((run) => ({ ...run, board: boardSchema.parse(change(run.board)) })).board;
    if (!enabled) throw new Error("공통 지식 기여는 이 모드에서 사용할 수 없습니다.");
    const current = snapshot();
    if (current === unavailable) throw new Error("브라우저 저장소에 접근할 수 없습니다. 저장 권한을 확인해 주세요.");
    let board: ContributionBoard;
    try { board = current ? boardSchema.parse(JSON.parse(current)) : emptyBoard(); }
    catch { throw new Error("기존 기여 내역을 읽지 못해 변경하지 않았습니다."); }
    const next = boardSchema.parse(change(board));
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(changed));
    return next;
  }
  return { ...(demo ? { board: demo.run.board, error: "" } : state), transact };
}
