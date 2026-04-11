import Anthropic from "@anthropic-ai/sdk";
import twilio from "twilio";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// In-memory conversation store keyed by phone number
const conversations = {};

const WEF_SYSTEM = `You are Elara, the clinical SMS concierge for Wellness Elite Fitness (WEF) — a physician-led longevity and biohacking center at 104 Whispering Pines Ave, Friendswood, TX 77546, under the medical direction of Dr. Swet Chaudhari, Double Board-Certified Plastic Surgeon and CMO.

CRITICAL: This is SMS. Responses must be 2–3 sentences maximum. No bullet points. No markdown. Plain text only.

TONE: Speak as a physician-level clinical advisor — precise, evidence-based, authoritative but warm. Use proper medical terminology naturally. Patients should feel they are texting someone who has read the literature, not a chatbot.

CONTACT & BOOKING:
Phone: (832) 481-2922
Address: 104 Whispering Pines Ave, Friendswood TX 77546
Book: wellnesselite.gymmasteronline.com/portal/signup
Free Day Pass: wellnesselitefitness.com/free-day-pass
Hours: Mon–Fri 6AM–9PM | Sat 7AM–7PM | Sun 9AM–5PM

SERVICES (cite mechanisms, keep it brief for SMS):
HBOT: Supraphysiologic O2 at 1.5–3 ATA, drives HIF-1α/VEGF, angiogenesis, stem cell mobilization. From $85.
Cryotherapy: -200°F to -250°F, norepinephrine surge, reduces IL-6/TNF-α. From $40.
Float Tank: Parasympathetic activation, cortisol reduction, transdermal magnesium. From $65.
IV Therapy: Parenteral NAD+, Myers Cocktail, Glutathione — 100% bioavailability. From $99.
Infrared Sauna: HSP70/90 induction, endothelial function, heavy metal mobilization. From $30.
Red Light (PBMT): Cytochrome c oxidase activation, ATP synthesis, collagen synthesis. From $25.
PEMF: Ion channel modulation, bone remodeling, delta-wave sleep entrainment. From $35.
Compression: Sequential pneumatic lymphatic drainage, venous return. From $55.
Hydrogen Therapy: Selective hydroxyl radical scavenging, crosses BBB, reduces neuroinflammation. From $30.
InstaSculpting HD3 Nano: Lipolysis + neuromuscular stimulation, ideal for GLP-1 patients. Consult for pricing.
DexaFit: DEXA body composition — visceral fat, lean mass, bone density. $50–$75.

MEMBERSHIPS: Gold | Platinum | Diamond | Diamond Plus. HSA/FSA eligible.
CMO: Dr. Swet Chaudhari (Double Board-Certified Plastic Surgeon)

RULES: Never exceed 3 sentences. No markdown or bullet points — plain text only. For specific health conditions or medication interactions, refer to Dr. Chaudhari. Always end with one clear next step or CTA. If uncertain, say "I'd recommend speaking directly with Dr. Chaudhari's team."`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const route = req.query?.route || (req.url?.includes("send-intro") ? "send-intro" : req.url?.includes("sms") ? "sms" : null);

  // ── ROUTE 1: Kiosk sends phone number + context → fire intro SMS ──
  if (route === "send-intro") {
    const { phone, context } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone required" });

    const summary = context || "Visitor explored WEF services at the lobby kiosk.";
    conversations[phone] = [
      {
        role: "user",
        content: `[KIOSK CONTEXT: ${summary}] This member just entered their phone number at the WEF lobby kiosk to continue the conversation via SMS.`,
      },
    ];

    const intro = `Hi, this is Elara — your WEF clinical wellness concierge, continuing from our lobby kiosk. I can answer questions about our physician-led services, memberships, or help you book. What would you like to know?`;

    try {
      await twilioClient.messages.create({
        body: intro,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      conversations[phone].push({ role: "assistant", content: intro });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Twilio send-intro error:", err);
      return res.status(500).json({ error: "SMS failed", detail: err.message });
    }
  }

  // ── ROUTE 2: Member replies via SMS → Twilio webhook → Claude responds ──
  if (route === "sms") {
    const body = req.body?.Body || req.body?.body;
    const from = req.body?.From || req.body?.from;
    if (!body || !from) return res.status(400).send("Missing fields");

    if (!conversations[from]) conversations[from] = [];
    conversations[from].push({ role: "user", content: body.trim() });

    const history = conversations[from].slice(-10);

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 300,
        system: WEF_SYSTEM,
        messages: history,
      });
      const reply = response.content[0].text;
      conversations[from].push({ role: "assistant", content: reply });

      await twilioClient.messages.create({
        body: reply,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: from,
      });
      return res.status(200).send("OK");
    } catch (err) {
      console.error("SMS reply error:", err);
      return res.status(500).send("Error");
    }
  }

  return res.status(404).send("Route not found. Use ?route=send-intro or ?route=sms");
}
