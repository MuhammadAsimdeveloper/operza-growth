/**
 * ============================================================================
 * Operza Visual In-Browser Funnel, Website & Landing Page Builder
 * ============================================================================
 * 
 * High-performance, element-level WYSIWYG editor for crafting conversion-optimized
 * sales funnels, lead capture pages, and multi-page websites.
 * 
 * Advanced Capabilities:
 * 1. Element Palette: Headlines, paragraphs, hero media, 2-column grids,
 *    urgency countdown timers, high-converting CTAs, order bump modules, and custom HTML.
 * 2. Code Import & Export:
 *    - Export to clean, self-contained, responsive HTML5 + CSS bundle (with 1-click copy & file download).
 *    - Export to JSON schema.
 *    - Import custom HTML or JSON schemas with automatic block parsing.
 * 3. WordPress-Inspired Features:
 *    - Navigation Menu Builder (Header and Footer link reordering and targets).
 *    - Yoast / RankMath Style Google SERP Snippet & Permalink Editor (live Google preview).
 *    - Revisions History & 1-Click Rollback snapshots.
 *    - Custom Header and Footer script injection (<head> and <body>).
 * 4. Responsive Device Preview: Desktop (100%), Tablet (768px), and Mobile (375px).
 */

import { useState, useEffect } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { currency } from '../lib/format';
import { sanitizeCustomHtml } from '../lib/sanitize';

export interface FunnelBlock {
  id: string;
  type:
    | 'headline'
    | 'subheadline'
    | 'paragraph'
    | 'hero_image'
    | 'video'
    | 'cta_button'
    | 'order_bump'
    | 'countdown'
    | 'testimonials'
    | 'two_columns'
    | 'custom_html';
  content?: string;
  subcontent?: string;
  align?: 'left' | 'center' | 'right';
  buttonText?: string;
  buttonLink?: string;
  buttonColor?: string;
  bumpPrice?: number;
  bumpTitle?: string;
  bumpCopy?: string;
  bumpAccepted?: boolean;
  imageUrl?: string;
  videoUrl?: string;
  countdownMinutes?: number;
  rating?: number;
  authorName?: string;
  authorRole?: string;
  columnA?: string;
  columnB?: string;
  htmlCode?: string;
}

export type BuilderElement = FunnelBlock;

export interface MenuItem {
  id: string;
  label: string;
  url: string;
  newTab?: boolean;
}

export interface PageRevision {
  id: string;
  timestamp: string;
  label: string;
  blockCount: number;
  blocks: FunnelBlock[];
}

const DEFAULT_BLOCKS: FunnelBlock[] = [
  {
    id: 'b_head_1',
    type: 'headline',
    content: 'Scale Your Agency With Autonomous Growth Systems',
    align: 'center',
  },
  {
    id: 'b_subhead_1',
    type: 'subheadline',
    content: 'Unlock 3x qualified leads, instant AI qualification, and automated pipeline execution in 7 days.',
    align: 'center',
  },
  {
    id: 'b_countdown_1',
    type: 'countdown',
    content: 'Limited Invitation Special Offer Closes In:',
    countdownMinutes: 15,
    align: 'center',
  },
  {
    id: 'b_hero_1',
    type: 'hero_image',
    imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&auto=format&fit=crop&q=80',
    content: 'Unified Business Automation & AI Operating System',
    align: 'center',
  },
  {
    id: 'b_cols_1',
    type: 'two_columns',
    columnA: '⚡ **Instant Lead Capture**\nCapture visitors via high-converting multi-step forms and AI webchat widgets directly into your CRM.',
    columnB: '🤖 **Autonomous Copilot**\nRespond in seconds with custom trained RAG bots that book meetings and process payments on autopilot.',
  },
  {
    id: 'b_bump_1',
    type: 'order_bump',
    bumpTitle: 'VIP Masterclass & Ready-to-Deploy Agency Blueprints',
    bumpCopy: 'Add our complete 40-template snapshot collection and 1-on-1 onboarding session at 50% discount.',
    bumpPrice: 497,
    bumpAccepted: false,
  },
  {
    id: 'b_cta_1',
    type: 'cta_button',
    buttonText: 'Claim Your Strategy Retainer Now →',
    buttonLink: '#checkout',
    buttonColor: '#4f46e5',
    align: 'center',
  },
  {
    id: 'b_testi_1',
    type: 'testimonials',
    content: '“Operza completely replaced our fragmented stack of 5 tools. Our agency landed 4 new enterprise retainers in our first month.”',
    authorName: 'Marcus Vance',
    authorRole: 'Founder, Apex Growth Partners',
    rating: 5,
    align: 'center',
  },
];

