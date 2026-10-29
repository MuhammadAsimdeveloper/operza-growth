import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import AuthGuard from './components/AuthGuard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Conversations from './pages/Conversations';
import PhoneSystem from './pages/PhoneSystem';
import Snapshots from './pages/Snapshots';
import Snippets from './pages/Snippets';
import SubAccounts from './pages/SubAccounts';
import Calendars from './pages/Calendars';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Tasks from './pages/Tasks';
import Opportunities from './pages/Opportunities';
import Reputation from './pages/Reputation';
import SmartLists from './pages/SmartLists';
import Payments from './pages/Payments';
import Store from './pages/Store';
import Products from './pages/Products';
import PaymentLinks from './pages/PaymentLinks';
import Coupons from './pages/Coupons';
import CustomValues from './pages/CustomValues';
import AuditLog from './pages/AuditLog';
import Orders from './pages/Orders';
import Subscriptions from './pages/Subscriptions';
import Campaigns from './pages/Campaigns';
import Social from './pages/Social';
import Prospecting from './pages/Prospecting';
import MediaLibrary from './pages/MediaLibrary';
import Templates from './pages/Templates';
import TriggerLinks from './pages/TriggerLinks';
import Affiliates from './pages/Affiliates';
import Funnels from './pages/Funnels';
import Websites from './pages/Websites';
import Forms from './pages/Forms';
import Workflows from './pages/Workflows';
import Memberships from './pages/Memberships';
import Documents from './pages/Documents';
import Blogs from './pages/Blogs';
import QrCodes from './pages/QrCodes';
import ClientPortal from './pages/ClientPortal';
import Reporting from './pages/Reporting';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      {/* Public Authentication Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      {/* Protected Agency Workspace Routes */}
      <Route
        element={
          <AuthGuard>
            <AppShell />
          </AuthGuard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="phone" element={<PhoneSystem />} />
        <Route path="snippets" element={<Snippets />} />
        <Route path="calendars" element={<Calendars />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactDetail />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="reputation" element={<Reputation />} />
        <Route path="smart-lists" element={<SmartLists />} />
        <Route path="payments" element={<Payments />} />
        <Route path="store" element={<Store />} />
        <Route path="products" element={<Products />} />
        <Route path="payment-links" element={<PaymentLinks />} />
        <Route path="coupons" element={<Coupons />} />
        <Route path="custom-values" element={<CustomValues />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="orders" element={<Orders />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="documents" element={<Documents />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="social" element={<Social />} />
        <Route path="prospecting" element={<Prospecting />} />
        <Route path="media" element={<MediaLibrary />} />
        <Route path="templates" element={<Templates />} />
        <Route path="links" element={<TriggerLinks />} />
        <Route path="affiliates" element={<Affiliates />} />
        <Route path="funnels" element={<Funnels />} />
        <Route path="websites" element={<Websites />} />
        <Route path="forms" element={<Forms />} />
        <Route path="blogs" element={<Blogs />} />
        <Route path="qr-codes" element={<QrCodes />} />
        <Route path="portal" element={<ClientPortal />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="memberships" element={<Memberships />} />
        <Route path="reporting" element={<Reporting />} />
        <Route path="settings" element={<Settings />} />
        <Route path="sub-accounts" element={<SubAccounts />} />
        <Route path="snapshots" element={<Snapshots />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
