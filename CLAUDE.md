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

- **Workflow** tab and its sub-tabs (WORKFLOW, BUILD ORDER, AI Model): Brian's original plan. Read them for context only. **This file wins whenever the two disagree** (Brian's call, 2026-11-10); don't update the doc to match.
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
| AI provider | **Vercel AI Gateway** (decided 2026-11-10). No Google key: the gateway reaches Gemini, Claude and others with one account, billed at the provider's list price with a monthly free credit. |
| AI model | **Gemini 2.5 Flash-Lite** (`google/gemini-2.5-flash-lite`) as the default, with **GPT-4o mini** (`openai/gpt-4o-mini`) as the backup when it's down or busy (a different company). Both are on the AI Gateway **free tier** ($5 a month, tested 2026-11-10) and read photos and PDFs. Claude Haiku 5.5 was the first pick, but it needs paid credits (free tier says "no access"); switch to it by buying credits and changing `AI_MODEL_DEFAULT`. A receipt the model can't read goes to the manual form. |

Model names are exact gateway ids (`provider/model`); check them at https://ai-gateway.vercel.sh/v1/models and the free-tier list in the Vercel dashboard (AI Gateway tab). Keep model names in environment variables, not code.

**AI is connected and live** (the CommonTab AI bot, Step 16; code in `src/app/api/ai/chat/route.ts` and `src/app/(app)/ai/`). We tried a direct Gemini key first, but Google's new "auth keys" (`AQ.…`) failed with empty 404s and `ACCESS_TOKEN_TYPE_UNSUPPORTED`, so we use **Vercel AI Gateway** instead.
- **Keys:** on Vercel, deployments sign in to the gateway automatically (OIDC), so production needs no AI secret. Locally, Brian creates an AI Gateway API key in the Vercel dashboard and puts it in `.env.local` as `AI_GATEWAY_API_KEY` himself (never in chat or code).
- **Models:** `.env.local` has `AI_GATEWAY_API_KEY`, `AI_MODEL_DEFAULT=google/gemini-2.5-flash-lite` and `AI_MODEL_FALLBACK=openai/gpt-4o-mini` (2026-11-10). The `ai_calls` log records which model actually answered, so check it if answers seem off (that's how we found Haiku silently falling back). Vercel Production still needs the two model variables, but **not** the API key (the live site uses OIDC; a key there would override it). Both places also need **`AI_VERIFY_SECRET`** (a random server-only value, added 2026-11-10) so AI Verify can save results; its SHA-256 is in migration `20261110240000`, so a new value needs a new migration.
- **Spend:** set an AI Gateway budget in the dashboard, alongside the per-user daily limits below.

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
| `warn` | `#B42318` | **Form error messages, and the unread count on the alert bell** |

Rules:
- **No red** for money states. "You owe" is dark `ink` text; overdue and disputed are `honey` text on `butter`. Red (`warn`) is only for form errors and the bell's unread count (Brian's call).
- **No gradients.** The one exception is the landing hero, where the photo fades into the page.
- Keep text contrast readable (at least 4.5:1). Pale backgrounds always get dark text.
- No emoji in the UI; use stroke icons (24px viewBox, 2px stroke, `currentColor`).

**Type and shapes:** Plus Jakarta Sans. Page titles 28–32px ExtraBold (800); card titles 18–20px ExtraBold; body 14–16px; small labels 11–12px Bold, uppercase with wide letter spacing. Cards are white with a 1px `line` border and 20–24px corners; buttons and inputs are 44–52px tall with 10–14px corners; badges and chips are fully rounded. Touch targets at least 44px.

