// Lead router client for Astro forms. Same logic and popup as the Webflow pages (router v1.2).
// 1. lr_submit_lead (Supabase) picks the GM/CS person and returns their card.
// 2. The lead + token go to the n8n router, which creates the HubSpot contact with that owner.
// 3. The popup shows who will reach out, with number, email, checklist and the self-setup CTA for offline.

const SUPABASE_URL = "https://qmaphtslnvvifkzmbrvh.supabase.co";
const SUPABASE_KEY = "sb_publishable_AIvKMuiGgEsMokWZCT4IDw_T9DRnNYx";
const ROUTER_WEBHOOK = "https://n8n.aiaccountant.com/webhook/lead-router-hs";
const ROUTER_TIMEOUT_MS = 4000;
const SELF_SETUP_URL = "https://app.aiaccountant.com/";
const LIVE_HOST = "lp.aiaccountant.com";

type Gm = { name: string; full_name?: string; title?: string; photo_url?: string | null; phone?: string; email?: string };
export type RouterResult = {
  ok?: boolean; token?: string; reason?: string; pool?: string; blocked?: boolean;
  tally_bucket?: string; callback?: { text?: string; in_hours?: boolean }; gm?: Gm | null;
};

// Anything not on the live domain (Vercel previews, localhost) is flagged as a test lead
export const isTestHost = () => location.hostname !== LIVE_HOST;

const newKey = () =>
  (crypto && (crypto as any).randomUUID) ? (crypto as any).randomUUID()
  : "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Ask Supabase who gets this lead. Never throws: returns null on failure (lead still reaches HubSpot). */
export async function routeLead(opts: {
  pageKey: string; idempotencyKey?: string; email: string; name: string; phone: string;
  fields: Record<string, string>; utm: Record<string, string>; clickIds: Record<string, string>;
}): Promise<RouterResult | null> {
  const body = {
    idempotency_key: opts.idempotencyKey || newKey(),
    page_key: opts.pageKey, email: opts.email, name: opts.name, phone: opts.phone,
    form_id: "wa-form", page_url: location.href, source_site: "astro",
    utm: opts.utm, click_ids: opts.clickIds, fields: opts.fields, is_test: isTestHost(),
  };
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ROUTER_TIMEOUT_MS);
    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/lr_submit_lead", {
        method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ payload: body }), signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return (await res.json()) as RouterResult;
    } finally { clearTimeout(timer); }
  };
  try { return await attempt(); }
  catch (err: any) {
    if (err && err.name === "AbortError") { console.error("[router] timed out"); return null; }
    try { return await attempt(); } catch (e) { console.error("[router] failed", e); return null; } // one retry, same key
  }
}

/** Send the lead + token to n8n (HubSpot contact with owner). Fire and forget. */
export function sendToRouterWebhook(payload: Record<string, string>, result: RouterResult | null) {
  if (result && result.blocked) return; // spam guard: saved in Supabase, never sent to HubSpot
  const ok = !!(result && result.ok && result.gm && result.token);
  const body = { ...payload, lr_token: ok ? result!.token! : "", is_test: isTestHost() ? "true" : "",
    __event: ok ? "rr_submit" : "rr_submit_no_gm" };
  fetch(ROUTER_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), keepalive: true }).catch((e) => console.error("[router] webhook failed", e));
}

// ── Popup (shadow DOM, so page CSS can't break it). Identical to the Webflow v1.2 popup. ──
let modalRoot: ShadowRoot | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let openedAt = 0;

