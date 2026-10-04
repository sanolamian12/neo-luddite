"use client";

import { useAccountStore } from "./account-store";
import { isPrototype } from "./data-mode";
import type { EntryConversation } from "./entry-chat";
import { persistLive } from "../services/conversation";

/** Only adopted owner chats enter the local consultation collection. */
export async function saveOwnerConversation(conversation: EntryConversation) {
  const account = useAccountStore.getState();
  if (account.session !== "viewer" || conversation.scope !== `viewer:${account.viewer.id}`) {
    throw new Error("Only the current owner can save this conversation.");
  }
  await persistLive({
    conversationId: conversation.id, occupation: conversation.occupation,
    ownerId: account.viewer.id, ownerLabel: account.viewer.label,
    createdAt: conversation.createdAt, messages: conversation.messages, source: isPrototype ? "prototype" : "live",
  });
}
