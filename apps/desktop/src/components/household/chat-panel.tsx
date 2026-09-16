import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ARTIFACT_TYPE_LABEL, parseArtifactHref } from "@fambot/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RobotSpinner } from "@/components/robot/spinner";
import { RobotEmptyState } from "@/components/robot/scenes";
import type { ChatMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ArtifactLink } from "./artifact-link";

const URL_RE = /(https?:\/\/[^\s]+)/g;

export function ChatText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {parts.map((part, index) => {
        if (!/^https?:\/\//.test(part)) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        const artifact = parseArtifactHref(part);
        if (artifact) {
          return (
            <ArtifactLink
              key={`${part}-${index}`}
              type={artifact.type}
              id={artifact.id}
              className="underline underline-offset-2 hover:opacity-80"
            >
              {ARTIFACT_TYPE_LABEL[artifact.type]}
            </ArtifactLink>
          );
        }
        return (
          <a key={`${part}-${index}`} href={part} className="underline underline-offset-2 hover:opacity-80">
            {part}
          </a>
        );
      })}
    </span>
  );
}

export function ChatPanel({
  meName,
  messages,
  online,
  sending,
  fillViewport = false,
  header,
  emptyCaption,
  placeholder,
  loading = false,
  onSend,
}: {
  meName: string;
  messages: ChatMessage[];
  online: boolean;
  sending: boolean;
  fillViewport?: boolean;
  header?: ReactNode;
  emptyCaption: string;
  placeholder: string;
  loading?: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await onSend(text);
  }

  return (
    <Card
      className={cn(
        "animate-fade-up overflow-hidden py-0",
        fillViewport && "flex h-full min-h-0 flex-1 flex-col"
      )}
    >
      <CardContent className={cn("p-0", fillViewport && "flex min-h-0 flex-1 flex-col")}>
        <div className="bg-terminal text-terminal-foreground border-terminal-border flex items-center justify-between border-b px-4 py-2 font-mono text-xs">
          <span>
            <span className="text-terminal-dim">~/fambot $</span> {header ?? "chat --with fambot"}
          </span>
          <span className={online ? "text-chart-1" : "text-destructive"}>
            {online ? "● online" : "● offline — OpenAI key required"}
          </span>
        </div>
        <div
          ref={scrollRef}
          className={cn(
            "bg-terminal overflow-y-auto p-4 font-mono text-sm",
            fillViewport ? "min-h-0 flex-1" : "h-[26rem]"
          )}
        >
          {messages.length === 0 && !loading && (
            <RobotEmptyState caption={emptyCaption} className="text-terminal-dim py-10" />
          )}
          <div className="grid gap-1.5">
            {messages.map((message) => (
              <div key={message.id} className="flex gap-2 leading-relaxed">
                <span
                  className={cn(
                    "shrink-0 select-none",
                    message.direction === "outbound" ? "text-terminal-foreground" : "text-terminal-dim"
                  )}
                >
                  {message.direction === "outbound" ? "fambot>" : `${meName.toLowerCase()}>`}
                </span>
                <ChatText
                  text={message.text}
                  className={
                    message.direction === "outbound" ? "text-terminal-foreground" : "text-terminal-dim"
                  }
                />
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
        <form
          onSubmit={send}
          className="border-terminal-border bg-terminal flex shrink-0 items-center gap-2 border-t p-3"
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={online ? placeholder : "Chat is offline until OPENAI_API_KEY is configured"}
            className="border-terminal-border text-terminal-foreground placeholder:text-terminal-dim/60 bg-transparent font-mono text-sm focus-visible:ring-0"
            disabled={!online}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!online || sending || !draft.trim()}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
