import { useState } from "react";
import { formatPhone, normalizePhone } from "@fambot/shared/phone";
import { Input } from "@/components/ui/input";

export function PhoneInput({
  defaultValue = "",
  id,
  name = "phone",
  placeholder = "(555) 555-1212",
}: {
  defaultValue?: string;
  id?: string;
  name?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(() => (defaultValue ? formatPhone(defaultValue) : ""));

  return (
    <Input
      id={id}
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (normalizePhone(value)) setValue(formatPhone(value));
      }}
      placeholder={placeholder}
      required
    />
  );
}