**Layout and names:**
- **Desktop:** left sidebar with the logo; **Menu** (Dashboard, Group, Contacts, CommonTab AI, Document Drafting, Alerts & Reminders) and **Preferences** (Preferences, Log out); payment handles box (all three providers with their logos; missing ones show an underlined **Add handle** link) and profile card at the bottom. The profile card opens the **Profile** page. Top bar: page title on the left, a large live clock with the date in the center, the **alert bell** on the right, on every page (on phones it sits in the header). The bell opens a fixed-size (380×440) drop-down of recent **alerts** (the app calls notifications "alerts" everywhere) that scrolls when full. It shows **only unread alerts** (payment reminders, updates on your requests, new chat messages, contact requests with Accept and Decline), with **Mark all as read** and **View All Alerts** (opens Alerts & Reminders). Opening the bell doesn't mark anything read. Unread ones show a red count on the bell.
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
| **Alerts & Reminders** (`/notifications`) | Every alert and reminder, read or unread, plus payment search (see "Alerts & Reminders" below). The bell shows only the unread ones. |
| **Preferences** | Profile summary with **Edit Profile** (opens the separate **Profile** page), payment handles, reminders, privacy, account. |
| **Profile** (`/profile`) | Edit photo, name, username, phone and birthday. Opened from Edit Profile or the sidebar's profile card. |

Tab names follow the approved dashboard design (they used to be Chats, Agent and Documents). The planning doc still uses the old names.

## Alerts & Reminders (built 2026-11-10)
- **One live alert source** for the whole app (`NotificationsContext`): payment reminders, updates on your requests, read marks, contact requests and chats load once and stay live, so the bell, this page, the tab badges and the sidebar always agree.
- **Header:** short subtitle, **Mark all as read** (Retry if saving fails), **Settings** (opens Preferences). Tabs **All / Payments / Documents** with unread counts, and an **Unread only** switch ("No unread notifications."). The page keeps its tab, filter, sort and scroll when you come back.
- **Action needed:** your open tasks (Confirm your share, Pay your share, In dispute; document tasks come with Step 12), each with a deadline label ("2 days overdue", "Due today", "Due tomorrow", "Due Nov 13", "No due date") and a button (View request, Upload receipt, Upload document, Review document, Review payment). Sort **Earliest / Latest** (no date last). Colors: overdue honey on butter, today/tomorrow amber, later pale green, never red. Loading placeholders, "You're all caught up.", and "Couldn't load reminders" with Retry.
- **Recent updates:** what happened on your requests (confirmed, disputed, amount changed, waived, dispute canceled, paid), newest first, from the last 30 days. Your own actions are left out, except your completed payments.
- **Read marks:** green dots for unread. Opening an alert's destination (e.g. the payment's Details page) marks it read; tasks stay in Action needed until they're done.
- **Payment IDs:** each payment request has a short ID like **PR-CD1C93** (made from its database id, nothing stored). It shows on the chat card, the Details page (with Copy), reminders and search. Individual payments keep their transaction IDs (**CT-…**).
- **Payment search** (Payments tab): by PR-…, CT-…, title, group or person, over every request you sent or are in, open or fully paid. Results are grouped and ranked **Pending confirmation → Paid → Confirmed, not paid yet → Disputed → Waived**, then soonest due date.
- **Code:** `src/lib/alerts.ts` (the rules: tasks, updates, unread, payment IDs, search ranking), `src/lib/notificationReads.ts`, `src/components/app/NotificationsContext.tsx`, `NotificationBell.tsx`, `src/app/(app)/notifications/` (`AlertsScreen.tsx` is the UI, `AlertsView.tsx` connects it). Local demo with made-up data: `http://localhost:3000/demo/alerts` (dev only, never touches the database).

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
- Create a group with a name, description and picture (or a random color with its initials).
- Invite people from your contacts. **Invites add them right away** (no accept step).
- Three roles: **owner** (whoever created the group; one per group), **organizer** and **member**.
  - Owner: invite or remove anyone, make people members or organizers, edit or delete the group, and hand ownership to another member (becoming an organizer).
  - Organizer: invite contacts as members, edit the group, and remove only the people they added.
  - Member: can't invite or remove anyone.
- All of this lives in the group's **Details** window.
- Real-time messaging in groups, plus one-on-one direct messages, with photo and PDF attachments.
- **@mentions** in chat, stored by user id. Tagging is how payment and document requests will get assigned.
- New messages show in the alert bell, and the Group tab shows the unread count.

