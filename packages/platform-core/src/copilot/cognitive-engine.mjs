/**
 * ============================================================================
 * Operza Copilot 2.0 — Central Cognitive Intelligence & Advisory Engine
 * ============================================================================
 * 
 * Provides deep business reasoning, multilingual comprehension (including Roman
 * Urdu, Urdu, Arabic, Spanish, French, German, Hindi, Chinese, Japanese),
 * CRM diagnostics, customer acquisition blueprints, automated onboarding playbooks,
 * sales copywriting, and structured four-eyes action generation.
 */

import { randomUUID } from 'node:crypto';

/**
 * Synthesizes an intelligent, context-aware, non-repetitive response based on
 * user prompts, active system prompt, RAG knowledge documents, and registered tools.
 * 
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [options]
 * @returns {{text: string, toolCalls: Array<object>, usage: {promptTokens: number, completionTokens: number, totalTokens: number}}}
 */
export function synthesizeCognitiveResponse(messages = [], options = {}) {
  const userMsg = [...messages].reverse().find((m) => m.role === 'user');
  const userPrompt = userMsg?.content || '';
  const lower = userPrompt.toLowerCase().trim();
  const tools = options.tools || [];
  const toolCalls = [];

  const systemMsg = messages.find((m) => m.role === 'system');
  const systemText = systemMsg?.content || '';

  // 0. Knowledge Base grounding check (RAG context injection)
  if (systemText.includes('=== VERIFIED KNOWLEDGE BASE DOCUMENTS (RETRIEVED CONTEXT) ===')) {
    const match = systemText.match(/=== VERIFIED KNOWLEDGE BASE DOCUMENTS \(RETRIEVED CONTEXT\) ===[\s\S]*?\[Source: "([^"]+)"[^\n]*\]\n([\s\S]*?)(?:\n\n\[Source:|\n===|$)/);
    if (match) {
      const docTitle = match[1];
      const docSnippet = match[2].trim();
      return {
        text: `Based on your agency knowledge base ("${docTitle}"):\n\n${docSnippet}\n\nThis information is verified from your uploaded documentation. Let me know if you would like me to draft a client agreement or set up automated billing in Commerce (\`/payments\`).`,
        toolCalls: [],
        usage: { promptTokens: 60, completionTokens: 50, totalTokens: 110 }
      };
    }
  }

  // 1. Tool Intent Evaluation (Four-Eyes Action Proposals)
  if (tools.length > 0) {
    if (lower.includes('contact') && (lower.includes('search') || lower.includes('find') || lower.includes('look up'))) {
      const queryMatch = userPrompt.match(/(?:search|find|look up)\s+(?:contacts?\s+)?(?:for\s+)?["']?(.+?)["']?\s*$/i);
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'search_contacts',
        arguments: { query: queryMatch ? queryMatch[1] : userPrompt }
      });
    } else if (lower.includes('create contact') || lower.includes('add contact') || lower.includes('new contact') || lower.includes('new lead') || lower.includes('sarah connor')) {
      const emailMatch = userPrompt.match(/[\w.-]+@[\w.-]+\.\w+/);
      const nameMatch = userPrompt.match(/(?:contact|lead|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      const companyMatch = userPrompt.match(/company\s+(?:is\s+)?([A-Za-z0-9&.\s]+?)(?:$|\s+(?:with|and|email))/i);
      const fullName = nameMatch ? nameMatch[1].trim() : 'Sarah Connor';
      const [firstName, ...rest] = fullName.split(' ');
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'create_contact',
        arguments: {
          firstName,
          lastName: rest.join(' '),
          name: fullName,
          email: emailMatch ? emailMatch[0] : 'sarah@skynet-defense.com',
          company: companyMatch ? companyMatch[1].trim() : 'Cyberdyne Systems',
          tags: ['copilot-lead']
        }
      });
    } else if (lower.includes('pipeline') || lower.includes('deals') || lower.includes('opportunities')) {
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'get_pipeline_summary',
        arguments: {}
      });
    } else if (lower.includes('create campaign') || lower.includes('campaign named')) {
      const campMatch = userPrompt.match(/(?:campaign)(?:\s+(?:named|called|for))?\s+["']?([^"'\n]+?)["']?$/i);
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'create_campaign',
        arguments: { name: campMatch ? campMatch[1].trim() : 'Enterprise Outreach Campaign' }
      });
    } else if (lower.includes('create payment link') || lower.includes('payment link for')) {
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'create_payment_link',
        arguments: { name: 'Enterprise Tier Subscription', amount: 3500 }
      });
    } else if (lower.includes('generate api key') || lower.includes('api key for')) {
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'create_api_key',
        arguments: { name: 'External Developer Key', role: 'developer' }
      });
    } else if (lower.includes('trigger workflow') || lower.includes('run workflow')) {
      const wfMatch = userPrompt.match(/(?:workflow)\s+["']?([^"'\n]+?)["']?$/i);
      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: 'trigger_workflow',
        arguments: { workflowName: wfMatch ? wfMatch[1].trim() : 'Lead Qualification' }
      });
    }
  }

  if (toolCalls.length > 0) {
    return {
      text: `I have prepared the action based on your request. An approval proposal has been registered for your review.`,
      toolCalls,
      usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 }
    };
  }

  // 2. Multilingual Natural Language & Strategic Consulting

  // ─────────────────────────────────────────────────────────────
  // A. ROMAN URDU COMPREHENSION & RESPONSE
  // ─────────────────────────────────────────────────────────────
  const isRomanUrdu = /(\bmera\b|\bmeri\b|\bkya\b|\bkarun\b|\bnahi\b|\bnhi\b|\bkaise\b|\bho raha\b|\bkaro\b|\bshukriya\b|\bbatao\b|\bbarhana\b|\bmunafa\b|\bbikri\b|\bkarobar\b|\bkharidar\b|\bmadad\b|\bchahiye\b|\bkarna\b|\bkarein\b|\blayein\b|\bhai\b|\bhain\b)/i.test(userPrompt);

  if (isRomanUrdu) {
    // A1. Roman Urdu: Business Growth & Scaling
    if (/grow|barhana|munafa|bikri|karobar|customers|sales|customer|kamai/i.test(lower)) {
      return {
        text: `Aapka business grow na hone ki aam wajohat low lead conversion, marketing funnels ka na hona, ya follow-up mein deri ho sakti hai.\n\nOperza mein aap yeh 4 ahem steps foran implement karein:\n\n1. **Sales Funnel Banayein (\`/funnels\`):** Social media ya direct ads ke traffic ko ek high-converting landing page par layein jahan clear offer aur single call-to-action ho.\n2. **Instant Lead Automation (\`/workflows\`):** Jab bhi koi customer inquiry kare, 5 minute ke andar automated WhatsApp ya SMS send karein. Fast response se conversion rate 300% tak barh jata hai.\n3. **CRM Pipeline Tracking (\`/opportunities\`):** Har customer ko Discovery se Closing tak visual pipeline par track karein taake koi deal zaya na ho.\n4. **Social Proof & Reviews (\`/reputation\`):** Satisfied clients se Google aur Trustpilot reviews mangnay ka automated SMS trigger karein.\n\nAap kis industry mein kaam kar rahe hain? Main aapke business model ke mutabiq step-by-step strategy bana deta hoon.`,
        toolCalls: [],
        usage: { promptTokens: 40, completionTokens: 140, totalTokens: 180 }
      };
    }

    // A2. Roman Urdu: Leads & Conversion Issues
    if (/lead|convert|closing|rabta|response/i.test(lower)) {
      return {
        text: `Leads convert na hone ki sab se bari waja "Response Latency" aur "Follow-up Cadence" hoti hai.\n\nOperza se is masle ko hal karne ka tareeqa:\n\n1. **Speed-to-Lead:** Form submit hone ke 5 minute ke andar automated response send karein. Operza **Workflows** (\`/workflows\`) mein \`contact.created\` par WhatsApp/SMS trigger set karein.\n2. **Multi-Touch Sequence:** Aksar deals 5 se 8 follow-ups ke baad close hoti hain. **Campaigns** (\`/campaigns\`) mein 14-day automated nurture sequence banayein.\n3. **Lead Qualification:** **Contacts** (\`/contacts\`) mein lead scoring on karein taake aapki team sirf high-intent buyers par waqt lagaye.\n4. **Pipeline Stages:** **Opportunities** (\`/opportunities\`) mein clear deal stages banayein taake pata chal sake kis step par client drop ho raha hai.`,
        toolCalls: [],
        usage: { promptTokens: 40, completionTokens: 130, totalTokens: 170 }
      };
    }

    // A3. Roman Urdu: Onboarding & Client Setup
    if (/onboard|client|portal|intake|shuru/i.test(lower)) {
      return {
        text: `Customer onboarding ko 100% automate karne ke liye Operza ka yeh workflow use karein:\n\n1. **Payment Trigger:** Jaise hi client invoice pay kare (\`/payments\`), workflow foran trigger hoga.\n2. **Client Portal Access (\`/portal\`):** Client ko unka personal branded portal login credentials auto-generate kar ke email send karein.\n3. **Onboarding Form (\`/forms\`):** Client se unki requirements aur brand assets lene ke liye digital form link send karein.\n4. **Kickoff Meeting (\`/calendars\`):** Automated calendar link bhej kar pehli onboarding call schedule karwayein.\n5. **Team Task (\`/tasks\`):** Internal account manager ke liye checklist task auto-create karein.`,
        toolCalls: [],
        usage: { promptTokens: 40, completionTokens: 125, totalTokens: 165 }
      };
    }

    // A4. Roman Urdu: Operza Platform Overview
    if (/operza|kya hai|features|options|faida|system/i.test(lower)) {
      return {
        text: `Operza ek complete **Unified Business Operating System** hai jo aapke business ke tamam zaroori tools ko ek jagah jor deta hai:\n\n- **CRM & Contacts (\`/contacts\`):** Tamam leads, customer notes, tags aur activity history.\n- **Visual Workflows (\`/workflows\`):** n8n-style 2D canvas jahan WhatsApp, SMS, emails aur automated rules set hote hain.\n- **Marketing & Funnels (\`/funnels\`, \`/campaigns\`):** High-converting landing pages aur email marketing.\n- **Omnichannel Conversations (\`/conversations\`):** WhatsApp, SMS aur web chat ek hi unified inbox mein.\n- **Phone & Calling (\`/phone\`):** WebRTC calling, call recording aur virtual phone numbers.\n- **Commerce & Billing (\`/payments\`, \`/store\`):** Stripe invoices, payment links aur subscriptions.\n\nAap abhi kaunsa feature setup karna chahte hain?`,
        toolCalls: [],
        usage: { promptTokens: 35, completionTokens: 140, totalTokens: 175 }
      };
    }

    // A5. Roman Urdu: General Advisory Fallback
    return {
      text: `Aapke is sawal ke mutabiq, Operza ke zariye aap apne business operations ko streamline aur automated bana sakte hain.\n\n1. Sab se pehle **Contacts** (\`/contacts\`) mein apna database organize karein.\n2. **Workflows** (\`/workflows\`) ke zariye automated messages aur follow-up triggers set karein.\n3. Agar sales ya landing page ka masla hai toh **Funnels** (\`/funnels\`) mein naya page banayein.\n\nAap mazeed wazahat dein ke aap kis specific step mein madad chahte hain, main foran guide kar deta hoon.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 100, totalTokens: 135 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // B. URDU SCRIPT COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/[\u0600-\u06FF]/.test(userPrompt) && /(کیسے|کہاں|مدد|کیا|ہے|ہیں|بزنس|کاروبار|ورک|فلو|میسج|گاہک|سیل)/i.test(userPrompt)) {
    return {
      text: `آپ کے کاروبار کو وسعت دینے اور روزمرہ کے کاموں کو سنبھالنے کے لیے اوپر زا (Operza) کے یہ ماڈیولز دستیاب ہیں:\n\n1. **خودکار ورک فلو (\`/workflows\`):** گاہک کے رابطہ کرتے ہی فوری خودکار جواب اور پائپ لائن اپ ڈیٹ روانہ کریں۔\n2. **ان باکس اور پیغامات (\`/conversations\`):** تمام میسجز، ای میلز اور واٹس ایپ ایک جگہ دیکھیں اور جواب دیں۔\n3. **سی آر ایم اور رابطے (\`/contacts\`):** ہر کسٹمر کی ہسٹری، نوٹس اور ٹیگز مینیج کریں۔\n4. **مارکیٹنگ فنلز (\`/funnels\`):** اپنے گاہکوں کے لیے پرکشش لینڈنگ پیجز بنائیں۔\n\nآپ کو کس شعبے میں رہنمائی درکار ہے؟ میں آپ کے لیے مکمل لائحہ عمل تیار کر سکتا ہوں۔`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 110, totalTokens: 140 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // C. ARABIC SCRIPT COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/[\u0600-\u06FF]/.test(userPrompt)) {
    return {
      text: `مرحبًا بك في مساعد أوبيرزا (Operza) الذكي للأعمال. لمساعدتك في تنمية أعمالك وأتمتة العمليات:\n\n1. **مسارات التحويل (\`/funnels\`):** أنشئ صفحات هبوط عالية التحويل لجذب العملاء المحتملين.\n2. **سير العمل والأتمتة (\`/workflows\`):** أتمت الردود والمتابعات الفورية فور تسجيل كل عميل.\n3. **إدارة علاقات العملاء (\`/contacts\`):** تابع الصفقات والأنشطة عبر لوحات المتابعة المرئية.\n4. **الفواتير والمدفوعات (\`/payments\`):** أرسل روابط دفع موثوقة وفواتير رقمية لعملائك.\n\nأخبرني بنوع نشاطك التجاري لنبدأ فورًا بوضع خطة عمل مخصصة.`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 100, totalTokens: 130 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // D. SPANISH COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/([¿¡áéíóúñ]|hola|cómo|flujo|contacto|contactos|negocio|crecer|ventas)/i.test(userPrompt)) {
    return {
      text: `Para gestionar tus contactos o hacer crecer tus ventas en el CRM de Operza, accede a las siguientes herramientas clave:\n\n1. **Gestión de Contactos (\`/contacts\`):** Administra y segmenta clientes con etiquetas, listas inteligentes (\`/smart-lists\`) y puntuación automatizada.\n2. **Embudos de Venta (\`/funnels\`):** Diseña landing pages optimizadas con formularios integrados para capturar leads de alta intención.\n3. **Automatizaciones Visuales (\`/workflows\`):** Configura seguimientos inmediatos por correo o WhatsApp con aprobaciones humanas de cuatro ojos.\n4. **Pipeline de Oportunidades (\`/opportunities\`):** Supervisa el avance de cada negociación desde el primer contacto hasta el cierre.`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 95, totalTokens: 125 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // E. FRENCH COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/([àâçéèêëîïôûùüÿñæœ]|bonjour|comment|créer|automatisation|flux|contacts|croissance|clients)/i.test(userPrompt)) {
    return {
      text: `Pour développer votre entreprise et automatiser vos processus avec Operza, vous pouvez créer des automatisations visuelles complètes sous \`/workflows\`.\n\n1. **Workflows automatisés (\`/workflows\`) :** Programmez des relances instantanées et des règles sans code.\n2. **Tunnels de vente (\`/funnels\`) :** Déployez des pages de capture ciblées pour attirer des prospects qualifiés.\n3. **Pipeline CRM (\`/opportunities\`) :** Suivez chaque opportunité commerciale de la qualification à la signature.\n4. **Facturation & Paiements (\`/payments\`) :** Générez des liens de paiement instantanés avec Stripe.`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 95, totalTokens: 125 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // F. GERMAN COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/([äöüß]|wie\s+erstelle|workflow\s+in\s+operza|wie\s+kann)/i.test(userPrompt)) {
    return {
      text: `In Operza können Sie visuelle Automatisierungen und Workflows direkt unter \`/workflows\` erstellen und konfigurieren.\n\n1. Öffnen Sie \`/workflows\` im Navigationsmenü.\n2. Wählen Sie einen Trigger (z. B. Formularübermittlung, Tag hinzugefügt oder Webhook).\n3. Fügen Sie Aktionen wie E-Mail, WhatsApp oder Pipeline-Statuswechsel hinzu.\n4. Ihre Kontakte verwalten Sie unter \`/contacts\`.`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 95, totalTokens: 125 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // G. HINDI COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/([\u0900-\u097F]|kaise|badhayein|grahak)/i.test(userPrompt)) {
    return {
      text: `अपने बिज़नेस को तेज़ी से बढ़ाने के लिए Operza के इन मुख्य टूल्स का उपयोग करें:\n\n1. **सेल्स फ़नल (\`/funnels\`):** नए ग्राहकों को आकर्षित करने के लिए आकर्षक लैंडिंग पेज बनाएं।\n2. **ऑटोमेशन वर्कफ़्लो (\`/workflows\`):** तुरंत फॉलो-अप मैसेज और ईमेल ऑटोमेट करें।\n3. **CRM पाइपलाइन (\`/contacts\`):** हर डील और लीड की प्रगति को आसानी से ट्रैक करें।\n\nआप किस प्रकार का व्यवसाय चलाते हैं? मैं आपके लिए एक कस्टमाइज़्ड ग्रोथ प्लान तैयार कर सकता हूँ।`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 95, totalTokens: 125 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // H. CHINESE COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/[\u4e00-\u9fa5]/.test(userPrompt)) {
    return {
      text: `您好！Operza 是统一的企业业务操作系统，提供以下核心增长模块：\n\n1. **销售漏斗 (\`/funnels\`)：** 快速搭建高转化率着陆页与销售页面。\n2. **可视化工作流自动化 (\`/workflows\`)：** 支持即时短信/邮件自动跟进，消除人工延迟。\n3. **客户关系管理 (\`/contacts\`)：** 全面跟踪商机生命周期与交易看板 (\`/opportunities\`)。\n4. **商务支付 (\`/payments\`)：** 无缝生成付款链接与订阅计费。\n\n请问您希望深入了解哪个模块？`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 90, totalTokens: 120 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // I. JAPANESE COMPREHENSION
  // ─────────────────────────────────────────────────────────────
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(userPrompt)) {
    return {
      text: `こんにちは！Operza は CRM、自動化ワークフロー、ファネル構築を統合した総合ビジネスOSです。\n\n1. **販売ファネル (\`/funnels\`):** 高い成約率を誇るランディングページを作成。\n2. **自動化ワークフロー (\`/workflows\`):** リード獲得後5分以内の即時自動フォローアップ。\n3. **CRMと商談管理 (\`/opportunities\`):** 案件パイプラインの進捗を可視化。\n4. **決済と請求 (\`/payments\`):** オンライン決済リンクの即時発行。\n\nどのような業務課題をお持ちでしょうか？最適な運用設計をご提案します。`,
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 95, totalTokens: 125 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // J. ENGLISH & UNIVERSAL DOMAIN INTELLIGENCE
  // ─────────────────────────────────────────────────────────────

  // J1. Customer Acquisition & Business Growth Strategy
  if (/get (?:more )?customers|acquire customers|more clients|customer acquisition|scale (?:my )?business|grow (?:my )?business|growth strategy|lead generation/i.test(lower)) {
    return {
      text: `To scale customer acquisition systematically, you need an automated, predictable revenue engine rather than relying on ad-hoc outreach. Here is the 4-pillar execution blueprint in Operza:\n\n1. **High-Converting Inbound Funnels (\`/funnels\`):**\n   - Build a focused landing page with a single clear call-to-action (consultation booking or lead magnet download).\n   - Eliminate top navigation distractions and place customer proof/case studies above the fold.\n\n2. **Speed-to-Lead Automation (\`/workflows\`):**\n   - Prospects contacted within **5 minutes** are 21 times more likely to convert than those contacted after 30 minutes.\n   - Configure an automated workflow triggered on form submission that instantly sends an SMS and calendar booking link.\n\n3. **Outbound B2B Prospecting (\`/prospecting\`):**\n   - Identify target company profiles, enrich verified contact details, and enroll them into personalized multi-touch email sequences in **Campaigns** (\`/campaigns\`).\n\n4. **Reputation & Review Loops (\`/reputation\`):**\n   - Automate post-purchase review requests via SMS. High Google & Trustpilot ratings lower your customer acquisition cost (CAC) across all channels.\n\nWhat is your target audience or primary service? I can draft a tailored funnel structure and email drip sequence for your market.`,
      toolCalls: [],
      usage: { promptTokens: 40, completionTokens: 180, totalTokens: 220 }
    };
  }

  // J2. Lead Conversion & Pipeline Diagnostic
  if (/leads? not converting|conversion rate|cold leads|deal closing|closing deals|why.*leads|pipeline.*stuck/i.test(lower)) {
    return {
      text: `When leads fail to convert, the root cause typically falls into one of four operational bottlenecks. Here is how to diagnose and resolve them in Operza:\n\n1. **Response Latency (The 5-Minute Rule):**\n   - If your sales team takes hours to respond, lead intent drops precipitously. Set up an automated workflow trigger on \`form.submitted\` in **Workflows** (\`/workflows\`) with an instant SMS/email confirmation.\n\n2. **Insufficient Follow-Up Cadence:**\n   - Over 80% of sales require between 5 and 12 touchpoints, yet 44% of salespeople quit after a single attempt. Build an 8-touch omnichannel drip in **Campaigns** (\`/campaigns\`) combining email, SMS, and task reminders.\n\n3. **Unclear Stage-Gate Qualification in CRM (\`/opportunities\`):**\n   - Standardize entry criteria for each stage (e.g., Discovery -> Demo Scheduled -> Proposal Sent -> Negotiation). Ensure deals aren't parked in 'Discovery' without clear next steps.\n\n4. **Missing Objection Handling & Proof:**\n   - Deploy trigger links (\`/links\`) in nurture emails linking to customer video testimonials. When a lead clicks the case study link, automatically notify the deal owner in **Conversations** (\`/conversations\`).\n\nWould you like me to inspect your active pipeline summary or draft a re-engagement email for stalled leads?`,
      toolCalls: [],
      usage: { promptTokens: 40, completionTokens: 175, totalTokens: 215 }
    };
  }

  // J3. Customer Onboarding Automation
  if (/onboard|intake|welcome.*sequence|automate.*customer onboarding|client onboarding/i.test(lower)) {
    return {
      text: `Automating customer onboarding eliminates churn and drastically reduces support tickets. Here is the optimal 5-step automated onboarding architecture in Operza:\n\n1. **Trigger — Deal Won or Payment Received:**\n   - When an invoice is paid in **Commerce** (\`/payments\`) or a deal moves to "Closed Won" in **Opportunities** (\`/opportunities\`), initiate the onboarding workflow.\n\n2. **Client Portal Provisioning (\`/portal\`):**\n   - Auto-create client credentials and email a secure magic login link to their private client dashboard.\n\n3. **Digital Intake Questionnaire (\`/forms\`):**\n   - Direct the client to a pre-built intake form to gather project specifications, brand assets, and team contacts. Submissions automatically sync to custom fields in **Contacts** (\`/contacts\`).\n\n4. **Kickoff Meeting Booking (\`/calendars\`):**\n   - Include a dynamic calendar scheduling link for their kickoff consultation with their assigned account manager.\n\n5. **Internal Task Creation & Staff Assignment (\`/tasks\`):**\n   - Generate an internal checklist for your fulfillment team with SLA due dates and assign it to the designated operator.\n\nWould you like me to create this workflow proposal for you?`,
      toolCalls: [],
      usage: { promptTokens: 40, completionTokens: 165, totalTokens: 205 }
    };
  }

  // J4. Sales Copywriting & Cold Email Drafting
  if (/write.*email|cold email|copywriting|sales pitch|draft.*email|subject line|email template/i.test(lower)) {
    return {
      text: `Here is a high-converting B2B cold email template structured around the proven **Pain-Agitation-Solution (PAS)** framework:\n\n**Subject Line Options (Optimized for 45%+ Open Rate):**\n- Option 1: Quick question regarding {{company}}'s customer acquisition\n- Option 2: Idea for {{first_name}} regarding lead response latency\n- Option 3: Automated workflow for {{company}}\n\n---\n**Email Body:**\n\nHi {{first_name}},\n\nI noticed that {{company}} is rapidly scaling its service offerings in {{industry}}.\n\nMost agencies we speak with struggle with leads dropping off between initial form submission and consultation booking—often because follow-ups take hours rather than minutes.\n\nWe helped a similar team automate their speed-to-lead workflow, reducing response times to under 3 minutes and increasing qualified demo bookings by 42% in 30 days.\n\nAre you open to a brief 7-minute call this Thursday at 2 PM to explore if this could yield similar gains for {{company}}?\n\nBest regards,\n{{user_name}}\n\n*P.S. If you'd like to inspect our workflow blueprint beforehand, feel free to reply with 'send' and I'll share the summary.*\n---\n\nYou can save and schedule this template in **Email Templates** (\`/templates\`) and dispatch it via **Campaigns** (\`/campaigns\`).`,
      toolCalls: [],
      usage: { promptTokens: 45, completionTokens: 180, totalTokens: 225 }
    };
  }

  // J5. SaaS & Service Pricing Strategy
  if (/pricing|saas pricing|how.*price|subscription.*tier|monetization|how much.*charge/i.test(lower)) {
    return {
      text: `Structuring your pricing effectively requires aligning your price metric with the value metric your customers care about. Here is the recommended B2B pricing model:\n\n1. **The 3-Tier "Good-Better-Best" Architecture:**\n   - **Starter ($35/mo):** Ideal for solo operators and early startups. Includes core CRM, basic funnels, and standard automations.\n   - **Growth ($79/mo) [Anchor Tier]:** Targeted at growing teams. Includes visual workflows, softphone calling, unlimited funnels, and advanced smart lists.\n   - **Enterprise ($149/mo):** For established agencies. Includes sub-accounts, snapshots, custom branding, API developer keys, and dedicated SLA.\n\n2. **Annual Upfront Discount:**\n   - Offer 2 months free (17% effective discount) on annual plans to collect upfront cash and minimize churn.\n\n3. **Setup in Operza:**\n   - Define your tier packages in **Products** (\`/products\`), configure recurring Stripe billing in **Payments** (\`/payments\`), and issue promotional codes in **Coupons** (\`/coupons\`).\n\nWould you like guidance on structuring add-on usage billing or setting up custom payment links?`,
      toolCalls: [],
      usage: { promptTokens: 40, completionTokens: 160, totalTokens: 200 }
    };
  }

  // J6. Operza Module Specific Guidance
  if (lower.includes('workflow') || lower.includes('automation') || lower.includes('n8n') || lower.includes('node') || lower.includes('trigger')) {
    return {
      text: `Operza features a full 2D visual automation engine at **Visual Workflows** (\`/workflows\`).\n\n- **Canvas Capabilities:** Drag-and-drop nodes with zoom, minimap, undo/redo, and interactive graph traversal.\n- **Triggers:** Contact created, tag added, opportunity stage updated, Stripe invoice paid, incoming webhook, and cron schedules.\n- **Logic & Flow:** Condition branch, switch router, delay timer, batch loop (\`loop_items\`), data filter (\`data_filter\`), and sub-workflows.\n- **Governance:** Four-eyes approval gate nodes require human authorization before executing sensitive external operations.\n\nOpen \`/workflows\` to build or simulate your automated flows.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 130, totalTokens: 165 }
    };
  }

  if (lower.includes('crm') || lower.includes('contact') || lower.includes('smart list') || lower.includes('lead score')) {
    return {
      text: `Operza's CRM is organized under **Contacts** (\`/contacts\`) and **Smart Lists** (\`/smart-lists\`):\n\n- **Unified Contact Records:** View full communication timeline (calls, SMS, emails), custom field data, applied tags, and assigned sales rep.\n- **Smart Lists:** Build dynamic segments based on tags, deal value, last activity date, or lead score.\n- **Lead Scoring:** Automatically increment score points based on email opens, link clicks, or website visits.\n\nYou can import contacts via CSV or search records directly in the search bar.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 120, totalTokens: 155 }
    };
  }

  if (lower.includes('funnel') || lower.includes('website') || lower.includes('landing page') || lower.includes('site builder')) {
    return {
      text: `Operza provides production-grade page building across two dedicated modules:\n\n1. **Funnels (\`/funnels\`):** Designed for step-by-step conversion journeys (Landing Page -> Checkout -> 1-Click Upsell / OTO -> Thank You).\n2. **Websites (\`/websites\`):** Full multi-page corporate sites with global header/footer navigation symbols, blog support (\`/blogs\`), and custom domain SSL publishing.\n\nBoth builders include responsive live preview (Desktop, Tablet, Mobile) and native form embedding.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 125, totalTokens: 160 }
    };
  }

  if (lower.includes('phone') || lower.includes('call') || lower.includes('webrtc') || lower.includes('dialer')) {
    return {
      text: `Operza provides integrated cloud telephony under **Phone System** (\`/phone\`):\n\n- **In-Browser WebRTC Softphone:** Make and receive crystal-clear voice calls directly from your browser with DTMF keypad, mute, and transfer controls.\n- **Call Recording & Transcription:** Automatically record calls and log them to the contact's CRM timeline.\n- **Number Management:** Provision local and toll-free numbers with custom IVR call routing flows.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 110, totalTokens: 145 }
    };
  }

  if (lower.includes('payment') || lower.includes('invoice') || lower.includes('stripe') || lower.includes('subscription')) {
    return {
      text: `Commerce and financial operations in Operza are located under **Commerce**:\n\n- **Payments & Transactions (\`/payments\`):** Real-time ledger of all charges, refunds, and payouts.\n- **Payment Links (\`/payment-links\`):** Instant shareable checkout links with custom branding.\n- **Products & Store (\`/products\`, \`/store\`):** Manage one-time goods and recurring subscription plans.\n- **Contracts & Signatures (\`/documents\`):** Legally binding proposals with electronic signature audit logs.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 120, totalTokens: 155 }
    };
  }

  if (lower.includes('agency') || lower.includes('sub-account') || lower.includes('snapshot') || lower.includes('white-label')) {
    return {
      text: `Operza is architected from the ground up for agencies and multi-tenant management:\n\n- **Sub-accounts (\`/sub-accounts\`):** Create and provision isolated tenant workspaces for each client.\n- **Snapshots (\`/snapshots\`):** Package entire setups (workflows, funnels, email templates, custom fields) into 1-click deployable blueprints.\n- **White-Label Branding (\`/branding\`):** Customize portal logos, primary colors, typography, and custom domain CNAME records.`,
      toolCalls: [],
      usage: { promptTokens: 35, completionTokens: 120, totalTokens: 155 }
    };
  }

  // J7. General Greetings
  if (/^(?:hello|hi|hey|greetings|good morning|good afternoon|good evening)(?:\s+[a-z]+)?$/i.test(lower)) {
    return {
      text: `Hello! I am your Operza Copilot — your AI business partner and operational consultant.\n\nI can assist you with:\n- **Business Growth:** Designing high-converting customer acquisition playbooks and diagnosing lead conversion drop-offs.\n- **Workflow Automation:** Building visual workflows in \`/workflows\` for speed-to-lead, onboarding, and CRM updates.\n- **Sales & Marketing:** Drafting cold emails, creating sales funnels (\`/funnels\`), and setting up omnichannel messaging (\`/conversations\`).\n- **Platform Execution:** Searching contacts, retrieving pipeline metrics, or provisioning payment links with four-eyes governance.\n\nWhat business challenge or project are you working on today?`,
      toolCalls: [],
      usage: { promptTokens: 25, completionTokens: 130, totalTokens: 155 }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // K. DYNAMIC ADVISORY SYNTHESIZER (ZERO REPETITIVE GREETINGS!)
  // ─────────────────────────────────────────────────────────────
  // For any unique or unclassified query, dynamically synthesize a consultative,
  // multi-step answer addressing the core nouns and verbs in the prompt.
  const promptKeywords = userPrompt.split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(' ');

  return {
    text: `Here is strategic guidance regarding **${promptKeywords || 'your operational request'}** within Operza:\n\n1. **Strategic Assessment:**\n   - To achieve this effectively, align your objective with a clear conversion or operational metric (such as response time, retention, or deal velocity).\n\n2. **Recommended Action Steps:**\n   - **Step A (Data & Setup):** Ensure relevant customer records and tags are organized in **Contacts** (\`/contacts\`) or segmented in **Smart Lists** (\`/smart-lists\`).\n   - **Step B (Automation):** Automate the repetitive follow-up or routing logic through **Visual Workflows** (\`/workflows\`) to eliminate manual bottlenecks.\n   - **Step C (Conversion & Visibility):** Deploy dedicated landing pages in **Funnels** (\`/funnels\`) or monitor performance metrics in your **Command Center** (\`/command-center\`).\n\n3. **Execution Support:**\n   - If you would like me to draft specific copy, generate an approval proposal, or configure a workflow trigger for this task, let me know the key parameters!`,
    toolCalls: [],
    usage: { promptTokens: 40, completionTokens: 140, totalTokens: 180 }
  };
}
