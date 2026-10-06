"use client";

import type { ComponentProps } from "react";
import { isPrototype } from "@/lib/data-mode";
import { LiveEntryResponse } from "./live-entry-response";
import { PrototypeEntryResponse } from "./prototype-entry-response";

export function EntryResponse(props: ComponentProps<typeof LiveEntryResponse>) {
  return isPrototype ? <PrototypeEntryResponse {...props} /> : <LiveEntryResponse {...props} />;
}
