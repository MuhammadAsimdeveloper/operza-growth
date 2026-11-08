import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/AuthContext';

// ─── Certification Track Definitions ─────────────────────────────────
export interface CertificationTrack {
  id: string;
  code: string;
  title: string;
  level: 'Associate' | 'Professional' | 'Specialty';
  duration: string;
  description: string;
  badgeColor: string;
  skills: string[];
}

export const CERTIFICATION_TRACKS: CertificationTrack[] = [
  {
    id: 'ocba',
    code: 'OCBA-A01',
    title: 'Operza Certified Business Architect',
    level: 'Associate',
    duration: '12 Hours (24 Modules)',
    description: 'Validates comprehensive architectural mastery of the entire Operza Business Operating System across Multi-Tenant Governance, CRM, Omnichannel Voice, Headless CMS, and Unified Commerce.',
    badgeColor: '#4f46e5',
    skills: ['Multi-Tenant Tenancy', 'Unified CRM & Pipelines', 'Visual Headless CMS', 'Omnichannel Softphone', 'Stripe Billing & Contracts'],
  },
  {
    id: 'ocae',
    code: 'OCAE-P01',
    title: 'Operza Certified Automation & AI Engineer',
    level: 'Professional',
    duration: '16 Hours (Advanced)',
    description: 'Validates advanced proficiency in 2D DAG Workflow design, Transactional Outbox retry semantics, Zapier REST Hook subscription architecture, and 10-Agent Copilot Swarm orchestration.',
    badgeColor: '#0ea5e9',
    skills: ['2D Visual Flow Canvas', 'Wait-for-Webhook Pauses', 'Copilot AI Swarm', 'HMAC Replay Defense', 'Zapier Universal REST Hooks'],
  },
];

// ─── Curriculum Domain & Module Definitions ─────────────────────────
export interface AcademyModule {
  id: string;
  domainId: string;
  title: string;
  duration: string;
  level: 'Foundational' | 'Intermediate' | 'Advanced';
  workspaceRoute: string;
  workspaceAction: string;
  summary: string;
  architectureNotes: string;
  codeSnippet: string;
  keyTakeaways: string[];
  quiz: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  };
}

export interface AcademyDomain {
  id: string;
  number: number;
  title: string;
  weight: string;
  icon: string;
  description: string;
  modules: AcademyModule[];
}