const DEFAULT_MENU_ITEMS: MenuItem[] = [
  { id: 'm_1', label: 'Home', url: '/' },
  { id: 'm_2', label: 'Services', url: '/services' },
  { id: 'm_3', label: 'Pricing', url: '/pricing' },
  { id: 'm_4', label: 'Case Studies', url: '/case-studies' },
  { id: 'm_5', label: 'Contact', url: '/contact' },
];

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generatePageHtml(
  pageName: string,
  blocks: FunnelBlock[],
  options?: {
    metaTitle?: string;
    metaDescription?: string;
    customHead?: string;
    customFooter?: string;
    menuItems?: MenuItem[];
    showNav?: boolean;
  }
): string {
  const title = options?.metaTitle || pageName;
  const desc = options?.metaDescription || 'Engineered with Operza SaaS Website & Funnel Platform';

  const navHtml =
    options?.showNav && options?.menuItems && options.menuItems.length > 0
      ? `
  <header class="opz-header">
    <div class="opz-nav-container">
      <a href="/" class="opz-logo">${escapeHtml(pageName.split('·')[0].trim() || 'Operza')}</a>
      <nav class="opz-nav-links">
        ${options.menuItems
          .map(
            (m) =>
              `<a href="${escapeHtml(m.url)}" ${m.newTab ? 'target="_blank" rel="noopener"' : ''}>${escapeHtml(m.label)}</a>`
          )
          .join('\n        ')}
      </nav>
    </div>
  </header>`
      : '';

  const blocksHtml = blocks
    .map((block) => {
      switch (block.type) {
        case 'headline':
          return `<h1 style="text-align: ${block.align || 'center'}; font-size: 2.5rem; font-weight: 800; line-height: 1.2; margin: 1.5rem 0;">${escapeHtml(
            block.content || ''
          )}</h1>`;
        case 'subheadline':
          return `<p class="opz-subhead" style="text-align: ${block.align || 'center'}; font-size: 1.25rem; color: #475569; max-width: 720px; margin: 0 auto 1.5rem;">${escapeHtml(
            block.content || ''
          )}</p>`;
        case 'paragraph':
          return `<p style="text-align: ${block.align || 'left'}; font-size: 1rem; line-height: 1.7; color: #334155; margin: 1rem 0;">${escapeHtml(
            block.content || ''
          )}</p>`;
        case 'hero_image':
          return `<div style="text-align: center; margin: 2rem 0;"><img src="${escapeHtml(
            block.imageUrl || ''
          )}" alt="${escapeHtml(block.content || 'Hero')}" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);" /></div>`;
        case 'countdown':
          return `
<div class="opz-countdown-box">
  <div class="opz-countdown-title">${escapeHtml(block.content || 'Special Limited-Time Offer Closes In:')}</div>
  <div id="countdown-timer" class="opz-countdown-digits">14:59</div>
</div>`;
        case 'two_columns':
          return `
<div class="opz-grid-2">
  <div class="opz-col-card">${escapeHtml(block.columnA || '')}</div>
  <div class="opz-col-card">${escapeHtml(block.columnB || '')}</div>
</div>`;
        case 'order_bump':
          return `
<div class="opz-order-bump">
  <label style="display: flex; gap: 12px; align-items: flex-start; cursor: pointer;">
    <input type="checkbox" style="width: 20px; height: 20px; margin-top: 3px;" />
    <div>
      <div style="font-weight: 700; color: #0f172a; font-size: 1.05rem;">⚡ ${escapeHtml(
        block.bumpTitle || '1-Click Priority Upgrade'
      )} <span style="color: #15803d; font-weight: 800;">+$${block.bumpPrice || 97}</span></div>
      <p style="margin: 6px 0 0; font-size: 0.9rem; color: #475569; line-height: 1.4;">${escapeHtml(
        block.bumpCopy || ''
      )}</p>
    </div>
  </label>
</div>`;
        case 'cta_button':
          return `
<div style="text-align: ${block.align || 'center'}; margin: 2rem 0;">
  <a href="${escapeHtml(block.buttonLink || '#')}" class="opz-cta-btn" style="background-color: ${
            block.buttonColor || '#4f46e5'
          };">${escapeHtml(block.buttonText || 'Get Started Now →')}</a>
</div>`;
        case 'testimonials':
          return `
<div class="opz-testimonial">
  <div class="opz-stars">★★★★★</div>
  <blockquote style="font-size: 1.1rem; font-style: italic; color: #1e293b; margin: 0 0 12px; line-height: 1.6;">${escapeHtml(
    block.content || ''
  )}</blockquote>
  <div style="font-weight: 700; color: #0f172a;">${escapeHtml(block.authorName || 'Verified Client')}</div>
  <div style="font-size: 0.85rem; color: #64748b;">${escapeHtml(block.authorRole || '')}</div>
</div>`;
        case 'custom_html':
          return `<div class="opz-custom-html">${block.htmlCode || block.content || ''}</div>`;
        default:
          return `<div style="margin: 1rem 0;">${escapeHtml(block.content || '')}</div>`;
      }
    })
    .join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --bg: #ffffff;
      --text: #0f172a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text);
      background-color: #f8fafc;
      line-height: 1.5;
    }
    .opz-header {
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .opz-nav-container {
      max-width: 1080px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .opz-logo {
      font-weight: 800;
      font-size: 1.25rem;
      color: var(--primary);
      text-decoration: none;
    }
    .opz-nav-links {
      display: flex;
      gap: 20px;
    }
    .opz-nav-links a {
      color: #475569;
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 500;
      transition: color 0.15s;
    }
    .opz-nav-links a:hover {
      color: var(--primary);
    }
    .opz-main {
      max-width: 960px;
      margin: 40px auto;
      background: #ffffff;
      padding: 48px;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.06);
    }
    .opz-countdown-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 12px;
      padding: 16px 24px;
      text-align: center;
      margin: 1.5rem 0;
    }
    .opz-countdown-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #991b1b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .opz-countdown-digits {
      font-family: monospace;
      font-size: 2rem;
      font-weight: 800;
      color: #b91c1c;
      letter-spacing: 2px;
      margin-top: 4px;
    }
    .opz-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 2rem 0;
    }
    .opz-col-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      font-size: 0.95rem;
      color: #334155;
      line-height: 1.6;
      white-space: pre-line;
    }
    .opz-order-bump {
      background: #fffbeb;
      border: 2px dashed #f59e0b;
      border-radius: 12px;
      padding: 20px;
      margin: 2rem 0;
    }
    .opz-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 16px 36px;
      color: #ffffff;
      border-radius: 10px;
      font-size: 1.1rem;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 10px 20px -5px rgba(79, 70, 229, 0.4);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .opz-cta-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 24px -5px rgba(79, 70, 229, 0.5);
    }
    .opz-testimonial {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 28px;
      text-align: center;
      margin: 2rem 0;
    }
    .opz-stars {
      color: #eab308;
      font-size: 1.25rem;
      margin-bottom: 8px;
    }
    @media (max-width: 768px) {
      .opz-main { padding: 24px; margin: 16px; }
      .opz-grid-2 { grid-template-columns: 1fr; }
      .opz-nav-links { display: none; }
    }
  </style>
  ${options?.customHead || ''}
</head>
<body>
  ${navHtml}
  <main class="opz-main">
${blocksHtml}
  </main>
  <script>
    (function() {
      var sec = 14 * 60 + 59;
      var el = document.getElementById('countdown-timer');
      if (el) {
        setInterval(function() {
          if (sec > 0) sec--;
          var m = Math.floor(sec / 60);
          var s = sec % 60;
          el.innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }, 1000);
      }
    })();
  </script>
  ${options?.customFooter || ''}
