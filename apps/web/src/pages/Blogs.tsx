import { Icon } from '../components/Icon';
import { Avatar, Badge, PageHeader, StatCard, Switch } from '../components/ui';
import { useStore } from '../lib/store';
import { num, relative, shortDate } from '../lib/format';

export default function Blogs() {
  const { state, dispatch } = useStore();
  const { blogs } = state;

  const published = blogs.filter((b) => b.status === 'published');
  const views = blogs.reduce((s, b) => s + b.views, 0);
  const drafts = blogs.filter((b) => b.status === 'draft').length;

  return (
    <div className="content">
      <PageHeader
        title="Blogs"
        subtitle="Long-form content published to your site."
        actions={
          <>
            <button className="btn">
              <Icon name="settings" size={15} /> Blog settings
            </button>
            <button className="btn btn--primary">
              <Icon name="plus" size={15} /> New post
            </button>
          </>
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
            <div className="card__sub">Toggle a draft to publish it to the blog</div>
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
                <th className="cell-right" style={{ width: 90 }}>
                  Live
                </th>
              </tr>
            </thead>
            <tbody>
              {blogs.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="person">
                      <span className="avatar avatar--sm avatar--square" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                        <Icon name="file" size={14} />
                      </span>
                      <span className="person__text">
                        <span className="person__name">{b.title}</span>
                        <span className="person__sub">/blog/{b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}</span>
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
                    <span style={{ display: 'inline-flex' }}>
                      <Switch
                        on={b.status === 'published'}
                        label={`Publish ${b.title}`}
                        onChange={() => dispatch({ type: 'blog/toggle', id: b.id })}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
