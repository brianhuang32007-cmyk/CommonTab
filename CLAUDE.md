# CommonTab

CommonTab is a shared payment-coordination workspace. Each payment request is tied to its purpose, agreed amount, participants, receipts, deadline and settlement evidence, so a group can see what's owed, what's been paid and what's still outstanding.

Payments themselves happen through external providers (Venmo, PayPal, Zelle). CommonTab coordinates the workflow around them and does **not** hold funds, store balances or connect wallets.

## Launch focus

The first release targets adult student clubs and group trips, in one country and one currency (USD). It needs to prove one complete workflow from start to finish before anything broader.

## How we work

- Brian owns the workflow. We build **one step at a time, together**.
- Don't jump ahead of the current step or add features that weren't asked for.
- **Ask before creating or modifying files.** Explain the plan first and wait for a go-ahead.
- Keep changes small and easy to review in VS Code.
- Commit and push to GitHub only when Brian asks.

## Project notes (Google Doc)

Brian's planning doc is the Google Doc titled **"CommonTab"** (ID `15eORCYKhQXNj7566QIsHyL8YxGEinnnxWzZmkV4gJR4`).

- **Workflow** tab and its sub-tabs (WORKFLOW, BUILD ORDER, AI Model): the source of truth for the spec. Read them for context. If the doc and this file disagree, the doc wins; tell Brian about the mismatch.
- **Claude Notes** tab: write here only the notes Brian asks you to jot. Add dated entries at the end and never overwrite. Don't edit the other tabs unless asked.

## Rules

- **This repo is public.** Never put API keys, tokens or secrets in code or committed files. Keys live in a git-ignored `.env.local` locally and in Vercel environment variables when deployed. If someone pastes a key into chat, don't use it. Ask them to set it in their environment instead.
- AI calls run **server-side only** (Next.js API routes). Never expose keys to the browser and never use `NEXT_PUBLIC_` for secrets.
- AI drafts and suggests; **people confirm**. AI never posts, approves or pays on its own.
- Plain code does the math (splits, totals). AI only reads and drafts.
- Repo: https://github.com/brianhuang32007-cmyk/CommonTab (branch `main`).
- The local folder is named `OpenTab`; the product name is **CommonTab**.

## Stack

| Part | Choice |
|---|---|
| App | Next.js (a website that works on phones too) |
| Login, database, file storage, scheduled jobs | Supabase (free tier) |
| Hosting | Vercel (Hobby tier) |
| AI library | Vercel AI SDK, so the provider is one setting and can be switched |
| AI model | **Gemini Flash-Lite** (free tier) as the default. **Gemini Flash** as a fallback for receipts Flash-Lite can't parse. Switch to paid Gemini or Claude Haiku before real users upload real receipts (free-tier data may be used by Google). |

Check exact model names and free-tier limits in Google AI Studio. Keep model names in environment variables, not code.

**AI is on hold until Step 13.** Google now issues Gemini "auth keys" (`AQ.…`, bound to a service account). Our test key mostly failed with empty 404s and `ACCESS_TOKEN_TYPE_UNSUPPORTED`, so no AI code exists yet. When we resume, the easiest option is Vercel AI Gateway (no Google key needed); Brian decides. `.env.local` already has `AI_MODEL_DEFAULT=gemini-3.5-flash-lite` and `AI_MODEL_FALLBACK=gemini-3.8-flash`.

## Project facts

- **Live site:** https://common-tab.vercel.app (Vercel project `common-tab`). Every push to `main` deploys automatically. The Supabase env vars are set for **Production only**, so preview deployments can't sign in yet.
- **Supabase database changes** live in `supabase/migrations/*.sql`. There's no Supabase CLI: Brian runs each new file once, in order, in the Supabase **SQL Editor**. Never edit a file that has already been run; add a new one.
- **Auth redirects:** Google and email links return to `/auth/callback?next=…`. Supabase **URL Configuration** must allow `http://localhost:3000/**` and `https://common-tab.vercel.app/**`.
- **Next.js 16 specifics:** request guards live in `src/proxy.ts` (the new name for `middleware.ts`). `cacheComponents` is on, so pages that read the login cookie need `export const instant = false`. Check `node_modules/next/dist/docs/` before using a Next API you're unsure of. `next dev` regenerates `AGENTS.md`; keep it committed.
- **Brand:** logo files in `public/brand/` (wordmark converted to outlines), tab icon `src/app/icon.svg`, font Plus Jakarta Sans. The logo design canvas: https://claude.ai/artifact/N2ADi6QhKUZupPT6iSVQcK

