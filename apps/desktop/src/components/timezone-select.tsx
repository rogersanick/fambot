import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FALLBACK_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
}

function availableTimeZones(selected: string): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const supported = intl.supportedValuesOf?.("timeZone") ?? FALLBACK_TIMEZONES;
  return Array.from(new Set([selected, ...supported])).sort((a, b) => a.localeCompare(b));
}

export function TimezoneSelect({
  id,
  name = "timezone",
  defaultValue = browserTimeZone(),
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
}) {
  return (
    <Select name={name} defaultValue={defaultValue} required>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent position="popper">
        {availableTimeZones(defaultValue).map((timezone) => (
          <SelectItem key={timezone} value={timezone}>
            {timezone.replaceAll("_", " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
