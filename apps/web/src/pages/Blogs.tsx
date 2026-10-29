import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, PageHeader, StatCard, Switch } from '../components/ui';
import { useStore } from '../lib/store';
import { num, relative, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { BlogPost } from '../lib/types';

export default function Blogs() {
  const { state, dispatch } = useStore();
  const { blogs } = state;
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [readingSlug, setReadingSlug] = useState<string | null>(null);
  const [readingPost, setReadingPost] = useState<any | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);

  // Sync with real backend blog posts on mount
  useEffect(() => {
    let active = true;
    api.crm.list<BlogPost>('blogs')
      .then((res) => {
        if (!active || !res || !Array.isArray(res)) return;
        for (const post of res) {
          if (!blogs.some((b) => b.id === post.id)) {
            dispatch({ type: 'blog/add', post });
          }
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [dispatch, blogs]);

  const published = blogs.filter((b) => b.status === 'published');
  const views = blogs.reduce((s, b) => s + b.views, 0);
  const drafts = blogs.filter((b) => b.status === 'draft').length;

  async function handleTogglePublish(post: BlogPost) {
    const nextStatus = post.status === 'published' ? 'draft' : 'published';
    try {
      if (nextStatus === 'published') {
        await api.blogs.publish(post.id);
      } else {
        await api.crm.update('blogs', post.id, { status: nextStatus });
      }
    } catch {
      /* fallback */
    }
    dispatch({ type: 'blog/toggle', id: post.id });
  }

  async function openReader(slugOrTitle: string) {
    const slug = slugOrTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setReadingSlug(slug);
    setReadingLoading(true);
    try {
      const data = await api.blogs.getPublic(slug);
      setReadingPost(data);
      // update local view count
      if (data?.id) {
        dispatch({ type: 'blog/update', id: data.id, patch: { views: data.views } });
      }
    } catch {
      setReadingPost(null);
    } finally {
      setReadingLoading(false);
    }
  }

  return (
    <div className="content">
      <PageHeader
        title="Blogs"
        subtitle="Long-form content published to your site with automated view analytics."
        actions={
          <button className="btn btn--primary" type="button" onClick={() => setNewPostOpen(true)}>
            <Icon name="plus" size={15} /> New post
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Published posts" value={num(published.length)} icon={<Icon name="file" size={15} />} meta={`${drafts} drafts`} />
        <StatCard label="Total views" value={num(views)} icon={<Icon name="eye" size={15} />} meta="all posts" />
        <StatCard
          label="Avg. views"
          value={num(published.length ? Math.round(views / Math.max(published.length, 1)) : 0)}
          icon={<Icon name="chart" size={15} />}
          meta="per published post"
        />
        <StatCard label="Last published" value={published[0] ? relative(published[0].publishedAt) : '—'} icon={<Icon name="clock" size={15} />} meta="most recent" />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">All posts</div>
            <div className="card__sub">Toggle a draft to publish it live to your public blog reader</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Author</th>
                <th className="cell-right">Views</th>
                <th>Date</th>
                <th style={{ width: 120 }}>Status</th>
                <th className="cell-right" style={{ width: 110 }}>
                  Live / Preview
                </th>
              </tr>
            </thead>
            <tbody>
              {blogs.map((b) => {
                const slug = b.slug || b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                return (
                  <tr key={b.id}>
                    <td>
                      <span className="person">
                        <span className="avatar avatar--sm avatar--square" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                          <Icon name="file" size={14} />
                        </span>
                        <span className="person__text">
                          <span className="person__name">{b.title}</span>
                          <span className="person__sub">/blog/{slug}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Avatar name={b.author} size="xs" />
                        {b.author}
                      </span>
                    </td>
                    <td className="cell-right cell-num">{num(b.views)}</td>
                    <td className="cell-sub">{shortDate(b.publishedAt)}</td>
                    <td>
                      <Badge tone={b.status === 'published' ? 'green' : 'default'} dot>
                        {b.status === 'published' ? 'Published' : 'Draft'}
                      </Badge>
                    </td>
                    <td className="cell-right">
                      <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                        {b.status === 'published' && (
                          <button
                            type="button"
                            className="btn btn--sm"
                            aria-label={`Preview ${b.title}`}
                            onClick={() => openReader(slug)}
                          >
                            <Icon name="eye" size={12} /> View
                          </button>
                        )}
                        <span style={{ display: 'inline-flex' }}>
                          <Switch
                            on={b.status === 'published'}
                            label={`Publish ${b.title}`}
                            onChange={() => handleTogglePublish(b)}
                          />
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {newPostOpen && (
        <NewPostModal
          onClose={() => setNewPostOpen(false)}
          onCreate={async (postData) => {
            const slug = postData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const post: BlogPost = {
              id: `blog-${Date.now()}`,
              title: postData.title,
              slug,
              author: postData.author || 'Agency Team',
              category: postData.category || 'General',
              content: postData.content || '',
              status: postData.status,
              views: 0,
              publishedAt: new Date().toISOString(),
            };

            try {
              const res = await api.crm.create<BlogPost>('blogs', post);
              dispatch({ type: 'blog/add', post: res || post });
            } catch {
              dispatch({ type: 'blog/add', post });
            }
            setNewPostOpen(false);
          }}
        />
      )}

      {readingSlug && (
        <Modal
          title={readingPost?.title || 'Public Reader Preview'}
          wide
          onClose={() => {
            setReadingSlug(null);
            setReadingPost(null);
          }}
          footer={
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => {
                setReadingSlug(null);
                setReadingPost(null);
              }}
            >
              Close
            </button>
          }
        >
          {readingLoading ? (
            <div className="cell-sub" style={{ padding: 20 }}>
              Loading public article from server...
            </div>
          ) : readingPost ? (
            <div className="stack" style={{ gap: 14 }}>
              <div className="row row--between">
                <span className="row" style={{ gap: 8 }}>
                  <Avatar name={readingPost.author} size="sm" />
                  <span>
                    <strong style={{ display: 'block', fontSize: 13 }}>{readingPost.author}</strong>
                    <span className="cell-sub">{shortDate(readingPost.publishedAt)} · {readingPost.category}</span>
                  </span>
                </span>
                <Badge tone="blue">{readingPost.views} views</Badge>
              </div>

              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  padding: '16px 0',
                  borderTop: '1px solid var(--border)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {readingPost.content || 'No article content preview available.'}
              </div>

              <div className="hint">
                Public URL: <span className="mono-cell">/api/blogs/public/{readingSlug}</span>
              </div>
            </div>
          ) : (
            <div className="cell-sub" style={{ padding: 20 }}>
              Article not found or not published.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function NewPostModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { title: string; author: string; category: string; content: string; status: 'draft' | 'published' }) => void;
}) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('Elena Rostova');
  const [category, setCategory] = useState('Strategy');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('published');

  const canCreate = title.trim().length > 2;

  return (
    <Modal
      title="Create new blog post"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canCreate}
            onClick={() =>
              onCreate({
                title: title.trim(),
                author: author.trim(),
                category: category.trim(),
                content: content.trim(),
                status,
              })
            }
          >
            Create post
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="post-title">Article title</label>
          <input
            id="post-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 5 Autonomous Workflows That Save 20 Hours a Week"
            autoFocus
          />
        </div>

        <div className="grid grid--3">
          <div className="field">
            <label htmlFor="post-author">Author</label>
            <input
              id="post-author"
              className="input"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="post-category">Category</label>
            <input
              id="post-category"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="post-status">Status</label>
            <select
              id="post-status"
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="post-content">Article body (Markdown / Plain text)</label>
          <textarea
            id="post-content"
            className="input"
            rows={8}
            placeholder="Write your long-form article content here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}