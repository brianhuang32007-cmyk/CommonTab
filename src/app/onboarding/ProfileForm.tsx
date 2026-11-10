"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import { borderFor, HandleField, inputClass, Required } from "@/components/forms";
import { createClient } from "@/lib/supabase/client";
import { useUsernameAvailability } from "@/lib/useUsernameAvailability";
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  birthdayProblem,
  latestAllowedBirthday,
  nameProblem,
  normalizePaypal,
  normalizeUsername,
  normalizeUsPhone,
  normalizeVenmo,
  normalizeZelle,
  paypalProblem,
  phoneProblem,
  usernameProblem,
  venmoProblem,
  zelleProblem,
} from "@/lib/profile";
import { createProfile, type CreateProfileState } from "./actions";

type FieldErrors = NonNullable<CreateProfileState["fieldErrors"]>;

export default function ProfileForm({
  userId,
  defaultFirstName,
  defaultLastName,
}: {
  userId: string;
  defaultFirstName: string;
  defaultLastName: string;
}) {
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState(defaultFirstName);
  const [lastName, setLastName] = useState(defaultLastName);
  const [birthday, setBirthday] = useState("");
  const [phone, setPhone] = useState("");
  const [venmo, setVenmo] = useState("");
  const [paypal, setPaypal] = useState("");
  const [zelle, setZelle] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const normalized = normalizeUsername(username);
  const { availability, formatError: usernameFormatError } = useUsernameAvailability(normalized);

  // Free the preview image's memory when it changes.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choosePhoto(file: File | undefined) {
    setPhotoError("");
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setPhotoError("Use a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setPhotoError("That image is over 2 MB. Try a smaller one.");
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function removePhoto() {
    setPhoto(null);
    setPreview(null);
    setPhotoError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const errors: FieldErrors = {};
    const u = usernameProblem(normalized);
    if (u) errors.username = u;
    else if (availability === "taken") errors.username = "That username is taken.";
    const ph = phoneProblem(normalizeUsPhone(phone));
    if (ph) errors.phone = ph;
    const f = nameProblem(firstName);
    if (f) errors.firstName = f;
    const l = nameProblem(lastName);
    if (l) errors.lastName = l;
    const b = birthdayProblem(birthday);
    if (b) errors.birthday = b;
    const v = venmoProblem(normalizeVenmo(venmo));
    if (v) errors.venmo = v;
    const p = paypalProblem(normalizePaypal(paypal));
    if (p) errors.paypal = p;
    const z = zelleProblem(normalizeZelle(zelle));
    if (z) errors.zelle = z;
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const supabase = createClient();
    let avatarPath: string | null = null;
    if (photo) {
      setUploading(true);
      const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
      avatarPath = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(avatarPath, photo, { contentType: photo.type, cacheControl: "3600" });
      setUploading(false);
      if (error) {
        setFormError("Couldn't upload your photo. Try again, or remove it and add one later.");
        return;
      }
    }

    startTransition(async () => {
      const result = await createProfile({
        username: normalized,
        firstName,
        lastName,
        birthday,
        avatarPath,
        phone,
        venmo,
        paypal,
        zelle,
      });
      // Success redirects to the dashboard; we only get a result back when something failed.
      if (!result || (!result.error && !result.fieldErrors)) return;
      if (avatarPath) await supabase.storage.from("avatars").remove([avatarPath]); // tidy up the unused upload
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.error) setFormError(result.error);
    });
  }

  const usernameMessage =
    fieldErrors.username ??
    usernameFormatError ??
    (availability === "taken" ? "That username is taken." : null);
  const busy = uploading || pending;

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5" noValidate>
      {/* Photo (optional) */}
      <div className="flex items-center gap-4">
        <Avatar
          src={preview}
          name={`${firstName} ${lastName}`}
          seed={userId}
          size={72}
          alt={preview ? "Your new profile photo" : "Your initials (default photo)"}
        />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="photo"
              className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-brand ring-1 ring-line hover:bg-mist focus-within:ring-2 focus-within:ring-brand"
            >
              {photo ? "Change photo" : "Upload photo"}
              <input
                ref={fileInput}
                id="photo"
                type="file"
                accept={AVATAR_TYPES.join(",")}
                className="sr-only"
                onChange={(e) => choosePhoto(e.target.files?.[0])}
              />
            </label>
            {photo && (
              <button
                type="button"
                onClick={removePhoto}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-mist"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-muted">Optional · JPG, PNG or WebP, up to 2 MB</p>
          {photoError && <p className="text-xs text-warn">{photoError}</p>}
        </div>
      </div>

      {/* Username */}
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-semibold text-ink">
          Username <Required />
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">@</span>
          <input
            id="username"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={21}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setFieldErrors((fe) => ({ ...fe, username: undefined }));
            }}
            placeholder="yourname"
            aria-invalid={Boolean(usernameMessage)}
            aria-describedby="username-status"
            className={`${inputClass} pl-9 ${borderFor(usernameMessage ?? undefined)}`}
          />
        </div>
        <p id="username-status" aria-live="polite" className="mt-1 min-h-5 text-xs">
          {usernameMessage ? (
            <span className="text-warn">{usernameMessage}</span>
          ) : availability === "checking" ? (
            <span className="text-muted">Checking…</span>
          ) : availability === "available" ? (
            <span className="font-semibold text-brand">@{normalized} is available</span>
          ) : (
            <span className="text-muted">3–20 characters: letters, numbers and underscores.</span>
          )}
        </p>
      </div>

      {/* Phone (optional) */}
      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-semibold text-ink">
          Phone number <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={20}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setFieldErrors((fe) => ({ ...fe, phone: undefined }));
          }}
          placeholder="(555) 123-4567"
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
          className={`${inputClass} ${borderFor(fieldErrors.phone)}`}
        />
        {fieldErrors.phone && (
          <p id="phone-error" className="mt-1 text-xs text-warn">
            {fieldErrors.phone}
          </p>
        )}
      </div>

      {/* Names */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="mb-1 block text-sm font-semibold text-ink">
            First name <Required />
          </label>
          <input
            id="firstName"
            required
            autoComplete="given-name"
            maxLength={50}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.firstName)}
            className={`${inputClass} ${borderFor(fieldErrors.firstName)}`}
          />
          {fieldErrors.firstName && <p className="mt-1 text-xs text-warn">{fieldErrors.firstName}</p>}
        </div>
        <div>
          <label htmlFor="lastName" className="mb-1 block text-sm font-semibold text-ink">
            Last name <Required />
          </label>
          <input
            id="lastName"
            required
            autoComplete="family-name"
            maxLength={50}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.lastName)}
            className={`${inputClass} ${borderFor(fieldErrors.lastName)}`}
          />
          {fieldErrors.lastName && <p className="mt-1 text-xs text-warn">{fieldErrors.lastName}</p>}
        </div>
      </div>

      {/* Birthday */}
      <div>
        <label htmlFor="birthday" className="mb-1 block text-sm font-semibold text-ink">
          Birthday <Required />
        </label>
        <input
          id="birthday"
          type="date"
          required
          min="1900-01-01"
          max={latestAllowedBirthday()}
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          aria-invalid={Boolean(fieldErrors.birthday)}
          aria-describedby="birthday-hint"
          className={`${inputClass} ${borderFor(fieldErrors.birthday)}`}
        />
        <p id="birthday-hint" className="mt-1 text-xs">
          {fieldErrors.birthday ? (
            <span className="text-warn">{fieldErrors.birthday}</span>
          ) : (
            <span className="text-muted">Not shown to other people.</span>
          )}
        </p>
      </div>

      {/* Payment handles (optional) */}
      <fieldset className="flex flex-col gap-4 rounded-2xl bg-mist p-4 sm:p-5">
        <legend className="sr-only">Payment handles</legend>
        <p className="text-sm font-semibold text-ink">Payment handles</p>
        <HandleField
          id="venmo"
          label="Venmo"
          prefix="@"
          placeholder="your-venmo"
          value={venmo}
          onChange={(v) => {
            setVenmo(v);
            setFieldErrors((fe) => ({ ...fe, venmo: undefined }));
          }}
          error={fieldErrors.venmo}
        />
        <HandleField
          id="paypal"
          label="PayPal"
          prefix="paypal.me/"
          placeholder="yourname"
          value={paypal}
          onChange={(v) => {
            setPaypal(v);
            setFieldErrors((fe) => ({ ...fe, paypal: undefined }));
          }}
          error={fieldErrors.paypal}
        />
        <HandleField
          id="zelle"
          label="Zelle"
          placeholder="Email or US phone number"
          value={zelle}
          onChange={(v) => {
            setZelle(v);
            setFieldErrors((fe) => ({ ...fe, zelle: undefined }));
          }}
          error={fieldErrors.zelle}
        />
      </fieldset>

      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-warn">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {uploading ? "Uploading photo…" : pending ? "Creating account…" : "Finish Creating Account"}
      </button>
    </form>
  );
}

