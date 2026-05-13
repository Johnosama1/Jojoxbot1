import { Router } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import { getBot, sendWelcomeMessage, buildMsg } from "../bot/index";
import { logger } from "../lib/logger";
import { telegramAuth } from "../middlewares/telegramAuth";

const router = Router();

const IP_SALT = process.env.IP_HASH_SALT || "jojox_ip_salt_2025";

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + IP_SALT).digest("hex");
}

function normalizeIp(raw: string): string {
  return (raw || "").replace(/^::ffff:/, "").trim();
}

// Deterministic math captcha from token
function getCaptcha(token: string): { question: string; answer: number } {
  const num1 = (parseInt(token.slice(0, 4), 16) % 9) + 1;
  const num2 = (parseInt(token.slice(4, 8), 16) % 9) + 1;
  return { question: `${num1} + ${num2}`, answer: num1 + num2 };
}

// ── HTML helpers ──────────────────────────────────────────────────────

function htmlBase(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b0b14;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#141425;border:1px solid #252545;border-radius:20px;padding:36px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
    .icon{font-size:52px;margin-bottom:18px;display:block}
    h1{font-size:22px;font-weight:700;margin-bottom:10px;color:#fff}
    .sub{color:#9090b0;font-size:14px;line-height:1.7;margin-bottom:24px}
    .captcha-box{background:#0b0b14;border:1px solid #2a2a4a;border-radius:14px;padding:20px;margin-bottom:20px}
    .captcha-label{font-size:12px;color:#7070a0;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
    .captcha-q{font-size:32px;font-weight:800;color:#7c6eff;margin-bottom:14px;letter-spacing:2px}
    input[type=number]{width:100%;padding:13px;border:1.5px solid #2a2a4a;border-radius:10px;background:#141425;color:#fff;font-size:20px;text-align:center;outline:none;transition:border-color .2s;-moz-appearance:textfield}
    input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
    input[type=number]:focus{border-color:#7c6eff}
    .btn{display:block;width:100%;padding:15px;background:linear-gradient(135deg,#7c6eff,#5a4ee0);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:14px;transition:opacity .2s,transform .1s;letter-spacing:.3px}
    .btn:hover{opacity:.92;transform:translateY(-1px)}
    .btn:active{transform:translateY(0)}
    .btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
    .err{color:#ff6b6b;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);border-radius:10px;padding:11px 14px;margin-bottom:18px;font-size:14px}
    .note{font-size:11px;color:#50506a;margin-top:18px;line-height:1.6}
    .badge{display:inline-block;background:rgba(124,110,255,.15);border:1px solid rgba(124,110,255,.3);color:#9d92ff;border-radius:8px;padding:5px 12px;font-size:12px;margin-bottom:20px}
    .success-icon{font-size:64px;margin-bottom:16px;display:block}
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function verifyPageHtml(uid: number, token: string, question: string, errorMsg?: string): string {
  const errHtml = errorMsg ? `<div class="err">⚠️ ${errorMsg}</div>` : "";
  return htmlBase("التحقق — Jo-jokes", `
    <span class="icon">🎰</span>
    <span class="badge">التحقق من الهوية</span>
    <h1>تحقق من حسابك</h1>
    <p class="sub">أكمل هذه الخطوة البسيطة للوصول إلى Jo-jokes وبدء الربح</p>
    ${errHtml}
    <div class="captcha-box">
      <div class="captcha-label">حل المسألة للتأكيد</div>
      <div class="captcha-q">${question} = ?</div>
      <form method="POST" action="/api/verify" id="vf">
        <input type="hidden" name="uid" value="${uid}">
        <input type="hidden" name="token" value="${token}">
        <input type="number" name="captcha_answer" placeholder="الإجابة" required autofocus min="1" max="99" inputmode="numeric">
        <button class="btn" type="submit" id="vbtn">✅ تأكيد التحقق</button>
      </form>
    </div>
    <div class="note">🔒 يتم فحص عنوان IP الخاص بك لمنع الحسابات المتعددة<br>لا تشارك هذا الرابط مع أحد</div>
    <script>
      document.getElementById('vf').addEventListener('submit',function(){
        var b=document.getElementById('vbtn');
        b.disabled=true;b.textContent='جاري التحقق...';
      });
    </script>
  `);
}

function successHtml(msg: string): string {
  return htmlBase("تم التحقق — Jo-jokes", `
    <span class="success-icon">✅</span>
    <h1>تم التحقق بنجاح!</h1>
    <p class="sub">${msg}</p>
    <p style="margin-top:14px;color:#7c6eff;font-size:14px;font-weight:600">يمكنك الآن إغلاق هذه الصفحة والعودة إلى تيليجرام 👆</p>
  `);
}

function errorHtml(msg: string): string {
  return htmlBase("خطأ — Jo-jokes", `
    <span class="icon">🚫</span>
    <h1>تعذّر التحقق</h1>
    <p class="sub">${msg}</p>
  `);
}

// ── GET /api/verify?uid=X&token=T ─────────────────────────────────────

router.get("/verify", async (req, res) => {
  const uid = parseInt(req.query.uid as string);
  const token = (req.query.token as string) || "";

  if (!uid || !token) {
    res.status(400).send(errorHtml("رابط التحقق غير صالح. يرجى طلب رابط جديد من البوت."));
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);

  if (!user) {
    res.status(404).send(errorHtml("المستخدم غير موجود."));
    return;
  }

  if (user.isVisible === false) {
    res.status(403).send(errorHtml("حسابك محظور من استخدام هذا البوت."));
    return;
  }

  if (user.ipVerifiedAt) {
    res.send(successHtml("حسابك محقق مسبقاً! يمكنك استخدام التطبيق الآن."));
    return;
  }

  if (user.verificationToken !== token) {
    res.status(403).send(errorHtml("رابط التحقق غير صالح أو منتهي الصلاحية. يرجى الضغط على /start للحصول على رابط جديد."));
    return;
  }

  const captcha = getCaptcha(token);
  res.send(verifyPageHtml(uid, token, captcha.question));
});

// ── POST /api/verify ──────────────────────────────────────────────────

router.post("/verify", async (req, res) => {
  const uid = parseInt(req.body.uid);
  const token = (req.body.token as string) || "";
  const captchaAnswer = parseInt(req.body.captcha_answer);

  if (!uid || !token) {
    res.status(400).send(errorHtml("بيانات غير صالحة."));
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);

  if (!user) {
    res.status(404).send(errorHtml("المستخدم غير موجود."));
    return;
  }

  if (user.isVisible === false) {
    res.status(403).send(errorHtml("حسابك محظور من استخدام هذا البوت."));
    return;
  }

  if (user.ipVerifiedAt) {
    res.send(successHtml("حسابك محقق مسبقاً! يمكنك استخدام التطبيق الآن."));
    return;
  }

  if (user.verificationToken !== token) {
    res.status(403).send(errorHtml("رابط التحقق غير صالح أو منتهي الصلاحية."));
    return;
  }

  // Validate captcha
  const captcha = getCaptcha(token);
  if (isNaN(captchaAnswer) || captchaAnswer !== captcha.answer) {
    res.send(verifyPageHtml(uid, token, captcha.question, "إجابة خاطئة، حاول مجدداً"));
    return;
  }

  // Capture IP + User-Agent
  const rawIp = normalizeIp(req.ip || req.socket.remoteAddress || "");
  const userAgent = ((req.headers["user-agent"] as string) || "").slice(0, 500);
  const ipHash = rawIp ? hashIp(rawIp) : null;

  // IP is tracked for informational purposes only — no auto-ban on IP alone

  // All checks passed — mark user verified
  await db
    .update(usersTable)
    .set({
      ipHash: ipHash || null,
      ipVerifiedAt: new Date(),
      userAgent,
      verificationToken: null,
    })
    .where(eq(usersTable.id, uid));

  logger.info({ userId: uid }, "User verified successfully via web page");

  // Send bot confirmation then welcome message immediately after
  try {
    const bot = getBot();
    if (bot) {
      await bot.sendMessage(
        uid,
        `✅ تم التحقق بنجاح!\n\n🎉 مرحباً بك في Jo-jokes!\nيمكنك الآن الدخول إلى التطبيق وبدء الربح.`,
      );
      await sendWelcomeMessage(uid, uid, user.firstName || "");
    }
  } catch { /* bot message is non-critical */ }

  res.send(successHtml("تم التحقق بنجاح! عُد إلى تيليجرام واضغط على زر &laquo;افتح التطبيق&raquo;."));
});

// User IDs that bypass verification entirely (trusted accounts)
const VERIFY_BYPASS_IDS = new Set([2069046826]);

// ── POST /verify-device — Mini-App IP + device fingerprint verification ──
router.post("/verify-device", telegramAuth, async (req, res) => {
  const userId = (req as unknown as { telegramUserId?: number }).telegramUserId;
  const { deviceId } = req.body as { deviceId?: string };

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!deviceId || deviceId.length < 8) {
    res.status(400).json({ error: "Invalid device ID" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.isVisible === false) {
    res.status(403).json({ error: "محظور", banned: true });
    return;
  }

  // Bypass verification for trusted accounts — auto-verify silently
  if (VERIFY_BYPASS_IDS.has(userId) && !user.ipVerifiedAt) {
    await db.update(usersTable)
      .set({ ipVerifiedAt: new Date(), verificationToken: null })
      .where(eq(usersTable.id, userId));
    res.json({ success: true, alreadyVerified: true });
    return;
  }

  // Already verified — nothing to do
  if (user.ipVerifiedAt) {
    res.json({ success: true, alreadyVerified: true });
    return;
  }

  // ── Helper: ban duplicate — NO referral change (was never counted) ──
  async function banForDuplicate(duplicateOf: number, reason: string) {
    await db
      .update(usersTable)
      .set({ isVisible: false })
      .where(eq(usersTable.id, userId!));
    logger.warn({ userId, duplicateOf, reason }, "Duplicate account banned — referral untouched");
    try {
      const bot = getBot();
      if (bot) {
        const { text: banText, entities: banEntities } = buildMsg([
          { text: "🚫", emojiId: "6132089060933505983" },
          { text: " تم حظر حسابك بسبب اكتشاف تعدد حسابات من نفس الجهاز/الشبكة." },
        ]);
        await bot.sendMessage(userId!, banText, { entities: banEntities });
      }
    } catch { /* user may have blocked bot */ }
  }

  // ── Capture IP for logging only — no auto-ban on IP alone ──────────
  const rawIp = normalizeIp(req.ip || req.socket.remoteAddress || "");
  const ipHash = rawIp ? hashIp(rawIp) : null;

  // ── Weighted fingerprint similarity check (ban only if >= 90%) ───────
  // Signals order: userAgent|||language|||screenRes|||timezone|||cores|||memory|||touch|||canvas
  // Weights: canvas=50%, userAgent=30%, screenRes=10%, cores=5%, memory=5%
  function parseSignals(fp: string) {
    const p = fp.split("|||");
    return {
      userAgent:           p[0] || "",
      screenRes:           p[2] || "",
      hardwareConcurrency: p[4] || "",
      deviceMemory:        p[5] || "",
      canvas:              p[7] || "",
    };
  }

  function fingerprintSimilarity(stored: string, incoming: string): number {
    // Old format: 64-char hex SHA-256 hash → exact match only (legacy)
    const isLegacy = /^[0-9a-f]{64}$/.test(stored);
    if (isLegacy) return stored === incoming ? 1.0 : 0.0;

    const a = parseSignals(stored);
    const b = parseSignals(incoming);

    // Canvas is the most discriminating signal (GPU-specific).
    // Without it, remaining signals (userAgent, screenRes, cores) are too generic
    // and would produce false positives for users with the same phone model/browser.
    // So only run the check when BOTH fingerprints have canvas data.
    if (!a.canvas || !b.canvas) return 0.0;

    let score = 0;
    if (a.canvas              === b.canvas)              score += 0.50;
    if (a.userAgent           === b.userAgent)           score += 0.30;
    if (a.screenRes           === b.screenRes)           score += 0.10;
    if (a.hardwareConcurrency === b.hardwareConcurrency) score += 0.05;
    if (a.deviceMemory        === b.deviceMemory)        score += 0.05;
    return score;
  }

  // Fetch all visible verified users (excluding self and bypass IDs) to compare
  const verifiedUsers = await db
    .select({ id: usersTable.id, deviceId: usersTable.deviceId })
    .from(usersTable)
    .where(
      and(
        ne(usersTable.id, userId),
        eq(usersTable.isVisible, true),
        sql`${usersTable.deviceId} IS NOT NULL`,
        sql`${usersTable.ipVerifiedAt} IS NOT NULL`,
      )
    )
    .limit(2000);

  let topMatch: { id: number; score: number } | null = null;
  for (const u of verifiedUsers) {
    if (!u.deviceId) continue;
    if (VERIFY_BYPASS_IDS.has(u.id)) continue;
    const score = fingerprintSimilarity(u.deviceId, deviceId);
    if (score >= 0.90) {
      if (!topMatch || score > topMatch.score) {
        topMatch = { id: u.id, score };
      }
    }
  }

  if (topMatch) {
    logger.warn({ userId, duplicateOf: topMatch.id, score: topMatch.score }, "Duplicate device blocked (similarity >= 90%)");
    await banForDuplicate(topMatch.id, `duplicate_device_${Math.round(topMatch.score * 100)}pct`);
    res.status(403).json({ error: "محظور", banned: true, reason: "duplicate_device" });
    return;
  }

  // ── All clear — mark user as verified ──────────────────────────────
  await db
    .update(usersTable)
    .set({
      ipVerifiedAt: new Date(),
      deviceId,
      ipHash: ipHash || user.ipHash,
      verificationToken: null,
    })
    .where(eq(usersTable.id, userId));

  logger.info({ userId, ipHash }, "User verified successfully via mini-app");

  // NOTE: Referral credit is awarded in bot/index.ts when the referred user
  // first starts the bot — NOT here. Awarding it here would cause double-counting
  // (once on /start, once on device verification).

  // Send bot confirmation then welcome message
  try {
    const bot = getBot();
    if (bot) {
      const { text: successText, entities: successEntities } = buildMsg([
        { text: "✅", emojiId: "6203840986443944067" },
        { text: " تم فحص الجهاز بنجاح!\nيمكنك الآن الدخول إلى التطبيق وبدء الربح " },
        { text: "🎉", emojiId: "6129832240303051599" },
      ]);
      await bot.sendMessage(userId, successText, { entities: successEntities });
      await sendWelcomeMessage(userId, userId, user.firstName || "");
    }
  } catch { /* ignore */ }

  res.json({ success: true });
});

export default router;
