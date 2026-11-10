"use client";

import { useState, useTransition } from "react";
import { saveReminders } from "./actions";
import SaveStatus, { type Status } from "./SaveStatus";
import Toggle from "./Toggle";

type Reminders = { threeDays: boolean; oneDay: boolean; overdue: boolean };

// Each switch saves as soon as it's flipped.
export default function RemindersForm({ initial }: { initial: Reminders }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [, startTransition] = useTransition();

  function change(key: keyof Reminders, checked: boolean) {
    const previous = value;
    const next = { ...value, [key]: checked };
    setValue(next);
    setStatus("saving");
    startTransition(async () => {
      const res = await saveReminders(next);
      if (res.ok) setStatus("saved");
      else {
        setValue(previous);
        setStatus("error");
      }
    });
  }

  const allOff = !value.threeDays && !value.oneDay && !value.overdue;

  return (
    <div className="flex flex-col gap-2">
      <Toggle
        id="remind-3-days"
        label="3 days before"
        hint="A heads-up three days before a payment is due."
        checked={value.threeDays}
        onChange={(c) => change("threeDays", c)}
      />
      <Toggle
        id="remind-1-day"
        label="1 day before"
        hint="A reminder the day before it's due."
        checked={value.oneDay}
        onChange={(c) => change("oneDay", c)}
      />
      <Toggle
        id="remind-overdue"
        label="When overdue"
        hint="A reminder once a payment is past its due date."
        checked={value.overdue}
        onChange={(c) => change("overdue", c)}
      />
      <p className="mt-1 text-[13px] text-muted">
        {allOff ? "Reminders are off." : "Reminders show up in CommonTab AI."}
      </p>
      <SaveStatus status={status} />
    </div>
  );
}
