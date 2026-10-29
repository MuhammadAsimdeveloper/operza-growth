import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export default function NotFound() {
  return (
    <div className="content">
      <div className="card">
        <div className="empty" style={{ padding: '70px 20px' }}>
          <div className="empty__icon">
            <Icon name="search" size={22} />
          </div>
          <div className="empty__title">Page not found</div>
          <div className="empty__text">The page you were looking for does not exist in this workspace.</div>
          <Link className="btn btn--primary" to="/" style={{ marginTop: 10 }}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