export const ACADEMY_DOMAINS: AcademyDomain[] = [
  {
    id: 'domain-1',
    number: 1,
    title: 'Multi-Tenant Cloud Hierarchy & Agency Governance',
    weight: '18% Exam Weight',
    icon: 'building',
    description: 'Master isolated agency tenancy, location workspaces, cross-account telemetry, TCPA/GDPR consent ledgers, and audited system security.',
    modules: [
      {
        id: 'mod-1-1',
        domainId: 'domain-1',
        title: 'Multi-Tenant Tenancy Architecture & Location Workspaces',
        duration: '25 min',
        level: 'Foundational',
        workspaceRoute: '/sub-accounts',
        workspaceAction: 'Explore Sub-accounts & Locations',
        summary: 'Understand the multi-tenant database isolation model separating Agency parent organizations from child client locations with granular RBAC.',
        architectureNotes: `Multi-tenant isolation in Operza operates on a hierarchical tenant boundary:
1. Agency Root Tenant: Holds billing, custom branding, and account snapshot blueprints.
2. Location Workspaces: Independent operational units with their own contact graphs, phone numbers, pipelines, and API keys.
3. User RBAC: Scoped JWT tokens guarantee strict tenant sandboxing without cross-account data leakage.`,
        codeSnippet: `// Tenant Context Resolution & Scoped Ingress
interface TenantContext {
  agencyId: string;
  locationId: string;
  roles: ('agency_admin' | 'location_manager' | 'operator')[];
  quotaMeters: {
    monthlySmsTokens: number;
    voiceMinutesAllocated: number;
    copilotAiCredits: number;
  };
}`,
        keyTakeaways: [
          'Child locations inherit agency-wide snapshot templates but isolate contact graphs.',
          'Sub-account switcher in the topbar executes zero-downtime JWT context switching.',
          'Tenant isolation is verified on every API request via middleware headers.',
        ],
        quiz: {
          question: 'What is the primary architectural boundary separating distinct client data in Operza?',
          options: [
            'Separate browser cookies per client',
            'Hierarchical Location Workspaces with scoped tenant JWT isolation',
            'Manually duplicated codebases per customer',
            'Static JSON configuration files on disk',
          ],
          correctIndex: 1,
          explanation: 'Operza enforces strict tenant boundaries at the database and API middleware levels using scoped Location Workspaces and tenant JWT contexts.',
        },
      },
      {
        id: 'mod-1-2',
        domainId: 'domain-1',
        title: 'Agency Command Center & Cross-Account Telemetry',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/command-center',
        workspaceAction: 'Open Command Center',
        summary: 'Aggregate high-frequency telemetry across all agency child accounts with live operational pulse meters and error heatmaps.',
        architectureNotes: `The Command Center aggregates real-time metrics across 100+ sub-accounts:
- Aggregated MRR & Deal Pipeline Velocity
- Telephony Outbox Delivery Rates (Twilio + WhatsApp)
- Webhook Dead-Letter Queues & Circuit Breakers
- Live Copilot AI Swarm proposal dispatch queues`,
        codeSnippet: `// Real-Time Sub-Account Pulse Meter Aggregate
const aggregatedPulse = {
  totalActiveLocations: 124,
  networkHealthScore: 99.98,
  realtimeTrafficRps: 842,
  activeWebRtcCalls: 38,
  pendingAiProposals: 14
};`,
        keyTakeaways: [
          'Command Center provides unified cross-account observability.',
          'Instant drill-down enables opening any sub-account in a single click.',
          'Anomaly detectors highlight webhook delivery drops before clients notice.',
        ],
        quiz: {
          question: 'Which tool gives agency executives aggregated pulse metrics across all child locations?',
          options: [
            'Standard Contacts page',
            'The Operza Command Center',
            'Individual Email Templates',
            'The Media Asset Library',
          ],
          correctIndex: 1,
          explanation: 'The Command Center aggregates high-frequency health meters, revenue, and queue depth across all client workspaces.',
        },
      },
      {
        id: 'mod-1-3',
        domainId: 'domain-1',
        title: 'Account Snapshots & Reusable Blueprint Deployment',
        duration: '35 min',
        level: 'Intermediate',
        workspaceRoute: '/snapshots',
        workspaceAction: 'Inspect Account Snapshots',
        summary: 'Package entire business operating stacks (funnels, automations, custom fields, SMS templates) into 1-click deployable snapshots.',
        architectureNotes: `Snapshot engine serializes complete sub-account states:
- Visual Funnel Pages & Global Symbols
- 2D DAG Workflows and Trigger Rules
- Custom Fields & Pipeline Stage Configurations
- Voice IVR Menus & SMS Auto-responder Snippets`,
        codeSnippet: `// Snapshot Blueprint Manifest
interface SnapshotManifest {
  version: '2.4.0';
  industry: 'Healthcare & Dental Practice';
  components: {
    funnels: ['patient-onboarding-v2', 'implant-consultation'];
    workflows: ['missed-call-textback', 'recall-reminder-drip'];
    customFields: ['insurance_carrier', 'preferred_doctor', 'hipaa_consent_date'];
  };
}`,
        keyTakeaways: [
          'Snapshots allow onboarding new agency clients in under 60 seconds.',
          'Component conflict resolution protects existing customer data upon snapshot push.',
          'Snapshots can be versioned and rolled back cleanly.',
        ],
        quiz: {
          question: 'What is the primary benefit of Operza Account Snapshots?',
          options: [
            'Taking a screenshot of the browser window',
            'Deploying turnkey funnels, workflows, and custom fields to new sub-accounts in 1 click',
            'Archiving deleted contacts into CSV files',
            'Translating web pages into foreign languages',
          ],
          correctIndex: 1,
          explanation: 'Snapshots package an entire operational vertical into a versioned blueprint that can be pushed to any sub-account instantly.',
        },
      },
      {
        id: 'mod-1-4',
        domainId: 'domain-1',
        title: 'TCPA / GDPR Consent Ledger & Cryptographic Audit Trails',
        duration: '25 min',
        level: 'Advanced',
        workspaceRoute: '/consent-ledger',
        workspaceAction: 'Review Consent Ledger',
        summary: 'Enforce legal telecommunications compliance with cryptographic SHA-256 consent logs and immutable opt-in proofs.',
        architectureNotes: `Every outbound SMS, voice call, and marketing campaign checks the Consent Ledger:
- Ingress channels log IP, Timestamp, Form URL, and exact consent checkbox text.
- SHA-256 digital fingerprint guarantees proof cannot be retroactively altered.
- Immediate suppression list enforcement upon receiving STOP/UNSUBSCRIBE keywords.`,
        codeSnippet: `// TCPA Cryptographic Proof Record
interface ConsentProof {
  proofId: 'cst_' + string;
  phoneE164: '+12025550198';
  ingressIp: '198.51.100.42';
  timestampIso: string;
  disclaimerHash: string; // SHA-256 of legal agreement
  optInChannel: 'web_form' | 'qr_inbound' | 'checkout_bump';
  status: 'active' | 'revoked';
}`,
        keyTakeaways: [
          'Carrier compliance (A2P 10DLC) requires verifiable consent proof.',
          'The Consent Ledger provides instant regulatory audit export.',
          'Automatic opt-out keyword processing prevents non-compliant outbound messaging.',
        ],
        quiz: {
          question: 'Why does Operza calculate a SHA-256 hash on consent records in the Consent Ledger?',
          options: [
            'To encrypt the customer password',
            'To provide tamper-evident cryptographic proof of exact opt-in terms for carrier audits',
            'To speed up SQL queries',
            'To generate a phone number',
          ],
          correctIndex: 1,
          explanation: 'Cryptographic hashing provides immutable, verifiable evidence that the subscriber consented to specific messaging terms before any outbound message was sent.',
        },
      },
    ],
  },
  {
    id: 'domain-2',
    number: 2,
    title: 'Core CRM, Pipeline Architecture & Dynamic Segmentation',
    weight: '16% Exam Weight',
    icon: 'users',
    description: 'Design unified customer graphs, manage multi-stage visual kanban deal pipelines, and query dynamic real-time smart lists.',
    modules: [
      {
        id: 'mod-2-1',
        domainId: 'domain-2',
        title: 'Unified Contact Identity & Graph Resolution',
        duration: '25 min',
        level: 'Foundational',
        workspaceRoute: '/contacts',
        workspaceAction: 'Open Contacts & CRM',
        summary: 'Merge omnichannel touches (form submits, calls, emails, Stripe checkouts) into a single unified customer profile.',
        architectureNotes: `Operza resolves customer identities across disparate channels:
- Primary deterministic keys: E.164 normalized phone number & sanitized email.
- Secondary keys: Stripe customer ID, WhatsApp JID, and tracking cookies.
- Real-time event timeline aggregates all interactions across CRM, telephony, and funnels.`,
        codeSnippet: `// Identity Resolution Normalization
function normalizeContactIdentity(raw: RawPayload) {
  return {
    email: raw.email?.trim().toLowerCase(),
    phone: formatE164(raw.phone, raw.countryCode || 'US'),
    tags: Array.from(new Set([...raw.tags, 'source:web_optin'])),
    customValues: sanitizeCustomFields(raw.customValues)
  };
}`,
        keyTakeaways: [
          'Duplicate contacts are automatically merged based on verified identifiers.',
          'Custom values store arbitrary domain-specific metadata (e.g. CRM IDs).',
          'Timeline view shows chronological interaction history across all channels.',
        ],
        quiz: {
          question: 'What happens when a lead submits a web form with a phone number matching an existing contact?',
          options: [
            'A duplicate contact is created and overwrites the old contact',
            'The submission is merged into the existing contact timeline without losing history',
            'The form fails with a validation error',
            'An email is sent asking the user to delete their account',
          ],
          correctIndex: 1,
          explanation: 'Operza automatically merges new incoming interactions into the existing unified contact profile, preserving full chronological history.',
        },
      },
      {
        id: 'mod-2-2',
        domainId: 'domain-2',
        title: 'Smart Lists & SQL-Grade Dynamic Segmentation',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/smart-lists',
        workspaceAction: 'Explore Smart Lists',
        summary: 'Build real-time self-updating audience segments with boolean filters, pipeline stage criteria, and engagement recency.',
        architectureNotes: `Smart Lists evaluate rules dynamically without static batch exports:
- Condition tree supports AND/OR nesting across tags, deal stages, and custom fields.
- Zero-latency query execution feeds directly into broadcast campaigns and 2D workflows.
- Bulk action dispatch allows tagging, SMS broadcasting, or workflow enrollment.`,
        codeSnippet: `// Smart List Dynamic Filter Predicate
const hotLeadsFilter = {
  operator: 'AND',
  predicates: [
    { field: 'dealStage', op: 'in', value: ['proposal_sent', 'negotiation'] },
    { field: 'lastContactDays', op: 'lte', value: 7 },
    { field: 'tags', op: 'contains', value: 'enterprise' }
  ]
};`,
        keyTakeaways: [
          'Contacts dynamically enter and exit Smart Lists as their attributes change.',
          'Smart Lists can trigger autonomous workflow enrollments.',
          'Saved views empower sales reps to focus on high-priority leads.',
        ],
        quiz: {
          question: 'How do Operza Smart Lists differ from static CSV contact lists?',
          options: [
            'Smart Lists only allow 10 contacts',
            'Smart Lists evaluate criteria dynamically in real-time as contact data updates',
            'Smart Lists cannot be used in marketing campaigns',
            'Smart Lists require manual daily re-importing',
          ],
          correctIndex: 1,
          explanation: 'Smart Lists are dynamic queries: contacts automatically enter or exit the list as their tags, deal stages, or activity update in real-time.',
        },
      },
      {
        id: 'mod-2-3',
        domainId: 'domain-2',
        title: 'Visual Kanban Deal Pipelines & Revenue Velocity',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/opportunities',
        workspaceAction: 'Inspect Opportunities Kanban',
        summary: 'Architect custom sales stages, drag-and-drop opportunity cards, and automate stage-transition actions.',
        architectureNotes: `Pipelines drive agency and client sales velocity:
- Visual Kanban board with stage totals and weighted revenue forecasting.
- Automatic stage trigger dispatch: moving a card to "Proposal Sent" can trigger contract generation.
- Lead attribution tracking tracks first-click, last-click, and revenue ROAS.`,
        codeSnippet: `// Opportunity Stage Transition Event
interface StageChangeEvent {
  opportunityId: string;
  previousStage: 'discovery';
  newStage: 'proposal_sent';
  dealValue: 12500;
  assignedUser: 'agent_442';
  timestamp: string;
}`,
        keyTakeaways: [
          'Multiple distinct pipelines can exist per location (e.g. Sales, Onboarding, Renewals).',
          'Drag-and-drop stage updates emit real-time workflow events.',
          'Weighted value forecasts accurately predict month-end revenue.',
        ],
        quiz: {
          question: 'What event is triggered when an operator drags a deal to a new stage in Kanban?',
          options: [
            'The entire database is re-indexed',
            'An opportunity.stage_changed event fires, allowing automated workflow execution',
            'The deal value is automatically reset to zero',
            'The user is logged out of the session',
          ],
          correctIndex: 1,
          explanation: 'Stage transitions emit structured events that trigger automated follow-ups, contract dispatches, or team notifications in real time.',
        },
      },
      {
        id: 'mod-2-4',
        domainId: 'domain-2',
        title: 'B2B Prospecting Engine, Lead Scoring & Enrichment',
        duration: '30 min',
        level: 'Advanced',
        workspaceRoute: '/prospecting',
        workspaceAction: 'Open Prospecting Engine',
        summary: 'Target high-intent B2B accounts, calculate dynamic lead health scores, and automate personalized outbound sequences.',
        architectureNotes: `Prospecting combines demographic data with behavioral intent:
- Company domain lookup extracts technology stack, revenue tier, and executive profiles.
- Intent score increases with page visits, pricing clicks, and email opens.
- Automated qualification rules advance high-score leads directly into sales queues.`,
        codeSnippet: `// Dynamic Lead Score Calculation Formula
function calculateLeadScore(contact: ContactMetrics): number {
  let score = 0;
  if (contact.pricingPageVisits > 2) score += 35;
  if (contact.emailOpenRate > 0.5) score += 20;
  if (contact.companyEmployees > 50) score += 25;
  if (contact.inboundCallDurationSec > 60) score += 20;
  return Math.min(score, 100);
}`,
        keyTakeaways: [
          'Automated enrichment saves hours of manual sales research.',
          'Lead scores prioritize sales reps on the most lucrative deals.',
          'Cold prospects can be nurtured automatically until intent scores spike.',
        ],
        quiz: {
          question: 'What triggers an automatic qualification transition in the Prospecting engine?',
          options: [
            'A random number generator',
            'A lead surpassing the configured dynamic intent score threshold',
            'Deleting the contact from the CRM',
            'Manually clicking refresh 10 times',
          ],
          correctIndex: 1,
          explanation: 'When behavioral interactions push a lead score above the defined threshold, the engine automatically qualifies and routes the prospect.',
        },
      },
    ],
  },
  {
    id: 'domain-3',
    number: 3,
    title: 'Omnichannel Telephony, WebRTC Softphone & 2-Way Messaging',
    weight: '16% Exam Weight',
    icon: 'phone',
    description: 'Configure browser-based WebRTC softphones, Twilio/Telnyx SIP trunking, 2-way SMS/WhatsApp Cloud API, and automated appointment calendars.',
    modules: [
      {
        id: 'mod-3-1',
        domainId: 'domain-3',
        title: 'Browser WebRTC Softphone & Inbound Call Routing',
        duration: '35 min',
        level: 'Intermediate',
        workspaceRoute: '/phone',
        workspaceAction: 'Test Phone System & Softphone',
        summary: 'Deploy real-time audio softphones directly inside the browser with Twilio Voice SDK tokens and call recording.',
        architectureNotes: `WebRTC calling enables call handling without physical desk phones:
- Browser initiates encrypted Opus audio stream via WebRTC to Twilio Voice Gateway.
- Backend generates short-lived capability tokens signed with API credentials.
- Real-time DTMF keypad supports interactive IVR navigation and live transfers.`,
        codeSnippet: `// WebRTC Softphone Session Initialization
const voiceSession = {
  clientIdentity: 'agent_asim',
  capabilityToken: 'eyJhbGciOiJIUzI1Ni...',
  webrtcIceServers: [{ urls: 'stun:global.stun.twilio.com:3478' }],
  codecPreferences: ['opus', 'pcmu'],
  recordingPolicy: 'dual-channel-active'
};`,
        keyTakeaways: [
          'Agents can make and receive calls from any computer with a headset.',
          'Calls are automatically recorded, transcribed, and logged in contact timelines.',
          'Zero desktop software installation required.',
        ],
        quiz: {
          question: 'How does the Operza Phone System establish audio communication in the browser?',
          options: [
            'Using Flash Player audio plugins',
            'Through WebRTC encrypted audio streams authenticated via backend capability tokens',
            'By requiring agents to install a desktop .exe program',
            'Through regular HTTP long-polling',
          ],
          correctIndex: 1,
          explanation: 'Operza uses standard, modern WebRTC audio streams secured by temporary capability tokens generated on the backend.',
        },
      },
      {
        id: 'mod-3-2',
        domainId: 'domain-3',
        title: '2-Way SMS & WhatsApp Cloud Ingress with Delivery Hooks',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/conversations',
        workspaceAction: 'Open Unified Inbox',
        summary: 'Consolidate SMS, MMS, WhatsApp Cloud, and email into a single 2-way conversation thread with delivery receipt status tracking.',
        architectureNotes: `Unified Conversation Hub aggregates multi-provider message feeds:
- Inbound webhooks parse carrier delivery receipts (sent, delivered, read, failed).
- Rich attachments (MMS images, WhatsApp PDF brochures) sync to Media Library.
- Operators can switch between SMS, WhatsApp, and Email within one thread.`,
        codeSnippet: `// Omnichannel Ingress Message Event
interface InboundMessage {
  channel: 'sms' | 'whatsapp' | 'email';
  senderE164: '+14155552671';
  recipientE164: '+18005550199';
  body: 'Can I reschedule my appointment to tomorrow at 3pm?';
  status: 'delivered';
  messageId: 'msg_89f41b2c';
}`,
        keyTakeaways: [
          'Conversations are threaded chronologically regardless of channel.',
          'Read receipts and delivery confirmation provide verified communication status.',
          'Quick snippets allow 1-click canned responses with contact variable substitution.',
        ],
        quiz: {
          question: 'What happens if a customer replies to an SMS on WhatsApp instead?',
          options: [
            'A completely separate customer account is created',
            'The reply is appended to the same unified conversation timeline under the contact',
            'The message is rejected as an unverified channel',
            'The system crashes',
          ],
          correctIndex: 1,
          explanation: 'The Unified Inbox aggregates all communication channels (SMS, WhatsApp, Email, Phone) into a single unified customer timeline.',
        },
      },
      {
        id: 'mod-3-3',
        domainId: 'domain-3',
        title: 'Interactive Voice Response (IVR) & Intelligent Call Routing',
        duration: '35 min',
        level: 'Advanced',
        workspaceRoute: '/phone',
        workspaceAction: 'Inspect IVR Call Trees',
        summary: 'Architect multi-tier phone menus ("Press 1 for Sales, 2 for Support"), time-of-day routing, and ring groups.',
        architectureNotes: `IVR Call Tree execution engine:
- TwiML / SIP call instructions evaluate caller input in milliseconds.
- Time-of-day condition branches: send after-hours callers to Missed Call Text-Back.
- Simultaneous and round-robin ring groups distribute calls across available agents.`,
        codeSnippet: `// IVR Multi-Branch Decision Node
const ivrBranchTree = {
  welcomePrompt: 'Thank you for calling Operza. Please select an option.',
  dtmfGather: {
    timeout: 5,
    numDigits: 1,
    routes: {
      '1': { action: 'ring_group', target: 'sales_team', timeout: 20 },
      '2': { action: 'queue', target: 'technical_support' },
      '*': { action: 'repeat_menu' }
    },
    defaultFallback: { action: 'forward_voicemail', notifySms: true }
  }
};`,
        keyTakeaways: [
          'Missed Call Text-Back instantly recovers 60%+ of lost inbound callers.',
          'Time-of-day rules prevent middle-of-the-night calls to agent mobile phones.',
          'Voicemails are transcribed into text and emailed to assigned account managers.',
        ],
        quiz: {
          question: 'What is "Missed Call Text-Back" and why is it critical for local businesses?',
          options: [
            'It blocks all callers who hang up',
            'It sends an immediate automated SMS apology & booking link when a call is missed',
            'It charges the caller a penalty fee',
            'It redirects the caller to a search engine',
          ],
          correctIndex: 1,
          explanation: 'Missed Call Text-Back automatically sends an SMS within 5 seconds of a missed call, instantly saving the lead before they call a competitor.',
        },
      },
      {
        id: 'mod-3-4',
        domainId: 'domain-3',
        title: '2-Way Calendar Booking, Buffer Logic & Staff Scheduling',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/calendars',
        workspaceAction: 'Manage Calendars & Scheduling',
        summary: 'Sync Google & Outlook calendars with 2-way conflict prevention, custom booking forms, and automated reminder sequences.',
        architectureNotes: `Calendar scheduling architecture:
- 2-way OAuth token sync checks existing busy slots in Google / Outlook in real time.
- Configurable pre- and post-appointment buffer intervals prevent back-to-back fatigue.
- Public embeddable booking widget auto-reschedules and updates deal stages upon booking.`,
        codeSnippet: `// Slot Availability Calculation Request
interface SlotQuery {
  calendarId: 'cal_sales_demo';
  timeZone: 'America/New_York';
  rangeStart: '2026-11-10T09:00:00Z';
  rangeEnd: '2026-11-17T17:00:00Z';
  durationMinutes: 45;
  bufferMinutes: 15;
}`,
        keyTakeaways: [
          'Automatic timezone detection eliminates missed appointment confusion.',
          'Multi-staff round-robin distributes consultations fairly across team members.',
          'Automated SMS reminders 24h and 1h before appointments reduce no-shows to under 5%.',
        ],
        quiz: {
          question: 'How does Operza ensure a sales rep is never double-booked?',
          options: [
            'By requiring customers to call before booking online',
            'By checking 2-way real-time calendar OAuth availability with Google/Outlook before rendering slots',
            'By only allowing 1 booking per day',
            'By manually approving every appointment',
          ],
          correctIndex: 1,
          explanation: 'Operza queries the connected calendar via 2-way OAuth in real-time, instantly blocking out any times where the operator has existing personal or business events.',
        },
      },
    ],
  },
  {
    id: 'domain-4',
    number: 4,
    title: 'Visual Headless CMS, Funnel Engineering & Edge Hosting',
    weight: '18% Exam Weight',
    icon: 'globe',
    description: 'Master drag-and-drop page composition, responsive breakpoints, global symbols, 1-click upsell sales funnels, and edge CDN DNS publishing.',
    modules: [
      {
        id: 'mod-4-1',
        domainId: 'domain-4',
        title: 'Visual Page Builder Architecture & Responsive Block Canvas',
        duration: '35 min',
        level: 'Foundational',
        workspaceRoute: '/websites',
        workspaceAction: 'Launch Websites Builder',
        summary: 'Compose pixel-perfect landing pages and multi-page sites with clean semantic JSON block schemas and zero bloat.',
        architectureNotes: `The Visual Page Builder renders clean CSS without legacy iframe overhead:
- Block tree hierarchy: Section -> Container -> Row -> Column -> Component.
- Real-time preview modes: Desktop (1200px+), Tablet (768px), and Mobile (<480px).
- Typography, color palettes, and spacing inherit from the agency design tokens.`,
        codeSnippet: `// Declarative Page Block Schema
interface PageBlock {
  id: 'blk_hero_01';
  type: 'hero';
  props: {
    headline: 'Scale Your Agency with Autonomous Operations';
    subheadline: 'The complete business operating system engineered for high-growth teams.';
    ctaText: 'Claim Your 14-Day Free Trial';
    ctaTarget: '#checkout-section';
    backgroundGradient: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)';
  };
}`,
        keyTakeaways: [
          'Pure semantic HTML generation achieves 99+ Google PageSpeed scores.',
          'Live canvas updates without requiring slow full-page browser reloads.',
          'Industry template kits provision 5+ complete pages in under 2 seconds.',
        ],
        quiz: {
          question: 'What is the architectural format used to store page layouts in the Operza Builder?',
          options: [
            'Raw monolithic HTML strings with inline styles',
            'Structured declarative JSON block schemas rendered dynamically',
            'Flash SWF binaries',
            'Uncompressed bitmap image slices',
          ],
          correctIndex: 1,
          explanation: 'Operza stores pages as structured JSON component trees, allowing fast dynamic rendering, SEO optimization, and painless template duplication.',
        },
      },
      {
        id: 'mod-4-2',
        domainId: 'domain-4',
        title: 'Global Symbols & Reusable Component Systems',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/websites',
        workspaceAction: 'Manage Global Symbols',
        summary: 'Maintain centralized headers, footers, and CTA sections across 50+ pages with synchronized 1-click updates.',
        architectureNotes: `Global Symbols prevent repetitive maintenance:
- An update made to a Global Navigation Symbol instantly reflects across all linked pages.
- Detach Symbol capability allows creating localized variations without breaking the master.
- Symbol asset caching minimizes server render overhead.`,
        codeSnippet: `// Global Symbol Reference Definition
interface GlobalSymbolRef {
  symbolId: 'sym_primary_nav_v2';
  instances: ['home-page', 'pricing-page', 'features-page', 'about-page'];
  syncStrategy: 'automatic_publish';
  variables: {
    activeNavHighlight: true;
    showNotificationBadge: false;
  };
}`,
        keyTakeaways: [
          'Never edit headers or footers manually across multiple pages.',
          'Symbol changes can be drafted and previewed before publishing live.',
          'Client branding colors propagate through global symbol tokens automatically.',
        ],
        quiz: {
          question: 'What is the primary benefit of using a Global Symbol for website headers?',
          options: [
            'It changes the browser icon',
            'Editing the symbol updates the header across all website pages automatically in one place',
            'It prevents the page from being indexed by search engines',
            'It forces all links to open in a new tab',
          ],
          correctIndex: 1,
          explanation: 'Global Symbols act as master components: editing a symbol once automatically updates every page that references it.',
        },
      },
      {
        id: 'mod-4-3',
        domainId: 'domain-4',
        title: 'High-Converting Sales Funnels & 1-Click Upsell Step Routing',
        duration: '35 min',
        level: 'Intermediate',
        workspaceRoute: '/funnels',
        workspaceAction: 'Open Sales Funnels Hub',
        summary: 'Architect linear conversion funnels with opt-in squeeze pages, 2-step order forms, order bumps, and 1-click OTO post-purchase upsells.',
        architectureNotes: `Funnel step routing logic:
- Step 1 (Squeeze / VSL) -> Step 2 (Checkout + Bump) -> Step 3 (1-Click OTO Upsell) -> Step 4 (Order Confirmation).
- Tokenized Stripe PaymentIntent enables 1-click upsells without re-entering credit card details.
- A/B Split Testing engine divides traffic 50/50 and measures true statistical conversion rate.`,
        codeSnippet: `// 1-Click Upsell Execution Contract
async function executeOneClickUpsell(sessionId: string, upsellOfferId: string) {
  return await api.commerce.chargeVaultedCard({
    originalPaymentIntent: sessionId,
    offerId: upsellOfferId,
    amountCents: 9700,
    itemDescription: 'Executive Masterclass VIP Upgrade'
  });
}`,
        keyTakeaways: [
          'Order bumps on checkouts typically increase Average Order Value (AOV) by 25-35%.',
          '1-click post-purchase upsells charge vaulted cards instantly.',
          'Split testing identifies winning headlines with statistical confidence intervals.',
        ],
        quiz: {
          question: 'How do 1-Click Upsells (OTO) charge customers without asking for credit card numbers again?',
          options: [
            'By storing raw credit card numbers in plaintext database tables',
            'By utilizing secure tokenized Stripe payment methods authorized during initial checkout',
            'By sending a paper invoice through the postal mail',
            'By guessing the card expiration date',
          ],
          correctIndex: 1,
          explanation: 'Modern PCI-compliant 1-click upsells reuse tokenized customer credentials established during the initial checkout transaction with full 3D-Secure approval.',
        },
      },
      {
        id: 'mod-4-4',
        domainId: 'domain-4',
        title: 'Custom Domain DNS, CNAME Routing & Edge CDN Hosting',
        duration: '30 min',
        level: 'Advanced',
        workspaceRoute: '/websites',
        workspaceAction: 'Check Domain & Edge Settings',
        summary: 'Configure apex and subdomain DNS records, automated Let\'s Encrypt SSL certificates, and edge caching for sub-100ms load times.',
        architectureNotes: `Edge hosting architecture:
- Custom domain DNS: CNAME pointing to edge.operza.site or A-record to 76.76.21.21.
- Edge Gateway handles automatic TLS handshake and SSL certificate provisioning.
- Distributed Edge CDN caches static assets globally for zero-latency page loads.`,
        codeSnippet: `// Edge Domain DNS Verification Record
interface DnsVerificationRecord {
  domain: 'portal.myagency.com';
  targetCname: 'edge.operza.site';
  status: 'active' | 'dns_pending' | 'ssl_provisioning';
  sslCertIssuer: "Let's Encrypt Authority X3";
  edgeLatencyP95Ms: 42;
  lastHealthCheckIso: string;
}`,
        keyTakeaways: [
          'SSL certificates renew automatically without manual intervention.',
          'Subdomain provisioning takes effect in seconds with real-time DNS status checks.',
          'Edge caching guarantees resilience during heavy traffic spikes.',
        ],
        quiz: {
          question: 'What DNS record is typically configured to point a custom subdomain (e.g. go.agency.com) to Operza?',
          options: [
            'A TXT record containing a secret passphrase',
            'A CNAME record pointing to edge.operza.site',
            'An MX record pointing to an email server',
            'A PTR reverse lookup record',
          ],
          correctIndex: 1,
          explanation: 'CNAME (Canonical Name) records route subdomains to Operza’s global edge CDN infrastructure where SSL certificates and edge caching are handled automatically.',
        },
      },
    ],
  },
  {
    id: 'domain-5',
    number: 5,
    title: 'Autonomous Workflows, 2D DAG Graphs & AI Swarms',
    weight: '20% Exam Weight',
    icon: 'zap',
    description: 'Design n8n-grade 2D visual automation node graphs, configure Transactional Outbox retry semantics, and deploy the 10-Agent Copilot AI Swarm.',
    modules: [
      {
        id: 'mod-5-1',
        domainId: 'domain-5',
        title: '2D Visual Flow Canvas (n8n-Grade DAG Graph Design)',
        duration: '40 min',
        level: 'Intermediate',
        workspaceRoute: '/workflows',
        workspaceAction: 'Launch 2D Workflow Canvas',
        summary: 'Build complex automation pipelines with interactive pan/zoom canvas, typed node sockets, minimap navigation, and drag-and-drop wiring.',
        architectureNotes: `Operza Workflow Canvas operates on Directed Acyclic Graphs (DAG):
- Trigger Nodes: Inbound Webhooks, Form Submissions, Deal Stage Moves, Call Events.
- Action Nodes: Send SMS, Dispatch WhatsApp, Charge Card, Update Deal, Slack Ping.
- Interactive controls: Infinite canvas with pan/zoom, node search palette, and connection snap.`,
        codeSnippet: `// 2D Flow Node Graph Specification
interface WorkflowDag {
  id: 'wf_lead_accelerator';
  nodes: [
    { id: 'n1', type: 'trigger.form_submitted', position: { x: 100, y: 150 } },
    { id: 'n2', type: 'condition.lead_score', position: { x: 380, y: 150 } },
    { id: 'n3', type: 'action.sms_dispatch', position: { x: 680, y: 80 } },
    { id: 'n4', type: 'action.create_task', position: { x: 680, y: 240 } }
  ];
  edges: [
    { from: 'n1', to: 'n2', sourceHandle: 'out', targetHandle: 'in' },
    { from: 'n2', to: 'n3', sourceHandle: 'true', targetHandle: 'in' },
    { from: 'n2', to: 'n4', sourceHandle: 'false', targetHandle: 'in' }
  ];
}`,
        keyTakeaways: [
          'Visual canvas makes complex branching logic immediately comprehensible.',
          'Live test run tool executes flows with mock payloads directly on the canvas.',
          'Nodes display real-time execution counts and error badges.',
        ],
        quiz: {
          question: 'What graph architecture powers the Operza visual workflow engine?',
          options: [
            'Circular linked loops',
            'Directed Acyclic Graphs (DAG) with typed node inputs and outputs',
            'Flat unordered text files',
            'Simple single-step timers',
          ],
          correctIndex: 1,
          explanation: 'Directed Acyclic Graphs (DAG) allow deterministic execution paths, multi-condition branching, and asynchronous joins without endless circular execution traps.',
        },
      },
      {
        id: 'mod-5-2',
        domainId: 'domain-5',
        title: 'Event Triggers, Branching Logic & Multi-Condition Trees',
        duration: '35 min',
        level: 'Intermediate',
        workspaceRoute: '/workflows',
        workspaceAction: 'Build Branching Rules',
        summary: 'Route execution paths dynamically using nested boolean logic, contact attributes, time-of-day filters, and custom field values.',
        architectureNotes: `Multi-condition evaluation engine:
- If/Else branches evaluate multiple simultaneous outputs (e.g., VIP, Standard, Inactive).
- Match rules: All conditions met (AND) or Any condition met (OR).
- Type-safe comparison operators: Equals, Contains, Greater Than, Is Within Hours.`,
        codeSnippet: `// Multi-Condition Branch Evaluator
function evaluateBranch(contact: Contact, conditions: Condition[]): string {
  if (contact.customFields.vip_tier === 'platinum' && contact.totalSpend > 5000) {
    return 'branch_white_glove';
  }
  if (isBusinessHours(contact.timezone)) {
    return 'branch_immediate_outreach';
  }
  return 'branch_next_morning_queue';
}`,
        keyTakeaways: [
          'Avoid monolithic workflows by splitting execution across purpose-built branches.',
          'Timezone-aware delays ensure messages arrive when prospects are awake.',
          'Fallback branches gracefully handle unexpected or empty contact fields.',
        ],
        quiz: {
          question: 'What is the purpose of time-of-day condition branches in an SMS workflow?',
          options: [
            'To turn off the computer at night',
            'To ensure marketing messages are only dispatched during compliant daytime business hours',
            'To slow down the internet connection',
            'To delete old messages',
          ],
          correctIndex: 1,
          explanation: 'Time-of-day branches hold or reschedule message dispatches so they arrive during polite, legally compliant waking hours (typically 8am–8pm in the recipient’s local timezone).',
        },
      },
      {
        id: 'mod-5-3',
        domainId: 'domain-5',
        title: 'Wait-for-Webhook Pauses & Transactional Outbox Retries',
        duration: '35 min',
        level: 'Advanced',
        workspaceRoute: '/workflows',
        workspaceAction: 'Inspect Outbox Queues',
        summary: 'Implement resilient long-running workflows that pause execution until an external webhook arrives, backed by Transactional Outbox queues.',
        architectureNotes: `Resilience engineering in Operza workflows:
- Wait-for-Webhook: Suspends execution state in the database with a correlation ID.
- Upon receiving a matching webhook (e.g. DocuSign signed, Stripe charged), execution resumes seamlessly.
- Transactional Outbox guarantees at-least-once delivery with exponential backoff and jitter.`,
        codeSnippet: `// Asynchronous Wait-For-Webhook State
interface WorkflowExecutionState {
  instanceId: 'exec_883a91';
  workflowId: 'wf_contract_fulfillment';
  status: 'paused_awaiting_event';
  correlationKey: 'contract_7721';
  resumeEvent: 'document.signed';
  timeoutHours: 72;
  fallbackAction: 'remind_sales_rep';
}`,
        keyTakeaways: [
          'No thread or server memory is consumed while workflows are in a paused state.',
          'Dead-letter queues capture failed third-party API dispatches for replay.',
          'Exponential backoff prevents rate-limit penalties during downstream API outages.',
        ],
        quiz: {
          question: 'What happens to a workflow that enters a "Wait for Webhook" node?',
          options: [
            'The entire server freezes until the webhook arrives',
            'Its execution state is serialized to the database, freeing all compute until the resume event occurs',
            'The workflow is aborted and marked as failed',
            'It keeps polling the external API every 100 milliseconds',
          ],
          correctIndex: 1,
          explanation: 'Operza suspends the workflow state in persistent storage with an event listener key, consuming zero active compute until the triggering event arrives.',
        },
      },
      {
        id: 'mod-5-4',
        domainId: 'domain-5',
        title: 'Operza Copilot Swarm (10 Specialized Autonomous AI Agents)',
        duration: '40 min',
        level: 'Advanced',
        workspaceRoute: '/copilot-inbox',
        workspaceAction: 'Review Copilot Proposals',
        summary: 'Deploy an autonomous multi-agent swarm across your agency: CRM Architect, Copywriter, Campaign Builder, Telephony Engineer, and more.',
        architectureNotes: `The Copilot Swarm operates on a Human-in-the-Loop proposal model:
- 10 Specialized Agents: CRM Architect, Copywriter, Telephony Engineer, Funnel Designer, Automation Specialist, Billing Ops, Analytics Auditor, Reputation Defender, Security Sentinel, System Orchestrator.
- Agents analyze real-time context and generate actionable proposals with single-click approval.
- Full execution audit log records every agent decision and outcome.`,
        codeSnippet: `// Copilot Swarm Autonomous Proposal Schema
interface CopilotProposal {
  id: 'prop_991f';
  agentRole: 'Reputation Defender';
  confidenceScore: 0.94;
  triggerContext: '1-Star Google Review received on location_4';
  proposedAction: 'Draft empathetic resolution response + dispatch alert to location manager';
  previewPayload: {
    responseText: 'We are so sorry your visit did not meet expectations...';
    priority: 'urgent';
  };
  status: 'pending_approval' | 'executed' | 'rejected';
}`,
        keyTakeaways: [
          'AI agents propose concrete actions instead of generating abstract advice.',
          'Agency owners retain total governance via the Copilot Proposal Inbox.',
          'Autonomous mode can be enabled for verified, repetitive low-risk operations.',
        ],
        quiz: {
          question: 'How does the Operza Copilot Swarm ensure AI safety and prevent unauthorized actions?',
          options: [
            'By requiring all actions to pass through a human-governed Copilot Proposal Inbox before execution',
            'By disabling all AI features',
            'By only running at midnight',
            'By having no access to CRM data',
          ],
          correctIndex: 0,
          explanation: 'The Copilot Swarm generates structured proposals in the Copilot Inbox where human operators review and approve changes with one click before any live modification occurs.',
        },
      },
    ],
  },
  {
    id: 'domain-6',
    number: 6,
    title: 'Unified Commerce, Zapier Suite & Enterprise Integrations',
    weight: '12% Exam Weight',
    icon: 'wallet',
    description: 'Master native Stripe payment processing, client portal memberships, legally binding e-sign contracts, and Zapier REST Hook subscription architecture.',
    modules: [
      {
        id: 'mod-6-1',
        domainId: 'domain-6',
        title: 'Native Stripe Payments, Subscriptions & Order Bump Architecture',
        duration: '35 min',
        level: 'Intermediate',
        workspaceRoute: '/payments',
        workspaceAction: 'Inspect Payments & MRR',
        summary: 'Accept credit cards, Apple Pay, Google Pay, recurring subscription billing, and multi-tier pricing plans with automated dunning.',
        architectureNotes: `Direct Stripe Connect integration:
- Agency platform facilitates payments while child locations connect their own merchant accounts.
- Automated dunning management sends smart retries and SMS alerts when cards expire.
- Product catalog supports one-time products, digital downloads, and tiered recurring MRR.`,
        codeSnippet: `// Stripe Checkout Session Creation
const checkoutSession = {
  mode: 'subscription',
  paymentMethodTypes: ['card'],
  lineItems: [
    { priceId: 'price_agency_starter_monthly', quantity: 1 }
  ],
  orderBump: {
    priceId: 'price_vip_onboarding_addon',
    headline: 'Add VIP Done-For-You Setup (Save 50%)'
  },
  successUrl: 'https://app.operza.site/thank-you?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://app.operza.site/checkout'
};`,
        keyTakeaways: [
          'Support both platform-managed billing and client-direct Stripe accounts.',
          'Automated dunning drastically reduces involuntary churn from expired credit cards.',
          'Real-time revenue metrics update instantly in the Financial Dashboard.',
        ],
        quiz: {
          question: 'What is automated dunning in subscription billing?',
          options: [
            'Charging customers random bonus fees',
            'An automated retry and customer notification sequence when a subscription payment fails',
            'Deleting a customer account immediately after one failed charge',
            'A discount coupon code',
          ],
          correctIndex: 1,
          explanation: 'Automated dunning retries failed card charges with smart scheduling and sends polite SMS/email update links so subscribers can update cards without manual support intervention.',
        },
      },
      {
        id: 'mod-6-2',
        domainId: 'domain-6',
        title: 'Client Portal Hub & Customer Membership Communities',
        duration: '30 min',
        level: 'Intermediate',
        workspaceRoute: '/portal',
        workspaceAction: 'Open Client Portal Hub',
        summary: 'Provide client-facing branded portals where customers view invoices, sign pending documents, book appointments, and access digital course content.',
        architectureNotes: `Client Portal provides authenticated self-service:
- Secure magic link authentication eliminates password reset support tickets.
- White-labeled with client custom logo, brand colors, and custom subdomain.
- Real-time sync with CRM ensures document signatures and payments update immediately.`,
        codeSnippet: `// Client Portal Access Token Payload
interface PortalSession {
  contactId: 'ct_9021';
  locationId: 'loc_742';
  grantedScopes: ['view_invoices', 'sign_contracts', 'access_courses', 'book_appointments'];
  activeEnrollments: ['course_business_scaling_101'];
  expiresAtIso: string;
}`,
        keyTakeaways: [
          'Eliminates back-and-forth emails for invoice copies and booking links.',
          'Magic links provide friction-free mobile access.',
          'Courses support video streaming, PDF downloads, and progress certificates.',
        ],
        quiz: {
          question: 'How do customers securely log into the Operza Client Portal?',
          options: [
            'By answering 20 security questions',
            'Via friction-free branded Magic Links delivered securely to their verified email or SMS',
            'By using a master admin password shared with all users',
            'They cannot log in',
          ],
          correctIndex: 1,
          explanation: 'Operza Client Portal utilizes secure time-limited Magic Links sent directly to the customer’s verified contact details, providing zero-friction instant access.',
        },
      },
      {
        id: 'mod-6-3',
        domainId: 'domain-6',
        title: 'E-Sign Contracts, Dynamic Proposal Tokens & PDF Auditing',
        duration: '35 min',
        level: 'Intermediate',
        workspaceRoute: '/documents',
        workspaceAction: 'Manage Contracts & Agreements',
        summary: 'Generate legally binding digital agreements with contact merge tokens, digital signature capture, and cryptographic signing certificates.',
        architectureNotes: `Contract lifecycle management:
- Dynamic merge fields: {{contact.name}}, {{deal.value}}, {{agency.name}} auto-populate.
- Browser canvas signature pad captures touch/mouse signatures with timestamp.
- Completed contracts compile into sealed PDF audit trails with IP and signer user-agent.`,
        codeSnippet: `// Digital Contract Signing Audit Manifest
interface ContractSignatureManifest {
  documentId: 'doc_retainer_2026';
  signerName: 'Jane Doe';
  signerEmail: 'jane@enterprise.com';
  signaturePngBase64: 'data:image/png;base64,...';
  signingIp: '72.14.201.88';
  signedTimestamp: string;
  sha256IntegrityHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}`,
        keyTakeaways: [
          'Contracts update opportunity stages to "Closed-Won" upon completion.',
          'Automated reminders ensure proposals do not linger unsigned for weeks.',
          'Audit trail provides ESIGN Act and eIDAS regulatory compliance.',
        ],
        quiz: {
          question: 'What happens immediately after a client signs a contract in Operza?',
          options: [
            'The document is lost forever',
            'The contract is sealed with an audit certificate and emits an event that can advance the deal to Closed-Won',
            'The user’s browser window is closed',
            'The contract is deleted',
          ],
          correctIndex: 1,
          explanation: 'Signed contracts generate a cryptographically verifiable completion certificate and emit a `document.signed` event that automatically triggers downstream billing and onboarding flows.',
        },
      },
      {
        id: 'mod-6-4',
        domainId: 'domain-6',
        title: 'Zapier Universal REST Hooks & 24 SaaS Ecosystem Connectors',
        duration: '40 min',
        level: 'Advanced',
        workspaceRoute: '/integrations',
        workspaceAction: 'Explore App Marketplace & Zapier',
        summary: 'Connect Operza to 6,000+ external apps via Zapier Universal REST Hooks, HMAC-SHA256 replay defense, and 24 native verified SaaS connectors.',
        architectureNotes: `Zapier integration architecture:
- 14 Real-time REST Hook Triggers: Instant push notifications with zero polling delay.
- 12 Inbound Zapier Actions: Create contacts, fire workflows, charge invoices, log calls.
- 4 Search Lookups: Find contacts by email, phone, or company with deduplication.
- HMAC-SHA256 signature header prevents malicious webhook spoofing and replay attacks.`,
        codeSnippet: `// Zapier REST Hook Signature Verification
function verifyZapierHookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const calculated = 'sha256=' + hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(signatureHeader));
}`,
        keyTakeaways: [
          'REST Hooks deliver events instantly without waiting for 15-minute polling intervals.',
          'HMAC replay defense guarantees data authenticity.',
          '24 native connectors provide pre-configured integrations for Stripe, Twilio, Slack, and Google.',
        ],
        quiz: {
          question: 'Why are Zapier REST Hooks superior to legacy polling triggers?',
          options: [
            'They cost ten times more',
            'They deliver events instantaneously in real time without polling delay or wasted API quota',
            'They only work on desktop computers',
            'They require manual button clicks for every event',
          ],
          correctIndex: 1,
          explanation: 'REST Hooks use subscription-based event push: when an event occurs in Operza, it is dispatched to Zapier within milliseconds, eliminating 15-minute polling delays and conserving server quota.',
        },
      },
    ],
  },
];

