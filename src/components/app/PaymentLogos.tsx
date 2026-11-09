// Venmo, PayPal and Zelle logo marks, shown as small app-style tiles.
// Glyphs from Simple Icons (CC0); colors are each brand's own.
// Venmo's Simple Icons file is the full wordmark, so we use just its "v".

export type PaymentProvider = "venmo" | "paypal" | "zelle";

const LOGOS: Record<PaymentProvider, { color: string; viewBox: string; path: string }> = {
  venmo: {
    color: "#008CFF",
    viewBox: "-0.6 9.25 5.4 5.4",
    path: "M2.543 10.009c.089.186.146.412.146.743 0 .606-.429 1.494-.777 2.06l-.373-2.989L0 9.969l.705 4.2h1.757c.77-1.01 1.718-2.448 1.718-3.554 0-.347-.073-.622-.235-.889l-1.402.283Z",
  },
  paypal: {
    color: "#002991",
    viewBox: "0 0 24 24",
    path: "M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z",
  },
  zelle: {
    color: "#6D1ED4",
    viewBox: "0 0 24 24",
    path: "M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-2.765H5.638a.667.667 0 0 1-.666-.666v-2.234a.67.67 0 0 1 .142-.412l8.139-10.382h-7.25a.667.667 0 0 1-.667-.667V3.914c0-.367.299-.666.666-.666h4.23V.483c0-.266.217-.483.483-.483h2.841c.266 0 .483.217.483.483v2.765h4.323c.367 0 .666.299.666.666v2.137a.67.67 0 0 1-.141.41l-8.19 10.481h7.665c.367 0 .666.299.666.666v2.477a.667.667 0 0 1-.666.667h-4.32v2.765a.483.483 0 0 1-.483.483Z",
  },
};

export function PaymentLogo({ provider, className = "h-7 w-7" }: { provider: PaymentProvider; className?: string }) {
  const logo = LOGOS[provider];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${className}`}
      style={{ backgroundColor: logo.color }}
      aria-hidden="true"
    >
      <svg viewBox={logo.viewBox} className="h-[58%] w-[58%]" fill="#FFFFFF">
        <path d={logo.path} />
      </svg>
    </span>
  );
}
