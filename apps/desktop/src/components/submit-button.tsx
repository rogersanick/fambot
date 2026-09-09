import { Button } from "@/components/ui/button";
import { AsciiSpinner } from "@/components/ascii/ascii-spinner";

type SubmitButtonProps = React.ComponentProps<typeof Button> & { pending?: boolean };

/** Form submit button that swaps in an ASCII spinner while the action runs. */
export function SubmitButton({ children, disabled, pending, ...props }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending ? <AsciiSpinner /> : children}
    </Button>
  );
}
