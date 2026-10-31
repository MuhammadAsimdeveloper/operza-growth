import { useState, useEffect } from 'react';
import { Icon } from './Icon';
import { currency } from '../lib/format';

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
    | 'two_columns';
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
    content: 'Unlock 3x qualified leads, instant AI qualification, and automated pipeline execution in 14 days.',
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

  // Animated countdown timer state for live preview
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
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

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
          padding: '0 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onClose} title="Back to Funnel Settings">
            <Icon name="chevron-left" size={17} />
          </button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {pageName} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({pagePath})</span>
            </div>
            <div className="cell-sub" style={{ fontSize: 11 }}>WYSIWYG Funnel Canvas Engine</div>
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

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={`btn btn--sm ${isPreview ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setIsPreview(!isPreview)}
          >
            <Icon name="eye" size={14} /> {isPreview ? 'Exit Preview' : 'Preview Live'}
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
              Add Funnel Blocks
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
              padding: viewport === 'mobile' ? '32px 20px' : '48px 40px',
              minHeight: '80vh',
              transition: 'width 0.3s ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
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
                        onClick={(e) => { e.stopPropagation(); handleMoveBlock(idx, 'up'); }}
                        title="Move Up"
                      >
                        <Icon name="chevron-up" size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ color: '#fff' }}
                        disabled={idx === blocks.length - 1}
                        onClick={(e) => { e.stopPropagation(); handleMoveBlock(idx, 'down'); }}
                        title="Move Down"
                      >
                        <Icon name="chevron-down" size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ color: '#f87171' }}
                        onClick={(e) => { e.stopPropagation(); handleDeleteBlock(block.id); }}
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
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                          <strong style={{ fontSize: 14, color: '#0f172a' }}>
                            ⚡ {block.bumpTitle}
                          </strong>
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
    </div>
  );
}