## Design system

Every page uses the same look. Approved dashboard design (desktop + phone): https://claude.ai/artifact/NTZEaRiQRt7dCMyTiXZkcu. Match it when building new pages.

**Colors: green, yellow and white. Flat colors only, no gradients.** The tokens live in `src/app/globals.css`; use the Tailwind names (`bg-tint`, `text-honey`…), not raw hex values.

| Token | Hex | Use for |
|---|---|---|
| `brand` | `#2E6A45` | Main buttons, links, "you're owed" amounts, active icons, logo |
| `brand-hover` | `#25593A` | Hover on brand buttons |
| `leaf` | `#5FA474` | Progress bars |
| `sage` | `#8DBF9A` | Logo, small dots and accents |
| `tint` | `#E8F2E4` | Pale green panels: greeting card, active menu item, AI panel header, "document requested" |
| `citron` | `#F3F6E2` | Pale lime panels: "confirm your share" |
| `butter` | `#FCF2D4` | Overdue / needs-action panels |
| `butter-strong` | `#FBF0C9` | Yellow badges and icon chips ("NEW", chat count, lightning icon) |
| `cream` | `#F6F3E1` | Profile card, soft highlights |
| `honey` | `#8A5A06` | Text on yellow: overdue, disputed |
| `ink` | `#17221B` | Main text, and "you owe" amounts |
| `muted` | `#5B6660` | Secondary text and labels |
| `line` | `#DDE2DA` | Borders |
| `mist` | `#F7F8F2` | Page background |
| white | `#FFFFFF` | Cards, sidebar, inputs |
| `night` | `#14231A` | Landing page footer only |
| `warn` | `#B42318` | **Form error messages, and the unread count on the notification bell** |

Rules:
- **No red** for money states. "You owe" is dark `ink` text; overdue and disputed are `honey` text on `butter`. Red (`warn`) is only for form errors and the bell's unread count (Brian's call).
- **No gradients.** The one exception is the landing hero, where the photo fades into the page.
- Keep text contrast readable (at least 4.5:1). Pale backgrounds always get dark text.
- No emoji in the UI; use stroke icons (24px viewBox, 2px stroke, `currentColor`).

**Type and shapes:** Plus Jakarta Sans. Page titles 28–32px ExtraBold (800); card titles 18–20px ExtraBold; body 14–16px; small labels 11–12px Bold, uppercase with wide letter spacing. Cards are white with a 1px `line` border and 20–24px corners; buttons and inputs are 44–52px tall with 10–14px corners; badges and chips are fully rounded. Touch targets at least 44px.

**Layout and names:**
- **Desktop:** left sidebar with the logo; **Menu** (Dashboard, Group, Contacts, CommonTab AI, Document Drafting, Notifications & Reminders) and **Preferences** (Preferences, Log out); payment handles box (all three providers with their logos; missing ones show an underlined **Add handle** link) and profile card at the bottom. The profile card opens the **Profile** page. Top bar: page title on the left, a large live clock with the date in the center, the **notification bell** on the right, on every page (on phones it sits in the header). The bell opens a fixed-size (380×440) drop-down of recent notifications that scrolls when full; for now notifications are only new contact requests, with Accept and Decline. Unread ones show a red count on the bell.
- **Phone:** top bar with logo mark, title, action icon and profile photo (opens Profile); bottom tabs Home, Group, Contacts, AI, Docs.
- **CommonTab AI** always uses the lightning-bolt icon and can be collapsed to an "Ask CommonTab AI" button. It drafts and suggests; the user taps to send.
- Button labels use Title Case for main actions: **Add Contact**, **Create Group**.

---

# MVP workflow

## App layout

