/** Core domain model for the workspace. */

export type ID = string;

export type Channel = 'sms' | 'email' | 'facebook' | 'instagram' | 'whatsapp' | 'webchat';

export type ContactStatus = 'lead' | 'customer' | 'cold';

export interface Note {
  id: ID;
  body: string;
  at: string;
  author: string;
}

export interface Contact {
  id: ID;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  tags: string[];
  source: string;
  status: ContactStatus;
  owner: string;
  createdAt: string;
  notes: Note[];
  customFields: Record<string, string>;
  portalAccess?: boolean;
}

export interface Stage {
  id: ID;
  name: string;
  color: string;
}

export interface Pipeline {
  id: ID;
  name: string;
  stages: Stage[];
}

export type OpportunityStatus = 'open' | 'won' | 'lost';

export interface Opportunity {
  id: ID;
  name: string;
  pipelineId: ID;
  stageId: ID;
  contactId: ID;
  value: number;
  status: OpportunityStatus;
  owner: string;
  createdAt: string;
}

export interface Message {
  id: ID;
  direction: 'in' | 'out';
  /** Subject line for outbound email. */
  subject?: string;
  body: string;
  at: string;
}

export interface Conversation {
  id: ID;
  contactId: ID;
  channel: Channel;
  unread: number;
  starred: boolean;
  messages: Message[];
}

export interface AvailabilityWindow {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** 24-hour "HH:MM" */
  start: string;
  end: string;
}

export interface CalendarDef {
  id: ID;
  name: string;
  color: string;
  availability: AvailabilityWindow[];
  /** New bookings rotate to the team member with the fewest upcoming appointments. */
  roundRobin: boolean;
}

export type AppointmentStatus = 'confirmed' | 'pending' | 'cancelled';

export interface Appointment {
  id: ID;
  calendarId: ID;
  contactId: ID;
  title: string;
  /** ISO date-time */
  start: string;
  durationMin: number;
  status: AppointmentStatus;
  assignee?: string;
}

export interface Snippet {
  id: ID;
  label: string;
  /** Email subject line; ignored by channels that have no subject. */
  subject?: string;
  body: string;
  /** Restricted to one channel, or undefined for every channel. */
  channel?: Channel;
  uses: number;
}

export type InvoiceStatus = 'paid' | 'sent' | 'draft' | 'overdue';

export interface Invoice {
  id: ID;
  number: string;
  contactId: ID;
  amount: number;
  status: InvoiceStatus;
  issuedAt: string;
}

export interface Product {
  id: ID;
  name: string;
  price: number;
  kind: 'one_time' | 'recurring';
  active: boolean;
  sku?: string;
}

export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: ID;
  title: string;
  contactId?: ID;
  opportunityId?: ID;
  assignee: string;
  /** ISO date-time */
  dueAt: string;
  priority: TaskPriority;
  done: boolean;
  createdAt: string;
}

export interface PaymentLink {
  id: ID;
  name: string;
  productIds: ID[];
  amount: number;
  slug: string;
  visits: number;
  conversions: number;
  active: boolean;
  createdAt: string;
}

export type CouponKind = 'percent' | 'fixed';

export interface Coupon {
  id: ID;
  /** Always stored upper-case. */
  code: string;
  kind: CouponKind;
  /** Percent off (0–100) for percent coupons, USD off for fixed coupons. */
  value: number;
  /** Checkout minimum, 0 means no minimum. */
  minAmount: number;
  /** Redemption ceiling, null means unlimited. */
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
  /** ISO date-time, null means it never expires. */
  expiresAt: string | null;
  createdAt: string;
}

export interface CustomValue {
  id: ID;
  /** Human label, e.g. "Business name". */
  name: string;
  value: string;
}

