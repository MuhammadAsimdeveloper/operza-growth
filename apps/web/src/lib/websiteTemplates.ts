import type { PageTheme, Site } from './types';
import type { FunnelBlock } from '../components/VisualPageBuilder';

export interface WebsiteTemplate {
  id: string;
  name: string;
  category: string;
  badge: string;
  description: string;
  icon: string;
  theme: PageTheme;
  color: string;
  pages: Array<{
    name: string;
    path: string;
    headline: string;
    subhead: string;
    cta: string;
    theme: PageTheme;
    blocks: FunnelBlock[];
  }>;
  headerNav: Array<{ label: string; url: string }>;
  footerNav: Array<{ label: string; url: string }>;
  ctaLabel: string;
  ctaUrl: string;
}

export const WEBSITE_TEMPLATES: WebsiteTemplate[] = [
  {
    id: 'agency-growth',
    name: 'Digital Agency & Growth Studio',
    category: 'Agency / Marketing',
    badge: 'HIGH-CONVERTING',
    icon: 'zap',
    theme: 'gradient',
    color: '#4f46e5',
    description: 'Complete multi-page agency website with client case studies, retainer pricing packages, service breakdown, and consultation scheduling.',
    ctaLabel: 'Book Free Growth Audit',
    ctaUrl: '/contact',
    headerNav: [
      { label: 'Services', url: '/services' },
      { label: 'Case Studies', url: '/case-studies' },
      { label: 'Retainers', url: '/pricing' },
      { label: 'About', url: '/about' },
      { label: 'Contact', url: '/contact' },
    ],
    footerNav: [
      { label: 'Privacy Policy', url: '/privacy' },
      { label: 'Terms of Service', url: '/terms' },
      { label: 'Client Portal', url: '/portal' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: 'We Build Autonomous Revenue Engines for Scaling Brands',
        subhead: 'Eliminate customer acquisition bottlenecks with full-funnel paid media, high-converting funnel architectures, and automated CRM retention.',
        cta: 'Claim Your Growth Strategy →',
        theme: 'gradient',
        blocks: [
          {
            id: 'b1',
            type: 'headline',
            content: 'We Build Autonomous Revenue Engines for Scaling Brands',
            align: 'center',
          },
          {
            id: 'b2',
            type: 'subheadline',
            content: 'Eliminate customer acquisition bottlenecks with full-funnel paid media, high-converting funnels, and automated CRM retention.',
            align: 'center',
          },
          {
            id: 'b3',
            type: 'countdown',
            content: 'Q2 Strategy Consultations Closing In:',
            countdownMinutes: 20,
            align: 'center',
          },
          {
            id: 'b4',
            type: 'hero_image',
            imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&auto=format&fit=crop&q=80',
            content: 'Proven Agency Architecture & Real-Time Performance Analytics',
            align: 'center',
          },
          {
            id: 'b5',
            type: 'two_columns',
            columnA: '⚡ **Full-Funnel Acquisition**\nWe design, launch, and optimize omnichannel ad campaigns across Meta, Google, and TikTok that generate qualified leads on autopilot.',
            columnB: '🤖 **Automated CRM Workflows**\nInstant SMS reply within 60 seconds, automated calendar scheduling, and automated lead scoring that doubles sales close rates.',
          },
          {
            id: 'b6',
            type: 'testimonials',
            content: 'Working with this agency tripled our monthly qualified leads while cutting our customer acquisition cost by 42%. The ROI has been phenomenal.',
            authorName: 'Elena Rostova',
            authorRole: 'CEO, Apex Ventures',
            rating: 5,
            align: 'center',
          },
          {
            id: 'b7',
            type: 'cta_button',
            buttonText: 'Schedule Free 30-Min Strategy Call →',
            buttonLink: '/contact',
            buttonColor: '#4f46e5',
            align: 'center',
          },
        ],
      },
      {
        name: 'Services',
        path: '/services',
        headline: 'Comprehensive Digital Marketing & Growth Engineering',
        subhead: 'End-to-end execution across paid advertising, high-velocity landing pages, and automated lifecycle marketing.',
        cta: 'Inquire About Services',
        theme: 'plain',
        blocks: [
          {
            id: 'b_srv_1',
            type: 'headline',
            content: 'Specialized Growth Capabilities Engineered for High ROI',
            align: 'center',
          },
          {
            id: 'b_srv_2',
            type: 'two_columns',
            columnA: '🎯 **Performance Paid Advertising**\nTargeted campaigns on Google Ads, Meta, and LinkedIn focused on high-intent buyer acquisition with ROAS safeguards.',
            columnB: '🛠️ **Conversion Rate Optimization**\nHigh-speed landing pages and checkout funnels engineered to convert traffic into booked consultations and revenue.',
          },
          {
            id: 'b_srv_3',
            type: 'two_columns',
            columnA: '📱 **Omnichannel Telephony & Messaging**\nAutomated SMS follow-ups, WhatsApp Cloud messaging, and virtual phone systems that prevent pipeline leakage.',
            columnB: '📊 **Closed-Loop Attribution & Analytics**\nReal-time attribution dashboards giving you clarity on exact CAC and revenue contribution per channel.',
          },
        ],
      },
      {
        name: 'Case Studies',
        path: '/case-studies',
        headline: 'Over $48M+ in Verified Client Revenue Generated',
        subhead: 'Real results from real growth partnerships across B2B SaaS, professional services, and high-ticket ecommerce.',
        cta: 'See Client Case Studies',
        theme: 'plain',
        blocks: [
          {
            id: 'b_cs_1',
            type: 'headline',
            content: 'Measurable Growth Metrics Across 150+ Campaigns',
            align: 'center',
          },
          {
            id: 'b_cs_2',
            type: 'testimonials',
            content: 'They rebuilt our entire customer acquisition funnel and integrated automated WhatsApp workflows. Our pipeline grew from $40k/mo to $220k/mo in 90 days.',
            authorName: 'Marcus Vance',
            authorRole: 'Managing Director, Northstar Group',
            rating: 5,
            align: 'center',
          },
          {
            id: 'b_cs_3',
            type: 'two_columns',
            columnA: '📈 **SaaS Client Scale: 4.8x ARR**\nScaled inbound demo bookings from 22/month to 105/month using targeted LinkedIn ads and automatic calendar qualification.',
            columnB: '🏥 **Healthcare Practice: +310% Patients**\nAutomated dental appointment recall flows via Twilio SMS, generating $140,000 in recovered treatment pipeline.',
          },
        ],
      },
      {
        name: 'Pricing',
        path: '/pricing',
        headline: 'Transparent Retainer Packages with Zero Lock-In',
        subhead: 'Predictable monthly growth partnerships designed for growing companies. Cancel or pause anytime.',
        cta: 'Select a Retainer Plan',
        theme: 'plain',
        blocks: [
          {
            id: 'b_pr_1',
            type: 'headline',
            content: 'Flexible Engagement Models to Match Your Growth Stage',
            align: 'center',
          },
          {
            id: 'b_pr_2',
            type: 'two_columns',
            columnA: '🚀 **Growth Acceleration ($3,500/mo)**\nIncludes 2 active ad channels, dedicated creative production, landing page optimization, and weekly performance reviews.',
            columnB: '👑 **Full-Stack Enterprise ($6,500/mo)**\nComplete agency team takeover: omnichannel ad spend, CRM automation buildout, video ad production, and daily Slack access.',
          },
          {
            id: 'b_pr_3',
            type: 'cta_button',
            buttonText: 'Book Scope Review Meeting →',
            buttonLink: '/contact',
            buttonColor: '#4f46e5',
            align: 'center',
          },
        ],
      },
      {
        name: 'About',
        path: '/about',
        headline: 'Crafting Modern Growth Systems Since 2020',
        subhead: 'We are a dedicated collective of media buyers, automation engineers, and conversion designers.',
        cta: 'Learn About Our Team',
        theme: 'plain',
        blocks: [
          {
            id: 'b_ab_1',
            type: 'headline',
            content: 'Engineering-First Digital Agency Practice',
            align: 'center',
          },
          {
            id: 'b_ab_2',
            type: 'paragraph',
            content: 'We founded our agency on a simple observation: most marketing campaigns fail not because of ad creatives, but because of broken lead-handling infrastructure. We combine high-performance ad creative with automated CRM response systems that convert.',
            align: 'center',
          },
        ],
      },
      {
        name: 'Contact',
        path: '/contact',
        headline: 'Schedule Your Free Growth Consultation',
        subhead: 'Get a 30-minute teardown of your current customer acquisition funnel and a step-by-step roadmap.',
        cta: 'Submit Growth Inquiry',
        theme: 'plain',
        blocks: [
          {
            id: 'b_cnt_1',
            type: 'headline',
            content: 'Ready to Accelerate Your Customer Acquisition?',
            align: 'center',
          },
          {
            id: 'b_cnt_2',
            type: 'paragraph',
            content: 'Fill out our discovery brief below or email strategy@youragency.com. Our managing partners will review your current metrics and respond within 24 business hours.',
            align: 'center',
          },
        ],
      },
    ],
  },
  {
    id: 'healthcare-clinic',
    name: 'Healthcare, Dental & Wellness Clinic',
    category: 'Healthcare / Medical',
    badge: 'PATIENT-CENTRIC',
    icon: 'shield',
    theme: 'plain',
    color: '#0891b2',
    description: 'Patient-first medical or dental clinic website with online appointment scheduling, treatment guides, doctor bios, and insurance verification.',
    ctaLabel: 'Book Appointment Online',
    ctaUrl: '/book',
    headerNav: [
      { label: 'Treatments', url: '/treatments' },
      { label: 'Doctors', url: '/doctors' },
      { label: 'Patient Info', url: '/patient-portal' },
      { label: 'Book Online', url: '/book' },
    ],
    footerNav: [
      { label: 'HIPAA Compliance', url: '/hipaa' },
      { label: 'Notice of Privacy Practices', url: '/privacy' },
      { label: 'Emergency Contact', url: '/emergency' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: 'Gentle, State-of-the-Art Dental & Healthcare for Your Family',
        subhead: 'Accepting new patients with same-day emergency appointments, digital low-radiation imaging, and personalized compassionate care.',
        cta: 'Schedule Your First Visit Online →',
        theme: 'plain',
        blocks: [
          {
            id: 'h_b1',
            type: 'headline',
            content: 'Modern Healthcare & Family Dentistry with a Gentle Touch',
            align: 'center',
          },
          {
            id: 'h_b2',
            type: 'subheadline',
            content: 'Experience painless treatments, modern digital diagnostics, and comprehensive preventative care for all ages.',
            align: 'center',
          },
          {
            id: 'h_b3',
            type: 'hero_image',
            imageUrl: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=1000&auto=format&fit=crop&q=80',
            content: 'Modern State-of-the-Art Clinical Care Suites',
            align: 'center',
          },
          {
            id: 'h_b4',
            type: 'two_columns',
            columnA: '🦷 **Preventative & Cosmetic Dentistry**\nFrom gentle ultrasonic cleanings to porcelain veneers and professional whitening, we protect and enhance your smile.',
            columnB: '🩺 **Advanced Digital Diagnostics**\nLow-radiation 3D cone-beam tomography and intraoral digital scanning for precise, comfortable evaluations.',
          },
          {
            id: 'h_b5',
            type: 'testimonials',
            content: 'Dr. Sarah and the clinical team are wonderful! As someone with high dental anxiety, their gentle approach made all the difference.',
            authorName: 'David K.',
            authorRole: 'Patient since 2021',
            rating: 5,
            align: 'center',
          },
        ],
      },
      {
        name: 'Treatments',
        path: '/treatments',
        headline: 'Comprehensive Dental & Medical Treatment Procedures',
        subhead: 'Explore our full spectrum of specialized healthcare services from preventative exams to complex restorative surgery.',
        cta: 'View Treatment Plans',
        theme: 'plain',
        blocks: [
          {
            id: 'h_t1',
            type: 'headline',
            content: 'Advanced Treatment Solutions Tailored to You',
            align: 'center',
          },
          {
            id: 'h_t2',
            type: 'two_columns',
            columnA: '🌟 **Restorative Dental Implants**\nPermanent, natural-looking titanium implants that restore full bite functionality and preserve jawbone integrity.',
            columnB: '✨ **Invisalign Clear Orthodontics**\nDiscreet, comfortable alignment therapy for adults and teens with 3D digital simulation before you begin.',
          },
        ],
      },
      {
        name: 'Doctors',
        path: '/doctors',
        headline: 'Meet Our Dedicated Board-Certified Clinical Team',
        subhead: 'Our experienced physicians and dentists combine rigorous academic training with warm, compassionate bedside care.',
        cta: 'Meet The Team',
        theme: 'plain',
        blocks: [
          {
            id: 'h_d1',
            type: 'headline',
            content: 'Over 30+ Years of Combined Clinical Excellence',
            align: 'center',
          },
          {
            id: 'h_d2',
            type: 'two_columns',
            columnA: '👨‍⚕️ **Dr. Sarah Jenkins, DDS, FAGD**\nChief Dental Officer with fellowship honors in restorative implantology and laser periodontics.',
            columnB: '👩‍⚕️ **Dr. Robert Miller, MD**\nSpecialist in preventative family medicine and pediatric wellness with 15+ years serving our community.',
          },
        ],
      },
      {
        name: 'Patient Info',
        path: '/patient-portal',
        headline: 'New Patient Onboarding & Insurance Information',
        subhead: 'We partner with all major PPO insurance networks and provide flexible zero-interest financing options.',
        cta: 'Download Intake Forms',
        theme: 'plain',
        blocks: [
          {
            id: 'h_p1',
            type: 'headline',
            content: 'Seamless, Paperless Patient Experience',
            align: 'center',
          },
          {
            id: 'h_p2',
            type: 'two_columns',
            columnA: '📋 **Digital Check-In via Smartphone**\nComplete your medical history and insurance cards securely from home before your scheduled arrival.',
            columnB: '💳 **In-Network Insurance Partners**\nWe work directly with Delta Dental, MetLife, Cigna, Aetna, and Guardian to maximize your plan benefits.',
          },
        ],
      },
      {
        name: 'Book Appointment',
        path: '/book',
        headline: 'Schedule Your Visit Online in Less Than 2 Minutes',
        subhead: 'Select your preferred doctor, appointment time, and treatment reason. Emergency same-day slots available.',
        cta: 'Confirm Appointment Time',
        theme: 'plain',
        blocks: [
          {
            id: 'h_b_1',
            type: 'headline',
            content: 'Instant Real-Time Appointment Scheduling',
            align: 'center',
          },
          {
            id: 'h_b_2',
            type: 'cta_button',
            buttonText: 'Call Clinic Immediately: (555) 234-5678',
            buttonLink: 'tel:5552345678',
            buttonColor: '#0891b2',
            align: 'center',
          },
        ],
      },
    ],
  },
  {
    id: 'real-estate',
    name: 'Real Estate Brokerage & Luxury Estates',
    category: 'Real Estate / Property',
    badge: 'LUXURY SHOWCASE',
    icon: 'home',
    theme: 'plain',
    color: '#0f172a',
    description: 'Curated real estate portfolio website with featured property showcases, neighborhood guides, agent directory, and instant home valuation lead magnets.',
    ctaLabel: 'Browse Featured Properties',
    ctaUrl: '/properties',
    headerNav: [
      { label: 'Featured Properties', url: '/properties' },
      { label: 'Neighborhoods', url: '/neighborhoods' },
      { label: 'Home Valuation', url: '/valuation' },
      { label: 'Agents', url: '/agents' },
    ],
    footerNav: [
      { label: 'Equal Housing Opportunity', url: '/housing-pledge' },
      { label: 'Terms of Use', url: '/terms' },
      { label: 'MLS Disclaimers', url: '/disclaimers' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: 'Curated Luxury Residences & Architectural Estates',
        subhead: 'Discover premier residential listings, waterfront retreats, and off-market investment properties across the region’s most coveted enclaves.',
        cta: 'Explore Portfolio of Homes →',
        theme: 'plain',
        blocks: [
          {
            id: 're_1',
            type: 'headline',
            content: 'Architectural Excellence. Unrivaled Real Estate Representation.',
            align: 'center',
          },
          {
            id: 're_2',
            type: 'subheadline',
            content: 'Connecting extraordinary clients with exceptional architectural properties since 2012.',
            align: 'center',
          },
          {
            id: 're_3',
            type: 'hero_image',
            imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1000&auto=format&fit=crop&q=80',
            content: 'Private Waterfront Villa — Pacific Palisades Collection',
            align: 'center',
          },
          {
            id: 're_4',
            type: 'two_columns',
            columnA: '🏡 **Private Off-Market Access**\nExclusive representation for high-net-worth sellers providing discreet marketing without public MLS listing exposure.',
            columnB: '📊 **Precision Market Intelligence**\nMicro-neighborhood pricing data, historical appreciation benchmarks, and proprietary absorption rate tracking.',
          },
        ],
      },
      {
        name: 'Featured Properties',
        path: '/properties',
        headline: 'Featured Luxury Residences & Architectural Homes',
        subhead: 'View high-definition virtual tours, floor plans, and architectural specifications for our active portfolio.',
        cta: 'Schedule Private Showing',
        theme: 'plain',
        blocks: [
          {
            id: 're_p1',
            type: 'headline',
            content: 'Current Premier Listings & Estates',
            align: 'center',
          },
          {
            id: 're_p2',
            type: 'two_columns',
            columnA: '🌲 **742 Bel Air Heights · $8,450,000**\n6 Beds, 8 Baths, 7,200 SF. Infinity edge pool, smart home automation, panoramic city light views.',
            columnB: '🌊 **1204 Pacific Coast Highway · $12,900,000**\nPrivate beach access, architect-designed modernist glass pavilion with guest house and wine room.',
          },
        ],
      },
      {
        name: 'Neighborhoods',
        path: '/neighborhoods',
        headline: 'Explore Premier Communities & Micro-Markets',
        subhead: 'In-depth neighborhood guides covering top-rated school districts, private clubs, culinary destinations, and local lifestyle nuances.',
        cta: 'Download Neighborhood Report',
        theme: 'plain',
        blocks: [
          {
            id: 're_n1',
            type: 'headline',
            content: 'Curated Guides to the Region’s Finest Addresses',
            align: 'center',
          },
        ],
      },
      {
        name: 'Home Valuation',
        path: '/valuation',
        headline: 'What Is Your Property Worth in Today’s Market?',
        subhead: 'Receive an exhaustive comparative market analysis (CMA) prepared by our senior managing brokers within 24 hours.',
        cta: 'Request Valuation Analysis',
        theme: 'plain',
        blocks: [
          {
            id: 're_v1',
            type: 'headline',
            content: 'Get a Professional Comparative Market Valuation',
            align: 'center',
          },
          {
            id: 're_v2',
            type: 'cta_button',
            buttonText: 'Submit Property Address for Free CMA →',
            buttonLink: '/valuation',
            buttonColor: '#0f172a',
            align: 'center',
          },
        ],
      },
      {
        name: 'Agents',
        path: '/agents',
        headline: 'Meet Our Managing Brokers & Advisory Partners',
        subhead: 'Uncompromising integrity, discrete representation, and unmatched negotiation acumen.',
        cta: 'Contact an Agent',
        theme: 'plain',
        blocks: [
          {
            id: 're_a1',
            type: 'headline',
            content: 'Over $750M in Career Transaction Volume',
            align: 'center',
          },
        ],
      },
    ],
  },
  {
    id: 'b2b-saas',
    name: 'B2B SaaS & Tech Product',
    category: 'SaaS / Technology',
    badge: 'PRODUCT-LED',
    icon: 'cpu',
    theme: 'dark',
    color: '#6366f1',
    description: 'High-tech dark mode product landing page with interactive node graph simulation, API documentation teasers, security trust seals, and tiered pricing.',
    ctaLabel: 'Start Free 14-Day Trial',
    ctaUrl: '/signup',
    headerNav: [
      { label: 'Capabilities', url: '/features' },
      { label: 'Pricing', url: '/pricing' },
      { label: 'Security', url: '/security' },
      { label: 'Book Demo', url: '/demo' },
    ],
    footerNav: [
      { label: 'API Documentation', url: '/docs' },
      { label: 'Status Page', url: '/status' },
      { label: 'Privacy Policy', url: '/privacy' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: 'The Autonomous Workflow Engine for Modern Enterprise',
        subhead: 'Unify real-time customer data, 2D visual automation graphs, and omnichannel communication pipelines on a resilient PostgreSQL foundation.',
        cta: 'Deploy Production Cluster →',
        theme: 'dark',
        blocks: [
          {
            id: 's_h1',
            type: 'headline',
            content: 'The Autonomous Workflow Engine for Modern Enterprise',
            align: 'center',
          },
          {
            id: 's_h2',
            type: 'subheadline',
            content: 'Unify real-time customer data, 2D visual automation graphs, and omnichannel pipelines on a high-throughput relational foundation.',
            align: 'center',
          },
          {
            id: 's_h3',
            type: 'countdown',
            content: 'Early Access Special Pricing Expires In:',
            countdownMinutes: 24,
            align: 'center',
          },
          {
            id: 's_h4',
            type: 'two_columns',
            columnA: '🔒 **PostgreSQL Row-Level Security**\nNative database-enforced multi-tenant isolation ensures zero cross-tenant data leakage risk.',
            columnB: '⚡ **BullMQ High-Throughput Queue**\nDistributed Redis message broker capable of processing 25,000+ workflow jobs per minute with automatic jitter.',
          },
          {
            id: 's_h5',
            type: 'cta_button',
            buttonText: 'Start Free 14-Day Production Trial →',
            buttonLink: '/signup',
            buttonColor: '#6366f1',
            align: 'center',
          },
        ],
      },
      {
        name: 'Features',
        path: '/features',
        headline: 'Architected for High-Throughput Production Workloads',
        subhead: 'Inspect the technical primitives behind our sub-millisecond event streaming and zero-lock-in data pipeline.',
        cta: 'Explore Feature Architecture',
        theme: 'dark',
        blocks: [
          {
            id: 's_f1',
            type: 'headline',
            content: 'Enterprise Architecture Specifications',
            align: 'center',
          },
        ],
      },
      {
        name: 'Pricing',
        path: '/pricing',
        headline: 'Transparent, Predictable Developer & Team Pricing',
        subhead: 'Simple tiers starting at just $35/month. Zero per-user penalty taxes. Unlimited team seats on every plan.',
        cta: 'Select SaaS Plan',
        theme: 'dark',
        blocks: [
          {
            id: 's_p1',
            type: 'headline',
            content: 'Plans Starting at $35 / Month',
            align: 'center',
          },
          {
            id: 's_p2',
            type: 'two_columns',
            columnA: '💎 **Starter ($35/mo)**\nIdeal for early products: 3 sub-accounts, unlimited team seats, visual automation engine, and CRM pipelines.',
            columnB: '⚡ **Growth ($79/mo)**\nFor scaling platforms: 15 sub-accounts, white-label client portal, WebRTC softphone, and priority support.',
          },
        ],
      },
      {
        name: 'Security',
        path: '/security',
        headline: 'Enterprise Security, Compliance & Data Sovereignty',
        subhead: 'SOC-2 Type II audited, HIPAA BAA compliant, and GDPR isolated. Self-hostable via Docker with standard SQL migrations.',
        cta: 'Download Security Whitepaper',
        theme: 'dark',
        blocks: [
          {
            id: 's_s1',
            type: 'headline',
            content: 'Fail-Closed Security Infrastructure',
            align: 'center',
          },
        ],
      },
      {
        name: 'Request Demo',
        path: '/demo',
        headline: 'Schedule a Guided Technical Architecture Demo',
        subhead: 'Walk through live node graph automations, PostgreSQL RLS schema isolation, and custom API integrations with a systems engineer.',
        cta: 'Schedule Live Walkthrough',
        theme: 'dark',
        blocks: [
          {
            id: 's_d1',
            type: 'headline',
            content: 'Talk Directly with Our Lead Systems Engineers',
            align: 'center',
          },
        ],
      },
    ],
  },
  {
    id: 'home-services',
    name: 'Local Home Services & HVAC Contracting',
    category: 'Trades / Home Services',
    badge: 'LEAD GENERATOR',
    icon: 'tool',
    theme: 'plain',
    color: '#ea580c',
    description: 'Lead-generating website for HVAC, plumbing, roofing, or electrical contractors with 24/7 emergency dispatch banners, quote calculators, and Google reviews.',
    ctaLabel: 'Get Instant Free Estimate',
    ctaUrl: '/quote',
    headerNav: [
      { label: 'Services', url: '/services' },
      { label: 'Emergency 24/7', url: '/emergency' },
      { label: 'Reviews', url: '/reviews' },
      { label: 'Free Quote', url: '/quote' },
    ],
    footerNav: [
      { label: 'Licensed & Insured #HVAC-8842', url: '/license' },
      { label: 'Service Areas', url: '/areas' },
      { label: 'Terms of Service', url: '/terms' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: '24/7 Fast & Reliable Heating, Cooling & Plumbing Specialists',
        subhead: 'Licensed, bonded, and insured technicians ready for same-day dispatch. 100% upfront flat-rate pricing with zero hidden overtime fees.',
        cta: 'Call Now: (555) 839-4822',
        theme: 'plain',
        blocks: [
          {
            id: 'hs_1',
            type: 'headline',
            content: 'Fast, Honest Heating, AC & Plumbing Service in Your Neighborhood',
            align: 'center',
          },
          {
            id: 'hs_2',
            type: 'subheadline',
            content: 'Over 1,400+ 5-star verified homeowner reviews. On-time guarantee or your service call fee is waived!',
            align: 'center',
          },
          {
            id: 'hs_3',
            type: 'hero_image',
            imageUrl: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1000&auto=format&fit=crop&q=80',
            content: 'Certified Master HVAC & Plumbing Specialists Ready for Dispatch',
            align: 'center',
          },
          {
            id: 'hs_4',
            type: 'two_columns',
            columnA: '❄️ **Emergency AC & Furnace Repair**\nRapid 45-minute arrival window for emergency heating and cooling breakdowns. Stocked vans ready to fix it on the spot.',
            columnB: '💧 **Complete Plumbing & Drain Clearing**\nHydro-jetting, trenchless sewer repair, tankless water heater installation, and digital video pipe inspection.',
          },
          {
            id: 'hs_5',
            type: 'testimonials',
            content: 'Our furnace died on a freezing Sunday night. They had a technician at our door in 35 minutes, diagnosed a bad igniter, and had heat back on by 10 PM. Truly lifesavers!',
            authorName: 'Brenda Miller',
            authorRole: 'Verified Homeowner',
            rating: 5,
            align: 'center',
          },
        ],
      },
      {
        name: 'Services',
        path: '/services',
        headline: 'Comprehensive Heating, AC & Plumbing Services',
        subhead: 'Expert installation, maintenance tune-ups, and 24/7 emergency repair for residential and light commercial properties.',
        cta: 'View All Services',
        theme: 'plain',
        blocks: [
          {
            id: 'hs_s1',
            type: 'headline',
            content: 'Full-Spectrum Mechanical Trades & Contracting',
            align: 'center',
          },
        ],
      },
      {
        name: 'Emergency 24/7',
        path: '/emergency',
        headline: 'Need Immediate 24/7 Emergency Dispatch?',
        subhead: 'Call our dedicated emergency operator line immediately. Technicians are on standby across all local zones.',
        cta: 'Call Emergency Dispatch',
        theme: 'plain',
        blocks: [
          {
            id: 'hs_e1',
            type: 'headline',
            content: 'Live Operators Standing By 24 Hours a Day, 365 Days a Year',
            align: 'center',
          },
          {
            id: 'hs_e2',
            type: 'cta_button',
            buttonText: 'Emergency Dispatch Hotline: (555) 839-4822',
            buttonLink: 'tel:5558394822',
            buttonColor: '#ea580c',
            align: 'center',
          },
        ],
      },
      {
        name: 'Reviews',
        path: '/reviews',
        headline: 'What Your Neighbors Say About Our Technicians',
        subhead: 'Read over 1,400+ authentic Google and Angi verified reviews from local homeowners.',
        cta: 'Read Customer Reviews',
        theme: 'plain',
        blocks: [
          {
            id: 'hs_r1',
            type: 'headline',
            content: '4.9 Stars Across 1,400+ Verified Reviews',
            align: 'center',
          },
        ],
      },
      {
        name: 'Free Quote',
        path: '/quote',
        headline: 'Get an Instant Estimate for Your Home Project',
        subhead: 'Tell us about your home and required service. Receive a clear, upfront estimate with no pushy sales pressure.',
        cta: 'Calculate Project Estimate',
        theme: 'plain',
        blocks: [
          {
            id: 'hs_q1',
            type: 'headline',
            content: '100% Upfront Pricing Guarantee — No Surprises',
            align: 'center',
          },
        ],
      },
    ],
  },
  {
    id: 'ecommerce-store',
    name: 'Modern E-Commerce Boutique & Retail',
    category: 'E-Commerce / Retail',
    badge: 'STOREFRONT',
    icon: 'shopping-cart',
    theme: 'plain',
    color: '#059669',
    description: 'Clean artisanal e-commerce storefront with curated product catalog, customer reviews, lookbook collections, and transparent shipping policies.',
    ctaLabel: 'Shop New Arrivals',
    ctaUrl: '/shop',
    headerNav: [
      { label: 'Shop Catalog', url: '/shop' },
      { label: 'Our Story', url: '/story' },
      { label: 'Shipping & FAQ', url: '/faq' },
      { label: 'Contact Us', url: '/contact' },
    ],
    footerNav: [
      { label: '30-Day Return Guarantee', url: '/returns' },
      { label: 'Sustainability Pledge', url: '/sustainability' },
      { label: 'Privacy & Terms', url: '/privacy' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: 'Handcrafted Goods Designed for Intentional Living',
        subhead: 'Explore thoughtfully curated home decor, organic textiles, and heirloom ceramics made in small batches by independent artisans.',
        cta: 'Explore The New Season →',
        theme: 'plain',
        blocks: [
          {
            id: 'ec_1',
            type: 'headline',
            content: 'Artisanal Craftsmanship for Everyday Rituals',
            align: 'center',
          },
          {
            id: 'ec_2',
            type: 'subheadline',
            content: 'Ethically sourced, sustainably crafted goods designed to last a lifetime.',
            align: 'center',
          },
          {
            id: 'ec_3',
            type: 'hero_image',
            imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1000&auto=format&fit=crop&q=80',
            content: 'Spring Artisanal Ceramics & Organic Linen Collection',
            align: 'center',
          },
          {
            id: 'ec_4',
            type: 'two_columns',
            columnA: '🌿 **Sustainable Organic Materials**\nEvery piece is crafted from renewable raw materials, non-toxic vegetable glazes, and recycled packaging.',
            columnB: '📦 **Carbon-Neutral Global Shipping**\nFast, tracked delivery with plastic-free packaging and 100% offset carbon logistics.',
          },
        ],
      },
      {
        name: 'Shop',
        path: '/shop',
        headline: 'The Complete Seasonal Collection',
        subhead: 'Browse handcrafted ceramics, organic kitchenware, linen bedding, and minimalist home scents.',
        cta: 'View All Products',
        theme: 'plain',
        blocks: [
          {
            id: 'ec_s1',
            type: 'headline',
            content: 'Limited Edition Small-Batch Releases',
            align: 'center',
          },
        ],
      },
      {
        name: 'Our Story',
        path: '/story',
        headline: 'Honoring Traditional Craft in a Disposable World',
        subhead: 'Learn about our partner workshops and the multi-generational artisans who shape every vessel.',
        cta: 'Read Our Story',
        theme: 'plain',
        blocks: [
          {
            id: 'ec_st1',
            type: 'headline',
            content: 'Rooted in Purpose, Sourced with Respect',
            align: 'center',
          },
        ],
      },
      {
        name: 'FAQ & Shipping',
        path: '/faq',
        headline: 'Shipping, Care Instructions & Hassle-Free Returns',
        subhead: 'Everything you need to know about our packaging, transit times, and 30-day return policy.',
        cta: 'View FAQ',
        theme: 'plain',
        blocks: [
          {
            id: 'ec_f1',
            type: 'headline',
            content: 'Frequently Asked Customer Questions',
            align: 'center',
          },
        ],
      },
      {
        name: 'Contact',
        path: '/contact',
        headline: 'We Are Always Happy to Help',
        subhead: 'Questions about dimensions, bespoke corporate orders, or order tracking? Reach out to our concierge.',
        cta: 'Send Message to Concierge',
        theme: 'plain',
        blocks: [
          {
            id: 'ec_c1',
            type: 'headline',
            content: 'Dedicated Customer Concierge',
            align: 'center',
          },
        ],
      },
    ],
  },
  {
    id: 'blank-canvas',
    name: 'Blank Canvas (Build from Scratch)',
    category: 'Custom / Blank',
    badge: 'UNRESTRICTED',
    icon: 'layout',
    theme: 'plain',
    color: '#64748b',
    description: 'Start with a clean slate: provides a blank Home and About page ready for custom drag-and-drop visual block layout.',
    ctaLabel: 'Get Started',
    ctaUrl: '/contact',
    headerNav: [
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about' },
      { label: 'Contact', url: '/contact' },
    ],
    footerNav: [
      { label: 'Privacy', url: '/privacy' },
      { label: 'Terms', url: '/terms' },
    ],
    pages: [
      {
        name: 'Home',
        path: '/',
        headline: 'Welcome to Our New Website',
        subhead: 'Open the Visual Builder to customize your headlines, blocks, and media.',
        cta: 'Get Started',
        theme: 'plain',
        blocks: [
          {
            id: 'b_blank_1',
            type: 'headline',
            content: 'Welcome to Our New Website',
            align: 'center',
          },
          {
            id: 'b_blank_2',
            type: 'subheadline',
            content: 'Open the Visual Builder to add elements, customize typography, and connect forms.',
            align: 'center',
          },
        ],
      },
      {
        name: 'About',
        path: '/about',
        headline: 'About Our Organization',
        subhead: 'Add your company mission, team bios, and milestones.',
        cta: 'Contact Us',
        theme: 'plain',
        blocks: [
          {
            id: 'b_blank_3',
            type: 'headline',
            content: 'About Our Organization',
            align: 'center',
          },
        ],
      },
    ],
  },
];

