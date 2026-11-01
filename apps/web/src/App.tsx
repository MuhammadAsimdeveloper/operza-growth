import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import AuthGuard from './components/AuthGuard';

// Layouts
const AppShell = lazy(() => import('./components/AppShell').then((m) => ({ default: m.AppShell })));
const MarketingLayout = lazy(() => import('./pages/marketing/MarketingLayout'));

// Public Marketing & Feature Pages
const Home = lazy(() => import('./pages/marketing/Home'));
const PlatformCrm = lazy(() => import('./pages/marketing/PlatformCrm'));
const PlatformAutomation = lazy(() => import('./pages/marketing/PlatformAutomation'));
const PlatformFunnels = lazy(() => import('./pages/marketing/PlatformFunnels'));
const PlatformConversations = lazy(() => import('./pages/marketing/PlatformConversations'));
const PlatformPortal = lazy(() => import('./pages/marketing/PlatformPortal'));
const PlatformCourses = lazy(() => import('./pages/marketing/PlatformCourses'));
const PlatformReporting = lazy(() => import('./pages/marketing/PlatformReporting'));
const Pricing = lazy(() => import('./pages/marketing/Pricing'));
const About = lazy(() => import('./pages/marketing/About'));
const Docs = lazy(() => import('./pages/marketing/Docs'));
const Blog = lazy(() => import('./pages/marketing/Blog'));

// Public Ingress & Authentication Pages
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const PublicForm = lazy(() => import('./pages/PublicForm'));
const PublicBooking = lazy(() => import('./pages/PublicBooking'));
const PublicCheckout = lazy(() => import('./pages/PublicCheckout'));
const PublicReview = lazy(() => import('./pages/PublicReview'));
const PublicPortal = lazy(() => import('./pages/PublicPortal'));
const PublicFunnel = lazy(() => import('./pages/PublicFunnel'));

// Protected Agency Workspace Pages
const PlatformAdmin = lazy(() => import('./pages/PlatformAdmin'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Conversations = lazy(() => import('./pages/Conversations'));
const PhoneSystem = lazy(() => import('./pages/PhoneSystem'));
const Snapshots = lazy(() => import('./pages/Snapshots'));
const Snippets = lazy(() => import('./pages/Snippets'));
const SubAccounts = lazy(() => import('./pages/SubAccounts'));
const Calendars = lazy(() => import('./pages/Calendars'));
const Contacts = lazy(() => import('./pages/Contacts'));
const ContactDetail = lazy(() => import('./pages/ContactDetail'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Opportunities = lazy(() => import('./pages/Opportunities'));
const Reputation = lazy(() => import('./pages/Reputation'));
const SmartLists = lazy(() => import('./pages/SmartLists'));
const Payments = lazy(() => import('./pages/Payments'));
const Store = lazy(() => import('./pages/Store'));
const Products = lazy(() => import('./pages/Products'));
const PaymentLinks = lazy(() => import('./pages/PaymentLinks'));
const Coupons = lazy(() => import('./pages/Coupons'));
const CustomValues = lazy(() => import('./pages/CustomValues'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Orders = lazy(() => import('./pages/Orders'));
const Subscriptions = lazy(() => import('./pages/Subscriptions'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Social = lazy(() => import('./pages/Social'));
const Prospecting = lazy(() => import('./pages/Prospecting'));
const MediaLibrary = lazy(() => import('./pages/MediaLibrary'));
const Templates = lazy(() => import('./pages/Templates'));
const TriggerLinks = lazy(() => import('./pages/TriggerLinks'));
const Affiliates = lazy(() => import('./pages/Affiliates'));
const Funnels = lazy(() => import('./pages/Funnels'));
const Websites = lazy(() => import('./pages/Websites'));
const Forms = lazy(() => import('./pages/Forms'));
const Workflows = lazy(() => import('./pages/Workflows'));
const Memberships = lazy(() => import('./pages/Memberships'));
const Documents = lazy(() => import('./pages/Documents'));
const Blogs = lazy(() => import('./pages/Blogs'));
const QrCodes = lazy(() => import('./pages/QrCodes'));
const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const Reporting = lazy(() => import('./pages/Reporting'));
const Settings = lazy(() => import('./pages/Settings'));
const Integrations = lazy(() => import('./pages/Integrations'));
const AiTrainer = lazy(() => import('./pages/AiTrainer'));
const Developers = lazy(() => import('./pages/Developers'));
const Branding = lazy(() => import('./pages/Branding'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageLoadingFallback() {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '60vh',
        background: 'transparent',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid #e2e8f0',
          borderTopColor: '#4f46e5',
          borderRadius: '50%',
          animation: 'spin 0.6s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Routes>
        {/* ─── Public Marketing & Feature Pages ─── */}
        <Route element={<MarketingLayout />}>
          <Route path="/platform/crm" element={<PlatformCrm />} />
          <Route path="/platform/automation" element={<PlatformAutomation />} />
          <Route path="/platform/funnels" element={<PlatformFunnels />} />
          <Route path="/platform/conversations" element={<PlatformConversations />} />
          <Route path="/platform/portal" element={<PlatformPortal />} />
          <Route path="/platform/courses" element={<PlatformCourses />} />
          <Route path="/platform/reporting" element={<PlatformReporting />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/help" element={<Docs />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/home" element={<Home />} />
          <Route path="/overview" element={<Home />} />
          {/* When unauthenticated, root path / serves the marketing Homepage */}
          {!isAuthenticated && <Route path="/" element={<Home />} />}
        </Route>

        {/* ─── Public Ingress & Authentication Routes ─── */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/f/:slug" element={<PublicForm />} />
        <Route path="/book/:id" element={<PublicBooking />} />
        <Route path="/pay/:slug" element={<PublicCheckout />} />
        <Route path="/review/:id" element={<PublicReview />} />
        <Route path="/portal/:contactId" element={<PublicPortal />} />
        <Route path="/client-portal/:contactId" element={<PublicPortal />} />
        <Route path="/funnel/:slug" element={<PublicFunnel />} />
        <Route path="/v/:slug" element={<PublicFunnel />} />

        {/* ─── Protected Agency Workspace Routes ─── */}
        <Route
          element={
            <AuthGuard>
              <AppShell />
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Dashboard />} />
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
          <Route path="integrations" element={<Integrations />} />
          <Route path="ai-trainer" element={<AiTrainer />} />
          <Route path="developers" element={<Developers />} />
          <Route path="branding" element={<Branding />} />
          <Route path="admin" element={<PlatformAdmin />} />
          <Route path="platform-admin" element={<PlatformAdmin />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
