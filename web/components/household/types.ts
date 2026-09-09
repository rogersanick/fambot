export type MemberRow = {
  id: string;
  display_name: string;
  role: string;
  handle: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  list_id: string | null;
  assignee: { display_name: string } | null;
};

export type ListRow = {
  id: string;
  name: string;
};

export type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
};

export type ReminderRow = {
  id: string;
  message: string;
  fire_at: string;
  status: string;
  sent_at: string | null;
};

export type ChannelRow = {
  id: string;
  chat_guid: string;
  name: string | null;
};

/** Event pre-localized to the household timezone for the client calendar. */
export type CalendarEvent = {
  id: string;
  title: string;
  /** YYYY-MM-DD in the household timezone. */
  day: string;
  time: string;
  location: string | null;
};
