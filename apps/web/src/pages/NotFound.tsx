import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export default function NotFound() {
  return (
    <main className="operza-dashboard atlas-dashboard">
      <div className="card-premium" style={{ maxWidth: 600, margin: '60px auto', padding: '30px 20px' }}>
        <div className="empty" style={{ padding: '40px 20px' }}>
          <div className="empty__icon">
            <Icon name="search" size={24} />
          </div>
          <div className="empty__title" style={{ fontSize: 18, fontWeight: 700 }}>Page Not Found</div>
          <div className="empty__text" style={{ fontSize: 13, color: 'var(--text-2)' }}>The requested route or resource does not exist in this workspace.</div>
          <Link className="atlas-quick-action-button" to="/" style={{ marginTop: 18, display: 'inline-flex' }}>
            Back to Control Center
          </Link>
        </div>
      </div>
    </main>
  );
}