/**
 * Generates a complete, beautiful semantic HTML bundle for all pages on the site,
 * allowing instant 1-click static site export with zero vendor lock-in!
 */
export function generateStaticHtmlExport(site: Site): string {
  const currentYear = new Date().getFullYear();
  const brandName = site.globalHeader?.brandText || site.name;

  const pageHtmlSnippets = site.pages.map((p) => {
    const blocksHtml = (p.blocks || [])
      .map((b) => {
        if (b.type === 'headline') {
          return `<h2 style="font-size:2.2rem;font-weight:800;letter-spacing:-0.03em;margin:1rem 0;text-align:${b.align || 'center'};">${escapeHtml(b.content || '')}</h2>`;
        }
        if (b.type === 'subheadline') {
          return `<p style="font-size:1.15rem;color:#475569;max-width:700px;margin:0 auto 1.5rem;line-height:1.6;text-align:${b.align || 'center'};">${escapeHtml(b.content || '')}</p>`;
        }
        if (b.type === 'hero_image' && b.imageUrl) {
          return `<div style="margin:2rem 0;text-align:center;"><img src="${escapeHtml(b.imageUrl)}" alt="${escapeHtml(b.content || 'Hero')}" style="max-width:100%;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.1);" /></div>`;
        }
        if (b.type === 'two_columns') {
          return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin:2.5rem 0;text-align:left;">
            <div style="background:#f8fafc;padding:1.5rem;border-radius:10px;border:1px solid #e2e8f0;"><p style="white-space:pre-wrap;margin:0;line-height:1.6;">${escapeHtml(b.columnA || '')}</p></div>
            <div style="background:#f8fafc;padding:1.5rem;border-radius:10px;border:1px solid #e2e8f0;"><p style="white-space:pre-wrap;margin:0;line-height:1.6;">${escapeHtml(b.columnB || '')}</p></div>
          </div>`;
        }
        if (b.type === 'testimonials') {
          return `<div style="background:#f1f5f9;border-left:4px solid #4f46e5;padding:1.8rem;border-radius:8px;margin:2rem 0;">
            <p style="font-style:italic;font-size:1.1rem;margin:0 0 1rem;color:#1e293b;">"${escapeHtml(b.content || '')}"</p>
            <strong>${escapeHtml(b.authorName || 'Verified Client')}</strong> — <span style="color:#64748b;">${escapeHtml(b.authorRole || '')}</span>
          </div>`;
        }
        if (b.type === 'paragraph') {
          return `<p style="font-size:1.05rem;color:#334155;line-height:1.7;margin:0 0 1.25rem;text-align:${b.align || 'left'};">${escapeHtml(b.content || '')}</p>`;
        }
        if (b.type === 'countdown') {
          return `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:1rem;text-align:center;margin:1.5rem 0;">
            <span style="font-size:0.85rem;font-weight:700;color:#991b1b;text-transform:uppercase;">${escapeHtml(b.content || '')}</span>
            <div style="font-family:monospace;font-size:1.8rem;font-weight:800;color:#b91c1c;margin-top:0.25rem;">${b.countdownMinutes || 15}:00</div>
          </div>`;
        }
        if (b.type === 'cta_button') {
          return `<div style="text-align:${b.align || 'center'};margin:2rem 0;">
            <a href="${escapeHtml(b.buttonLink || '#')}" style="display:inline-block;padding:12px 28px;background:${b.buttonColor || '#4f46e5'};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">${escapeHtml(b.buttonText || 'Take Action')}</a>
          </div>`;
        }
        return '';
      })
      .join('\n');

    return `<!-- ================= PAGE: ${escapeHtml(p.name)} (${escapeHtml(p.path)}) ================= -->
    <article id="page-${escapeHtml(p.id || p.path.replace(/\//g, '') || 'index')}" class="site-page-container" style="padding:4rem 1.5rem;max-width:1080px;margin:0 auto;border-bottom:1px solid #e2e8f0;">
      <div style="text-align:center;margin-bottom:2.5rem;">
        <span style="font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#4f46e5;background:#eef2ff;padding:4px 12px;border-radius:99px;">${escapeHtml(p.name)}</span>
        <h1 style="font-size:2.6rem;font-weight:850;letter-spacing:-0.03em;color:#0f172a;margin:0.8rem 0;">${escapeHtml(p.headline || p.name)}</h1>
        <p style="font-size:1.2rem;color:#475569;max-width:680px;margin:0 auto;line-height:1.6;">${escapeHtml(p.subhead || '')}</p>
      </div>
      <div class="blocks-stream">
        ${blocksHtml}
      </div>
    </article>`;
  }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(site.seoTitle || site.name)}</title>
  <meta name="description" content="${escapeHtml(site.seoDescription || `Official website for ${site.name}.`)}">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #ffffff; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 1.2rem 2rem; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); z-index: 100; }
    .brand { font-size: 1.25rem; font-weight: 800; color: #0f172a; text-decoration: none; }
    nav a { margin: 0 0.8rem; color: #475569; text-decoration: none; font-size: 0.95rem; font-weight: 550; }
    nav a:hover { color: #4f46e5; }
    footer { padding: 3rem 2rem; border-top: 1px solid #e2e8f0; background: #f8fafc; text-align: center; font-size: 0.9rem; color: #64748b; }
    @media (max-width: 768px) {
      .blocks-stream div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
      header { flex-direction: column; gap: 1rem; }
    }
  </style>
</head>
<body>
  <header>
    <a href="#" class="brand">${escapeHtml(brandName)}</a>
    <nav>
      ${(site.globalHeader?.navLinks || []).map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join(' ')}
      <a href="${escapeHtml(site.globalHeader?.ctaUrl || '#')}" style="padding: 8px 16px; background: #4f46e5; color: #fff; border-radius: 6px; font-weight: 650;">${escapeHtml(site.globalHeader?.ctaLabel || 'Get Started')}</a>
    </nav>
  </header>

  <main>
    ${pageHtmlSnippets}
  </main>

  <footer>
    <p>${escapeHtml(site.globalFooter?.copyrightText || `© ${currentYear} ${site.name}. All rights reserved.`)}</p>
    <div>
      ${(site.globalFooter?.footerLinks || []).map((l) => `<a href="${escapeHtml(l.url)}" style="margin: 0 0.5rem; color: #64748b; text-decoration: none;">${escapeHtml(l.label)}</a>`).join(' · ')}
    </div>
  </footer>
</body>
</html>`;
}

function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
