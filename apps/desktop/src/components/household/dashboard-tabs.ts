export const DASHBOARD_TABS = [
  "overview",
  "chat",
  "tasks",
  "lists",
  "calendar",
  "reminders",
  "connections",
  "settings",
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export function isDashboardTab(value: string): value is DashboardTab {
  return (DASHBOARD_TABS as readonly string[]).includes(value);
}

export const MORE_TABS = ["lists", "reminders", "connections", "settings"] as const satisfies readonly DashboardTab[];

export function isMoreTab(tab: DashboardTab) {
  return (MORE_TABS as readonly DashboardTab[]).includes(tab);
}
