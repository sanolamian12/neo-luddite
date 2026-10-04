"use client";

import { Suspense } from "react";
import { EntrySidebar } from "./entry-sidebar";

/** 사장님 화면 사이드바 — 두 모드 모두 새 입구 사이드바. live 는 로그인 시 서버 대화 목록을 합쳐 보인다(owner-server-conversations). */
export function AppSidebar() {
  return <Suspense fallback={null}><EntrySidebar /></Suspense>;
}
