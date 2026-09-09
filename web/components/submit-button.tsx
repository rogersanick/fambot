"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { AsciiSpinner } from "@/components/ascii/ascii-spinner";

type SubmitButtonProps = React.ComponentProps<typeof Button>;

/** Form submit button that swaps in an ASCII spinner while the action runs. */
export function SubmitButton({ children, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending ? <AsciiSpinner /> : children}
    </Button>
  );
}
