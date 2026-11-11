<p align="center">
  <img src="public/brand/commontab-logo.svg" alt="CommonTab" width="260" />
</p>

<p align="center">
  <strong>Live app: <a href="https://common-tab.vercel.app">common-tab.vercel.app</a></strong>
</p>

<p align="center"><em>A full-stack, AI-assisted payment-coordination app for clubs and group trips.</em></p>

---

## Overview

Groups that share costs usually track them across chats, spreadsheets and Venmo history, and nobody is sure who still owes what. **CommonTab** gives every shared cost one record: what it's for, the amount and split, the receipt, the deadline, each person's status and proof of payment. Money moves through the apps people already use (Venmo, PayPal, Zelle); CommonTab coordinates everything around it.

Designed, built and deployed end to end: product, database, backend, frontend and AI features.

## How the app works

1. **Groups and chat.** Users create groups with owner, organizer and member roles and talk in real-time chats and DMs with @mentions and file attachments.
2. **Payment request.** An organizer requests a payment from the chat: amount, equal or custom split, due date and an optional receipt photo, which AI turns into an itemized digital receipt. A live card appears in the chat and everyone tagged gets an alert.
3. **Confirm or dispute.** Each person confirms their share, or disputes it and negotiates a new amount with the requester in a private dispute room (propose, counter, accept).
4. **Pay and prove it.** The payer opens Venmo or PayPal with the amount pre-filled (or copies Zelle details), pays, and uploads a screenshot. AI reads the screenshot and checks the amount, recipient, date and status against what was owed.
5. **Approve.** The person being paid reviews the proof and the AI check, then approves (the share is marked paid) or rejects with a reason (the payer resubmits). Progress, balances and alerts update live for the whole group.
6. **Documents.** Anyone can request a document (receipt, invoice, signed form, spending records). The upload opens in a built-in viewer, and AI Verify checks it matches the request and extracts a summary and key details before it's accepted and filed.
7. **Drafting.** AI turns a blank PDF, Word or photo form into a short questionnaire, pre-fills it from the user's data and returns the filled PDF; it can also build a cost spreadsheet from a group's chat history, with totals calculated in code and exported to Excel with live formulas.
8. **Assistant and dashboard.** A dashboard and alert center show what you owe, what you're owed and what needs action. An AI assistant answers questions like "who still owes me for the cabin?" with payment and document cards pulled from the database.

## Technical highlights

- **Next.js 16 (App Router) + React 19 + TypeScript**, styled with Tailwind CSS 4 and deployed on **Vercel**.
- **Supabase Postgres** as the backend: row-level security on every table, and all writes go through `security definer` SQL functions that validate permissions and inputs. Client-generated UUIDs make every write idempotent, so retries never create duplicate requests or payments. 34 versioned SQL migrations.
- **Realtime** subscriptions keep chats, request cards, dashboards and alerts in sync; a single shared client-side alert store keeps every counter consistent.
- **Private file storage** with per-bucket access policies and short-lived signed URLs; screenshots, documents and dispute chats are visible only to the two people involved.
- **AI through the Vercel AI SDK and AI Gateway** (Gemini 2.5 Flash-Lite with a GPT-4o mini fallback):
  - structured (Zod-typed) outputs for receipt scanning, document verification, payment-screenshot checks, form parsing and spreadsheet planning;
  - a tool-calling assistant with read-only tools scoped to the signed-in user's own data;
  - per-user daily limits and a log of every call stored in Postgres.
- **Trust boundaries for AI:** the model never does money math; splits, totals and balances are computed in plain code, and amounts on payment records are always taken from the database. AI results that other users rely on can only be saved by the server, which proves itself with a secret checked against a SHA-256 hash in the database.
- **In-browser document tooling:** PDF.js for a custom PDF viewer, pdf-lib for filling fillable PDF fields or generating new PDFs, mammoth for Word previews, and read-excel-file / write-excel-file (with cached formula values) for spreadsheets.
- **Security and privacy:** server-side-only AI keys, an auth proxy for protected routes, email and Google sign-in, and configurable profile privacy.

## Tech stack

Next.js · React · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Storage, Realtime) · Vercel AI SDK · Vercel AI Gateway · Gemini / GPT-4o mini · Zod · PDF.js · pdf-lib · Vercel

## Status

MVP complete and deployed (November 2026).

**Built by Brian Huang and Wei Wei Wang.**
