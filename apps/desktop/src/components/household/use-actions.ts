import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Wraps an async API call: tracks pending state, refreshes the household
 * queries afterwards, and toasts on failure. The form-action replacement for
 * the old Next server actions.
 */
export function useAction(householdId: string) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setPending(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["household", householdId] });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setPending(false);
    }
  }

  return { run, pending };
}
