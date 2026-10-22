// Lead router client for Astro forms. Same logic and popup as the Webflow pages (router v1.2).
// 1. lr_submit_lead (Supabase) picks the GM/CS person and returns their card.
// 2. The lead + token go to the n8n router, which creates the HubSpot contact with that owner.
// 3. The popup shows who will reach out, with number, email, checklist and the self-setup CTA for offline.

const SUPABASE_URL = "https://qmaphtslnvvifkzmbrvh.supabase.co";
const SUPABASE_KEY = "sb_publishable_AIvKMuiGgEsMokWZCT4IDw_T9DRnNYx";
const ROUTER_WEBHOOK = "https://n8n.aiaccountant.com/webhook/lead-router-hs";
const ROUTER_TIMEOUT_MS = 4000;
const SELF_SETUP_URL = "https://app.aiaccountant.com/";
// v2.0: "Create account" opens a WhatsApp chat with the AiA bot (self-setup), with this pre-filled text
const BOT_WA_NUMBER = "916366575567";
const BOT_WA_TEXT = "I want to sign up";
const BOT_WA_URL = `https://wa.me/${BOT_WA_NUMBER}?text=${encodeURIComponent(BOT_WA_TEXT)}`;
const LIVE_HOST = "lp.aiaccountant.com";
// Instant demo: live Teams call with the GM straight from the popup (opt-in per form, backend decides availability)
const INSTANT_DEMO_WEBHOOK = "https://n8n.aiaccountant.com/webhook/instant-demo";
const INSTANT_DEMO_TIMEOUT_MS = 15000;

type Gm = { name: string; full_name?: string; title?: string; photo_url?: string | null; phone?: string; email?: string; pronoun?: string | null };
export type RouterResult = {
  ok?: boolean; token?: string; reason?: string; pool?: string; blocked?: boolean;
  tally_bucket?: string; callback?: { text?: string; in_hours?: boolean }; gm?: Gm | null;
};

// Anything not on the live domain (Vercel previews, localhost) is flagged as a test lead
export const isTestHost = () => location.hostname !== LIVE_HOST || /[?&]lr_test=1(&|$)/.test(location.search);

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
let lrToken = "";
let lrShownAt = 0;

