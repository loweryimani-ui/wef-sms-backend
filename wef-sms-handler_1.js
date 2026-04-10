// ============================================================
// WEF SMS BACKEND - SINGLE FILE VERSION
// Deploy this as ONE file to Vercel
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import twilio from "twilio";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Conversation memory per phone number
const conversations = {};

const WEF_SYSTEM = `You are the WEF Wellness Concierge for Wellness Elite Fitness in Friendswood TX. You are continuing a conversation via SMS that started at our lobby kiosk. Keep responses SHORT — this is a text message, max 3-4 sentences. Be warm and professional. Always end with a clear next step.

Contact: (832) 481-2922 | 104 Whispering Pines Ave, Friendswood TX 77546 | wellnesselitefitness.com
Book: wellnesselite.gymmasteronline.com/portal/signup
Free Day Pass: wellnesselitefitness.com/free-day-pass
Hours: Mon-Fri 9AM-7PM, Sat-Sun 10AM-1PM
Services: HBOT, Cryotherapy, Float Tank, PEMF, Red Light Therapy, Infrared Sauna, Salt Cave Sauna, Hydrogen Therapy, IV Infusions, Personal Training, Nutrition Coaching, Medical Weight Loss, Compression Therapy, DexaFit Body Scan
CMO: Dr. Swet Chaudhari (Double Board-Certified Plastic Surgeon)
Memberships: Gold, Platinum, Diamond, Diamond Plus
Never make medical claims.`;

export default async function handler(req, res) {
  // CORS for kiosk
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const path = req.url;

  // ── ROUTE 1: Kiosk sends phone number → fire intro SMS ──
  if (path.includes("send-intro")) {
    const { phone, context } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone required" });

    const summary = context || "Visitor explored WEF services at the lobby kiosk.";
    conversations[phone] = [
      {
        role: "user",
        content: `[KIOSK CONTEXT: ${summary}] Member entered their number to continue on phone.`,
      },
    ];

    const intro = `Hi! 👋 This is your WEF Wellness Concierge continuing from our lobby kiosk. I'm here to answer questions about our services, memberships, or help you book. What would you like to know?`;

    try {
      await twilioClient.messages.create({
        body: intro,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      conversations[phone].push({ role: "assistant", content: intro });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "SMS failed" });
    }
  }

  // ── ROUTE 2: Member replies via SMS → Claude responds ──
  if (path.includes("sms")) {
    const { Body, From } = req.body;
    if (!Body || !From) return res.status(400).send("Missing fields");

    if (!conversations[From]) conversations[From] = [];
    conversations[From].push({ role: "user", content: Body.trim() });
    const history = conversations[From].slice(-10);

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: WEF_SYSTEM,
        messages: history,
      });
      const reply = response.content[0].text;
      conversations[From].push({ role: "assistant", content: reply });

      await twilioClient.messages.create({
        body: reply,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: From,
      });
      return res.status(200).send("OK");
    } catch (err) {
      console.error(err);
      return res.status(500).send("Error");
    }
  }

  return res.status(404).send("Not found");
}