</body>
</html>`;
}

function parseImportedContent(text: string): FunnelBlock[] | null {
  const clean = text.trim();
  if (!clean) return null;

  // 1. Try parsing JSON block schema
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
      return parsed.map((b, i) => ({
        ...b,
        id: b.id || `b_imp_${Date.now()}_${i}`,
      }));
    }
    if (parsed.blocks && Array.isArray(parsed.blocks)) {
      return parsed.blocks.map((b: any, i: number) => ({
        ...b,
        id: b.id || `b_imp_${Date.now()}_${i}`,
      }));
    }
  } catch {
    // Not valid JSON, proceed to HTML parsing
  }

  // 2. Parse HTML text into blocks
  const blocks: FunnelBlock[] = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(clean, 'text/html');

    const main = doc.querySelector('main') || doc.body;
    if (main) {
      // Extract headlines
      const h1s = main.querySelectorAll('h1, h2');
      h1s.forEach((h, i) => {
        const t = h.textContent?.trim();
        if (t) {
          blocks.push({
            id: `b_imp_h_${Date.now()}_${i}`,
            type: i === 0 ? 'headline' : 'subheadline',
            content: t,
            align: 'center',
          });
        }
      });

      // Extract images
      const imgs = main.querySelectorAll('img');
      imgs.forEach((img, i) => {
        const src = img.getAttribute('src');
        if (src) {
          blocks.push({
            id: `b_imp_img_${Date.now()}_${i}`,
            type: 'hero_image',
            imageUrl: src,
            content: img.getAttribute('alt') || 'Imported Image',
          });
        }
      });

      // Extract paragraphs
      const ps = main.querySelectorAll('p');
      ps.forEach((p, i) => {
        const t = p.textContent?.trim();
        if (t && !p.classList.contains('opz-subhead')) {
          blocks.push({
            id: `b_imp_p_${Date.now()}_${i}`,
            type: 'paragraph',
            content: t,
            align: 'left',
          });
        }
      });

      // Extract CTA buttons / links
      const as = main.querySelectorAll('a.opz-cta-btn, .btn, a[href^="http"], a[href^="#"]');
      as.forEach((a, i) => {
        const t = a.textContent?.trim();
        if (t && t.length < 60) {
          blocks.push({
            id: `b_imp_cta_${Date.now()}_${i}`,
            type: 'cta_button',
            buttonText: t,
            buttonLink: a.getAttribute('href') || '#',
            align: 'center',
          });
        }
      });
    }
  } catch {
    // Parser fallback
  }

  // If nothing could be extracted, add as custom_html block
  if (blocks.length === 0) {
    blocks.push({
      id: `b_imp_html_${Date.now()}`,
      type: 'custom_html',
      htmlCode: clean,
      content: 'Custom HTML Block',
    });
  }

  return blocks;
}

export function VisualPageBuilder({
  pageName,
  pagePath,
  initialBlocks,
  onSave,
  onClose,
}: {
  pageName: string;
  pagePath: string;
  initialBlocks?: FunnelBlock[];
  onSave: (blocks: FunnelBlock[]) => void;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<FunnelBlock[]>(
    initialBlocks && initialBlocks.length > 0 ? initialBlocks : DEFAULT_BLOCKS
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isPreview, setIsPreview] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  // WordPress-inspired Navigation Menus
  const [menuItems, setMenuItems] = useState<MenuItem[]>(DEFAULT_MENU_ITEMS);
  const [showNav, setShowNav] = useState(true);

  // Yoast / RankMath Style SEO State
  const [metaTitle, setMetaTitle] = useState(pageName);
  const [metaDescription, setMetaDescription] = useState(
    'Transform your agency growth with autonomous RAG copilots, omnichannel CRM pipelines, and n8n-powered workflow automations.'
  );
  const [permalink, setPermalink] = useState(pagePath.replace(/^\/+/, '') || 'custom-page');
  const [focusKeyword, setFocusKeyword] = useState('agency growth');
  const [robotsIndex, setRobotsIndex] = useState(true);
  const [robotsFollow, setRobotsFollow] = useState(true);
  const [serpView, setSerpView] = useState<'desktop' | 'mobile'>('desktop');

  // WordPress Custom Scripts Injection
  const [customHead, setCustomHead] = useState('');
  const [customFooter, setCustomFooter] = useState('');

  // Revisions History
  const [revisions, setRevisions] = useState<PageRevision[]>([
    {
      id: 'rev_init',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      label: 'Initial Snapshot',
      blockCount: (initialBlocks && initialBlocks.length > 0 ? initialBlocks : DEFAULT_BLOCKS).length,
      blocks: initialBlocks && initialBlocks.length > 0 ? initialBlocks : DEFAULT_BLOCKS,
    },
  ]);

  // Modal Dialogs
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeTab, setCodeTab] = useState<'exportHtml' | 'exportJson' | 'import'>('exportHtml');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [showSeoModal, setShowSeoModal] = useState(false);
  const [showRevisionsModal, setShowRevisionsModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Live countdown timer state for live preview
  const [timeLeft, setTimeLeft] = useState(14 * 60 + 59);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;

  const handleUpdateBlock = (id: string, patch: Partial<FunnelBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const handleAddBlock = (type: FunnelBlock['type']) => {
    const newId = `b_${Date.now()}`;
    let newBlock: FunnelBlock;

    switch (type) {
      case 'headline':
        newBlock = { id: newId, type, content: 'New High-Converting Headline', align: 'center' };
        break;
      case 'subheadline':
        newBlock = { id: newId, type, content: 'Compelling benefit sub-headline supporting the core promise.', align: 'center' };
        break;
      case 'paragraph':
        newBlock = { id: newId, type, content: 'Describe the transformation and specific outcomes clients achieve with your solution.', align: 'left' };
        break;
      case 'hero_image':
        newBlock = { id: newId, type, imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1000&auto=format&fit=crop&q=80', content: 'Product Preview' };
        break;
      case 'cta_button':
        newBlock = { id: newId, type, buttonText: 'Get Started Today →', buttonLink: '#', buttonColor: '#10b981', align: 'center' };
        break;
      case 'order_bump':
        newBlock = { id: newId, type, bumpTitle: '1-Click Priority Upgrade', bumpCopy: 'Get expedited onboarding and direct Slack channel access.', bumpPrice: 199, bumpAccepted: false };
        break;
      case 'countdown':
        newBlock = { id: newId, type, content: 'Special Promotional Pricing Expires In:', countdownMinutes: 10, align: 'center' };
        break;
      case 'testimonials':
        newBlock = { id: newId, type, content: '“The best investment our agency has made this year.”', authorName: 'Sarah Jenkins', authorRole: 'Managing Director', rating: 5, align: 'center' };
        break;
      case 'two_columns':
        newBlock = { id: newId, type, columnA: 'Feature Column A', columnB: 'Feature Column B' };
        break;
      case 'custom_html':
        newBlock = { id: newId, type, content: 'Custom HTML Embed', htmlCode: '<div style="padding: 20px; background: #f1f5f9; border-radius: 8px; text-align: center;">\n  <h3>Custom Embed Widget</h3>\n  <p>Paste third-party widgets, iframes, or custom styling here.</p>\n</div>' };
        break;
      default:
        newBlock = { id: newId, type: 'paragraph', content: 'New Content Block' };
    }

    setBlocks((prev) => [...prev, newBlock]);
    setSelectedBlockId(newId);
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= blocks.length) return;
    const copy = [...blocks];
    const temp = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = temp;
    setBlocks(copy);
  };

  const handleDeleteBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  const handleSaveAndDeploy = () => {
    onSave(blocks);
    // Add to revision timeline
    const rev: PageRevision = {
      id: `rev_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      label: `Revision (${blocks.length} blocks)`,
      blockCount: blocks.length,
      blocks: [...blocks],
    };
    setRevisions((prev) => [rev, ...prev.slice(0, 9)]);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const handleDownloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fullHtmlContent = generatePageHtml(pageName, blocks, {
    metaTitle,
    metaDescription,
    customHead,
    customFooter,
    menuItems,
    showNav,
  });

  const fullJsonContent = JSON.stringify(
    {
      pageName,
      pagePath,
      metaTitle,
      metaDescription,
      permalink,
      blocks,
    },
    null,
    2
  );

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleApplyImport = (mode: 'replace' | 'append') => {
    const parsed = parseImportedContent(importText);
    if (!parsed || parsed.length === 0) {
      setImportStatus('Failed to parse valid HTML or JSON. Please inspect your input.');
      return;
    }
    if (mode === 'replace') {
      setBlocks(parsed);
    } else {
      setBlocks((prev) => [...prev, ...parsed]);
    }
    setImportStatus(`Successfully imported ${parsed.length} block(s)!`);
    setTimeout(() => {
      setShowCodeModal(false);
      setImportStatus(null);
      setImportText('');
    }, 1200);
  };

  // SEO keyword checks
  const kwLower = focusKeyword.trim().toLowerCase();
  const titleHasKw = kwLower && metaTitle.toLowerCase().includes(kwLower);
  const descHasKw = kwLower && metaDescription.toLowerCase().includes(kwLower);
  const contentHasKw =
    kwLower &&
    blocks.some(
      (b) =>
        (b.content && b.content.toLowerCase().includes(kwLower)) ||
        (b.columnA && b.columnA.toLowerCase().includes(kwLower)) ||
        (b.columnB && b.columnB.toLowerCase().includes(kwLower))
    );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Builder Control Bar */}
      <header
        style={{
          height: 56,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onClose} title="Back to Funnel Settings">
            <Icon name="chevron-left" size={17} />
          </button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              {pageName} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({pagePath})</span>
            </div>
            <div className="cell-sub" style={{ fontSize: 11 }}>WYSIWYG Funnel & Website Canvas Engine</div>
          </div>
        </div>

        {/* Viewport Switcher */}
        <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3 }}>
          {[
            { id: 'desktop', icon: 'globe', label: 'Desktop (1200px)' },
            { id: 'tablet', icon: 'clipboard', label: 'Tablet (768px)' },
            { id: 'mobile', icon: 'phone', label: 'Mobile (375px)' },
          ].map((vp) => (
            <button
              key={vp.id}
              className={`btn btn--xs ${viewport === vp.id ? 'btn--primary' : 'btn--subtle'}`}
              style={{ padding: '5px 10px', fontSize: 11, border: 'none' }}
              onClick={() => setViewport(vp.id as any)}
              title={vp.label}
            >
              <Icon name={vp.icon} size={12} />
              {vp.id.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Action Controls & WordPress Features */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            onClick={() => setShowCodeModal(true)}
            title="Import or Export HTML / JSON Code"
          >
            <Icon name="code" size={13} /> Code
          </button>
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            onClick={() => setShowMenuModal(true)}
            title="Manage Navigation Menus"
          >
            <Icon name="sliders" size={13} /> Menus
          </button>
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            onClick={() => setShowSeoModal(true)}
            title="SEO & Google SERP Preview"
          >
            <Icon name="search" size={13} /> SEO
          </button>
          <button
            type="button"
            className="btn btn--subtle btn--sm"
            onClick={() => setShowRevisionsModal(true)}
            title="Version History & Rollback"
          >
            <Icon name="clock" size={13} /> History
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }} />
          <button
            className={`btn btn--sm ${isPreview ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setIsPreview(!isPreview)}
          >
            <Icon name="eye" size={14} /> {isPreview ? 'Exit Preview' : 'Preview'}
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleSaveAndDeploy}>
            <Icon name="check" size={14} /> {savedToast ? 'Saved!' : 'Save & Publish'}
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Palette Sidebar (hidden in preview mode) */}
        {!isPreview && (
          <aside
            style={{
              width: 250,
              background: 'var(--surface)',
              borderRight: '1px solid var(--border)',
              padding: 16,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12 }}>
              Add Page Elements
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {[
                { type: 'headline', label: 'Main Headline', icon: 'file' },
                { type: 'subheadline', label: 'Sub-headline', icon: 'file' },
                { type: 'paragraph', label: 'Text Paragraph', icon: 'edit' },
                { type: 'hero_image', label: 'Hero Image', icon: 'image' },
                { type: 'two_columns', label: '2-Column Grid', icon: 'sliders' },
                { type: 'countdown', label: 'Urgency Countdown', icon: 'clock' },
                { type: 'order_bump', label: '1-Click Order Bump', icon: 'tag' },
                { type: 'cta_button', label: 'High-Converting CTA', icon: 'zap' },
                { type: 'testimonials', label: 'Social Proof Review', icon: 'star' },
                { type: 'custom_html', label: 'Raw HTML / Embed', icon: 'code' },
              ].map((item) => (
                <button
                  key={item.type}
                  className="btn btn--subtle"
                  style={{ width: '100%', justifyContent: 'flex-start', fontSize: 12, padding: '8px 12px' }}
                  onClick={() => handleAddBlock(item.type as any)}
                >
                  <Icon name={item.icon} size={14} /> {item.label}
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Center Live Canvas */}
        <main
          style={{
            flex: 1,
            background: 'var(--bg)',
            overflowY: 'auto',
            padding: isPreview ? '24px 0' : '32px 16px',
            display: 'flex',
            justifyContent: 'center',
          }}
          onClick={() => !isPreview && setSelectedBlockId(null)}
        >
          <div
            style={{
              width: viewport === 'desktop' ? 960 : viewport === 'tablet' ? 680 : 375,
              background: '#fff',
              color: '#0f172a',
              borderRadius: viewport === 'mobile' ? 24 : 12,
              border: '1px solid var(--border)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.08)',
              padding: viewport === 'mobile' ? '24px 16px' : '40px 36px',
              minHeight: '80vh',
              transition: 'width 0.3s ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* WordPress-Style Header Navigation Bar Preview */}
            {showNav && menuItems.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: 20,
                  marginBottom: 24,
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 16, color: '#4f46e5' }}>
                  {pageName.split('·')[0].trim() || 'Operza'}
                </div>
                <div style={{ display: viewport === 'mobile' ? 'none' : 'flex', gap: 16 }}>
                  {menuItems.map((m) => (
                    <a
                      key={m.id}
                      href={m.url}
                      target={m.newTab ? '_blank' : '_self'}
                      rel="noreferrer"
                      style={{ fontSize: 13, color: '#475569', textDecoration: 'none', fontWeight: 500 }}
                      onClick={(e) => e.preventDefault()}
                    >
                      {m.label}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {blocks.map((block, idx) => {
              const isSelected = selectedBlockId === block.id && !isPreview;

              return (
                <div
                  key={block.id}
                  style={{
                    position: 'relative',
                    marginBottom: 24,
                    padding: isPreview ? 0 : 8,
                    borderRadius: 8,
                    outline: isSelected ? '2px solid #4f46e5' : '1px dashed transparent',
                    background: isSelected ? 'rgba(79, 70, 229, 0.02)' : 'transparent',
                    cursor: isPreview ? 'default' : 'pointer',
                  }}
                  onClick={() => !isPreview && setSelectedBlockId(block.id)}
                >
                  {/* Floating Action Controls on Selected Block */}
                  {isSelected && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -32,
                        right: 8,
                        zIndex: 40,
                        display: 'flex',
                        gap: 4,
                        background: '#1e1b4b',
                        padding: '3px 8px',
                        borderRadius: 6,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      }}
                    >
                      <button
                        className="icon-btn"
                        style={{ color: '#fff' }}
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveBlock(idx, 'up');
                        }}
                        title="Move Up"
                      >
                        <Icon name="chevron-up" size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ color: '#fff' }}
                        disabled={idx === blocks.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveBlock(idx, 'down');
                        }}
                        title="Move Down"
                      >
                        <Icon name="chevron-down" size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ color: '#f87171' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBlock(block.id);
                        }}
                        title="Delete Block"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  )}

                  {/* BLOCK RENDERING */}
                  {block.type === 'headline' && (
                    <h1
                      style={{
                        fontSize: viewport === 'mobile' ? 26 : 38,
                        fontWeight: 850,
                        textAlign: block.align || 'center',
                        lineHeight: 1.15,
                        margin: 0,
                        letterSpacing: '-0.03em',
                      }}
                    >
                      {block.content}
                    </h1>
                  )}

                  {block.type === 'subheadline' && (
                    <p
                      style={{
                        fontSize: viewport === 'mobile' ? 15 : 18,
                        color: '#475569',
                        textAlign: block.align || 'center',
                        lineHeight: 1.5,
                        margin: 0,
                        maxWidth: 700,
                        marginLeft: block.align === 'center' ? 'auto' : undefined,
                        marginRight: block.align === 'center' ? 'auto' : undefined,
                      }}
                    >
                      {block.content}
                    </p>
                  )}

                  {block.type === 'countdown' && (
                    <div
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: 12,
                        padding: '14px 20px',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#991b1b',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {block.content}
                      </span>
                      <div
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 28,
                          fontWeight: 800,
                          color: '#b91c1c',
                          letterSpacing: 2,
                        }}
                      >
                        {formatCountdown(timeLeft)}
                      </div>
                    </div>
                  )}

                  {block.type === 'hero_image' && (
                    <div style={{ textAlign: 'center' }}>
                      <img
                        src={block.imageUrl}
                        alt="Hero"
                        style={{
                          width: '100%',
                          maxHeight: 420,
                          objectFit: 'cover',
                          borderRadius: 12,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        }}
                      />
                    </div>
                  )}

                  {block.type === 'two_columns' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: viewport === 'mobile' ? '1fr' : '1fr 1fr',
                        gap: 20,
                      }}
                    >
                      <div style={{ background: '#f8fafc', padding: 20, borderRadius: 10, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                          {block.columnA}
                        </div>
                      </div>
                      <div style={{ background: '#f8fafc', padding: 20, borderRadius: 10, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                          {block.columnB}
                        </div>
                      </div>
                    </div>
                  )}

                  {block.type === 'order_bump' && (
                    <div
                      style={{
                        background: block.bumpAccepted ? '#f0fdf4' : '#fffbeb',
                        border: `2px dashed ${block.bumpAccepted ? '#22c55e' : '#f59e0b'}`,
                        borderRadius: 12,
                        padding: '16px 20px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 14,
                        transition: 'all 0.2s ease',
                      }}
                      onClick={() => handleUpdateBlock(block.id, { bumpAccepted: !block.bumpAccepted })}
                    >
                      <input
                        type="checkbox"
                        checked={block.bumpAccepted || false}
                        onChange={() => {}}
                        style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: 14, color: '#0f172a' }}>⚡ {block.bumpTitle}</strong>
                          <span style={{ fontSize: 15, fontWeight: 800, color: '#15803d' }}>
                            +{currency(block.bumpPrice || 97)}
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#475569', lineHeight: 1.4 }}>
                          {block.bumpCopy}
                        </p>
                      </div>
                    </div>
                  )}

                  {block.type === 'cta_button' && (
                    <div style={{ textAlign: block.align || 'center' }}>
                      <a
                        href={block.buttonLink || '#'}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '16px 36px',
                          background: block.buttonColor || '#4f46e5',
                          color: '#fff',
                          borderRadius: 10,
                          fontSize: 16,
                          fontWeight: 700,
                          textDecoration: 'none',
                          boxShadow: '0 10px 20px -5px rgba(79, 70, 229, 0.4)',
                        }}
                      >
                        {block.buttonText}
                      </a>
                    </div>
                  )}

                  {block.type === 'testimonials' && (
                    <div
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        padding: '24px 28px',
                        textAlign: block.align || 'center',
                      }}
                    >
                      <div style={{ color: '#eab308', fontSize: 18, marginBottom: 8 }}>★★★★★</div>
                      <p style={{ fontSize: 15, fontStyle: 'italic', color: '#1e293b', margin: '0 0 12px', lineHeight: 1.6 }}>
                        {block.content}
                      </p>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{block.authorName}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{block.authorRole}</div>
                    </div>
                  )}

                  {block.type === 'paragraph' && (
                    <p
                      style={{
                        fontSize: 15,
                        color: '#334155',
                        lineHeight: 1.65,
                        textAlign: block.align || 'left',
                        margin: 0,
                      }}
                    >
                      {block.content}
                    </p>
                  )}

                  {block.type === 'custom_html' && (
                    <div
                      dangerouslySetInnerHTML={{ __html: sanitizeCustomHtml(block.htmlCode || block.content || '') }}
                      style={{ margin: '14px 0' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </main>

        {/* Right Property Inspector Panel */}
        {!isPreview && selectedBlock && (
          <aside
            style={{
              width: 280,
              background: 'var(--surface)',
              borderLeft: '1px solid var(--border)',
              padding: 16,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Edit {selectedBlock.type}
              </span>
              <button className="icon-btn" onClick={() => setSelectedBlockId(null)}>
                <Icon name="x" size={14} />
              </button>
            </div>

            <div className="stack" style={{ gap: 14 }}>
              {selectedBlock.content !== undefined && (
                <div>
                  <label className="field-label" style={{ fontSize: 11 }}>Text Content</label>
                  <textarea
                    className="field-input"
                    rows={4}
                    value={selectedBlock.content}
                    onChange={(e) => handleUpdateBlock(selectedBlock.id, { content: e.target.value })}
                  />
                </div>
              )}

              {selectedBlock.align !== undefined && (
                <div>
                  <label className="field-label" style={{ fontSize: 11 }}>Alignment</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['left', 'center', 'right'] as const).map((al) => (
                      <button
                        key={al}
                        type="button"
                        className={`btn btn--xs ${selectedBlock.align === al ? 'btn--primary' : 'btn--subtle'}`}
                        style={{ flex: 1, textTransform: 'capitalize' }}
                        onClick={() => handleUpdateBlock(selectedBlock.id, { align: al })}
                      >
                        {al}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedBlock.type === 'custom_html' && (
                <div>
                  <label className="field-label" style={{ fontSize: 11 }}>Raw HTML / Embed Code</label>
                  <textarea
                    className="field-input"
                    rows={7}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                    value={selectedBlock.htmlCode || ''}
                    onChange={(e) => handleUpdateBlock(selectedBlock.id, { htmlCode: e.target.value })}
                  />
                </div>
              )}

              {selectedBlock.type === 'cta_button' && (
                <>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Button Label</label>
                    <input
                      type="text"
                      className="field-input"
                      value={selectedBlock.buttonText || ''}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { buttonText: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Button Link / Target URL</label>
                    <input
                      type="text"
                      className="field-input"
                      value={selectedBlock.buttonLink || ''}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { buttonLink: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Button Color</label>
                    <input
                      type="color"
                      value={selectedBlock.buttonColor || '#4f46e5'}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { buttonColor: e.target.value })}
                      style={{ width: '100%', height: 36, padding: 0, borderRadius: 6, cursor: 'pointer' }}
                    />
                  </div>
                </>
              )}

              {selectedBlock.type === 'order_bump' && (
                <>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Bump Offer Title</label>
                    <input
                      type="text"
                      className="field-input"
                      value={selectedBlock.bumpTitle || ''}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { bumpTitle: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Bump Price ($)</label>
                    <input
                      type="number"
                      className="field-input"
                      value={selectedBlock.bumpPrice || 0}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { bumpPrice: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Bump Sales Copy</label>
                    <textarea
                      className="field-input"
                      rows={3}
                      value={selectedBlock.bumpCopy || ''}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { bumpCopy: e.target.value })}
                    />
                  </div>
                </>
              )}

              {selectedBlock.type === 'hero_image' && (
                <div>
                  <label className="field-label" style={{ fontSize: 11 }}>Image URL</label>
                  <input
                    type="text"
                    className="field-input"
                    value={selectedBlock.imageUrl || ''}
                    onChange={(e) => handleUpdateBlock(selectedBlock.id, { imageUrl: e.target.value })}
                  />
                </div>
              )}

              {selectedBlock.type === 'two_columns' && (
                <>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Column A Markdown</label>
                    <textarea
                      className="field-input"
                      rows={3}
                      value={selectedBlock.columnA || ''}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { columnA: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Column B Markdown</label>
                    <textarea
                      className="field-input"
                      rows={3}
                      value={selectedBlock.columnB || ''}
                      onChange={(e) => handleUpdateBlock(selectedBlock.id, { columnB: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* MODAL 1: CODE IMPORT & EXPORT */}
      {showCodeModal && (
        <Modal title="Code Import & Export Manager" onClose={() => setShowCodeModal(false)} wide>
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <button
                type="button"
                className={`btn btn--sm ${codeTab === 'exportHtml' ? 'btn--primary' : 'btn--subtle'}`}
                onClick={() => setCodeTab('exportHtml')}
              >
                Export HTML5 & CSS
              </button>
              <button
                type="button"
                className={`btn btn--sm ${codeTab === 'exportJson' ? 'btn--primary' : 'btn--subtle'}`}
                onClick={() => setCodeTab('exportJson')}
              >
                Export JSON Schema
              </button>
              <button
                type="button"
                className={`btn btn--sm ${codeTab === 'import' ? 'btn--primary' : 'btn--subtle'}`}
                onClick={() => setCodeTab('import')}
              >
                Import HTML / JSON
              </button>
            </div>

            {codeTab === 'exportHtml' && (
              <div className="stack" style={{ gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Self-contained, responsive HTML5 document with embedded styling.
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn--subtle btn--sm"
                      onClick={() => handleCopy(fullHtmlContent)}
                    >
                      <Icon name="clipboard" size={13} /> {copiedCode ? 'Copied!' : 'Copy HTML'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => handleDownloadFile('index.html', fullHtmlContent, 'text/html')}
                    >
                      <Icon name="check" size={13} /> Download .html
                    </button>
                  </div>
                </div>
                <textarea
                  className="field-input"
                  rows={15}
                  readOnly
                  style={{ fontFamily: 'monospace', fontSize: 11.5, background: 'var(--surface-2)' }}
                  value={fullHtmlContent}
                />
              </div>
            )}

            {codeTab === 'exportJson' && (
              <div className="stack" style={{ gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Exportable JSON block tree for cross-agency backup and template duplication.
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn--subtle btn--sm"
                      onClick={() => handleCopy(fullJsonContent)}
                    >
                      <Icon name="clipboard" size={13} /> {copiedCode ? 'Copied!' : 'Copy JSON'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => handleDownloadFile('page-schema.json', fullJsonContent, 'application/json')}
                    >
                      <Icon name="check" size={13} /> Download .json
                    </button>
                  </div>
                </div>
                <textarea
                  className="field-input"
                  rows={15}
                  readOnly
                  style={{ fontFamily: 'monospace', fontSize: 11.5, background: 'var(--surface-2)' }}
                  value={fullJsonContent}
                />
              </div>
            )}

            {codeTab === 'import' && (
              <div className="stack" style={{ gap: 12 }}>
                <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0 }}>
                  Paste custom HTML code (e.g. from an existing landing page) or a JSON block tree. The parser will automatically extract headlines, paragraphs, images, buttons, and custom embeds.
                </p>
                <textarea
                  className="field-input"
                  rows={10}
                  placeholder="Paste <!DOCTYPE html> or [{ type: 'headline', content: ... }] here..."
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                {importStatus && (
                  <div style={{ fontSize: 12, color: importStatus.includes('Failed') ? '#ef4444' : '#10b981' }}>
                    {importStatus}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!importText.trim()}
                    onClick={() => handleApplyImport('replace')}
                  >
                    Replace All Canvas Blocks
                  </button>
                  <button
                    type="button"
                    className="btn btn--subtle btn--sm"
                    disabled={!importText.trim()}
                    onClick={() => handleApplyImport('append')}
                  >
                    Append to Existing Page
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL 2: WORDPRESS NAVIGATION MENU BUILDER */}
      {showMenuModal && (
        <Modal title="Navigation Menu Builder" onClose={() => setShowMenuModal(false)} wide>
          <div className="stack" style={{ gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 13.5 }}>Display Navigation Header</strong>
                <div className="cell-sub" style={{ fontSize: 11.5 }}>
                  Render a branded navigation bar at the top of this landing page / site.
                </div>
              </div>
              <input
                type="checkbox"
                checked={showNav}
                onChange={(e) => setShowNav(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Menu Links ({menuItems.length})
              </div>
              {menuItems.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    background: 'var(--surface-2)',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                  }}
                >
                  <input
                    type="text"
                    className="field-input"
                    style={{ flex: 1 }}
                    placeholder="Link Label"
                    value={item.label}
                    onChange={(e) =>
                      setMenuItems((prev) =>
                        prev.map((m) => (m.id === item.id ? { ...m, label: e.target.value } : m))
                      )
                    }
                  />
                  <input
                    type="text"
                    className="field-input"
                    style={{ flex: 1.5 }}
                    placeholder="URL (e.g. /pricing, https://...)"
                    value={item.url}
                    onChange={(e) =>
                      setMenuItems((prev) =>
                        prev.map((m) => (m.id === item.id ? { ...m, url: e.target.value } : m))
                      )
                    }
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={item.newTab || false}
                      onChange={(e) =>
                        setMenuItems((prev) =>
                          prev.map((m) => (m.id === item.id ? { ...m, newTab: e.target.checked } : m))
                        )
                      }
                    />
                    New tab
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={idx === 0}
                    onClick={() => {
                      const copy = [...menuItems];
                      const t = copy[idx];
                      copy[idx] = copy[idx - 1];
                      copy[idx - 1] = t;
                      setMenuItems(copy);
                    }}
                    title="Move Up"
                  >
                    <Icon name="chevron-up" size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={idx === menuItems.length - 1}
                    onClick={() => {
                      const copy = [...menuItems];
                      const t = copy[idx];
                      copy[idx] = copy[idx + 1];
                      copy[idx + 1] = t;
                      setMenuItems(copy);
                    }}
                    title="Move Down"
                  >
                    <Icon name="chevron-down" size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ color: '#ef4444' }}
                    onClick={() => setMenuItems((prev) => prev.filter((m) => m.id !== item.id))}
                    title="Delete Link"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--subtle btn--sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  setMenuItems((prev) => [
                    ...prev,
                    { id: `m_${Date.now()}`, label: 'New Link', url: '/new-page' },
                  ])
                }
              >
                <Icon name="plus" size={13} /> Add Menu Item
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 3: YOAST / RANKMATH STYLE SEO & PERMALINK MANAGER */}
      {showSeoModal && (
        <Modal title="Yoast / RankMath SEO & Google SERP Simulator" onClose={() => setShowSeoModal(false)} wide>
          <div className="stack" style={{ gap: 16 }}>
            {/* Live Google Search Preview */}
            <div style={{ background: '#f8fafc', padding: 18, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                  Google Search Snippet Preview
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className={`btn btn--xs ${serpView === 'desktop' ? 'btn--primary' : 'btn--subtle'}`}
                    onClick={() => setSerpView('desktop')}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    className={`btn btn--xs ${serpView === 'mobile' ? 'btn--primary' : 'btn--subtle'}`}
                    onClick={() => setSerpView('mobile')}
                  >
                    Mobile
                  </button>
                </div>
              </div>
              <div
                style={{
                  background: '#ffffff',
                  padding: 16,
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  maxWidth: serpView === 'mobile' ? 380 : 600,
                  fontFamily: 'arial, sans-serif',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#202124', marginBottom: 4 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#4f46e5', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    O
                  </div>
                  <span>operza.io</span>
                  <span style={{ color: '#5f6368' }}>› {permalink}</span>
                </div>
                <div style={{ fontSize: 18, color: '#1a0dab', lineHeight: 1.3, marginBottom: 4, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {metaTitle || pageName}
                </div>
                <div style={{ fontSize: 13, color: '#4d5156', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {metaDescription || 'Add a compelling meta description to improve click-through rates from search results.'}
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label className="field-label" style={{ fontSize: 11 }}>SEO Meta Title</label>
                  <span style={{ fontSize: 11, color: metaTitle.length >= 40 && metaTitle.length <= 60 ? '#10b981' : '#f59e0b' }}>
                    {metaTitle.length}/60 chars
                  </span>
                </div>
                <input
                  type="text"
                  className="field-input"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label className="field-label" style={{ fontSize: 11 }}>Meta Description</label>
                  <span style={{ fontSize: 11, color: metaDescription.length >= 120 && metaDescription.length <= 160 ? '#10b981' : '#f59e0b' }}>
                    {metaDescription.length}/160 chars
                  </span>
                </div>
                <textarea
                  className="field-input"
                  rows={3}
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="field-label" style={{ fontSize: 11 }}>URL Slug / Permalink</label>
                  <input
                    type="text"
                    className="field-input"
                    value={permalink}
                    onChange={(e) => setPermalink(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label" style={{ fontSize: 11 }}>Focus Keyword</label>
                  <input
                    type="text"
                    className="field-input"
                    value={focusKeyword}
                    onChange={(e) => setFocusKeyword(e.target.value)}
                  />
                </div>
              </div>

              {/* Robots Directives */}
              <div style={{ display: 'flex', gap: 24, padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={robotsIndex}
                    onChange={(e) => setRobotsIndex(e.target.checked)}
                  />
                  Allow search engines to index this page (robots: index)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={robotsFollow}
                    onChange={(e) => setRobotsFollow(e.target.checked)}
                  />
                  Follow links on this page (robots: follow)
                </label>
              </div>

              {/* Keyword Score Audit */}
              <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Focus Keyword Analysis: "{focusKeyword}"
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                  <span>{titleHasKw ? '✅' : '❌'} In Title</span>
                  <span>{descHasKw ? '✅' : '❌'} In Description</span>
                  <span>{contentHasKw ? '✅' : '❌'} In Page Content</span>
                </div>
              </div>

              {/* Advanced Code Injections */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                  Custom Code Injections (WordPress Scripts)
                </div>
                <div className="stack" style={{ gap: 10 }}>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Header Scripts (&lt;head&gt;)</label>
                    <textarea
                      className="field-input"
                      rows={2}
                      placeholder="<!-- Google Tag Manager, Meta Pixel, custom CSS -->"
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                      value={customHead}
                      onChange={(e) => setCustomHead(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Footer Scripts (&lt;body&gt;)</label>
                    <textarea
                      className="field-input"
                      rows={2}
                      placeholder="<!-- Chat widgets, conversion beacons -->"
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                      value={customFooter}
                      onChange={(e) => setCustomFooter(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 4: REVISIONS HISTORY & ROLLBACK */}
      {showRevisionsModal && (
        <Modal title="Page Revision History & Rollback" onClose={() => setShowRevisionsModal(false)}>
          <div className="stack" style={{ gap: 12 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0 }}>
              Operza creates timestamped snapshots on each publish. Select a previous revision to restore your page state with 1-click.
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {revisions.map((rev, i) => (
                <div
                  key={rev.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: i === 0 ? 'rgba(79, 70, 229, 0.05)' : 'var(--surface-2)',
                    borderRadius: 8,
                    border: `1px solid ${i === 0 ? 'var(--primary)' : 'var(--border)'}`,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {rev.label} {i === 0 && <span className="badge badge--primary" style={{ fontSize: 9.5 }}>Current</span>}
                    </div>
                    <div className="cell-sub" style={{ fontSize: 11 }}>
                      {rev.timestamp} · {rev.blockCount} blocks
                    </div>
                  </div>
                  {i !== 0 && (
                    <button
                      type="button"
                      className="btn btn--subtle btn--sm"
                      onClick={() => {
                        setBlocks(rev.blocks);
                        setShowRevisionsModal(false);
                      }}
                    >
                      <Icon name="clock" size={12} /> Restore Version
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
