// Self-onboarding LP: hand the lead to the product sign-up page with the form pre-filled via query params.
// The sign-up page belongs to another team, so the URL is a contract: allowlisted, normalised names only.
// Nothing internal (accountant_name, accountant_number, lr_token, ...) ever goes in the URL.
// fbp/fbc are not sent: the Meta pixel already shares them on .aiaccountant.com.

export const SIGNUP_URL = "https://app.aiaccountant.com/sign-up";

/** The only params the sign-up URL may carry, in this order. */
export const SIGNUP_PARAMS = [
  "name", "first_name", "last_name", "email", "phone", "company", "accounting_tool",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "fbclid", "lead_reference",
] as const;
export type SignupParam = (typeof SIGNUP_PARAMS)[number];

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const UTM_STORAGE_KEY = "__utms";
// Same key and shape as the shared lead forms, so click IDs captured on any LP page carry over.
const CLICK_ID_STORAGE_KEY = "__clickids";
const CLICK_ID_MAP: Record<string, string> = {
  gclid: "hs_google_click_id",
  fbclid: "hs_facebook_click_id",
  li_fat_id: "hs_linkedin_click_id",
};

const readStore = (key: string): Record<string, string> => {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
};
const writeStore = (key: string, value: Record<string, string>) => {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: values still used for this page view */ }
};

let memUtms: Record<string, string> = {};
let memClickIds: Record<string, string> = {};

/**
 * Call on page load. UTMs were never persisted before (click IDs were), so a visitor who lands with
 * ?utm_... and then moves around the page/site would lose them. Store them for the session.
 * A landing that carries any UTM replaces the whole stored set, so two campaigns never mix.
 */
export function persistAttribution(): void {
  const params = new URLSearchParams(location.search);

  const fromUrl: Record<string, string> = {};
  UTM_KEYS.forEach((k) => { const v = params.get(k)?.trim(); if (v) fromUrl[k] = v; });
  memUtms = Object.keys(fromUrl).length ? fromUrl : readStore(UTM_STORAGE_KEY);
  writeStore(UTM_STORAGE_KEY, memUtms);

  const clickIds = readStore(CLICK_ID_STORAGE_KEY);
  Object.entries(CLICK_ID_MAP).forEach(([urlParam, hsName]) => {
    const v = params.get(urlParam)?.trim();
    if (v) clickIds[hsName] = v;
  });
  memClickIds = clickIds;
  writeStore(CLICK_ID_STORAGE_KEY, memClickIds);
}

/** Stored UTMs (utm_source ...). */
export const getUtms = (): Record<string, string> => ({ ...readStore(UTM_STORAGE_KEY), ...memUtms });
/** Stored click IDs, keyed by HubSpot name (hs_google_click_id ...). */
export const getClickIds = (): Record<string, string> => ({ ...readStore(CLICK_ID_STORAGE_KEY), ...memClickIds });

/** Last 10 digits, so "+91 98765 43210" / "09876543210" both become "9876543210". */
export const tenDigitPhone = (p: string | undefined): string => (p || "").replace(/\D/g, "").slice(-10);

/**
 * Lead payload (HubSpot field names) -> normalised sign-up params.
 * first_name / last_name sent as-is (plus name = both joined), lg__phone -> phone, which_accounting_tool_do_you_use -> accounting_tool,
 * hs_google_click_id -> gclid, hs_facebook_click_id -> fbclid.
 */
export function toSignupParams(lead: Record<string, string | undefined>): Record<SignupParam, string> {
  const first = (lead.first_name || "").trim();
  const last = (lead.last_name || "").trim();
  return {
    name: [first, last].filter(Boolean).join(" "), // kept for sign-up pages that still read a single name
    first_name: first,
    last_name: last,
    email: lead.email || "",
    phone: tenDigitPhone(lead.lg__phone),
    company: lead.company || "",
    accounting_tool: lead.which_accounting_tool_do_you_use || "",
    utm_source: lead.utm_source || "",
    utm_medium: lead.utm_medium || "",
    utm_campaign: lead.utm_campaign || "",
    utm_content: lead.utm_content || "",
    utm_term: lead.utm_term || "",
    gclid: lead.hs_google_click_id || lead.gclid || "",
    fbclid: lead.hs_facebook_click_id || lead.fbclid || "",
    lead_reference: lead.lead_reference || "",
  };
}

/** Build the sign-up URL. Allowlist only, empties skipped, encoding left to URLSearchParams ("Rao & Sons" stays whole). */
export function buildSignupUrl(lead: Record<string, string | undefined>): string {
  const values = toSignupParams(lead);
  const qs = new URLSearchParams();
  SIGNUP_PARAMS.forEach((k) => {
    const v = (values[k] || "").trim();
    if (v) qs.set(k, v);
  });
  const s = qs.toString();
  return s ? `${SIGNUP_URL}?${s}` : SIGNUP_URL;
}
