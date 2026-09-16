import type { MouseEvent, ReactNode } from "react";
import { artifactPath, type ArtifactType } from "@fambot/shared";
import { cn } from "@/lib/utils";

export function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goHome() {
  navigateTo("/");
}

export function ArtifactLink({
  type,
  id,
  className,
  children,
  title,
  "aria-label": ariaLabel,
}: {
  type: ArtifactType;
  id: string;
  className?: string;
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  const href = artifactPath(type, id);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigateTo(href);
  }

  return (
    <a
      href={href}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={cn("hover:underline underline-offset-2", className)}
    >
      {children}
    </a>
  );
}