## 4. Payment requests (tagged)
- Create one from a chat: two buttons sit just above the message box, **Request Payment** and **Request Document** (decided 2026-11-10).
- **Only the group's owner and organizers can request a payment** (Request Payment is hidden for members, and the database enforces it). **Anyone in the group can request a document.**
- Each button opens a **separate page with a form** (decided 2026-11-10). The **Request Payment** form has: title, total (fills itself in from custom amounts if left empty), due date, receipt, **add people** (the group's members, always shown, each with an Add button, plus Select All), an **"Include myself in the payment"** checkbox (you can't add yourself otherwise; your own share counts as paid), and the split. The **Request Document** form has: title, document type, instructions (optional), due date (optional) and who sends it (see section 6).
- **Each payment request and each document request has its own separate page with its own link** (decided 2026-11-10). The chat card's Details button, the group's Requests tab, alerts and the Dashboard all open that page.
- **After it's made, a payment request goes public in the chat** as a card and appears in each tagged person's Requests list (decided 2026-11-10). The card shows a chip saying where you stand (You requested / You're paying / Not in this request), the **total**, the **due date**, a **Digital receipt available** label when there is one, a progress bar ("1 of 4 settled"), and **Details** plus the payer's next step. The requester or the group owner can delete it with the × (confirm first). Cards update live when any share changes.
  - **The requester** sees how much they're still owed and **each person's status** (Pending, Confirmed, Paid, plus Disputed or Waived). Everyone else sees who has paid and who hasn't.
  - **People paying** see their share with its status, and one button: **Confirm** (Pending) → **Settle** (Confirmed), or **In Dispute**. **The sender and anyone not tagged see Details only.**
  - If the requester includes themselves, their own share is already Paid, so progress starts at "1 of N settled".
- **Details page** (`/group/<chat>/payments/<request>`): header (title, total, Open or **Fully paid**, due date, who requested it), "your part" (the requester: still owed and collected; payers: share, status, Confirm / Settle / Dispute; others: not in it), the dispute list, **Who owes you** / **Who's in it** (each person's amount and status), **How you get paid** (requester: their own handles) or **Pay to** (payers: the requester's handles with Copy) or **Paid to** (others), the payment records, the receipt (digital receipt and original photo) and **Activity** (requested, confirmed, disputed, amount changed, waived, dispute canceled, paid). Everyone in the group sees each person's amount and status; dispute details and payment records are private (see section 5).
- **Requests and documents lists** are a clear record of every current request the user **sent and/or received**: each row shows what it is, who it's from or to, the amount or document, its status and its deadline, and opens that request's page. **Sorted by the most urgent deadline first** (overdue, then due soonest, then no deadline) (decided 2026-11-10).
- **A chat's Requests and Files tabs only cover that one group or DM** (Brian's call, 2026-11-10): Requests lists that chat's current (open) payment and document requests; Files keeps that chat's **accepted documents** (see section 6). **Everything across all chats, and past requests (fully paid, complete, canceled), belongs in Alerts & Reminders**, not in a chat's tabs.
- Split options:
  - **Equal:** $100 over 5 people is $20 each. When it doesn't divide evenly, extra cents go to the first people ($100 / 3 = $33.34, $33.33, $33.33).
  - **Custom:** set an amount per person, **by amount or by percentage** (percentages are rounded down, leftover cents go to the first people).
  - **AI scan:** attach a receipt or bill. AI reads the total and splits it evenly among the tagged people.
- **Receipt** (decided 2026-11-10): two options, **Attach a Photo** (from the device) or **Take a Photo** (opens the camera). The AI scans it and turns it into a **clear digital receipt** with the key information (vendor, date, items, subtotal, tax, tip, total). The requester checks and can correct it before sending; the original photo stays attached. Private to the group, like chat files. The AI reads and drafts only; plain code does any math.
- The request shows who gets paid (always the requester), with their handles.
- Payment requests are only made in groups for now (hidden in DMs).

