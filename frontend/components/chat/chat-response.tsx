import type { ReactNode } from "react";
import type { Message } from "@/lib/conversation-schema";
import { SegmentRenderer } from "./segment-renderer";
import { UiBlocks } from "./ui-blocks";
import styles from "./entry-response.module.css";

/** Renders only the supplied response. Runtime controllers own handoff and persistence. */
export function ChatResponse({ message, handoff }: { message: Message; handoff?: ReactNode }) {
  return <div className={styles.response}>
    <SegmentRenderer message={message} />
    <UiBlocks blocks={message.uiBlocks?.filter((block) => block.kind !== "expert_handoff")} />
    {handoff}
  </div>;
}