export interface AuditEntry {
  id: ID;
  at: string;
  actor: string;
  /** Short human summary, e.g. "Invoice marked paid". */
  action: string;
  entity: string;
  detail?: string;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sent';

export interface CampaignSegment {
  /** Contact must carry at least one of these tags; empty means any tag. */
  tags: string[];
  status: 'any' | ContactStatus;
  /** Only include contacts created in the last N days; null means any age. */
  createdWithinDays: number | null;
}

export interface EmailBlock {
  id: string;
  type: 'header' | 'hero_image' | 'paragraph' | 'button' | 'divider' | 'footer';
  content?: string;
  buttonText?: string;
  buttonUrl?: string;
  imageUrl?: string;
  align?: 'left' | 'center' | 'right';
}

export interface Campaign {
  id: ID;
  name: string;
  kind: 'email' | 'sms';
  status: CampaignStatus;
  audience: number;
  sent: number;
  opened: number;
  clicked: number;
  scheduledAt: string;
  segment?: CampaignSegment;
  subject?: string;
  preheader?: string;
  blocks?: EmailBlock[];
}

export type PostStatus = 'draft' | 'scheduled' | 'published';

export interface SocialPost {
  id: ID;
  body: string;
  platforms: Array<'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'google'>;
  status: PostStatus;
  scheduledAt: string;
  likes: number;
  comments: number;
}

export type PageTheme = 'gradient' | 'plain' | 'dark';

export interface OrderBump {
  id: ID;
  productId: ID;
  /** Offer headline shown to the buyer at checkout. */
  title: string;
  /** One-line description under the checkbox. */
  copy: string;
  /** Checkout price for the add-on; below the product's list price. */
  price: number;
  enabled: boolean;
}

export interface FunnelCheckout {
  /** The product the funnel sells at its order step. */
  productId: ID;
  bumps: OrderBump[];
}

export interface SitePage {
  id: ID;
  name: string;
  path: string;
  visits: number;
  optins: number;
  /** Hero content edited in the website builder; funnels leave these empty. */
  headline?: string;
  subhead?: string;
  cta?: string;
  theme?: PageTheme;
}

export interface Site {
  id: ID;
  name: string;
  kind: 'funnel' | 'website';
  domain?: string;
  published: boolean;
  visits: number;
  optins: number;
  pages: SitePage[];
  /** Order-step configuration; funnels without a checkout leave this empty. */
  checkout?: FunnelCheckout;
}

export type FormKind = 'form' | 'survey';

export type FormFieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'consent';

export interface FieldCondition {
  /** The dropdown field whose answer controls visibility. */
  fieldId: ID;
  /** Show this field only when that answer equals this choice. */
  equals: string;
}

export interface FormField {
  id: ID;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Choices for select fields; ignored by every other type. */
  options: string[];
  showIf?: FieldCondition;
  /** Survey points keyed by option label; ignored by non-select fields. */
  points?: Record<string, number>;
}

export interface FormCompletion {
  /** Show a running score while the respondent answers. */
  showScore: boolean;
  /** Where respondents land after submitting; simulated, never navigated to. */
  redirectUrl?: string;
  /** At or above this score the response is a pass. */
  passingScore?: number;
}

export interface FormDef {
  id: ID;
  name: string;
  slug?: string;
  kind: FormKind;
  published: boolean;
  submissions: number;
  fields: FormField[];
  completion?: FormCompletion;
}

export type WorkflowTriggerKind =
  | 'form'
  | 'tag'
  | 'appointment'
  | 'invoice'
  | 'payment'
  | 'webhook'
  | 'schedule';

export interface WorkflowTrigger {
  kind: WorkflowTriggerKind;
  /**
   * Form name, tag name or inbound webhook path, depending on the kind.
   * Appointment, invoice and payment triggers fire on the matching event.
   */
  detail?: string;
  /** Repeat interval for schedule triggers. */
  every?: number;
  unit?: 'minutes' | 'hours' | 'days';
}

export type ConditionField = 'tag' | 'status' | 'company' | 'email';
export type ConditionOperator = 'is' | 'is_not' | 'contains';

export interface ConditionRule {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

export interface WorkflowStepConfig {
  /** Webhook request method. */
  method?: 'POST' | 'PUT' | 'GET';
  /** Webhook target; runs fail while this is empty or not http(s). */
  url?: string;
  /** Tag applied by tag steps. */
  tag?: string;
  /** Task title for task steps. */
  title?: string;
  /** Task due offset in days. */
  dueInDays?: number;
  /** Rule evaluated by condition steps. */
  rule?: ConditionRule;
}

export interface WorkflowAction {
  id: ID;
  kind: 'sms' | 'email' | 'wait' | 'tag' | 'task' | 'webhook' | 'condition';
  label: string;
  /** Delay for wait steps, in hours. Ignored by every other kind. */
  delayHours?: number;
  config?: WorkflowStepConfig;
  /** Steps that run when a condition passes. Condition steps only. */
  yes?: WorkflowAction[];
  /** Steps that run when a condition fails. Condition steps only. */
  no?: WorkflowAction[];
}

export interface Workflow {
  id: ID;
  name: string;
  status: 'published' | 'draft';
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
  enrolled: number;
  completed: number;
}

export type WorkflowRunStatus = 'success' | 'failed';
export type WorkflowRunStepStatus = 'done' | 'failed' | 'skipped';

export interface WorkflowRunStep {
  label: string;
  kind: WorkflowAction['kind'];
  status: WorkflowRunStepStatus;
  detail?: string;
}

export interface WorkflowRun {
  id: ID;
  workflowId: ID;
  contactId: ID;
  at: string;
  status: WorkflowRunStatus;
  durationMs: number;
  steps: WorkflowRunStep[];
}

export type ReviewSource = 'google' | 'facebook' | 'yelp';
export type ReviewStatus = 'new' | 'replied' | 'flagged';

export interface Review {
  id: ID;
  contactId: ID;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  source: ReviewSource;
  at: string;
  status: ReviewStatus;
  reply?: string;
}

export interface Listing {
  id: ID;
  name: string;
  source: ReviewSource;
  connected: boolean;
  rating: number;
  reviews: number;
}

export type ReviewRequestChannel = 'email' | 'sms';

export interface ReviewRequest {
  id: ID;
  contactId: ID;
  channel: ReviewRequestChannel;
  /** Raw template body — merge tokens resolve at render time. */
  message: string;
  scheduledAt: string;
  sentAt?: string;
}

export type ReportMetric = 'revenue' | 'pipeline' | 'deals' | 'contacts';
export type ReportRange = 30 | 90 | 180;

export interface SavedReport {
  id: ID;
  name: string;
  metric: ReportMetric;
  rangeDays: ReportRange;
  createdAt: string;
}

export type DashboardChart = 'stat' | 'line' | 'bar';

export interface DashboardWidget {
  id: ID;
  title: string;
  metric: ReportMetric;
  chart: DashboardChart;
  rangeDays: ReportRange;
  createdAt: string;
}

/** Simulated processor — fees only, no credentials or card data are stored. */
export interface PaymentGateway {
  id: ID;
  name: string;
  feePct: number;
  feeFixed: number;
  connected: boolean;
  mode: 'test' | 'live';
}

export type CourseKind = 'course' | 'community';

export interface Lesson {
  id: ID;
  title: string;
  durationMin: number;
  /** Days after enrollment before the lesson unlocks. 0 = immediately. */
  dripDays: number;
}

export interface Course {
  id: ID;
  title: string;
  kind: CourseKind;
  curriculum: Lesson[];
  enrollments: number;
  price: number;
  published: boolean;
}

export interface Enrollment {
  id: ID;
  courseId: ID;
  contactId: ID;
  progress: number;
  startedAt: string;
}

export interface SaasPlan {
  id: ID;
  name: string;
  /** Monthly price billed to the sub-account. */
  price: number;
  seats: number;
  contactLimit: number;
  smsCredits: number;
}

export type SubAccountStatus = 'active' | 'trial' | 'paused';

export interface SubAccount {
  id: ID;
  name: string;
  industry: string;
  ownerEmail: string;
  planId: ID;
  status: SubAccountStatus;
  seats: number;
  contacts: number;
  createdAt: string;
}

export type DocumentKind = 'proposal' | 'contract' | 'estimate';
export type DocumentStatus = 'draft' | 'sent' | 'signed' | 'declined';

export interface ContractDoc {
  id: ID;
  name: string;
  kind: DocumentKind;
  contactId: ID;
  value: number;
  status: DocumentStatus;
  updatedAt: string;
  signedAt?: string;
  signerName?: string;
  signatureData?: string;
  pdfUrl?: string;
}

export type MediaKind = 'image' | 'video' | 'document';

export interface MediaAsset {
  id: ID;
  name: string;
  kind: MediaKind;
  folder: string;
  sizeKb: number;
  uploadedAt: string;
  url?: string;
  mimeType?: string;
}

export type ProspectStatus = 'new' | 'contacted' | 'qualified' | 'skipped';

export interface Prospect {
  id: ID;
  company: string;
  person: string;
  email: string;
  industry: string;
  employees: number;
  location: string;
  score: number;
  status: ProspectStatus;
}

export type OrderStatus = 'paid' | 'pending' | 'refunded';

export interface Order {
  id: ID;
  number: string;
  contactId: ID;
  items: number;
  total: number;
  status: OrderStatus;
  at: string;
  /** Payment gateway used at checkout. */
  gateway?: string;
  couponCode?: string;
  /** Accepted funnel order-bump titles, when the order came from a funnel checkout. */
  bumps?: string[];
}

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

export interface Subscription {
  id: ID;
  contactId: ID;
  plan: string;
  amount: number;
  interval: 'month' | 'year';
  status: SubscriptionStatus;
  renewsAt: string;
}

export type AffiliateStatus = 'active' | 'pending' | 'paused';

export interface Affiliate {
  id: ID;
  name: string;
  email: string;
  code: string;
  clicks: number;
  signups: number;
  conversions: number;
  commissionPct: number;
  payout: number;
  status: AffiliateStatus;
}

export interface EmailTemplate {
  id: ID;
  name: string;
  category: string;
  subject: string;
  body: string;
  updatedAt: string;
  uses: number;
}

export interface TriggerLink {
  id: ID;
  name: string;
  slug: string;
  clicks: number;
  lastClickAt: string;
}

export interface BlogPost {
  id: ID;
  title: string;
  slug?: string;
  author: string;
  status: 'draft' | 'published';
  views: number;
  publishedAt: string;
  category?: string;
  content?: string;
  coverImage?: string;
}

export interface QrCode {
  id: ID;
  name: string;
  target: string;
  scans: number;
  createdAt: string;
}

export interface SmartList {
  id: ID;
  name: string;
  rule: string;
  count: number;
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'red' | 'default';
}

export interface TeamMember {
  id: ID;
  name: string;
  email: string;
  role: 'admin' | 'user';
  online: boolean;
}

export interface CustomField {
  id: ID;
  name: string;
  type: 'text' | 'number' | 'date' | 'select';
  entity: 'contact' | 'opportunity';
}

export interface Integration {
  id: ID;
  name: string;
  category: string;
  connected: boolean;
  blurb: string;
}

export interface Notification {
  id: ID;
  title: string;
  body: string;
  at: string;
  read: boolean;
}

export type PhoneNumberType = 'local' | 'toll_free';
export type PhoneNumberStatus = 'active' | 'inactive';

export interface PhoneNumber {
  id: ID;
  /** Display number in E.164-ish formatting. */
  number: string;
  label: string;
  type: PhoneNumberType;
  /** Team member who answers calls on this line. */
  assignedTo: string;
  status: PhoneNumberStatus;
  voice: boolean;
  sms: boolean;
  mms?: boolean;
  forwardTo?: string;
  ivrEnabled?: boolean;
  ivrMenu?: string;
  recordingEnabled?: boolean;
  areaCode?: string;
}

export type CallDirection = 'inbound' | 'outbound';
export type CallOutcome = 'completed' | 'missed' | 'voicemail';

export interface CallRecord {
  id: ID;
  contactId: ID;
  numberId: ID;
  direction: CallDirection;
  outcome: CallOutcome;
  startedAt: string;
  /** Talk time in seconds; 0 for missed calls that never connected. */
  durationSec: number;
  notes?: string;
  /** Missed calls and voicemails are followed up, then marked handled. */
  handled: boolean;
}

/** Everything a snapshot captures — the archive itself and the audit trail are excluded. */
export type SnapshotData = Omit<WorkspaceState, 'snapshots' | 'auditLog'>;

export interface Snapshot {
  id: ID;
  name: string;
  createdAt: string;
  data: SnapshotData;
}

export interface WorkspaceState {
  contacts: Contact[];
  pipelines: Pipeline[];
  opportunities: Opportunity[];
  conversations: Conversation[];
  calendars: CalendarDef[];
  appointments: Appointment[];
  invoices: Invoice[];
  products: Product[];
  paymentLinks: PaymentLink[];
  tasks: Task[];
  coupons: Coupon[];
  customValues: CustomValue[];
  auditLog: AuditEntry[];
  snippets: Snippet[];
  campaigns: Campaign[];
  posts: SocialPost[];
  sites: Site[];
  forms: FormDef[];
  workflows: Workflow[];
  workflowRuns: WorkflowRun[];
  reviews: Review[];
  listings: Listing[];
  reviewRequests: ReviewRequest[];
  savedReports: SavedReport[];
  dashboardWidgets: DashboardWidget[];
  paymentGateways: PaymentGateway[];
  courses: Course[];
  enrollments: Enrollment[];
  subAccounts: SubAccount[];
  saasPlans: SaasPlan[];
  documents: ContractDoc[];
  media: MediaAsset[];
  prospects: Prospect[];
  orders: Order[];
  subscriptions: Subscription[];
  affiliates: Affiliate[];
  templates: EmailTemplate[];
  triggerLinks: TriggerLink[];
  blogs: BlogPost[];
  qrCodes: QrCode[];
  smartLists: SmartList[];
  team: TeamMember[];
  customFields: CustomField[];
  integrations: Integration[];
  notifications: Notification[];
  phoneNumbers: PhoneNumber[];
  calls: CallRecord[];
  snapshots: Snapshot[];
}