function ensureModal(): ShadowRoot {
  if (modalRoot) return modalRoot;
  const host = document.createElement("div");
  host.setAttribute("data-lr-modal", "1");
  document.body.appendChild(host);
  modalRoot = host.attachShadow({ mode: "open" });
  modalRoot.innerHTML = `
<style>
:host{all:initial}
.ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;opacity:0;transition:opacity .18s ease}
.ov.on{opacity:1}
.card{background:#fff;color:#000;width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow-y:auto;border-radius:14px;padding:28px 24px 22px;box-shadow:0 24px 64px rgba(0,0,0,.25);transform:translateY(8px);transition:transform .22s ease;position:relative;outline:none}
.ov.on .card{transform:none}
.x{position:absolute;top:10px;right:12px;border:0;background:none;font-size:22px;line-height:1;color:#666;cursor:pointer;padding:6px}
.x:focus-visible,.btn:focus-visible{outline:2px solid #314DD0;outline-offset:2px}
.av{width:46px;height:46px;border-radius:50%;background:#314DD0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;overflow:hidden;flex:none}
.av img{width:100%;height:100%;object-fit:cover}
h2{margin:0 0 6px;font-size:22px;line-height:1.25;font-weight:700}
p{margin:0 0 18px;font-size:15px;line-height:1.5;color:#666}
.thx{margin:0 0 6px;font-size:15px;color:#666}
.hd{margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:700;color:#000}
.box{border:1px solid #dde1f3;border-radius:12px;padding:16px;margin-bottom:16px}
.who{display:flex;align-items:center;gap:12px;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid #eee}
.n{font-size:16px;font-weight:700;color:#000}
.t{font-size:13px;color:#666;margin-top:2px}
.ph{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:700;color:#000;margin-bottom:6px;text-decoration:none}
.em{display:flex;align-items:center;gap:10px;font-size:16px;color:#000;word-break:break-all;text-decoration:none}
.ph svg,.em svg{width:18px;height:18px;flex:none;color:#314DD0}
.lab{margin:0 0 6px;font-size:13px;font-weight:700;color:#666}
.ck{list-style:none;padding:0;margin:0 0 16px;font-size:14px;color:#444}
.ck li{display:flex;gap:8px;margin-bottom:4px;line-height:1.45}
.ck li span{color:#314DD0;font-weight:700}
.self{background:#f5f6fb;border-radius:10px;padding:12px 14px;margin-bottom:14px}
.self .t{margin:2px 0 0}
.sb{display:block;margin-top:10px;border:1px solid #314DD0;border-radius:10px;text-align:center;padding:10px;color:#314DD0;font:600 14px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;text-decoration:none}
.btn{display:block;width:100%;border:0;border-radius:10px;background:#314DD0;color:#fff;font:600 15px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;padding:14px;cursor:pointer}
.sp{width:28px;height:28px;border:3px solid #e6e9f8;border-top-color:#314DD0;border-radius:50%;animation:r .8s linear infinite;margin:6px 0 16px}
@keyframes r{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ov,.card{transition:none}.sp{animation-duration:2s}}
</style>
<div class="ov" role="dialog" aria-modal="true" aria-labelledby="lr-h"><div class="card" tabindex="-1"><button class="x" aria-label="Close">&times;</button><div class="body"></div></div></div>`;
  const ov = modalRoot.querySelector(".ov") as HTMLElement;
  (modalRoot.querySelector(".x") as HTMLElement).addEventListener("click", () => closeModal());
  ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  return modalRoot;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);

function showModal(html: string) {
  const root = ensureModal();
  clearTimeout(hideTimer);                                   // a close in progress must not hide new content
  if (!openedAt) openedAt = Date.now();
  (root.querySelector(".body") as HTMLElement).innerHTML = html;
  const ov = root.querySelector(".ov") as HTMLElement;
  ov.style.display = "flex";
  requestAnimationFrame(() => ov.classList.add("on"));
  (root.querySelector(".card") as HTMLElement).focus({ preventScroll: true }); // never focus a button (Enter would press it)
  root.querySelector(".btn")?.addEventListener("click", () => closeModal(true));
}

function closeModal(force?: boolean) {
  if (!modalRoot) return;
  if (force !== true && Date.now() - openedAt < 1000) return; // ignore stray clicks/keys right after opening
  const ov = modalRoot.querySelector(".ov") as HTMLElement;
  ov.classList.remove("on");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { ov.style.display = "none"; openedAt = 0; }, 200);
}