| Tab | What it shows |
|---|---|
| **Dashboard** | What you owe, what you're owed, overdue items, what needs your attention, your groups, recent activity |
| **Group** | Group chats and direct messages, where requests get tagged |
| **Contacts** | Friends list, adding friends by username |
| **CommonTab AI** | The AI chatbot (lightning icon) |
| **Document Drafting** (`/documents`) | The AI drafting tool (see section 7) |
| **Notifications & Reminders** (`/notifications`) | All notifications (contact requests for now) and payment reminders. The bell shows the recent ones. |
| **Preferences** | Profile summary with **Edit Profile** (opens the separate **Profile** page), payment handles, reminders, privacy, account. |
| **Profile** (`/profile`) | Edit photo, name, username, phone and birthday. Opened from Edit Profile or the sidebar's profile card. |

Tab names follow the approved dashboard design (they used to be Chats, Agent and Documents). The planning doc still uses the old names.

## 1. Accounts, profile and preferences
- Sign up and log in with Supabase: **Google**, or **email and password** (8+ characters, email must be confirmed). Log in page has **Forgot password?** → email link → **Reset password**.
- After signing up, everyone must **create their profile** before reaching the dashboard:
  - Required: **username** (unique, 3–20 lowercase letters, numbers or `_`, checked live), **first name**, **last name**, **birthday** (13 or older; private).
  - Optional: **phone number** (US), **profile photo** (JPG/PNG/WebP up to 2 MB; default is their initials on a soft color picked from their account), and **payment handles** for Venmo, PayPal and Zelle (any, all or none).
- **Profile** page: edit photo, first and last name, username (live check), phone and birthday.
- **Preferences** page (each card saves on its own):
  - Payment handles, plus **Show first**: which handle friends see first
  - Reminders: separate switches for 3 days before, 1 day before and when overdue (all off = no reminders)
  - Privacy: who can find me by username (**Everyone** or **Only my contacts**), and show my phone to contacts. Stored now; enforced when Contacts is built (Step 5).
  - Account: change email (confirmation link), change password (email accounts; asks for the current one), log out, **delete account** (immediate and permanent; type your username to confirm; removes photos, then the login, and the profile goes with it)

## 2. Contacts
- Add friends by username, then accept or decline friend requests.
- Friends list.

## 3. Groups and chats
- Create a group with a name, description and picture.
- Invite people from your friends list.
- Two roles: **organizer** and **member**.
- Real-time messaging in groups, plus one-on-one direct messages.
- **@tagging** people in chat. Tagging is how payment and document requests get assigned.

## 4. Payment requests (tagged)
- Create one from a chat. Fields: title, purpose, total, due date, receipt (photo or PDF), and tagged people.
- Split options:
  - **Equal:** $100 over 5 people is $20 each. When it doesn't divide evenly, extra cents go to the first people ($100 / 3 = $33.34, $33.33, $33.33).
  - **Custom:** set an amount per person.
  - **AI scan:** attach a receipt or bill. AI reads the total and splits it evenly among the tagged people.
- The request shows who gets paid, with their handles.
- Pay buttons:
  - **Venmo:** opens the Venmo app with the amount and note filled in
  - **PayPal:** opens PayPal.me with the amount filled in
  - **Zelle:** shows the payee's Zelle email or phone with a copy button. Zelle can't be linked to directly.

## 5. Confirmation, disputes and settlement (inside requests)
- Each tagged person **confirms** their share or **disputes** it with a short reason.
- A dispute opens a **dispute thread** where the people involved negotiate. When they agree, the amount is edited and the person re-confirms.
- Settlement:
  - The member taps **I paid** and attaches proof (a screenshot or reference number).
  - The organizer approves or rejects it.
- Share status: `Pending → Confirmed → Marked paid → Settled`, or `Disputed` (back to Pending once resolved).

## 6. Document requests and AI check (inside requests)
- In a chat, tag someone with a document request ("@Alex I need the receipt for gas"). Choose a document type and an optional deadline.
- The tagged person uploads the photo or file.
- **AI check:**
  - Confirms the upload matches the requested type
  - Pulls out key details (vendor, date, total, line items)
  - Writes a short summary
- Call it an "AI check," not proof the document is genuine. AI can catch wrong or blurry documents but can't reliably detect fakes.
- The requester **accepts** or **rejects** it. If rejected, the tagged person can upload again.
- Status: `Requested → Uploaded → AI checked → Accepted`, or `Rejected` (then back to Uploaded).

