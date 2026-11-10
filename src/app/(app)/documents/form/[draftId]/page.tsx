import FormDraft from "./FormDraft";

export const metadata = { title: "Fill Out a Form · CommonTab" };

// /documents/form/<draft id>: one form being filled out.
export default function Page() {
  return <FormDraft />;
}
