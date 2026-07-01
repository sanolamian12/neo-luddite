"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessagesSquare, Plus, Repeat2, StickyNote } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getConversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { useReplayStore } from "@/lib/replay-store";
import { AccountSwitcher } from "./account-switcher";

/** /chat/<occupation> 경로에서 현재 직업군 키 추출 */
function useOccupationKey(): string | null {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "chat" && parts[1] ? parts[1] : null;
}

export function AppSidebar() {
  const occupationKey = useOccupationKey();
  const occ = occupationKey ? getOccupation(occupationKey) : undefined;
  const sessions = getConversations(occ?.conversationIds ?? []);

  const revealAll = useReplayStore((s) => s.revealAll);
  const reset = useReplayStore((s) => s.reset);
  const activeId = useReplayStore((s) => s.script?.id ?? null);

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="text-lg">세무상담</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => reset()}>
                  <Plus />
                  <span>새 상담</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>상담 세션</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sessions.length === 0 && (
                <SidebarMenuItem>
                  <span className="px-2 py-1.5 text-xs text-muted-foreground">
                    세션이 없습니다
                  </span>
                </SidebarMenuItem>
              )}
              {sessions.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    isActive={activeId === c.id}
                    onClick={() => revealAll(c)}
                  >
                    <MessagesSquare />
                    <span>{c.topic.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>기능 (준비중)</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled aria-disabled className="opacity-50">
                  <StickyNote />
                  <span>대화 주석</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" render={<Link href="/select" />}>
              <Repeat2 />
              <span>업종 변경</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <AccountSwitcher />
      </SidebarFooter>
    </Sidebar>
  );
}