/** Click tracking (lr_click_events via lr_log_click). Token-only, resolved server-side. Never throws. */
function lrTrack(action: string, extra: Record<string, unknown> = {}) {
  if (!lrToken) return;
  const meta = {
    ...extra,
    device: matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop",
    seconds_since_shown: lrShownAt ? Math.round((Date.now() - lrShownAt) / 1000) : 0,
  };
  fetch(SUPABASE_URL + "/rest/v1/rpc/lr_log_click", {
    method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ p_token: lrToken, p_action: action, p_meta: meta }), keepalive: true,
  }).catch(() => {});
}

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
.card{background:#fff;color:#000;width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow-y:auto;border-radius:18px;padding:26px 22px 20px;box-shadow:0 24px 64px rgba(0,0,0,.25);transform:translateY(8px);transition:transform .22s ease;position:relative;text-align:center;outline:none}
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
.b2 svg{color:#314DD0}
.wa{background:#128C7E;color:#fff;border:0}
.wa svg{color:#fff}
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
.idm{background:#534AB7;color:#fff;border:0}
.idm svg{color:#fff}
.idsub{margin:-4px 0 12px;font-size:13px;color:#666}
.steps{list-style:none;padding:0;margin:0 auto 6px;max-width:270px;text-align:left;font-size:15px;line-height:2;color:#999}
.steps .done{color:#1f7a3f}
.steps .cur{color:#000;font-weight:700}
.sp{width:28px;height:28px;border:3px solid #e6e9f8;border-top-color:#314DD0;border-radius:50%;animation:r .8s linear infinite;margin:6px auto 16px}
@keyframes r{to{transform:rotate(360deg)}}
/* v2.0 popup: WhatsApp chat mock */
.wc{display:block;text-decoration:none;color:inherit;text-align:left;border:1px solid #dcdcdc;border-radius:16px;overflow:hidden;margin:18px 0 0;-webkit-tap-highlight-color:transparent}
.wc-hd{background:#008069;color:#fff;display:flex;align-items:center;gap:10px;padding:10px 14px 10px 8px;min-height:56px;box-sizing:border-box}
.wc-hd svg{width:20px;height:20px;flex:none}
.wc-av{width:36px;height:36px;border-radius:50%;background:#3446d6;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden}
.wc-av img{width:100%;height:100%;object-fit:cover}
.wc-who{flex:1;min-width:0;line-height:1.2}
h2.wc-nm{display:block;margin:0;font-size:15.5px;font-weight:700;color:#fff;line-height:1.2}
.wc-sub{display:block;font-size:12px;color:#d4efe8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-ic{display:flex;align-items:center;gap:16px}
.wc-bd{background-color:#efeae2;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Cg fill='none' stroke='%23d2c9b9' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M11 3.5c-3 0-5.5 2.3-5.5 5.2 0 3.8 5.5 8.8 5.5 8.8s5.5-5 5.5-8.8c0-2.9-2.5-5.2-5.5-5.2z'/%3E%3Ccircle cx='43' cy='9' r='5'/%3E%3Cpath d='M26 25l3-2.5 3 2.5'/%3E%3Cpath d='M11 48V36M6 41l5-5 5 5'/%3E%3Crect x='37' y='39' width='12' height='9' rx='1.5'/%3E%3Cpath d='M40.5 39v-2.5h5V39'/%3E%3Ccircle cx='57' cy='55' r='1.8'/%3E%3C/g%3E%3C/svg%3E");padding:12px 14px 14px}
.wc-pill{display:table;margin:0 auto 9px;background:#fff;color:#54656f;border-radius:8px;font-size:12.5px;padding:5px 12px;box-shadow:0 1px .5px rgba(11,20,26,.13)}
.wc-enc{display:table;margin:0 auto 12px;background:#ffeecd;color:#54656f;border-radius:8px;font-size:12px;line-height:1.3;padding:6px 12px;box-shadow:0 1px .5px rgba(11,20,26,.1)}
.wc-enc svg{width:13px;height:13px;vertical-align:-2px;margin-right:6px}
.wc-bub{position:relative;background:#fff;border-radius:0 8px 8px 8px;padding:9px 11px 5px;font-size:15.5px;line-height:1.42;color:#111b21;max-width:82%;margin-left:8px;box-shadow:0 1px .5px rgba(11,20,26,.13)}
.wc-bub::before{content:"";position:absolute;left:-8px;top:0;border-top:9px solid #fff;border-left:9px solid transparent}
.wc-tm{display:block;text-align:right;font-size:11px;color:#667781;margin-top:4px}
.wc-in{background:#f0f2f5;padding:8px 10px;display:flex;gap:9px;align-items:center}
.wc-fld{flex:1;min-width:0;background:#fff;border-radius:24px;height:40px;padding:0 14px;display:flex;align-items:center;gap:11px;color:#8696a0;font-size:15.5px}
.wc-fld svg{width:21px;height:21px;color:#54656f;flex:none}
.wc-sp{flex:1}
.wc-mic{width:40px;height:40px;border-radius:50%;background:#00a884;color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.wc-mic svg{width:20px;height:20px}
.b1.wcta{background:#3e8e7e;color:#fff;border:0;margin:16px 0 0;padding:19px 14px;font-size:17px}
.b1.wcta svg{width:22px;height:22px;color:#fff}
.wsub{margin:20px 0 0;padding-top:20px;border-top:1px solid #e6e6e6}
.wsub p{margin:0 0 14px;font-size:16px;color:#333}
.wsb{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;border:1.5px solid #2f3fc7;color:#2f3fc7;background:#fff;border-radius:12px;padding:17.5px 14px;font:700 17px/1.1 "Helvetica Neue",Helvetica,Arial,sans-serif;text-decoration:none;white-space:nowrap}
.wsb svg{width:20px;height:20px;flex:none}
.wc:focus-visible,.wsb:focus-visible{outline:2px solid #314DD0;outline-offset:2px}
@media (max-width:600px){.wc{margin-top:14px}.wc-bd{padding:10px 12px 12px}.wc-ic{gap:14px}.wc-dots{display:none}.b1.wcta{padding:17px 12px;font-size:16px}.wsub{margin-top:16px;padding-top:16px}.wsb{padding:15.5px 12px;font-size:16px}.wsub p{font-size:15px;margin-bottom:12px}}
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
  root.querySelectorAll("a, .btn.dn").forEach((el) => {
    const href = el.getAttribute("href") || "";
    const act = href.startsWith("tel:") ? "call"
      : el.classList.contains("wsb") || href.includes("wa.me/" + BOT_WA_NUMBER) ? "self_setup"
      : href.includes("wa.me") ? "whatsapp"
      : href === SELF_SETUP_URL ? "self_setup"
      : el.classList.contains("dn") ? "done"
      : "";
    // v2.0: tag which WhatsApp element was tapped (chat mock vs button)
    const via = el.classList.contains("wc") ? { via: "chat_mock" } : el.classList.contains("wcta") ? { via: "button" } : {};
    if (act) el.addEventListener("click", () => lrTrack(act, via));
  });
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
const ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 10l4.55 -2.28a1 1 0 0 1 1.45 .9v6.76a1 1 0 0 1 -1.45 .9l-4.55 -2.28v-4z"/><rect x="3" y="6" width="12" height="12" rx="2"/></svg>';
const svgI = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_BACK = svgI('<path d="M15 6l-6 6l6 6"/>');
const ICON_CAMVID = svgI('<path d="M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4z"/><rect x="3" y="6" width="12" height="12" rx="2"/>');
const ICON_DOTS = svgI('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>');
const ICON_LOCK = svgI('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>');
const ICON_SMILE = svgI('<circle cx="12" cy="12" r="9"/><path d="M9 10l.01 0"/><path d="M15 10l.01 0"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>');
const ICON_CLIP = svgI('<path d="M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5"/>');
const ICON_CAM = svgI('<path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"/><circle cx="12" cy="13" r="3"/>');
const ICON_MIC = svgI('<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/>');
const ICON_MSG = svgI('<path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1"/>');
const ICON_USERPLUS = svgI('<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M16 19h6"/><path d="M19 16v6"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4"/>');
const ICON_PLUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z"/><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z"/><path d="M3 21l2.5 -2.5"/><path d="M18.5 5.5l2.5 -2.5"/><path d="M10 11l-2 2"/><path d="M13 14l-2 2"/></svg>';

function fmtPhone(p?: string) {
  const d = String(p || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? { show: "+91 " + d.slice(0, 5) + " " + d.slice(5), tel: "+91" + d, wa: "91" + d } : null;
}

// v2.0 popup (Oct 2026): WhatsApp chat mock with the GM, one WhatsApp CTA, optional "Create account".
// Same layout in and out of business hours; no Call button, no callback line. The WhatsApp default text is unchanged (WA MQL scan matches it).
function gmHTML(gm: Gm, firstName: string, bucket?: string, callback?: RouterResult["callback"], selfSetup?: boolean, whatsapp = true) {
  void firstName; void callback;
  const initials = (gm.full_name || gm.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const av = gm.photo_url ? `<img src="${esc(gm.photo_url)}" alt="">` : esc(initials);
  const name = esc(gm.name);
  const role = esc(gm.title || "Product Specialist");
  const ph = fmtPhone(gm.phone);
  void selfSetup; void bucket;
  const showSelf = true; // v2.0 (Oct 2026): "Create account" shown to everyone
  const waHref = ph && whatsapp ? `https://wa.me/${ph.wa}?text=${encodeURIComponent(`Hi ${gm.name}, I just signed up for the AI Accountant free trial.`)}` : "";
  const mock = `<div class="wc-hd">${ICON_BACK}<span class="wc-av">${av}</span><span class="wc-who"><h2 id="lr-h" class="wc-nm">${esc(gm.full_name || gm.name)}</h2><span class="wc-sub">${role}, AI Accountant</span></span><span class="wc-ic">${ICON_CAMVID}${ICON_PHONE}<span class="wc-dots">${ICON_DOTS}</span></span></div>
<div class="wc-bd"><span class="wc-pill">Today</span><span class="wc-enc">${ICON_LOCK}Messages are end-to-end encrypted</span><div class="wc-bub">Let's continue this conversation on WhatsApp<span class="wc-tm">now</span></div></div>
<div class="wc-in"><span class="wc-fld">${ICON_SMILE}Message<span class="wc-sp"></span>${ICON_CLIP}${ICON_CAM}</span><span class="wc-mic">${ICON_MIC}</span></div>`;
  const chat = waHref
    ? `<a class="wc" href="${waHref}" target="_blank" rel="noopener" aria-label="Chat with ${name} on WhatsApp">${mock}</a>`
    : `<div class="wc">${mock}</div>`;
  const cta = waHref
    ? `<a class="b1 wcta" href="${waHref}" target="_blank" rel="noopener">${ICON_MSG}Chat with ${name} on WhatsApp</a>`
    : ph ? `<a class="b1 wcta" href="tel:${ph.tel}">${ICON_PHONE}Call ${name}</a>` : `<p class="ft">${name} will reach out to you shortly.</p>`;
  const self = showSelf
    ? `<div class="wsub"><p>Prefer to set it up yourself?</p><a class="wsb" href="${BOT_WA_URL}" target="_blank" rel="noopener">${ICON_USERPLUS}Create account</a></div>`
    : "";
  return `<div class="grab" aria-hidden="true"></div>${chat}${cta}${self}`;
}

// VA Bangalore restaurants: no "Meet your", no Call button, number as text + WhatsApp, same in and off hours
function vaBlrHTML(gm: Gm, firstName: string) {
  const initials = (gm.full_name || gm.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const av = gm.photo_url ? `<img src="${esc(gm.photo_url)}" alt="">` : esc(initials);
  const first = String(firstName || "").trim().split(/\s+/)[0];
  const hi = first ? `Thanks, ${esc(first.charAt(0).toUpperCase() + first.slice(1))}.` : "Thanks.";
  const name = esc(gm.name);
  const ph = fmtPhone(gm.phone);
  const waText = encodeURIComponent(`Hi ${gm.name}, I just asked for the free payment check for my restaurant.`);
  return `<div class="grab" aria-hidden="true"></div>
<p class="ok">${ICON_OK}${hi}</p>
<div class="av" style="margin-top:14px">${av}</div>
<h2 id="lr-h" class="nm">${esc(gm.full_name || gm.name)}</h2>
<p class="ctx">${name} will call you soon to collect the documents for your free check.</p>
${ph ? `<p class="no">${esc(ph.show)}</p><a class="b1 wa" href="https://wa.me/${ph.wa}?text=${waText}" target="_blank" rel="noopener">${ICON_WA}Text ${name} on WhatsApp</a>` : ""}
<button class="btn dn">Done</button>`;
}

type Variant = "va_blr";
const fallbackHTML = (variant?: Variant) => variant === "va_blr"
  ? `<h2 id="lr-h">Thank you!</h2><p>We will call you within one working day.</p><button class="btn">Done</button>`
  : `<h2 id="lr-h">Your request is in</h2><p>Our team will call you shortly to set up your free trial.</p><button class="btn">Done</button>`;
const loadingHTML = (variant?: Variant) => variant === "va_blr"
  ? `<div class="sp" aria-hidden="true"></div><h2 id="lr-h">Sending your request</h2><p>This takes a second.</p>`
  : `<div class="sp" aria-hidden="true"></div><h2 id="lr-h">Finding your product specialist</h2><p>This takes a second.</p>`;

export const showLoading = (variant?: Variant) => showModal(loadingHTML(variant));

// ── Instant demo ──
// After the GM card renders (business hours only), ask the backend if anyone is free right now.
// If yes, add the "Instant Demo" button on top. Click: loader -> backend creates a Teams meeting -> same tab goes to the join link.
// Anything slow, failed or busy ends on the fallback card (WhatsApp), never a dead end.
async function offerInstantDemo(token: string, gm: Gm) {
  let available = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/lr_instant_demo_available", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ p_token: token }), signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) { const j = await res.json(); available = !!(j && j.available); }
  } catch { available = false; }
  if (!available || !modalRoot) return;
  const body = modalRoot.querySelector(".body") as HTMLElement | null;
  const anchor = body && (body.querySelector(".b1, .b2, .info") as HTMLElement | null);
  if (!body || !anchor) return; // card was closed or replaced
  const wrap = document.createElement("div");
  wrap.innerHTML = `<button type="button" class="b1 idm">${ICON_VIDEO}Instant Demo</button><p class="idsub">Free now · 30-min video call with ${esc(gm.name)}</p>`;
  anchor.parentNode!.insertBefore(wrap, anchor);
  (wrap.querySelector(".idm") as HTMLElement).addEventListener("click", () => startInstantDemo(token, gm));
  lrTrack("instant_demo_shown");
}

async function startInstantDemo(token: string, gm: Gm) {
  lrTrack("instant_demo_click");
  const steps = ["Finding a product specialist", "Creating your video call", `Inviting ${gm.name}`];
  const loader = (i: number) => `<div class="sp" aria-hidden="true"></div><h2 id="lr-h">Setting up your live demo</h2>
<ul class="steps">${steps.map((s, k) => `<li class="${k < i ? "done" : k === i ? "cur" : ""}">${k < i ? "&#10003;" : k === i ? "&#8230;" : "&#9675;"} ${esc(s)}</li>`).join("")}</ul>`;
  showModal(loader(0));
  let step = 0;
  const tick = setInterval(() => { if (step < steps.length - 1) { step++; showModal(loader(step)); } }, 1200);
  let data: any = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), INSTANT_DEMO_TIMEOUT_MS);
    const res = await fetch(INSTANT_DEMO_WEBHOOK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }), signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) data = await res.json();
  } catch { data = null; }
  clearInterval(tick);

  const joinUrl = data && data.status === "ready" ? String(data.join_url || "") : "";
  if (/^https:\/\/teams\.microsoft\.com\//.test(joinUrl)) {
    const who = String(data.gm_name || gm.name);
    // v2.1: phones join in the browser on our page (Azure ACS guest, no Teams app); desktop keeps Teams. ?ild=1 forces the page (testing).
    const pageUrl = /^https:\/\/www\.aiaccountant\.com\/instant-live-demo\?d=[0-9a-f-]{36}$/i.test(String(data.page_url || "")) ? String(data.page_url) : "";
    const ua = navigator.userAgent || "";
    const phone = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const usePage = !!pageUrl && (phone || /[?&]ild=1\b/.test(location.search));
    const target = usePage ? pageUrl : joinUrl;
    lrTrack("instant_demo_ready", { gm: who, switched: !!data.gm_switched, existing: !!data.existing, via: usePage ? "page" : "teams" });
    showModal(`<div class="grab" aria-hidden="true"></div>
<p class="ok">${ICON_OK}Your call is ready</p>
<h2 id="lr-h" class="nm" style="font-size:22px">Your call with ${esc(who)} is ready</h2>
<p class="ctx">Taking you there now&#8230;</p>
<a class="b1 idm" href="${esc(target)}" rel="noopener">${ICON_VIDEO}Join video call</a>
<p class="ft">${usePage ? "Opens right here in your browser. No app needed." : "Opens in Microsoft Teams. We've also emailed you the link."}</p>`);
    let gone = false;
    const go = (auto: boolean) => { if (gone) return; gone = true; lrTrack("instant_demo_join", { auto }); };
    modalRoot?.querySelector(".idm")?.addEventListener("click", () => go(false));
    setTimeout(() => { if (!gone) { go(true); location.href = target; } }, 1500);
    return;
  }

  lrTrack("instant_demo_unavailable", { reason: (data && data.reason) || "error" });
  const ph = fmtPhone(gm.phone);
  const name = esc(gm.name);
  const waText = encodeURIComponent(`Hi ${gm.name}, I just signed up for the AI Accountant free trial.`);
  showModal(`<div class="grab" aria-hidden="true"></div>
<h2 id="lr-h">All our product specialists are on calls right now</h2>
<p>${name} will call you within 30 minutes.</p>
${ph ? `<a class="b1 wa" href="https://wa.me/${ph.wa}?text=${waText}" target="_blank" rel="noopener">${ICON_WA}Text ${name} on WhatsApp</a>` : ""}
<button class="btn dn">Done</button>`);
}

/** Swap the loader for the GM card (or the generic card if routing failed). */
export function showResult(result: RouterResult | null, firstName: string, opts: { selfSetup?: boolean; whatsapp?: boolean; track?: boolean; variant?: Variant; instantDemo?: boolean } = {}) {
  const ok = !!(result && result.ok && result.gm && result.token);
  const track = ok && opts.track === true; // opt-in per form: ca-wa-bot is not tracked
  lrToken = track ? result!.token! : ""; lrShownAt = track ? Date.now() : 0;
  const card = !ok ? fallbackHTML(opts.variant)
    : opts.variant === "va_blr" ? vaBlrHTML(result!.gm!, firstName)
    : gmHTML(result!.gm!, firstName, result!.tally_bucket, result!.callback, opts.selfSetup, opts.whatsapp !== false);
  showModal(card);
  if (track) lrTrack("popup_shown");
  // Instant demo: opt-in per form, business hours only, the backend decides if anyone is free
  if (ok && opts.instantDemo && opts.variant !== "va_blr" && result!.callback && result!.callback.in_hours) {
    offerInstantDemo(result!.token!, result!.gm!);
  }
}