## 7. Documents tab: the AI drafting tool
- Paste a message ("cabin was $510 split 6 ways, due Fri") or upload a receipt.
- AI drafts a payment request or document request (title, amount, split, due date, people).
- If something's missing, AI asks in a short chat ("Who's included in the split?") instead of making the user fill in the form by hand.
- AI helps fill out documents that someone has requested from you. *(Still to decide: exact scope, and whether this is in the MVP.)*
- The user reviews and edits, then sends it to a chat. **AI never posts on its own.**

## 8. Dashboard
- **For you:** what you owe, what you're owed, what's overdue, and documents you need to upload.
- **For each group:** each request with a progress bar ("5/6 settled").
- A summary of recent chats and groups.
- A shortcut to the Agent.

## 9. CommonTab Agent (AI chatbot)
- Sees **only the signed-in user's own** groups, requests and documents.
- Answers questions like "What do I owe this week?" or "Did everyone pay for the cabin?"
- Sends reminders as deadlines approach. They show up in the Agent tab with a badge.
- It can remind, summarize and answer. It can't create, approve or pay anything without the user tapping a button.
- Reminders run as a scheduled job (Supabase cron) using template messages, so no AI is needed for them. Email and push notifications come after the MVP.

## AI cost protections
- AI routes require login.
- Each user has a daily limit for each AI feature.
- AI calls are logged in Supabase.
- If the AI is unavailable, the app falls back to manual forms.
- Receipt images are resized before they're sent.

## After the MVP
- Stripe Connect in-app payments (test mode first) with automatic settlement
- Email and push notifications
- Refunds and reimbursement flows
- Multiple currencies

---

# Build order

Each step is something we build together, review, then commit.

| Phase | Step | What we build |
|---|---|---|
| 0. Setup | 1 | Next.js + Supabase + Vercel project, `.gitignore`, environment variables, deployed placeholder page **(done)** |
| 1. Foundation | 2 | Landing page, sign-up (Google, email + password), create profile, log in, forgot/reset password **(done)** |
| | 3 | Preferences and Profile: edit profile, photo and payment handles, reminders, privacy, account **(done)** |
| | 4 | Navigation bar with the tabs (placeholder pages) |
| 2. Social | 5 | Contacts: add friends by username, friends list **(built; live test pending)** |
| | 6 | Groups: create a group, invite friends, roles |
| | 7 | Real-time chat and direct messages |
| | 8 | @tagging in chat |
| 3. Money | 9 | Payment requests with equal and custom splits |
| | 10 | Confirm, dispute and dispute threads |
| | 11 | Pay buttons (Venmo, PayPal, Zelle) and settlement with proof |
| 4. Documents | 12 | Document requests and uploads |
| | 13 | AI receipt tools inside requests: scan and split, AI check on uploads |
| 5. Dashboard | 14 | Dashboard: owe/owed/overdue and progress bars |
| 6. AI | 15 | Documents tab: AI drafting with follow-up questions |
| | 16 | CommonTab Agent: questions and answers |
| | 17 | Agent reminders (scheduled job) |
| 7. Ship | 18 | Polish, mobile check, deploy, test run with a real group |

## Current step

Steps 1, 2 and 3 are done and live (last update: 2026-11-10). The app frame is also built: every signed-in page shares `src/app/(app)/layout.tsx` (sidebar, top bar with live clock, phone drop-down menu). The dashboard shows the approved design with empty data; Group, CommonTab AI, Document Drafting and Notifications & Reminders are "Coming soon" placeholders.

**Step 3 (Preferences and Profile) is done and live.** The app frame already covers most of Step 4 (navigation).

**Current: Step 5, Contacts, is built** (migration `20261110010000_contacts.sql` has been run). Username search (top 10, prefix first), requests that must be accepted, contacts list (starred first, then A to Z; 12 visible, then scroll), private stars, a profile pop-up (handles, phone if shared, groups in common once Groups exist), and live updates through Supabase Realtime, including a request badge on Contacts in the sidebar. Default profile pictures are initials on a soft color picked from the account (`src/components/Avatar.tsx`). Still to do: a live test with two accounts. Wait for Brian's instructions before starting the next step.

Open questions:
- CLAUDE.md and the planning doc disagree in places (5 vs 6 tabs, Settings, Steps 13/15, whose Zelle handle the button shows). Brian hasn't said which is current; the Google Doc also still says "magic link".
- Can any member create payment requests, or only organizers?
- What's the scope of "AI helps fill out documents," and is it in the MVP?
