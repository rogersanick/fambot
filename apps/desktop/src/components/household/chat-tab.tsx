import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ChatPanel } from "./chat-panel";

/**
 * Terminal-styled direct chat with Fambot. Messages go through the exact
 * same pipeline as iMessage: interpret → validate → execute → reply.
 */
export function ChatTab({
  householdId,
  meName,
  fillViewport = false,
}: {
  householdId: string;
  meName: string;
  fillViewport?: boolean;
}) {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    refetchInterval: 10_000,
  });
  const chat = useQuery({
    queryKey: ["household", householdId, "chat"],
    queryFn: () => api.chat.get(householdId),
    refetchInterval: 3_000,
  });

  async function send(text: string) {
    setSending(true);
    try {
      await api.chat.send(householdId, text);
      await queryClient.invalidateQueries({ queryKey: ["household", householdId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <ChatPanel
      meName={meName}
      messages={chat.data?.messages ?? []}
      online={config.data?.aiConfigured === true}
      sending={sending}
      fillViewport={fillViewport}
      loading={chat.isLoading}
      emptyCaption='Say hi — or try "remind me in 10 minutes to stretch".'
      placeholder={
        fillViewport
          ? "Talk to Fambot…"
          : "remind us tomorrow at 8am to pack lunches · make sure the trash goes out tonight · what's on this week?"
      }
      onSend={send}
    />
  );
}
