import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Badge, EmptyState, PageHeader } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { num, relative } from '../lib/format';
import type { MediaAsset } from '../lib/types';

const KIND_META = {
  image: { label: 'Image', icon: 'image', tone: 'blue' as const },
  video: { label: 'Video', icon: 'play', tone: 'violet' as const },
  document: { label: 'Document', icon: 'file', tone: 'amber' as const },
};

function sizeLabel(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

export default function MediaLibrary() {
  const { state, dispatch } = useStore();
  const { media } = state;
  const [folder, setFolder] = useState('All');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | MediaAsset['kind']>('all');

  const folders = useMemo(() => ['All', ...Array.from(new Set(media.map((m) => m.folder)))], [media]);

  const visible = media.filter((m) => {
    if (folder !== 'All' && m.folder !== folder) return false;
    if (kind !== 'all' && m.kind !== kind) return false;
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const totalKb = media.reduce((s, m) => s + m.sizeKb, 0);

  function upload() {
    dispatch({
      type: 'media/add',
      asset: {
        id: uid('md'),
        name: `upload-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`,
        kind: 'image',
        folder: folder === 'All' ? 'Unsorted' : folder,
        sizeKb: Math.round(120 + Math.random() * 700),
        uploadedAt: new Date().toISOString(),
      },
    });
  }

  return (
    <div className="content">
      <PageHeader
        title="Media Library"
        subtitle="Every image, video and PDF used across funnels, emails and social."
        actions={
          <>
            <button className="btn">
              <Icon name="folder" size={15} /> New folder
            </button>
            <button className="btn btn--primary" onClick={upload}>
              <Icon name="upload" size={15} /> Upload
            </button>
          </>
        }
      />

      <div className="media-bar">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${folder === f ? ' is-active' : ''}`}
              onClick={() => setFolder(f)}
            >
              <Icon name="folder" size={13} /> {f}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="document">Documents</option>
          </select>
          <div className="search" style={{ width: 220 }}>
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="cell-sub" style={{ margin: '0 0 12px' }}>
        {visible.length} of {media.length} files · {sizeLabel(totalKb)} used
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Icon name="image" size={22} />}
          title="No files match"
          text="Try another folder, type or search term."
        />
      ) : (
        <div className="media-grid">
          {visible.map((asset) => {
            const meta = KIND_META[asset.kind];
            return (
              <div key={asset.id} className="media-tile">
                <div className={`media-tile__thumb media-tile__thumb--${asset.kind}`}>
                  <Icon name={meta.icon} size={26} />
                </div>
                <div className="media-tile__body">
                  <div className="media-tile__name" title={asset.name}>
                    {asset.name}
                  </div>
                  <div className="row row--between" style={{ marginTop: 6 }}>
                    <span className="cell-sub">
                      {sizeLabel(asset.sizeKb)} · {relative(asset.uploadedAt)}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete ${asset.name}`}
                      onClick={() => dispatch({ type: 'media/delete', id: asset.id })}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid--3" style={{ marginTop: 18 }}>
        {(['image', 'video', 'document'] as const).map((k) => {
          const items = media.filter((m) => m.kind === k);
          const kb = items.reduce((s, m) => s + m.sizeKb, 0);
          return (
            <div key={k} className="card">
              <div className="card__body row row--between">
                <span className="row" style={{ gap: 10 }}>
                  <span className="avatar avatar--md avatar--square" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Icon name={KIND_META[k].icon} size={16} />
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 650 }}>{KIND_META[k].label}s</span>
                    <span className="cell-sub">{sizeLabel(kb)}</span>
                  </span>
                </span>
                <Badge tone={KIND_META[k].tone}>{num(items.length)}</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
