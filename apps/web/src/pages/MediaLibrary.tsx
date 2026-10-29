import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader } from '../components/ui';
import { useStore } from '../lib/store';
import { num, relative } from '../lib/format';
import { api } from '../lib/api';
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
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Sync with real backend assets on mount
  useEffect(() => {
    let active = true;
    api.crm.list<MediaAsset>('media')
      .then((res) => {
        if (!active || !res || !Array.isArray(res)) return;
        for (const item of res) {
          if (!media.some((m) => m.id === item.id)) {
            dispatch({ type: 'media/add', asset: item });
          }
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [dispatch, media]);

  const folders = useMemo(() => ['All', ...Array.from(new Set(media.map((m) => m.folder)))], [media]);

  const visible = media.filter((m) => {
    if (folder !== 'All' && m.folder !== folder) return false;
    if (kind !== 'all' && m.kind !== kind) return false;
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const totalKb = media.reduce((s, m) => s + m.sizeKb, 0);

  async function handleDelete(assetId: string) {
    try {
      await api.media.delete(assetId);
    } catch {
      /* fallback to local delete */
    }
    dispatch({ type: 'media/delete', id: assetId });
  }

  return (
    <div className="content">
      <PageHeader
        title="Media Library"
        subtitle="Every image, video and PDF used across funnels, emails and social."
        actions={
          <>
            <button className="btn" type="button" onClick={() => setNewFolderOpen(true)}>
              <Icon name="folder" size={15} /> New folder
            </button>
            <button className="btn btn--primary" type="button" onClick={() => setUploadModalOpen(true)}>
              <Icon name="upload" size={15} /> Upload asset
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
                      onClick={() => handleDelete(asset.id)}
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

      {uploadModalOpen && (
        <UploadModal
          currentFolder={folder === 'All' ? 'General' : folder}
          existingFolders={folders.filter((f) => f !== 'All')}
          onClose={() => setUploadModalOpen(false)}
          onUpload={async (assetData) => {
            try {
              const res = await api.media.upload(assetData);
              if (res?.asset) {
                dispatch({ type: 'media/add', asset: res.asset });
              }
            } catch {
              /* fallback */
              dispatch({
                type: 'media/add',
                asset: {
                  id: `md-${Date.now()}`,
                  name: assetData.name || 'uploaded-file.png',
                  kind: (assetData.kind as any) || 'image',
                  folder: assetData.folder || 'General',
                  sizeKb: assetData.sizeKb || 120,
                  uploadedAt: new Date().toISOString(),
                },
              });
            }
            setUploadModalOpen(false);
          }}
        />
      )}

      {newFolderOpen && (
        <Modal
          title="Create media folder"
          onClose={() => setNewFolderOpen(false)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setNewFolderOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                type="button"
                disabled={!newFolderName.trim()}
                onClick={() => {
                  setFolder(newFolderName.trim());
                  setNewFolderName('');
                  setNewFolderOpen(false);
                }}
              >
                Create
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="folder-name-input">Folder name</label>
            <input
              id="folder-name-input"
              className="input"
              placeholder="e.g. Logos, Funnel Assets, Case Studies"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function UploadModal({
  currentFolder,
  existingFolders,
  onClose,
  onUpload,
}: {
  currentFolder: string;
  existingFolders: string[];
  onClose: () => void;
  onUpload: (data: { name: string; folder: string; kind: 'image' | 'video' | 'document'; sizeKb: number }) => void;
}) {
  const [name, setName] = useState(`asset-${Date.now().toString().slice(-4)}.png`);
  const [folder, setFolder] = useState(currentFolder);
  const [kind, setKind] = useState<'image' | 'video' | 'document'>('image');
  const [sizeKb, setSizeKb] = useState(240);

  return (
    <Modal
      title="Upload media asset"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!name.trim()}
            onClick={() => onUpload({ name: name.trim(), folder, kind, sizeKb })}
          >
            Upload
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="asset-name">File name</label>
          <input
            id="asset-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. hero-banner.png"
            autoFocus
          />
        </div>

        <div className="grid grid--2">
          <div className="field">
            <label htmlFor="asset-kind">File type</label>
            <select
              id="asset-kind"
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="image">Image (PNG, JPG, SVG)</option>
              <option value="video">Video (MP4, WebM)</option>
              <option value="document">Document (PDF, DOCX)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="asset-folder">Folder</label>
            <input
              id="asset-folder"
              className="input"
              list="folder-options"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
            <datalist id="folder-options">
              {existingFolders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="field">
          <label htmlFor="asset-size">Simulated file size ({sizeKb} KB)</label>
          <input
            id="asset-size"
            type="range"
            min="20"
            max="3000"
            step="20"
            value={sizeKb}
            onChange={(e) => setSizeKb(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </Modal>
  );
}