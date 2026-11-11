<p align="center">
  <img src="public/brand/commontab-logo.svg" alt="CommonTab" width="260" />
</p>

<p align="center">
  <strong>Live app: <a href="https://common-tab.vercel.app">common-tab.vercel.app</a></strong>
</p>

<p align="center"><em>Know what you owe, what you're owed, and what to do next.</em></p>

---

## About

**CommonTab** is a shared payment-coordination workspace for student clubs, group trips and other small groups. Every shared cost lives in one place: what it's for, how much, who's in the split, the receipt, the due date and proof that each person paid. It replaces the usual mix of group chats, spreadsheets and "did you Venmo me yet?" messages.

CommonTab never holds or moves money. People pay each other with the apps they already use (Venmo, PayPal, Zelle), and CommonTab keeps track of everything around the payment.

## Features

**Groups and chat**
- Groups with owner, organizer and member roles; direct messages; real-time chat with @mentions, photos and PDFs
- Contacts by username, with privacy controls (everyone, or only people in shared groups)

**Payment requests**
- Request a payment from a chat with equal or custom splits (by amount or percentage); amounts are exact to the cent
- Attach a receipt photo: AI turns it into a clean digital receipt the requester can check and correct
- Each person confirms their share, can dispute it, and negotiates a new amount in a private dispute chat

**Real payments with proof**
- Pay through Venmo or PayPal (opened with the amount filled in) or Zelle (details to copy)
- Send a screenshot as proof; AI checks it against what was owed (amount, recipient, date, status)
- The person being paid approves or rejects with a reason; every submission and decision is kept

**Document requests**
- Ask one or more people for a receipt, invoice, signed form or spending records
- Files open in a built-in viewer (PDF pages, photos, Word and spreadsheet previews), private to the two people involved
- **AI Verify** checks that an upload matches what was asked and pulls out a summary and key details; accepted documents are kept in each chat's Files tab

**Document Drafting**
- **Fill out a form:** upload a blank PDF, Word file or photo; AI turns it into simple questions, pre-fills what it already knows, and produces the filled-in PDF
- **Build a spreadsheet:** ask for "a track record of all trip costs" and AI plans it from the chat's payments, receipts and messages; every total is calculated by code, and the Excel export keeps real formulas

**Staying on top of things**
- A dashboard with what you owe, what you're owed, documents to review and how settled your groups are
- Alerts & Reminders with deadlines, read/unread tracking and payment search by ID, title, group or person
- **CommonTab AI**, an assistant that answers questions about your groups, payments and documents, with payment and document cards

## How the AI is used

AI drafts and checks; **people always decide**. It reads receipts, documents, forms and payment screenshots, but it never sends, approves or pays anything. All money math (splits, totals, balances) is done in plain code, never by the model. AI results that other people rely on can only be saved by the server, so nobody can fake an "AI Verified" badge.

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Data and auth | Supabase: Postgres with row-level security, Auth (Google and email), Storage, Realtime |
| AI | Vercel AI SDK through Vercel AI Gateway (Gemini 2.5 Flash-Lite, with GPT-4o mini as a fallback) |
| Files | PDF.js, pdf-lib, mammoth, read-excel-file and write-excel-file |
| Hosting | Vercel |

## How it's built

- **Every write goes through a checked database function.** Tables are read-only to the app; functions verify who may do what, and IDs made by the app keep retries from creating duplicates.
- **Privacy by default.** Row-level security decides what each person sees. Payment proofs, dispute chats and requested documents are visible only to the two people involved, and private files open through short-lived links.
- **Live everywhere.** Chats, request cards, alerts and the dashboard update in real time and share one source of alert data, so the numbers always agree.
- **No secrets in the repo.** Keys live in environment variables; the database schema is in `supabase/migrations/`.

## Running it locally

1. Install dependencies: `npm install`
2. Create a Supabase project and run the files in `supabase/migrations/` in order in the SQL Editor.
3. Create `.env.local` with:
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `AI_GATEWAY_API_KEY`, `AI_MODEL_DEFAULT` and `AI_MODEL_FALLBACK`
   - `AI_VERIFY_SECRET` (a random value; its SHA-256 goes in the `ai_verify_key` table)
4. Start it: `npm run dev`, then open http://localhost:3000

## Status

**MVP complete** (November 2026). The prototype is deployed and covers the full workflow from request to payment proof. Next up: a test run with a real student group, scheduled reminders, and email and push notifications.

## Origin

Started as a project idea for the RAMP hackathon (October 2026) and built by **Brian Huang**.
