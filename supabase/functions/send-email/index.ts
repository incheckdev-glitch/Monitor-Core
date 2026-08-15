import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer@9.0.3";

type Recipient = { email: string; name?: string };
type EmailRequest = {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: string;
  html?: string;
  text?: string;
  reply_to?: string;
  replyTo?: string;
  category?: string;
  metadata?: Record<string, unknown>;
};

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-incheck360-email-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const clean = (value: unknown) => String(value ?? "").trim();
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function normalizeRecipients(value: unknown): Recipient[] {
  const output: Recipient[] = [];
  const add = (emailValue: unknown, nameValue?: unknown) => {
    const email = clean(emailValue).toLowerCase();
    const name = clean(nameValue);
    if (!email || !validEmail(email) || output.some((item) => item.email === email)) return;
    output.push({ email, ...(name ? { name } : {}) });
  };

  if (typeof value === "string") {
    value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => {
      const match = item.match(/^(.*?)<([^<>]+)>$/);
      if (match) add(match[2], match[1].trim().replace(/^["']|["']$/g, ""));
      else add(item);
    });
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") normalizeRecipients(item).forEach((r) => add(r.email, r.name));
      else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        add(obj.email ?? obj.address ?? obj.to, obj.name ?? obj.display_name ?? obj.displayName);
      }
    }
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    add(obj.email ?? obj.address ?? obj.to, obj.name ?? obj.display_name ?? obj.displayName);
  }
  return output;
}

function smtpConfig() {
  const gmailUser = clean(Deno.env.get("GMAIL_SMTP_USER"));
  const gmailPass = clean(Deno.env.get("GMAIL_SMTP_PASS"));
  const host = clean(Deno.env.get("SMTP_HOST")) || (gmailUser ? "smtp.gmail.com" : "");
  const port = Number(clean(Deno.env.get("SMTP_PORT")) || (host.toLowerCase().includes("gmail.com") ? 465 : 587));
  const user = clean(Deno.env.get("SMTP_USER")) || gmailUser;
  const pass = clean(Deno.env.get("SMTP_PASS")) || gmailPass;
  const fromEmail = clean(Deno.env.get("SMTP_FROM")) || clean(Deno.env.get("EMAIL_FROM")) || user;
  const fromName = clean(Deno.env.get("SMTP_FROM_NAME")) || clean(Deno.env.get("EMAIL_FROM_NAME")) || clean(Deno.env.get("GMAIL_FROM_NAME")) || "InCheck360";
  const secureRaw = clean(Deno.env.get("SMTP_SECURE")).toLowerCase();
  const secure = secureRaw ? ["true", "1", "yes"].includes(secureRaw) : port === 465;
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!fromEmail) missing.push("SMTP_FROM");
  if (missing.length) throw new Error(`Missing email configuration: ${missing.join(", ")}`);
  if (!validEmail(fromEmail)) throw new Error("SMTP_FROM / EMAIL_FROM must contain a valid email address.");
  return { host, port, secure, user, pass, fromEmail, fromName };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const expected = clean(Deno.env.get("INCHECK360_EMAIL_WEBHOOK_SECRET"));
  const received = clean(req.headers.get("x-incheck360-email-secret"));
  if (!expected) return json({ ok: false, error: "INCHECK360_EMAIL_WEBHOOK_SECRET is not configured." }, 500);
  if (!received || received !== expected) return json({ ok: false, error: "Unauthorized." }, 401);

  let body: EmailRequest;
  try { body = await req.json() as EmailRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body." }, 400); }

  const to = normalizeRecipients(body.to);
  const cc = normalizeRecipients(body.cc);
  const bcc = normalizeRecipients(body.bcc);
  const subject = clean(body.subject);
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!to.length) return json({ ok: false, error: "At least one valid recipient is required." }, 400);
  if (!subject) return json({ ok: false, error: "Email subject is required." }, 400);
  if (!html && !text) return json({ ok: false, error: "Email html or text content is required." }, 400);

  try {
    const smtp = smtpConfig();
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    const fmt = (recipient: Recipient) => recipient.name ? `"${recipient.name.replace(/"/g, '\\"')}" <${recipient.email}>` : recipient.email;
    const result = await transporter.sendMail({
      from: `${smtp.fromName} <${smtp.fromEmail}>`,
      to: to.map(fmt).join(", "),
      cc: cc.length ? cc.map(fmt).join(", ") : undefined,
      bcc: bcc.length ? bcc.map(fmt).join(", ") : undefined,
      replyTo: validEmail(clean(body.reply_to ?? body.replyTo)) ? clean(body.reply_to ?? body.replyTo) : undefined,
      subject,
      html: html || undefined,
      text: text || undefined,
    });
    return json({
      ok: true,
      messageId: result.messageId || null,
      recipientsCount: to.length,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
      category: clean(body.category) || null,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
