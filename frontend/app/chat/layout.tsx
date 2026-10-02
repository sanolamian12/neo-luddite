import { ChatShell } from "@/components/layout/chat-shell";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatShell>{children}</ChatShell>;
}
