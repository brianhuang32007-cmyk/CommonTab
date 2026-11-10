"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import { borderFor, FormMessage, inputClass, primaryButton, Required } from "@/components/forms";
import { createClient } from "@/lib/supabase/client";
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  birthdayProblem,
  latestAllowedBirthday,
  nameProblem,
  normalizeUsername,
  normalizeUsPhone,
  phoneProblem,
  usernameProblem,
} from "@/lib/profile";
import { useUsernameAvailability } from "@/lib/useUsernameAvailability";
import { updateProfile, type UpdateProfileResult } from "./actions";

type FieldErrors = NonNullable<UpdateProfileResult["fieldErrors"]>;

export type ProfileValues = {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  birthday: string;
  phone: string;
  avatarUrl: string | null;
};

export default function EditProfileForm({ initial }: { initial: ProfileValues }) {
  const [savedUsername, setSavedUsername] = useState(initial.username);
  const [username, setUsername] = useState(initial.username);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [birthday, setBirthday] = useState(initial.birthday);
  const [phone, setPhone] = useState(initial.phone);

  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl); // the saved photo
  const [photo, setPhoto] = useState<File | null>(null); // a new photo, not saved yet
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const normalized = normalizeUsername(username);
  const { availability, formatError: usernameFormatError, isOwn } = useUsernameAvailability(
    normalized,
    savedUsername,
  );

  // Free the preview image's memory when it changes.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shownPhoto = preview ?? (removePhoto ? null : avatarUrl);

  function edited() {
    setSaved(false);
    setFormError("");
  }

  function choosePhoto(file: File | undefined) {
    setPhotoError("");
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return setPhotoError("Use a JPG, PNG or WebP image.");
    if (file.size > AVATAR_MAX_BYTES) return setPhotoError("That image is over 2 MB. Try a smaller one.");
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setRemovePhoto(false);
    edited();
  }

  function clearPhoto() {
    setPhoto(null);
    setPreview(null);
    setRemovePhoto(true);
    setPhotoError("");
    if (fileInput.current) fileInput.current.value = "";
    edited();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    edited();

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
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const supabase = createClient();
    let newPath: string | null = null;
    if (photo) {
      setUploading(true);
      const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
      newPath = `${initial.userId}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(newPath, photo, { contentType: photo.type, cacheControl: "3600" });
      setUploading(false);
      if (error) {
        setFormError("Couldn't upload your photo. Please try again.");
        return;
      }
    }

    startTransition(async () => {
      const result = await updateProfile({
        username: normalized,
        firstName,
        lastName,
        birthday,
        phone,
        photo: newPath ? { action: "new", path: newPath } : removePhoto ? { action: "remove" } : { action: "keep" },
      });
      if (result.ok) {
        setAvatarUrl(result.avatarUrl ?? null);
        setPhoto(null);
        setPreview(null);
        setRemovePhoto(false);
        if (fileInput.current) fileInput.current.value = "";
        setSavedUsername(normalized);
        setSaved(true);
        return;
      }
      if (newPath) await supabase.storage.from("avatars").remove([newPath]); // tidy up the unused upload
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.error) setFormError(result.error);
    });
  }

  const usernameMessage =
    fieldErrors.username ?? usernameFormatError ?? (availability === "taken" ? "That username is taken." : null);
  const busy = uploading || pending;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {/* Photo */}
      <div className="flex items-center gap-4">
        <Avatar
          src={shownPhoto}
          name={`${firstName} ${lastName}`}
          seed={initial.userId}
          size={80}
          alt={shownPhoto ? "Your profile photo" : "Your initials (default photo)"}
        />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="photo"
              className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-brand ring-1 ring-line hover:bg-mist focus-within:ring-2 focus-within:ring-brand"
            >
              {shownPhoto ? "Change photo" : "Upload photo"}
              <input
                ref={fileInput}
                id="photo"
                type="file"
                accept={AVATAR_TYPES.join(",")}
                className="sr-only"
                onChange={(e) => choosePhoto(e.target.files?.[0])}
              />
            </label>
            {shownPhoto && (
              <button
                type="button"
                onClick={clearPhoto}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-mist"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-muted">JPG, PNG or WebP, up to 2 MB</p>
          {photoError && <p className="text-xs text-warn">{photoError}</p>}
        </div>
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
            onChange={(e) => {
              setFirstName(e.target.value);
              edited();
            }}
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
            onChange={(e) => {
              setLastName(e.target.value);
              edited();
            }}
            aria-invalid={Boolean(fieldErrors.lastName)}
            className={`${inputClass} ${borderFor(fieldErrors.lastName)}`}
          />
          {fieldErrors.lastName && <p className="mt-1 text-xs text-warn">{fieldErrors.lastName}</p>}
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
              edited();
            }}
            aria-invalid={Boolean(usernameMessage)}
            aria-describedby="username-status"
            className={`${inputClass} pl-9 ${borderFor(usernameMessage)}`}
          />
        </div>
        <p id="username-status" aria-live="polite" className="mt-1 min-h-5 text-xs">
          {usernameMessage ? (
            <span className="text-warn">{usernameMessage}</span>
          ) : isOwn ? (
            <span className="text-muted">Friends find you by your username.</span>
          ) : availability === "checking" ? (
            <span className="text-muted">Checking…</span>
          ) : availability === "available" ? (
            <span className="font-semibold text-brand">@{normalized} is available</span>
          ) : (
            <span className="text-muted">3–20 characters: letters, numbers and underscores.</span>
          )}
        </p>
      </div>

      {/* Phone */}
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
            edited();
          }}
          placeholder="(555) 123-4567"
          aria-invalid={Boolean(fieldErrors.phone)}
          className={`${inputClass} ${borderFor(fieldErrors.phone)}`}
        />
        {fieldErrors.phone && <p className="mt-1 text-xs text-warn">{fieldErrors.phone}</p>}
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
          onChange={(e) => {
            setBirthday(e.target.value);
            edited();
          }}
          aria-invalid={Boolean(fieldErrors.birthday)}
          aria-describedby="birthday-hint"
          className={`${inputClass} ${borderFor(fieldErrors.birthday)}`}
        />
        <p id="birthday-hint" className="mt-1 text-xs">
          {fieldErrors.birthday ? (
            <span className="text-warn">{fieldErrors.birthday}</span>
          ) : (
            <span className="text-muted">Private. Not shown to other people.</span>
          )}
        </p>
      </div>

      <FormMessage error={formError} success={saved ? "Profile saved." : undefined} />

      <div>
        <button type="submit" disabled={busy} className={primaryButton}>
          {uploading ? "Uploading photo…" : pending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