const CHECKLIST: Record<string, string[]> = {
  cloud: ["Tally cloud admin ID and password", "TallyPrime 6.0+ on Windows 10+", "UltraViewer installed and open"],
  offline: ["The computer Tally is installed on", "TallyPrime 6.0+ on Windows 10+", "UltraViewer installed and open"],
  not_sure: ["The computer Tally is on, or your cloud login", "TallyPrime 6.0+ on Windows 10+", "UltraViewer installed and open"],
};
const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6l9 -6"/></svg>';

function fmtPhone(p?: string) {
  const d = String(p || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? { show: "+91 " + d.slice(0, 5) + " " + d.slice(5), tel: "+91" + d } : null;
}

function gmHTML(gm: Gm, firstName: string, bucket?: string, callback?: RouterResult["callback"], selfSetup?: boolean) {
  const initials = (gm.full_name || gm.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const av = gm.photo_url ? `<img src="${esc(gm.photo_url)}" alt="">` : esc(initials);
  const first = String(firstName || "").trim().split(/\s+/)[0];
  const hi = first ? `Thanks, ${esc(first.charAt(0).toUpperCase() + first.slice(1))}. You're all set.` : "Thanks. You're all set.";
  const inHours = !!(callback && callback.in_hours);
  const when = (callback && callback.text) || "shortly";
  const headline = inHours
    ? `${esc(gm.name)} will reach out on WhatsApp and call you within 30 minutes`
    : `${esc(gm.name)} will reach out on WhatsApp or by phone ${esc(when)}`;
  const b = bucket && CHECKLIST[bucket] ? bucket : "not_sure";
  const ph = fmtPhone(gm.phone);
  const contact = (ph ? `<a class="ph" href="tel:${ph.tel}">${ICON_PHONE}${esc(ph.show)}</a>` : "")
    + (gm.email ? `<a class="em" href="mailto:${esc(gm.email)}">${ICON_MAIL}${esc(gm.email)}</a>` : "");
  const list = `<p class="lab">Keep these ready for the call</p><ul class="ck">${CHECKLIST[b].map((i) => `<li><span aria-hidden="true">&#10003;</span>${esc(i)}</li>`).join("")}</ul>`;
  const showSelf = selfSetup !== undefined ? selfSetup : b === "offline"; // default: offline only
  const self = showSelf ? `<div class="self"><div class="n">Prefer to do it yourself?</div><div class="t">Connect your Tally and start your free trial now. ${esc(gm.name)} can still help if you get stuck.</div><a class="sb" href="${SELF_SETUP_URL}" target="_blank" rel="noopener">Continue integration on my own</a></div>` : "";
  return `<p class="thx">${hi}</p>
<h2 id="lr-h" class="hd">${headline}</h2>
<div class="box"><div class="who"><div class="av">${av}</div><div><div class="n">${esc(gm.full_name || gm.name)}</div><div class="t">${esc(gm.title || "Product Specialist")}, AI Accountant</div></div></div>${contact}</div>
${list}
${self}
<button class="btn">Done</button>`;
}

const fallbackHTML = () => `<h2 id="lr-h">Your request is in</h2><p>Our team will call you shortly to set up your free trial.</p><button class="btn">Done</button>`;
const loadingHTML = () => `<div class="sp" aria-hidden="true"></div><h2 id="lr-h">Finding your product specialist</h2><p>This takes a second.</p>`;

export const showLoading = () => showModal(loadingHTML());

/** Swap the loader for the GM card (or the generic card if routing failed). */
export function showResult(result: RouterResult | null, firstName: string, opts: { selfSetup?: boolean } = {}) {
  const ok = !!(result && result.ok && result.gm && result.token);
  showModal(ok ? gmHTML(result!.gm!, firstName, result!.tally_bucket, result!.callback, opts.selfSetup) : fallbackHTML());
}