// ─── Certification Exam Questions (12 Comprehensive Scenario Questions) ──
export interface ExamQuestion {
  id: number;
  domain: string;
  scenario: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const CERTIFICATION_EXAM_QUESTIONS: ExamQuestion[] = [
  {
    id: 1,
    domain: 'Multi-Tenant Governance',
    scenario: 'An agency is onboarding 15 new dental clinics this month. Each clinic requires identical funnels, follow-up automations, and custom fields, but their patient records must remain completely isolated.',
    question: 'What is the most efficient and architecturally sound way to roll out these accounts in Operza?',
    options: [
      'Manually rebuild the funnels and workflows 15 times inside one shared database table.',
      'Create 15 Location Workspaces and deploy a master Dental Industry Account Snapshot to all 15 locations.',
      'Export the agency database to CSV files and email them to the clinic receptionists.',
      'Create 15 separate agency master root accounts with distinct Stripe billing subscriptions.',
    ],
    correctIndex: 1,
    explanation: 'Account Snapshots allow agencies to package entire operational blueprints (funnels, workflows, custom fields, SMS templates) and deploy them to newly created Location Workspaces in one click while preserving strict tenant isolation.',
  },
  {
    id: 2,
    domain: 'Multi-Tenant Governance',
    scenario: 'A major mobile telecommunications carrier audits an agency’s outbound SMS marketing campaigns and demands proof of opt-in consent for a batch of telephone numbers.',
    question: 'Where should the agency administrator retrieve tamper-evident proof of consent in Operza?',
    options: [
      'The Media Asset Library image upload folder',
      'The Consent Ledger (TCPA), which stores timestamps, IP addresses, form URLs, and SHA-256 disclaimer hashes',
      'The browser localStorage cache on the sales rep’s laptop',
      'The QR Code designer preview tab',
    ],
    correctIndex: 1,
    explanation: 'The Consent Ledger logs immutable, cryptographically hashed records of every opt-in event, including exact legal disclaimer language, IP address, and timestamp required by telecommunications carriers.',
  },
  {
    id: 3,
    domain: 'CRM & Pipelines',
    scenario: 'A customer who previously opted into an email newsletter submits a new appointment request on a high-ticket consultation funnel using their mobile phone number.',
    question: 'How does Operza handle this incoming interaction?',
    options: [
      'It creates a duplicate contact record with an error flag.',
      'It executes identity resolution, matching the phone or email to the existing contact and merging the appointment into their unified activity timeline.',
      'It deletes the existing contact record and replaces it with the new form submission.',
      'It blocks the submission because the customer already exists.',
    ],
    correctIndex: 1,
    explanation: 'Operza’s unified contact graph merges multiple touchpoints across phone numbers, emails, and identifiers into a single comprehensive contact timeline without data loss.',
  },
  {
    id: 4,
    domain: 'CRM & Pipelines',
    scenario: 'A sales director wants an audience list of all contacts who have an open deal value over $5,000, have not been contacted in the last 5 days, and have the tag "enterprise".',
    question: 'Which tool should the sales director configure?',
    options: [
      'A static CSV export in Excel',
      'A dynamic Smart List with nested condition predicates that updates in real time',
      'A trigger link pointing to Google Drive',
      'A custom white-label branding stylesheet',
    ],
    correctIndex: 1,
    explanation: 'Smart Lists dynamically evaluate criteria in real-time. Contacts automatically appear or disappear from the list as their deal values, activity dates, and tags update.',
  },
  {
    id: 5,
    domain: 'Omnichannel Telephony',
    scenario: 'A dental office receives 25 inbound phone calls daily while the front desk is busy with patients. Over 40% of callers hang up and call a competitor.',
    question: 'Which Operza automation should be deployed immediately to capture these lost opportunities?',
    options: [
      'A 10-day email nurture campaign',
      'A Missed Call Text-Back workflow that triggers an automated personalized SMS apology and online booking link within 5 seconds of a missed call',
      'A paper brochure mailed to the neighborhood',
      'A billing invoice sent through Stripe',
    ],
    correctIndex: 1,
    explanation: 'Missed Call Text-Back automatically detects unanswered inbound calls and fires an instant SMS response with a calendar booking link, immediately recovering prospective clients before they contact a competitor.',
  },
  {
    id: 6,
    domain: 'Omnichannel Telephony',
    scenario: 'A remote agency has 8 account managers across 3 different countries who need to place and receive phone calls using the agency’s US phone numbers.',
    question: 'What infrastructure enables them to place calls without purchasing physical desk phones or VoIP hardware?',
    options: [
      'Personal cell phones with caller ID spoofing apps',
      'The browser-based WebRTC Softphone, authenticated via backend capability tokens with call recording and dial pad controls',
      'Calling an international calling card number',
      'Sending pre-recorded MP3 voicemails through email',
    ],
    correctIndex: 1,
    explanation: 'Operza includes a native browser WebRTC Softphone that connects securely to Twilio Voice SIP trunking, allowing agents to make and receive calls globally with zero hardware setup.',
  },
  {
    id: 7,
    domain: 'Headless CMS & Funnels',
    scenario: 'An agency manages a 12-page website. The client requests a change to the main navigation menu and the footer legal disclaimer across the entire website.',
    question: 'How can the developer make this update across all 12 pages in seconds?',
    options: [
      'Open each of the 12 pages individually and manually retype the links and footer',
      'Edit the Global Symbols for the header and footer, which automatically propagate updates across all linked pages',
      'Delete the website and rebuild it from scratch',
      'Ask website visitors to refresh their browser cache manually',
    ],
    correctIndex: 1,
    explanation: 'Global Symbols act as master reusable components. Modifying the symbol once in the editor instantly publishes the changes across all pages referencing that symbol.',
  },
  {
    id: 8,
    domain: 'Headless CMS & Funnels',
    scenario: 'An e-commerce brand wants to offer a one-time discount on an executive consulting package immediately after a customer purchases a primary ticket, without requiring the customer to re-enter their credit card.',
    question: 'What funnel feature should be implemented?',
    options: [
      'An abandoned cart email sent 3 days later',
      'A 1-Click Post-Purchase Upsell (OTO) step that charges the tokenized Stripe PaymentIntent from the initial checkout',
      'A pop-up modal asking the customer to re-enter their 16-digit card number',
      'A paper order form enclosed in the shipping box',
    ],
    correctIndex: 1,
    explanation: '1-Click Upsell steps securely reuse the authenticated, tokenized payment credentials from the initial checkout transaction, enabling friction-free single-click upgrades.',
  },
  {
    id: 9,
    domain: 'Autonomous Workflows',
    scenario: 'A workflow must send a contract to a prospect, pause execution until the prospect actually signs the document, and then immediately notify the assigned sales rep and provision access.',
    question: 'What node pattern in the 2D Workflow Canvas executes this behavior without wasting server resources?',
    options: [
      'An infinite loop that checks the contract status every 10 seconds',
      'A "Wait for Webhook" node with a correlation ID that serializes execution state to storage and resumes upon receiving the document.signed event',
      'A 30-day fixed delay timer',
      'A manual reminder calendar event',
    ],
    correctIndex: 1,
    explanation: 'Wait-for-Webhook nodes suspend execution state in persistent storage, freeing all server compute while listening for the specific resume event key (such as `document.signed`).',
  },
  {
    id: 10,
    domain: 'Autonomous Workflows',
    scenario: 'An agency administrator notices an urgent 1-star review was posted on a client’s Google Business Profile. The agency wants AI to help draft a professional response and alert the client, but the owner must review before it goes live.',
    question: 'How does the Operza Copilot Swarm handle this scenario safely?',
    options: [
      'The AI automatically deletes the review from Google without telling anyone',
      'The Reputation Defender agent detects the review and creates a detailed proposal in the Copilot Inbox for human review and single-click approval',
      'The AI immediately disables the client’s website',
      'The AI sends an angry email to the reviewer',
    ],
    correctIndex: 1,
    explanation: 'The Copilot Swarm follows a Human-in-the-Loop governance model: specialized agents analyze events and submit actionable proposals to the Copilot Inbox for operator approval before execution.',
  },
  {
    id: 11,
    domain: 'Commerce & Integrations',
    scenario: 'An enterprise client uses a custom ERP system and needs real-time notifications whenever a deal is won or a payment is captured in Operza, without delay.',
    question: 'Which integration architecture should be used?',
    options: [
      'Setting up a cron job to poll the Operza API every 24 hours',
      'Zapier Universal REST Hooks, which dispatch real-time event notifications with HMAC-SHA256 signature verification within milliseconds',
      'Having a virtual assistant manually type records between systems',
      'Exporting monthly spreadsheet reports',
    ],
    correctIndex: 1,
    explanation: 'Zapier Universal REST Hooks provide instantaneous event push dispatches with HMAC signature verification, eliminating polling delays and conserving bandwidth.',
  },
  {
    id: 12,
    domain: 'Commerce & Integrations',
    scenario: 'A client’s monthly subscription payment fails because their credit card expired. The agency wants to prevent involuntary churn without having staff manually chase the client.',
    question: 'What native Operza commerce feature handles this scenario automatically?',
    options: [
      'Canceling the client’s account immediately',
      'Automated smart dunning sequences that retry the card on smart intervals and send branded SMS/email payment update links',
      'Calling the client’s bank directly',
      'Lowering the subscription price to zero',
    ],
    correctIndex: 1,
    explanation: 'Automated dunning retries failed subscription payments using intelligent retry schedules and dispatches self-service card update links to recover revenue automatically.',
  },
];

// ─── Component Implementation ─────────────────────────────────────────
export default function Academy() {
  const { user, agency } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active Tab: 'curriculum' | 'exam' | 'certificate' | 'tracks'
  const activeTab = (searchParams.get('tab') as 'curriculum' | 'exam' | 'certificate' | 'tracks') || 'curriculum';
  const setActiveTab = (tab: 'curriculum' | 'exam' | 'certificate' | 'tracks') => {
    setSearchParams({ tab });
  };

  // Selected Domain & Module State
  const [selectedDomainId, setSelectedDomainId] = useState<string>('domain-1');
  const [activeModule, setActiveModule] = useState<AcademyModule | null>(null);

  // Lesson Knowledge Check Interactive State (inside module modal)
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);