## 5. Confirmation, disputes and settlement (inside requests)
Share status: `Pending → Confirmed → Paid`, with `Disputed` and `Waived` as side paths. (`Paid` is stored as `settled`; `Marked paid` exists in the database but isn't used.)

**Confirm:** each person paying confirms their share before they can pay (Confirm on the card, the Details page or the Settle page).

**Disputes** (Step 10, built 2026-11-10):
- **Dispute** opens a small form: the current share, a short reason (500 characters max), **Cancel** or **Submit Dispute**. Only Pending or Confirmed shares can be disputed; one open dispute per share. If submitting fails, the reason stays filled in. An earlier confirmation stays in the history, but the person confirms again before paying.
- **Each dispute has its own page** (`/group/<chat>/payments/<request>/disputes/<dispute>`), opened with **Open Dispute Chat** from the Details page (the dispute list, the disputed person's row, or the payer's part). Desktop: **chat on the left**, **negotiation tool on the right**. Phone: negotiation on top, chat below (no tabs).
  - **Chat:** the reason pinned on top, messages with times, live. Every proposal and decision is a bold, highlighted line with a label: **Proposed** (white, green border), **Countered** (lime), **Accepted** (pale green), **Declined** (yellow, never red), **Dispute canceled** (grey).
  - **Negotiation:** the current proposal with **Accept** / **Counter** (and **Keep Original Amount** for the requester); **Propose a new share** (either side); **Propose Canceling My Payment** (the disputer only); **Cancel Dispute** (the disputer only); **History** of every proposal and how it ended; **Outcome** once resolved.
- Rules: one open proposal at a time (a newer one replaces yours or counters theirs; old ones stay in history). Amounts are positive whole cents. **Accept** a new amount → the share changes and goes back to Pending (confirm again). **Accept** a cancel → the share is **Waived** (owes nothing; leaves progress and "still owed"). **Keep Original Amount** → the share stays Disputed. **Cancel Dispute** (the person who started it) → the share keeps its amount and goes back to Pending.
- **Private:** only the requester and the disputing person see the reason, chat and proposals. The group sees only the status and Activity lines (no reasons).
- Not built: files in the dispute chat; alerts for new dispute messages and proposals (disputes and their outcomes do show in Recent updates). The request total doesn't change when a share changes or is waived.

**Settle: simulated payments** (Step 11, built 2026-11-10; Brian's call). **No real money moves and no outside app opens; every payment is accepted.** CommonTab still holds no balances or wallets; a payment is only a record of who paid whom.
- Settle page (`…/settle`), confirmed shares only: **1. Choose a payment method**: only methods **already on the payer's account** (Venmo / PayPal / Zelle, and that the requester takes if they've added any; the requester's preferred first). With none, it links to Preferences to add a handle. → **2. Review and authorize** (amount, recipient's handle, your handle, an editable note) → **Confirm Demo Payment** → **3. Processing** (a progress bar with random pauses, 3 to 7 seconds) → **Payment Complete** with a receipt (amount, method, recipient, transaction ID `CT-…`, time).
- The share becomes **Paid** right away (no approval). One payment per share; app-made ids stop double payments. When every share is Paid or Waived, the request is **Fully paid** and leaves the open Requests lists.
- The requester sees **Payments Received** on the Details page (person, amount, method, transaction ID, time); the payer sees **Your Payment**. Nobody else sees payment records. The note and the payer's handle aren't saved yet (receipt only).
- **Local demo:** `http://localhost:3000/demo/settle` walks through the payer's screens with made-up people and no sign-in, next to what the requester sees (statuses, still owed, progress, reminders), with **Reset Demo**. It only exists under `npm run dev` (not found on the live site) and never touches the database.
- Real in-app payments aren't possible with Venmo, PayPal or Zelle (no public payment APIs), and Stripe lists peer-to-peer money transmission as restricted, so real payments stay after the MVP.

## 6. Document requests and AI Verify (inside requests)
Built 2026-11-10 (Brian's calls). Migration `20261110220000_document_requests.sql`.
- **Who:** **anyone in a group** (owner, organizers, members) can use **Request Document**, and it works in **DMs** too (the other person is the one asked). The requester picks **one or more members**; each gets their own part and status.
- **Form** (`…/request/document`): **title**, **document type** (Receipt, Invoice, Spending records, Signed form or waiver, Ticket or booking, Proof of payment, Other with your own name), **instructions** (optional, 500 characters), **due date** (optional), and **who sends it** (Add buttons and Select All, like Request Payment). **Send Request** posts the card and tags everyone asked.
- **Chat card:** "Document request" header, the title with its ID (**DR-…**), type and due date, and the label **"<Requester> is requesting <title> from you"** (or "from <names>"; the requester sees "You're requesting … from …"). Below it, one box and **View Details**:
  - **People asked:** **Upload Document** (opens the request page at the upload). After uploading it becomes **Waiting for review**, **Accepted** (green) or **Rejected: Upload Again** (yellow); or "You said you can't provide it".
  - **The requester:** a progress bar ("1 of 3 accepted") and a **Review** box when something is waiting.
  - **Everyone else:** the label and View Details only.
- **Request page** (`/group/<chat>/documents/<request>`): header (status Open / Complete / Canceled, title, Request ID with Copy, type, due date, who asked, instructions), your part, **Who's sending** (each person's status), what's been sent, and **Activity**.
  - **People asked:** upload up to **5 files** at once (**Attach a File** or **Take a Photo**; PDF, photos, Word, Excel, PowerPoint, CSV or text; **15 MB each**), an optional note, optional **AI Verify** before sending, then **Submit Document**. **Replace File** works until it's reviewed. After a rejection they see the reason and upload again. **Can't Provide** (with a required reason) is there before sending or after a rejection.
  - **The requester:** each upload with its files (open in the viewer), the note, **AI Verify**, and **Accept** or **Reject** (with a required reason). An **×** at the top of the request page and of the chat card cancels the request (confirm first, like a payment request's ×; files already sent stay for the two people). The **group owner** can cancel anyone's request too (Brian's call, 2026-11-10; migration `20261110230000_owner_cancel_document.sql`). Replaced uploads sit under "Earlier uploads".
- **Statuses** per person: `Requested → Ready to review (submitted) → Accepted`, or `Rejected` (upload again) or `Can't provide`. The request is **Complete** when everyone is accepted or can't provide.
- **Files** live in CommonTab's own private storage (bucket `request-documents`, path `<request>/<uploader>/<upload>/<file>`). **Only the requester and the person who uploaded a file can open it**; the group sees statuses only. Drafts (not sent yet) are only the uploader's.
- **File viewer** (`…/documents/<request>/files/<file>`): CommonTab's own viewer on its own page, with **Download**, the file name, who sent it and when, and arrows between files in the same upload.
  - **PDF:** PDF.js (`pdfjs-dist`), page by page: page arrows, "Page 2 of 5", zoom in and out, **Fit width**.
  - **Photos:** zoom and fit (HEIC shows Download where the browser can't display it).
  - **Word (.docx):** converted in the browser into a page preview (`mammoth`). **Excel (.xlsx) and CSV:** shown as tables with sheet tabs (`read-excel-file`). **Text:** as text.
  - **Anything else** (old .doc or .xls, PowerPoint): a file card with **Download**.
- **AI Verify** (Step 13, built with this): runs **only when clicked**, by the **uploader** (before or after submitting) or the **requester**. Route `src/app/api/ai/document/route.ts` reads the files from storage with the person's own session, sends PDFs and photos to the model and turns Word, Excel, CSV and text into plain text. It returns a verdict, the reason, what it looks like, the **key details**, a **summary** and a **transcript**. 20 checks per person in any 24 hours, logged in `ai_calls` (feature `document`).
  - **The latest result is saved on the upload and shown to both people** (Brian's call, 2026-11-10; migration `20261110240000_ai_verified_documents.sql`): a check mark and **"AI Verified Successful"** (it matches what was asked and has the info needed), or **"AI Verification Failed"** (please check it manually), with the summary, key details and a Transcript you can open. Uploads and the Who's sending list show an **AI Verified** / **AI Verification Failed** badge.
  - **Only the server can save a result:** the route sends `AI_VERIFY_SECRET` (server only; in `.env.local` and Vercel Production) and the database checks it against the SHA-256 fingerprint stored in `ai_verify_key`. Nobody can save a made-up "AI Verified" by calling the database themselves. Changing a draft's files clears its old result.
  - **Accepting:** the requester can always accept by hand. If the upload **isn't AI Verified**, they must **open every file** in the viewer first (the viewer records it; the database enforces it). Reject never needs that.
  - Example: a club organizer asks the chair for a PDF of spending records; AI Verify confirms it's spending records, lists the key data and summarizes it. The requester then reviews and decides. **Manual review without AI Verify always works.**
  - Call it an "AI check," not proof the document is genuine. AI can catch wrong or blurry documents but can't reliably detect fakes. AI only reads and suggests; the requester decides.
- **Alerts:** people asked get an **Upload document** task (also after a rejection), the requester gets **Review document** when something arrives; Recent updates show "Document received", "Document accepted", "Document rejected" (with the reason), "Can't provide it" and "Request canceled". All on the Documents tab and in the bell while unread. Opening the request page marks them read. The group's **Requests** tab lists document requests next to payments.
- **Files tab** (Brian's call, 2026-11-10; migration `20261110250000_chat_documents.sql`): once a document is accepted it's kept in that chat's **Files** tab, so people can come back to it later: the title, type, who sent it to whom, when it was accepted, **AI Verified** or **Checked by hand**, the **original files** (open in the viewer), the **AI summary, key details and transcript** (if AI Verify was run) and **View Request**. Only the requester and the sender see it. Chat attachments aren't listed there yet.
- **Code:** `src/app/(app)/group/documents.ts` (types, labels, links, file rules), `request/[kind]/DocumentForm.tsx`, `MessageList.tsx` (`DocumentCard`), `[chatId]/documents/[requestId]/` (`DocumentDetails.tsx`, `parts.tsx` for upload, review and AI results, `files/[fileId]/FileViewer.tsx`).

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
- Real in-app payments (replacing the simulation). Stripe restricts peer-to-peer money transmission, so this needs a provider built for it (or Stripe's approval) first
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
| | 6 | Groups: create a group, invite friends, roles **(done)** |
| | 7 | Real-time chat and direct messages **(done)** |
| | 8 | @tagging in chat **(done: @mentions, and payment requests tag everyone paying; document requests come with Step 12)** |
| 3. Money | 9 | Payment requests with equal and custom splits **(done)** |
| | 10 | Confirm, dispute and dispute threads **(done)** |
| | 11 | Settlement **(done as simulated in-app payments; no real money)** |
| 4. Documents | 12 | Document requests and uploads **(built; live test pending)** |
| | 13 | AI receipt tools inside requests: scan and split, AI check on uploads |
| 5. Dashboard | 14 | Dashboard: owe/owed/overdue and progress bars |
| 6. AI | 15 | Documents tab: AI drafting with follow-up questions |
| | 16 | CommonTab Agent: questions and answers **(done early: groups, chats, contacts, reading receipts; payment and document answers come as those steps land)** |
| | 17 | Agent reminders (scheduled job) |
| 7. Ship | 18 | Polish, mobile check, deploy, test run with a real group |

## Current step

Last update: 2026-11-10. Steps 1 to 3, 5 to 7, 9 to 11, Alerts & Reminders and the first part of Step 16 are done and live (Step 4 is covered by the app frame in `src/app/(app)/layout.tsx`). Contacts still needs a live test with two accounts.

**Done: Steps 6 and 7, Groups and chats** (migrations `20261110030000` to `20261110090000` have all been run). Code is in `src/app/(app)/group/`. Groups with owner, organizer and member roles; a Details window (members, roles, Invite Contacts with search, Edit Group, Delete Group, Make Owner); DMs; chat with date lines, older messages on scroll, live updates, attachments (JPG, PNG, WebP or PDF, up to 5 at 10 MB each, private to members) and @mentions; an "@ You" badge on chats with unread mentions; new messages in the alert bell; and the unread count on the Group tab. Group pictures and chat files are private and open through short-lived links (`src/lib/signedLinks.ts`). Every write goes through checked database functions, and app-made ids stop duplicates on retry.

Known gaps from Steps 6 and 7:
- Contacts' Message icon and the profile pop-up's Message button link to `/group?dm=<username>`, which doesn't open the DM yet (`/group?chat=<id>` does).
- Sending, attachments, the "@ You" badge and message alerts still need a live test with a second account (e.g. @briantest).
- Drafts aren't kept when switching chats. Files left behind when the browser closes mid-upload aren't cleaned up yet (a scheduled cleanup could come with Step 17).

**Done early: Step 16, CommonTab AI** (migration `20261110100000_ai_calls.sql` has been run; live with Vercel's OIDC and the `AI_MODEL_*` variables set for Production).
- The `/ai` page and a small chat window on the Dashboard ("Ask CommonTab AI") share one conversation (`AiChatProvider` in the app frame). The page shows the full history; the window shows only what's asked during the current Dashboard visit. Not saved to the database yet (clears on reload).
- The AI can look up the user's own groups, chats, messages and contacts, read one attached photo (shrunk in the browser) or PDF (3 MB max), and split an amount with `split_evenly` (plain code, extra cents to the first people). It can't post, change, approve or pay anything.
- Limits: 30 questions per person in any 24 hours, every call logged in `ai_calls` (including which model answered).
- When requests exist, give the AI read-only tools for them (what you owe, who still owes, due dates) and use the answer cards in `src/app/(app)/ai/blocks.tsx` (payment summary, document request).

**Dashboard** matches the Group page: real groups (unread counts, "@ You"), Recent activity (chats with new messages) and Needs your attention (mentions). The money cards (You owe, You're owed, Overdue, Settled) are still $0 placeholders; they get real numbers in Step 14.

**Done: Steps 9 to 11, payment requests, disputes and simulated payments** (2026-11-10; migrations `20261110110000` to `20261110170000` have all been run; all live). See sections 4 and 5 for how they work. Code:
- `src/app/(app)/group/requests.ts`: types and the plain-code money helpers (`splitEvenly`, `splitByPercent`, `parseCents`, `dueLabel`, the page links, `SHARE_STATUS`).
- `src/app/(app)/group/[chatId]/request/[kind]/`: the Request Payment / Request Document forms (`PaymentForm.tsx`, receipt scan through `/api/ai/receipt`).
- `src/app/(app)/group/MessageList.tsx` (`RequestCard`), `RequestsTab.tsx`, and `messages.ts` (`refreshRequest`: cards update when a share changes).
- `src/app/(app)/group/[chatId]/payments/[requestId]/`: `RequestDetails.tsx`, `DisputePanel.tsx` (dispute list and `useMyDisputes`), `dispute/` (start-a-dispute form), `disputes/[disputeId]/DisputeRoom.tsx` (the dispute page), `settle/` (`SettlePanel.tsx` is the shared payment UI; `SettleView.tsx` connects it to the database).
- `src/app/demo/settle/`: the local no-sign-in demo.

Tested with @briantest: a full negotiation (propose, decline, counter, accept), cancelling a dispute, and confirming and paying a share end to end.

**Done: Alerts & Reminders** (2026-11-10; migrations `20261110180000` to `20261110210000` have all been run; live). See "Alerts & Reminders" above. Payment search was checked on the live site (by title and by CT- ID). Still to test with real data: the bell filling with new unread payment alerts when someone else acts on your request, and the search ranking across groups (only checked in `/demo/alerts` so far).

**Built: Step 12, Request Document, with AI Verify from Step 13** (2026-11-10; migration `20261110220000_document_requests.sql`). See section 6. Still to test with a second account (e.g. @briantest): uploading, AI Verify on real files, accept and reject, Can't Provide, and the viewer with each file type.

**After that:** 13 (the AI Verify part is built; scan and split stays with Request Payment), 14 (Dashboard money numbers), 15 (Documents tab), the rest of 16 (AI tools for requests: what you owe, who still owes; answer cards in `src/app/(app)/ai/blocks.tsx`), 17 (reminders). Build one piece at a time and plan each piece with Brian before writing code.

Rules that still apply: amounts in whole cents and all math in plain code; money states never use red ("you owe" is ink, overdue and disputed are honey on butter); every write goes through checked database functions with app-made ids so retries can't duplicate; CommonTab never holds money.

Open questions:
- AI bot: should conversations be saved to the database (so they survive a reload and sync across devices)?
- Groups: what happens when the owner deletes their account?
- Payment requests: can either person request a payment in a DM (hidden there for now)? Can a request be edited after it's sent? Should the request total change when a dispute changes or waives a share?
- Disputes: files in the dispute chat, and alerts for new dispute messages and proposals?
- Payments: save the payment note and the payer's handle so the requester sees them?
- Document requests: can a request be edited after it's sent (add people, change the due date)?
- What's the scope of "AI helps fill out documents," and is it in the MVP?
