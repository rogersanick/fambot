import type { ProposedAction } from "@fambot/shared";

/**
 * Deterministic authorization, applied AFTER AI interpretation and BEFORE
 * execution (design doc §17). Never delegated to the model.
 */

export type Actor = {
  memberId: string;
  householdId: string;
  role: "owner" | "member";
};

export type AuthzResult = { ok: true } | { ok: false; reason: string };

/**
 * Family-trust model: any household member may create/see shared items and
 * target other members of the same household. Cross-household access is
 * impossible by construction (all lookups are household-scoped). The checks
 * here are the ones that matter within that model.
 */
export function authorizeAction(actor: Actor, action: ProposedAction): AuthzResult {
  switch (action.type) {
    case "delete_list":
      // Destructive bulk-ish operation: owners only.
      if (actor.role !== "owner") {
        return { ok: false, reason: "Only the household owner can delete lists." };
      }
      return { ok: true };
    case "create_reminder":
    case "update_reminder":
    case "cancel_reminder":
    case "create_task":
    case "update_task":
    case "complete_task":
    case "cancel_task":
    case "create_list":
    case "rename_list":
    case "add_list_items":
    case "update_list_item":
    case "set_list_item_completed":
    case "delete_list_item":
    case "get_list":
    case "create_event":
    case "search_schedule":
    case "add_comment":
    case "get_comment_status":
    case "clarify":
    case "chat_reply":
      return { ok: true };
  }
}