  // Persistent Progress Tracking (localStorage: Set of completed module IDs)
  const [completedModules, setCompletedModules] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('operza_academy_progress');
      return saved ? JSON.parse(saved) : ['mod-1-1', 'mod-2-1']; // Seed starter progress
    } catch {
      return ['mod-1-1', 'mod-2-1'];
    }
  });

  const toggleModuleCompleted = (moduleId: string) => {
    setCompletedModules((prev) => {
      const next = prev.includes(moduleId)
        ? prev.filter((id) => id !== moduleId)
        : [...prev, moduleId];
      try {
        localStorage.setItem('operza_academy_progress', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Exam Simulator State
  const [examStarted, setExamStarted] = useState<boolean>(false);
  const [examAnswers, setExamAnswers] = useState<Record<number, number>>({});
  const [currentExamIndex, setCurrentExamIndex] = useState<number>(0);
  const [examSubmitted, setExamSubmitted] = useState<boolean>(false);
  const [examTimeRemaining, setExamTimeRemaining] = useState<number>(1800); // 30 minutes

  // Timer Effect
  useEffect(() => {
    if (!examStarted || examSubmitted) return;
    const interval = setInterval(() => {
      setExamTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setExamSubmitted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [examStarted, examSubmitted]);

  // Certificate Verification & Customization State
  const [candidateName, setCandidateName] = useState<string>(
    user?.name || (agency?.name ? `${agency.name} Solutions Architect` : 'Asim Tech Architect')
  );
  const [certVerificationId] = useState<string>(() => {
    const saved = localStorage.getItem('operza_cert_id');
    if (saved) return saved;
    const generated = 'OPZ-OCBA-2026-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
      localStorage.setItem('operza_cert_id', generated);
    } catch {}
    return generated;
  });
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Progress Calculation
  const totalModules = useMemo(() => {
    return ACADEMY_DOMAINS.reduce((acc, d) => acc + d.modules.length, 0);
  }, []);

  const progressPercent = Math.round((completedModules.length / totalModules) * 100);

  // Exam Score Calculation
  const examScore = useMemo(() => {
    let correct = 0;
    CERTIFICATION_EXAM_QUESTIONS.forEach((q) => {
      if (examAnswers[q.id] === q.correctIndex) {
        correct++;
      }
    });
    return {
      correct,
      total: CERTIFICATION_EXAM_QUESTIONS.length,
      percentage: Math.round((correct / CERTIFICATION_EXAM_QUESTIONS.length) * 100),
      passed: (correct / CERTIFICATION_EXAM_QUESTIONS.length) >= 0.8,
    };
  }, [examAnswers]);

  const activeDomain = ACADEMY_DOMAINS.find((d) => d.id === selectedDomainId) || ACADEMY_DOMAINS[0];

  const handleCopyVerificationUrl = () => {
    const url = `${window.location.origin}/certification?id=${certVerificationId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyFeedback('Verification URL copied to clipboard!');
      setTimeout(() => setCopyFeedback(null), 3000);
    });
  };

  const handlePrintCertificate = () => {
    window.print();
  };

  return (
    <div className="atlas-dashboard" style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* ─── Hero Header & Certification Banner ─── */}
      <div
        className="card"
        style={{
          padding: '28px 32px',
          background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.12) 0%, rgba(14, 165, 233, 0.08) 100%)',
          border: '1px solid rgba(79, 70, 229, 0.28)',
          borderRadius: 'var(--r-lg)',
          marginBottom: 24,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div className="row row--between" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    background: 'var(--accent)',
                    color: '#ffffff',
                    padding: '3px 9px',
                    borderRadius: 99,
                  }}
                >
                  Official Certification Program
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>
                  AWS Skill Builder &amp; Architect Curriculum Standard
                </span>
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: '4px 0 8px', letterSpacing: '-0.02em' }}>
                Operza Cloud Academy &amp; Certification
              </h1>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)', maxWidth: 820, lineHeight: 1.6 }}>
                Master the complete Operza Business Operating System. 6 Knowledge Domains, 24 structured deep-dive modules with hands-on workspace blueprints, scenario quizzes, and the official proctored-grade certification exam.
              </p>
            </div>

            {/* Quick Stats Pill */}
            <div
              style={{
                display: 'flex',
                gap: 16,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                padding: '12px 18px',
                borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>CURRICULUM PROGRESS</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>
                  {progressPercent}% <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>({completedModules.length}/{totalModules} Modules)</span>
                </div>
              </div>
              <div style={{ width: 1, background: 'var(--line)' }} />
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>CREDENTIAL STATUS</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: examScore.passed ? '#10b981' : '#f59e0b', marginTop: 2 }}>
                  {examScore.passed ? 'Certified Architect ✓' : 'Exam Candidate Ready'}
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
              <span>Curriculum Completion</span>
              <span style={{ fontWeight: 700 }}>{completedModules.length} of {totalModules} modules mastered</span>
            </div>
            <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #4f46e5 0%, #06b6d4 100%)',
                  borderRadius: 99,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Navigation Tabs ─── */}
      <div className="segmented" style={{ marginBottom: 24, display: 'inline-flex', padding: 4 }}>
        <button
          type="button"
          onClick={() => setActiveTab('curriculum')}
          className={activeTab === 'curriculum' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', fontSize: 13 }}
        >
          <Icon name="book" size={15} />
          Curriculum &amp; Blueprints (6 Domains)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('exam')}
          className={activeTab === 'exam' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', fontSize: 13 }}
        >
          <Icon name="target" size={15} />
          Official Certification Exam Simulator
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'rgba(79, 70, 229, 0.2)', color: 'var(--accent)', fontWeight: 700 }}>
            12 Questions
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('certificate')}
          className={activeTab === 'certificate' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', fontSize: 13 }}
        >
          <Icon name="award" size={15} />
          Verifiable Digital Certificate
          {examScore.passed && (
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 99, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', fontWeight: 700 }}>
              Passed
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tracks')}
          className={activeTab === 'tracks' ? 'is-active' : ''}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', fontSize: 13 }}
        >
          <Icon name="award" size={15} />
          Certification Tracks &amp; Career Paths
        </button>
      </div>

      {/* ─── TAB 1: CURRICULUM & BLUEPRINTS ─── */}
      {activeTab === 'curriculum' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'flex-start' }}>
          {/* Domain Selector Sidebar */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', padding: '6px 10px', textTransform: 'uppercase' }}>
              Knowledge Domains
            </div>
            <div className="stack" style={{ gap: 4, marginTop: 4 }}>
              {ACADEMY_DOMAINS.map((domain) => {
                const isSelected = domain.id === selectedDomainId;
                const completedInDomain = domain.modules.filter((m) => completedModules.includes(m.id)).length;
                return (
                  <button
                    key={domain.id}
                    type="button"
                    onClick={() => setSelectedDomainId(domain.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 'var(--r-md)',
                      background: isSelected ? 'var(--accent)' : 'transparent',
                      color: isSelected ? '#ffffff' : 'var(--text)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, opacity: isSelected ? 0.9 : 0.6 }}>
                        DOMAIN {domain.number} • {domain.weight}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 99,
                          background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
                          color: isSelected ? '#ffffff' : 'var(--text-2)',
                        }}
                      >
                        {completedInDomain}/{domain.modules.length}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
                      {domain.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Domain Detail & Modules List */}
          <div className="stack" style={{ gap: 20 }}>
            <div className="card" style={{ padding: '20px 24px' }}>
              <div className="row row--between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>
                    Domain {activeDomain.number} Specification
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{activeDomain.title}</h2>
                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)', maxWidth: 700, lineHeight: 1.5 }}>
                    {activeDomain.description}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="badge badge--subtle" style={{ fontSize: 12, fontWeight: 700 }}>
                    {activeDomain.weight}
                  </span>
                  <span className="badge badge--subtle" style={{ fontSize: 12 }}>
                    {activeDomain.modules.length} Deep-Dive Modules
                  </span>
                </div>
              </div>
            </div>

            {/* Modules Grid */}
            <div className="stack" style={{ gap: 14 }}>
              {activeDomain.modules.map((module, idx) => {
                const isDone = completedModules.includes(module.id);
                return (
                  <div
                    key={module.id}
                    className="card"
                    style={{
                      padding: '20px 24px',
                      borderLeft: isDone ? '4px solid #10b981' : '4px solid var(--accent)',
                      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                    }}
                  >
                    <div className="row row--between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 280 }}>
                        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)' }}>
                            MODULE {activeDomain.number}.{idx + 1}
                          </span>
                          <span
                            className="badge"
                            style={{
                              fontSize: 10.5,
                              padding: '2px 7px',
                              background: module.level === 'Foundational' ? 'rgba(16, 185, 129, 0.12)' : module.level === 'Intermediate' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)',
                              color: module.level === 'Foundational' ? '#10b981' : module.level === 'Intermediate' ? '#3b82f6' : '#a855f7',
                              fontWeight: 700,
                            }}
                          >
                            {module.level}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>⏱ {module.duration}</span>
                        </div>
                        <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 6px' }}>{module.title}</h3>
                        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.5 }}>
                          {module.summary}
                        </p>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {module.keyTakeaways.map((takeaway, tIdx) => (
                            <span
                              key={tIdx}
                              style={{
                                fontSize: 11.5,
                                background: 'var(--surface-2)',
                                padding: '3px 8px',
                                borderRadius: 6,
                                color: 'var(--text-2)',
                                border: '1px solid var(--line)',
                              }}
                            >
                              ✓ {takeaway}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => {
                            setActiveModule(module);
                            setQuizAnswer(null);
                            setQuizSubmitted(false);
                          }}
                          style={{ minWidth: 150, justifyContent: 'center' }}
                        >
                          <Icon name="book" size={14} />
                          Study Module &amp; Lab
                        </button>

                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => toggleModuleCompleted(module.id)}
                          style={{
                            fontSize: 12,
                            color: isDone ? '#10b981' : 'var(--text-3)',
                            fontWeight: isDone ? 700 : 500,
                          }}
                        >
                          <Icon name={isDone ? 'check-circle' : 'circle'} size={14} />
                          {isDone ? 'Completed ✓' : 'Mark as Complete'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 2: CERTIFICATION EXAM SIMULATOR ─── */}
      {activeTab === 'exam' && (
        <div className="stack" style={{ gap: 20 }}>
          {!examStarted ? (
            <div className="card" style={{ padding: '32px 40px', maxWidth: 840, margin: '0 auto', textAlign: 'center' }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: 'rgba(79, 70, 229, 0.15)',
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <Icon name="award" size={32} />
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px' }}>
                Operza Certified Business Architect (OCBA-A01)
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 650, margin: '0 auto 24px' }}>
                This 12-question proctored-grade exam assesses your architectural decision-making across all 6 Operza Domains.
                Passing threshold is <strong>80% (10/12 questions correct)</strong> to qualify for your digital credentials and seal.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 16,
                  textAlign: 'left',
                  background: 'var(--surface-2)',
                  padding: '16px 20px',
                  borderRadius: 'var(--r-md)',
                  marginBottom: 28,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>EXAM DURATION</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>30 Minutes</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>QUESTION COUNT</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>12 Scenario Questions</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>PASSING CRITERIA</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#10b981' }}>80% or Higher</div>
                </div>
              </div>

              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setExamStarted(true);
                  setExamSubmitted(false);
                  setCurrentExamIndex(0);
                  setExamAnswers({});
                  setExamTimeRemaining(1800);
                }}
                style={{ padding: '12px 32px', fontSize: 15, fontWeight: 700 }}
              >
                Launch Exam Simulator →
              </button>
            </div>
          ) : !examSubmitted ? (
            /* Active Exam Question Runner */
            <div className="card" style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
              {/* Exam Header */}
              <div className="row row--between" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 16, marginBottom: 20 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase' }}>
                    Question {currentExamIndex + 1} of {CERTIFICATION_EXAM_QUESTIONS.length}
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    Domain: {CERTIFICATION_EXAM_QUESTIONS[currentExamIndex].domain}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: examTimeRemaining < 300 ? '#ef4444' : 'var(--text)',
                    background: 'var(--surface-2)',
                    padding: '6px 14px',
                    borderRadius: 99,
                    border: '1px solid var(--line)',
                  }}
                >
                  ⏱ Time Left: {Math.floor(examTimeRemaining / 60)}:{(examTimeRemaining % 60).toString().padStart(2, '0')}
                </div>
              </div>

              {/* Scenario & Question Prompt */}
              <div
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  padding: '16px 20px',
                  borderRadius: 'var(--r-md)',
                  marginBottom: 20,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 4 }}>
                  PRODUCTION SCENARIO
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                  {CERTIFICATION_EXAM_QUESTIONS[currentExamIndex].scenario}
                </p>
              </div>

              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, lineHeight: 1.4 }}>
                {CERTIFICATION_EXAM_QUESTIONS[currentExamIndex].question}
              </h3>

              {/* Multiple Choice Options */}
              <div className="stack" style={{ gap: 10, marginBottom: 24 }}>
                {CERTIFICATION_EXAM_QUESTIONS[currentExamIndex].options.map((opt, oIdx) => {
                  const isSelected = examAnswers[CERTIFICATION_EXAM_QUESTIONS[currentExamIndex].id] === oIdx;
                  return (
                    <button
                      key={oIdx}
                      type="button"
                      onClick={() => {
                        setExamAnswers((prev) => ({
                          ...prev,
                          [CERTIFICATION_EXAM_QUESTIONS[currentExamIndex].id]: oIdx,
                        }));
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '12px 18px',
                        borderRadius: 'var(--r-md)',
                        background: isSelected ? 'rgba(79, 70, 229, 0.12)' : 'var(--surface)',
                        border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          border: isSelected ? '6px solid var(--accent)' : '2px solid var(--text-3)',
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      />
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>

              {/* Exam Navigation Bar */}
              <div className="row row--between" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={currentExamIndex === 0}
                  onClick={() => setCurrentExamIndex((p) => p - 1)}
                >
                  ← Previous Question
                </button>

                <div style={{ display: 'flex', gap: 6 }}>
                  {CERTIFICATION_EXAM_QUESTIONS.map((q, idx) => {
                    const answered = examAnswers[q.id] !== undefined;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCurrentExamIndex(idx)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          border: currentExamIndex === idx ? '2px solid var(--accent)' : '1px solid var(--line)',
                          background: answered ? 'rgba(16, 185, 129, 0.2)' : 'var(--surface-2)',
                          color: answered ? '#10b981' : 'var(--text-3)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

                {currentExamIndex < CERTIFICATION_EXAM_QUESTIONS.length - 1 ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setCurrentExamIndex((p) => p + 1)}
                  >
                    Next Question →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ background: '#10b981', borderColor: '#10b981' }}
                    onClick={() => setExamSubmitted(true)}
                  >
                    Submit Exam for Grading ✓
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Exam Results Scorecard */
            <div className="card" style={{ padding: '32px 40px', maxWidth: 840, margin: '0 auto', textAlign: 'center' }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: examScore.passed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: examScore.passed ? '#10b981' : '#ef4444',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <Icon name={examScore.passed ? 'check-circle' : 'alert'} size={36} />
              </div>
              <h2 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>
                {examScore.passed ? 'Congratulations! You Passed the Exam!' : 'Exam Attempt Incomplete'}
              </h2>
              <div style={{ fontSize: 18, fontWeight: 800, color: examScore.passed ? '#10b981' : '#ef4444', marginBottom: 16 }}>
                Score: {examScore.percentage}% ({examScore.correct} of {examScore.total} Questions Correct)
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-2)', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.6 }}>
                {examScore.passed
                  ? 'You have demonstrated comprehensive competence in the Operza Cloud Architecture Standard. Your official verifiable credential is now active.'
                  : 'You scored below the 80% passing threshold. Review the knowledge domains below, study the blueprints, and retake the simulator.'}
              </p>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                {examScore.passed ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setActiveTab('certificate')}
                    style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700 }}
                  >
                    <Icon name="award" size={16} />
                    View &amp; Print Verifiable Certificate →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      setExamStarted(false);
                      setExamSubmitted(false);
                      setExamAnswers({});
                    }}
                    style={{ padding: '10px 24px', fontSize: 14 }}
                  >
                    Review Curriculum &amp; Retake
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setExamStarted(false);
                    setExamSubmitted(false);
                  }}
                >
                  Exit Exam Simulator
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: VERIFIABLE DIGITAL CERTIFICATE ─── */}
      {activeTab === 'certificate' && (
        <div className="stack" style={{ gap: 24, maxWidth: 960, margin: '0 auto' }}>
          {/* Certificate Customization Bar */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <label htmlFor="candidate-name-input" style={{ fontSize: 13, fontWeight: 700 }}>Certificate Recipient Name:</label>
                <input
                  id="candidate-name-input"
                  type="text"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--line)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontSize: 13,
                    minWidth: 260,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleCopyVerificationUrl}
                >
                  <Icon name="link" size={13} />
                  Copy Verification URL
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={handlePrintCertificate}
                >
                  <Icon name="file" size={13} />
                  Print / Save PDF
                </button>
              </div>
            </div>

            {copyFeedback && (
              <div style={{ fontSize: 12, color: '#10b981', marginTop: 8, fontWeight: 600 }}>
                ✓ {copyFeedback}
              </div>
            )}
          </div>

          {/* Official Printable Certificate Canvas */}
          <div
            id="operza-official-certificate"
            style={{
              padding: '48px 56px',
              borderRadius: 16,
              background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #0f172a 100%)',
              color: '#ffffff',
              border: '8px double rgba(199, 210, 254, 0.4)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              position: 'relative',
              textAlign: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Watermark seal behind */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                opacity: 0.04,
                pointerEvents: 'none',
              }}
            >
              <Icon name="award" size={480} />
            </div>

            {/* Header Badge */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 16px',
                  borderRadius: 99,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#c7d2fe',
                }}
              >
                <Icon name="award" size={14} />
                Operza Cloud Architecture Authority
              </div>
            </div>

            <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: '0.04em', margin: '0 0 8px', textTransform: 'uppercase', color: '#f8fafc' }}>
              Certificate of Architectural Excellence
            </h1>
            <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 28px', fontStyle: 'italic' }}>
              This certifies that
            </p>

            {/* Recipient Name */}
            <div
              style={{
                fontSize: 34,
                fontWeight: 800,
                color: '#38bdf8',
                letterSpacing: '-0.01em',
                borderBottom: '2px solid rgba(56, 189, 248, 0.4)',
                display: 'inline-block',
                padding: '0 40px 10px',
                marginBottom: 24,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              {candidateName || 'Operza Architect Candidate'}
            </div>

            <p style={{ fontSize: 14, color: '#cbd5e1', maxWidth: 680, margin: '0 auto 32px', lineHeight: 1.7 }}>
              has successfully fulfilled all curriculum requirements, demonstrated production mastery across 6 knowledge domains, and passed the official proctored examination to earn the distinction of:
            </p>

            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                background: 'linear-gradient(90deg, #818cf8 0%, #38bdf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '0.02em',
                marginBottom: 28,
              }}
            >
              Operza Certified Business Architect (OCBA-A01)
            </div>

            {/* Skills Badges */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 40 }}>
              {['Multi-Tenant Governance', 'Visual 2D Workflows', 'Omnichannel WebRTC', 'Headless CMS', 'Unified Stripe Commerce', 'Zapier REST Hooks'].map((s) => (
                <span
                  key={s}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 99,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#e2e8f0',
                  }}
                >
                  ✓ {s}
                </span>
              ))}
            </div>

            {/* Signature & Verification Seal Footer */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 24,
                alignItems: 'flex-end',
                borderTop: '1px solid rgba(255, 255, 255, 0.12)',
                paddingTop: 24,
                textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>CERTIFICATION ID</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
                  {certVerificationId}
                </div>
                <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>Cryptographically Verified</div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    border: '2px solid #38bdf8',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#38bdf8',
                    margin: '0 auto 6px',
                    boxShadow: '0 0 16px rgba(56, 189, 248, 0.4)',
                  }}
                >
                  <Icon name="award" size={26} />
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Digital Trust Seal
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>ISSUE &amp; EXPIRY</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                  November 2026 – Valid 3 Years
                </div>
                <div style={{ fontSize: 10.5, color: '#10b981', marginTop: 2 }}>Active &amp; In Good Standing</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 4: CERTIFICATION TRACKS & CAREER PATHS ─── */}
      {activeTab === 'tracks' && (
        <div className="stack" style={{ gap: 24 }}>
          <div className="card" style={{ padding: '24px 28px' }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>
              Operza Professional Certification Roadmap
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)', maxWidth: 780, lineHeight: 1.6 }}>
              Modeled after the AWS Certification standard, our tracks equip agency founders, software architects, and automation engineers with industry-recognized credentials that prove hands-on mastery.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
            {CERTIFICATION_TRACKS.map((track) => (
              <div
                key={track.id}
                className="card"
                style={{
                  padding: '24px 28px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderTop: `4px solid ${track.badgeColor}`,
                }}
              >
                <div>
                  <div className="row row--between" style={{ marginBottom: 12 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: `${track.badgeColor}20`,
                        color: track.badgeColor,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {track.code} • {track.level}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{track.duration}</span>
                  </div>

                  <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>{track.title}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, margin: '0 0 16px' }}>
                    {track.description}
                  </p>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>
                      VERIFIED COMPETENCIES
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {track.skills.map((skill) => (
                        <span
                          key={skill}
                          style={{
                            fontSize: 11.5,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: 'var(--surface-2)',
                            border: '1px solid var(--line)',
                            color: 'var(--text-2)',
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => setActiveTab('curriculum')}
                  >
                    Start Certification Curriculum →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── INTERACTIVE MODULE STUDY & LAB MODAL ─── */}
      {activeModule && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setActiveModule(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 880,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 0,
              borderRadius: 'var(--r-lg)',
              background: 'var(--surface)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '20px 28px',
                borderBottom: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--surface-2)',
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase' }}>
                  Interactive Study Module &amp; Lab Blueprint
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: '2px 0 0' }}>{activeModule.title}</h3>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setActiveModule(null)}
                aria-label="Close module"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px 28px' }}>
              {/* Architectural Concept */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 6 }}>
                  1. Core Architectural Concept
                </div>
                <div
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-md)',
                    padding: '14px 18px',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-line',
                    fontFamily: 'inherit',
                  }}
                >
                  {activeModule.architectureNotes}
                </div>
              </div>

              {/* Code / Configuration Snippet */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 6 }}>
                  2. Production Implementation Schema &amp; Contract
                </div>
                <pre
                  style={{
                    background: '#090d16',
                    color: '#e2e8f0',
                    padding: '16px 20px',
                    borderRadius: 'var(--r-md)',
                    fontSize: 12.5,
                    fontFamily: 'Consolas, Monaco, monospace',
                    overflowX: 'auto',
                    lineHeight: 1.5,
                    margin: 0,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <code>{activeModule.codeSnippet}</code>
                </pre>
              </div>

              {/* Hands-On Lab Deep-Link */}
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: 'var(--r-md)',
                  background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.1) 0%, rgba(14, 165, 233, 0.08) 100%)',
                  border: '1px solid rgba(79, 70, 229, 0.3)',
                  marginBottom: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>Hands-On Workspace Practice</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    Practice what you learned directly inside the active Operza workspace environment.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    navigate(activeModule.workspaceRoute);
                    setActiveModule(null);
                  }}
                >
                  <Icon name="external-link" size={13} />
                  {activeModule.workspaceAction} ↗
                </button>
              </div>

              {/* Module Knowledge Check */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 8 }}>
                  3. Module Knowledge Check
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  {activeModule.quiz.question}
                </div>

                <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
                  {activeModule.quiz.options.map((opt, oIdx) => {
                    const isSelected = quizAnswer === oIdx;
                    let bg = 'var(--surface)';
                    let border = '1px solid var(--line)';
                    if (quizSubmitted) {
                      if (oIdx === activeModule.quiz.correctIndex) {
                        bg = 'rgba(16, 185, 129, 0.15)';
                        border = '1px solid #10b981';
                      } else if (isSelected) {
                        bg = 'rgba(239, 68, 68, 0.15)';
                        border = '1px solid #ef4444';
                      }
                    } else if (isSelected) {
                      bg = 'rgba(79, 70, 229, 0.1)';
                      border = '1px solid var(--accent)';
                    }

                    return (
                      <button
                        key={oIdx}
                        type="button"
                        onClick={() => !quizSubmitted && setQuizAnswer(oIdx)}
                        style={{
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderRadius: 'var(--r-md)',
                          background: bg,
                          border: border,
                          color: 'var(--text)',
                          cursor: quizSubmitted ? 'default' : 'pointer',
                          fontSize: 13,
                        }}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>

                {!quizSubmitted ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={quizAnswer === null}
                    onClick={() => setQuizSubmitted(true)}
                  >
                    Check Answer
                  </button>
                ) : (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--r-md)',
                      background: quizAnswer === activeModule.quiz.correctIndex ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      fontSize: 12.5,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>{quizAnswer === activeModule.quiz.correctIndex ? '✓ Correct! ' : '✕ Incorrect. '}</strong>
                    {activeModule.quiz.explanation}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '16px 28px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                justifyContent: 'space-between',
                background: 'var(--surface-2)',
              }}
            >
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setActiveModule(null)}
              >
                Close Lab
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  toggleModuleCompleted(activeModule.id);
                  setActiveModule(null);
                }}
              >
                <Icon name="check-circle" size={14} />
                {completedModules.includes(activeModule.id) ? 'Keep Completed' : 'Complete & Earn Credit ✓'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
