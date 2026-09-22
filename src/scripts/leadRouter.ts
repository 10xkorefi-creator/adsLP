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

type Gm = { name: string; full_name?: string; title?: string; photo_url?: string | null; phone?: string; email?: string; pronoun?: string | null };
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
.card{background:#fff;color:#000;width:100%;max-width:380px;max-height:calc(100vh - 32px);overflow-y:auto;border-radius:18px;padding:26px 22px 20px;box-shadow:0 24px 64px rgba(0,0,0,.25);transform:translateY(8px);transition:transform .22s ease;position:relative;text-align:center;outline:none}
.ov.on .card{transform:none}
.grab{display:none;width:40px;height:4px;border-radius:2px;background:#d9dbe3;margin:-12px auto 14px}
@media (max-width:600px){.ov{align-items:flex-end;padding:0}.card{max-width:none;border-radius:20px 20px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom,0px));transform:translateY(40px)}.grab{display:block}}
.x{position:absolute;top:12px;right:14px;border:0;background:none;font-size:22px;line-height:1;color:#666;cursor:pointer;padding:6px}
.x:focus-visible,.btn:focus-visible,.b1:focus-visible,.b2:focus-visible{outline:2px solid #314DD0;outline-offset:2px}
.ok{margin:0 0 4px;font-size:15px;line-height:1.4;color:#333}
.ok svg{width:18px;height:18px;vertical-align:-4px;margin-right:6px;color:#1f7a3f}
.meet{margin:0 0 18px;font-size:21px;line-height:1.35;color:#000}
.tag{background:#eef0fb;color:#314DD0;font-weight:700;border-radius:8px;padding:2px 9px;white-space:nowrap}
.av{width:76px;height:76px;border-radius:50%;background:#314DD0;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;margin:0 auto 10px;position:relative}
.av img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.dot{position:absolute;right:0;bottom:2px;width:18px;height:18px;border-radius:50%;background:#1faa55;border:3px solid #fff}
.lbl{margin:0;font-size:14px;color:#666}
.nm{margin:2px 0 8px;font-size:26px;font-weight:700;color:#000;line-height:1.2}
.ctx{margin:0 auto 18px;max-width:320px;font-size:15px;line-height:1.45;color:#555}
.or{display:flex;align-items:center;gap:12px;margin:2px 0 12px;font-size:14px;color:#888}
.or::before,.or::after{content:"";flex:1;height:1px;background:#e3e5ec}
.no{margin:-10px 0 16px;font-size:18px;color:#000}
.b1,.b2,.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;white-space:nowrap;box-sizing:border-box;border-radius:12px;padding:15px;font:700 16px/1.1 "Helvetica Neue",Helvetica,Arial,sans-serif;text-decoration:none;cursor:pointer}
.b1{background:#314DD0;color:#fff;border:0;margin-bottom:10px}
.b2{background:#fff;color:#000;border:1px solid #d9dbe3;margin-bottom:10px}
.b1 svg,.b2 svg{width:20px;height:20px;flex:none}
.b2 svg{color:#1faa55}
.btn{background:#f2f3f7;color:#000;border:0}
.info{display:flex;align-items:center;justify-content:center;gap:8px;background:#f2f3f7;border-radius:12px;padding:14px;font-size:15px;color:#000;margin-bottom:12px}
.info svg{width:18px;height:18px;flex:none;color:#314DD0}
.ft{margin:2px 0 0;font-size:14px;color:#666}
.sub{margin:14px 0 0;padding-top:12px;border-top:1px solid #eee}
.sub p{margin:0 0 8px;font-size:14px;color:#666}
.sb{display:inline-flex;align-items:center;gap:6px;border:1px solid #314DD0;color:#314DD0;border-radius:10px;padding:9px 14px;font:700 14px/1.1 "Helvetica Neue",Helvetica,Arial,sans-serif;text-decoration:none}
.sb svg,.pm svg{width:18px;height:18px;flex:none}
.pm{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;background:#314DD0;color:#fff;border-radius:12px;padding:15px;font:700 16px/1.1 "Helvetica Neue",Helvetica,Arial,sans-serif;text-decoration:none;margin-bottom:6px}
.hint{margin:0 0 10px;font-size:13px;color:#666}
.btn.dn{background:none;color:#666;padding:10px}
h2{margin:0 0 6px;font-size:21px;line-height:1.25;font-weight:700}
p{margin:0 0 16px;font-size:15px;line-height:1.5;color:#666}
.sp{width:28px;height:28px;border:3px solid #e6e9f8;border-top-color:#314DD0;border-radius:50%;animation:r .8s linear infinite;margin:6px auto 16px}
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

const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/></svg>';
const ICON_WA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9"/><path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1"/></svg>';
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2l4 -4"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
const ICON_PLUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z"/><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z"/><path d="M3 21l2.5 -2.5"/><path d="M18.5 5.5l2.5 -2.5"/><path d="M10 11l-2 2"/><path d="M13 14l-2 2"/></svg>';

function fmtPhone(p?: string) {
  const d = String(p || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? { show: "+91 " + d.slice(0, 5) + " " + d.slice(5), tel: "+91" + d, wa: "91" + d } : null;
}

// Same popup as the Webflow pages (v1.4). AiA bot pages show Call + "Text <name> on WhatsApp" in business hours.
function gmHTML(gm: Gm, firstName: string, bucket?: string, callback?: RouterResult["callback"], selfSetup?: boolean, whatsapp = true) {
  const initials = (gm.full_name || gm.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const inHours = !!(callback && callback.in_hours);
  const av = (gm.photo_url ? `<img src="${esc(gm.photo_url)}" alt="">` : esc(initials)) + (inHours ? `<span class="dot" aria-hidden="true"></span>` : "");
  const first = String(firstName || "").trim().split(/\s+/)[0];
  const role = esc(gm.title || "Product Specialist");
  const hi = first ? `Thanks, ${esc(first.charAt(0).toUpperCase() + first.slice(1))}.` : "Thanks.";
  const name = esc(gm.name);
  // "She'll" / "He'll" when the pronoun is set in lr_gms, otherwise the person's name
  const pr = gm.pronoun === "she" ? "She" : gm.pronoun === "he" ? "He" : "";
  const willCap = pr ? `${pr}'ll` : `${name} will`;
  const when = (callback && callback.text) || "shortly";
  const ph = fmtPhone(gm.phone);
  const showSelf = selfSetup !== undefined ? selfSetup : bucket === "offline"; // default: offline only
  const selfLink = (cls: string) => `<a class="${cls}" href="${SELF_SETUP_URL}" target="_blank" rel="noopener">${ICON_PLUG}Continue integration on my own</a>`;
  let actions: string;
  if (inHours && ph) {
    const waText = encodeURIComponent(`Hi ${gm.name}, I just signed up for the AI Accountant free trial.`);
    actions = `<a class="b1" href="tel:${ph.tel}">${ICON_PHONE}Call ${name} now</a>`
      + (whatsapp ? `<a class="b2" href="https://wa.me/${ph.wa}?text=${waText}" target="_blank" rel="noopener">${ICON_WA}Text ${name} on WhatsApp</a>` : "")
      + `<p class="ft">Can't talk right now? ${willCap} call you within 30 minutes.</p>`
      + (showSelf ? `<div class="sub"><p>Prefer to set it up yourself?</p>${selfLink("sb")}</div>` : "");
  } else {
    actions = (ph ? `<p class="no">${esc(ph.show)}</p>` : "")
      + `<div class="info">${ICON_CLOCK}<span>${willCap} call you ${esc(when)}</span></div>`
      + (showSelf
          ? `${selfLink("pm")}<p class="hint">Don't want to wait? Set it up yourself now.</p><button class="btn dn">Done</button>`
          : `<button class="btn">Done</button>`);
  }
  return `<div class="grab" aria-hidden="true"></div>
<p class="ok">${ICON_OK}${hi}</p>
<p class="meet">Meet your <span class="tag">${role}</span></p>
<div class="av">${av}</div>
<h2 id="lr-h" class="nm">${esc(gm.full_name || gm.name)}</h2>
<p class="ctx">${willCap} answer your questions and connect AI Accountant to your Tally.</p>
${actions}`;
}

const fallbackHTML = () => `<h2 id="lr-h">Your request is in</h2><p>Our team will call you shortly to set up your free trial.</p><button class="btn">Done</button>`;
const loadingHTML = () => `<div class="sp" aria-hidden="true"></div><h2 id="lr-h">Finding your product specialist</h2><p>This takes a second.</p>`;

export const showLoading = () => showModal(loadingHTML());

/** Swap the loader for the GM card (or the generic card if routing failed). */
export function showResult(result: RouterResult | null, firstName: string, opts: { selfSetup?: boolean; whatsapp?: boolean } = {}) {
  const ok = !!(result && result.ok && result.gm && result.token);
  showModal(ok ? gmHTML(result!.gm!, firstName, result!.tally_bucket, result!.callback, opts.selfSetup, opts.whatsapp !== false) : fallbackHTML());
}
