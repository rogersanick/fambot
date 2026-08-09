import { localDateString } from "./time.ts";

export function appBaseUrl(): string {
  return (Deno.env.get("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
}

export const links = {
  help: () => `${appBaseUrl()}/help`,
  linkEntry: () => `${appBaseUrl()}/link`,
  dashboard: (slug: string) => `${appBaseUrl()}/h/${slug}`,
  today: (slug: string) => `${appBaseUrl()}/h/${slug}/today`,
  tasks: (slug: string) => `${appBaseUrl()}/h/${slug}/tasks`,
  task: (slug: string, code: string) => `${appBaseUrl()}/h/${slug}/k/${code}`,
  calendar: (slug: string) => `${appBaseUrl()}/h/${slug}/calendar`,
  calendarDay: (slug: string, date: Date, tz: string) =>
    `${appBaseUrl()}/h/${slug}/calendar?d=${localDateString(date, tz)}`,
  settings: (slug: string) => `${appBaseUrl()}/h/${slug}/settings`,
};
