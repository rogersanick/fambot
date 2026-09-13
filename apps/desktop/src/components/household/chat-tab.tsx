import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RobotSpinner } from "@/components/robot/spinner";
import { RobotEmptyState } from "@/components/robot/scenes";
import { api, type ChatMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Terminal-styled direct chat with Fambot. Messages go through the exact
 * same pipeline as iMessage: interpret → validate → execute → reply.
 */
export function ChatTab({ householdId, meName }: { householdId: string; meName: string }) {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const messages = chat.data?.messages ?? [];
  const online = config.data?.aiConfigured === true;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      await api.chat.send(householdId, text);
      await queryClient.invalidateQueries({ queryKey: ["household", householdId] });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="animate-fade-up overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="bg-terminal text-terminal-foreground border-terminal-border flex items-center justify-between border-b px-4 py-2 font-mono text-xs">
          <span>
            <span className="text-terminal-dim">~/fambot $</span> chat --with fambot
          </span>
          <span className={online ? "text-chart-1" : "text-destructive"}>
            {online ? "● online" : "● offline — OpenAI key required"}
          </span>
        </div>
        <div ref={scrollRef} className="bg-terminal h-[26rem] overflow-y-auto p-4 font-mono text-sm">
          {messages.length === 0 && !chat.isLoading && (
            <RobotEmptyState
              variant="juggling"
              caption='Say hi — or try "remind me in 10 minutes to stretch".'
              className="text-terminal-dim py-10"
            />
          )}
          <div className="grid gap-1.5">
            {messages.map((m: ChatMessage) => (
              <div key={m.id} className="flex gap-2 leading-relaxed">
                <span
                  className={cn(
                    "shrink-0 select-none",
                    m.direction === "outbound" ? "text-terminal-foreground" : "text-terminal-dim"
                  )}
                >
                  {m.direction === "outbound" ? "fambot>" : `${meName.toLowerCase()}>`}
                </span>
                <span
                  className={cn(
                    "whitespace-pre-wrap",
                    m.direction === "outbound" ? "text-terminal-foreground" : "text-terminal-dim"
                  )}
                >
                  {m.text}
                </span>
              </div>
            ))}
            {sending && (
              <div className="text-terminal-dim flex gap-2">
                <span className="shrink-0 select-none">fambot&gt;</span>
                <RobotSpinner />
              </div>
            )}
          </div>
        </div>
        <form onSubmit={send} className="border-terminal-border bg-terminal flex items-center gap-2 border-t p-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              online
                ? "remind us tomorrow at 8am to pack lunches · make sure the trash goes out tonight · what's on this week?"
                : "Chat is offline until OPENAI_API_KEY is configured"
            }
            className="border-terminal-border text-terminal-foreground placeholder:text-terminal-dim/60 bg-transparent font-mono text-sm focus-visible:ring-0"
            disabled={!online}
            autoFocus
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!online || sending || !draft.trim()}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
