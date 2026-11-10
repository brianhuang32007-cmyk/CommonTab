"use client";

import { useState, useTransition } from "react";
import { savePrivacy } from "./actions";
import SaveStatus, { type Status } from "./SaveStatus";
import Toggle from "./Toggle";

type Privacy = { discoverableBy: "everyone" | "contacts"; showPhone: boolean };

const WHO: { value: Privacy["discoverableBy"]; label: string; hint: string }[] = [
  { value: "everyone", label: "Everyone", hint: "Anyone on CommonTab can find you and send a request." },
  { value: "contacts", label: "Only my contacts", hint: "Only people you've already added can find you." },
];

// Each choice saves as soon as it's made.
export default function PrivacyForm({ initial, hasPhone }: { initial: Privacy; hasPhone: boolean }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [, startTransition] = useTransition();

  function change(next: Privacy) {
    const previous = value;
    setValue(next);
    setStatus("saving");
    startTransition(async () => {
      const res = await savePrivacy(next);
      if (res.ok) setStatus("saved");
      else {
        setValue(previous);
        setStatus("error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="font-semibold text-ink">Who can find me by username</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {WHO.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
                value.discoverableBy === o.value ? "border-brand bg-tint" : "border-line bg-white hover:bg-mist"
              }`}
            >
              <input
                type="radio"
                name="discoverable-by"
                value={o.value}
                checked={value.discoverableBy === o.value}
                onChange={() => change({ ...value, discoverableBy: o.value })}
                className="mt-1 h-4 w-4 shrink-0 accent-brand"
              />
              <span>
                <span className="block font-semibold text-ink">{o.label}</span>
                <span className="block text-[13px] text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Toggle
        id="show-phone"
        label="Show my phone number to contacts"
        hint={hasPhone ? "Your birthday is always private." : "Add a phone number on your profile first."}
        checked={value.showPhone}
        disabled={!hasPhone && !value.showPhone}
        onChange={(c) => change({ ...value, showPhone: c })}
      />
      <SaveStatus status={status} />
    </div>
  );
}
