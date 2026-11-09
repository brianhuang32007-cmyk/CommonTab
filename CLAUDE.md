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

---

# MVP workflow

## App layout

| Tab | What it shows |
|---|---|
| **Dashboard** | What you owe, what you're owed, overdue items, group progress |
| **Chats** | Group chats and direct messages, where requests get tagged |
| **Contacts** | Friends list, adding friends by username |
| **Agent** | The CommonTab AI chatbot |
| **Documents** | The AI drafting tool (see section 7) |
| **Profile & Settings** | Profile, payment handles and preferences. On phones, open it from the profile photo in the top corner. |

## 1. Accounts, profile and settings
- Sign up and log in with Supabase (email magic link and/or Google).
- Each user has a unique username, which the friend system needs.
- Profile: name, photo, username, and payment handles for Venmo, PayPal and Zelle, plus which one to show first.
- Settings:
  - Reminder preferences (3 days before, 1 day before, when overdue, or off)
  - Privacy (kept simple in the MVP)
  - Change email, log out, delete account

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
| 0. Setup | 1 | Next.js + Supabase + Vercel project, `.gitignore`, environment variables, deployed placeholder page |
| 1. Foundation | 2 | Login with Supabase |
| | 3 | Profile & Settings: username, photo, payment handles, reminder preferences, log out |
| | 4 | Navigation bar with the tabs (placeholder pages) |
| 2. Social | 5 | Contacts: add friends by username, friends list |
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

**Step 1: project setup.** Not started yet.

Open questions:
- Can any member create payment requests, or only organizers?
- What's the scope of "AI helps fill out documents," and is it in the MVP?
