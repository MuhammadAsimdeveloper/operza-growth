import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import { seed } from './seed';
import type {
  Appointment,
  AuditEntry,
  CalendarDef,
  CallRecord,
  Campaign,
  Channel,
  Contact,
  ContractDoc,
  Coupon,
  Course,
  CustomField,
  CustomValue,
  DashboardWidget,
  EmailTemplate,
  FormDef,
  FormField,
  Invoice,
  Lesson,
  MediaAsset,
  Note,
  Opportunity,
  Order,
  OrderBump,
  PaymentGateway,
  PaymentLink,
  PhoneNumber,
  Product,
  QrCode,
  ReviewRequest,
  SaasPlan,
  SavedReport,
  Site,
  SitePage,
  SmartList,
  Snapshot,
  Snippet,
  SocialPost,
  SubAccount,
  Task,
  TeamMember,
  TriggerLink,
  WorkspaceState,
  Workflow,
  WorkflowAction,
  WorkflowRun,
} from './types';

const STORAGE_KEY = 'operza.workspace.v14';
const SNAPSHOT_LIMIT = 5;

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export type Action =
  | { type: 'contact/add'; contact: Contact }
  | { type: 'contact/update'; id: string; patch: Partial<Contact> }
  | { type: 'contact/delete'; id: string }
  | { type: 'contact/bulkTag'; ids: string[]; tag: string }
  | { type: 'contact/bulkStatus'; ids: string[]; status: Contact['status'] }
  | { type: 'contact/bulkDelete'; ids: string[] }
  | { type: 'contact/note'; id: string; body: string; author: string }
  | { type: 'opportunity/add'; opportunity: Opportunity }
  | { type: 'opportunity/move'; id: string; stageId: string }
  | { type: 'opportunity/delete'; id: string }
  | { type: 'conversation/send'; id: string; body: string; subject?: string }
  | {
      type: 'conversation/start';
      id: string;
      contactId: string;
      channel: Channel;
      body: string;
      subject?: string;
    }
  | { type: 'conversation/read'; id: string }
  | { type: 'conversation/star'; id: string }
  | { type: 'appointment/add'; appointment: Appointment }
  | { type: 'appointment/status'; id: string; status: Appointment['status'] }
  | { type: 'appointment/delete'; id: string }
  | { type: 'calendar/update'; id: string; patch: Partial<CalendarDef> }
  | { type: 'invoice/add'; invoice: Invoice }
  | { type: 'invoice/status'; id: string; status: Invoice['status'] }
  | { type: 'product/toggle'; id: string }
  | { type: 'product/add'; product: Product }
  | { type: 'product/update'; id: string; patch: Partial<Product> }
  | { type: 'paymentLink/add'; link: PaymentLink }
  | { type: 'paymentLink/toggle'; id: string }
  | { type: 'paymentLink/visit'; id: string }
  | { type: 'task/add'; task: Task }
  | { type: 'task/toggle'; id: string }
  | { type: 'task/delete'; id: string }
  | { type: 'coupon/add'; coupon: Coupon }
  | { type: 'coupon/update'; id: string; patch: Partial<Coupon> }
  | { type: 'coupon/toggle'; id: string }
  | { type: 'coupon/delete'; id: string }
  | { type: 'customValue/add'; customValue: CustomValue }
  | { type: 'customValue/update'; id: string; patch: Partial<CustomValue> }
  | { type: 'customValue/delete'; id: string }
  | { type: 'snippet/add'; snippet: Snippet }
  | { type: 'snippet/update'; id: string; patch: Partial<Snippet> }
  | { type: 'snippet/delete'; id: string }
  | { type: 'snippet/use'; id: string }
  | { type: 'audit/clear' }
  | { type: 'post/add'; post: SocialPost }
  | { type: 'post/status'; id: string; status: SocialPost['status'] }
  | { type: 'site/toggle'; id: string }
  | { type: 'site/step/add'; siteId: string; page: SitePage }
  | { type: 'site/step/update'; siteId: string; id: string; patch: Partial<SitePage> }
  | { type: 'site/step/move'; siteId: string; id: string; direction: 'up' | 'down' }
  | { type: 'site/step/delete'; siteId: string; id: string }
  | { type: 'site/checkout/set'; siteId: string; productId: string }
  | { type: 'site/bump/add'; siteId: string; bump: OrderBump }
  | { type: 'site/bump/update'; siteId: string; id: string; patch: Partial<OrderBump> }
  | { type: 'site/bump/delete'; siteId: string; id: string }
  | { type: 'site/duplicate'; copy: Site }
  | { type: 'report/add'; report: SavedReport }
  | { type: 'report/delete'; id: string }
  | { type: 'widget/add'; widget: DashboardWidget }
  | { type: 'widget/delete'; id: string }
  | { type: 'widget/move'; id: string; direction: 'up' | 'down' }
  | { type: 'gateway/toggle'; id: string }
  | { type: 'gateway/mode'; id: string; mode: PaymentGateway['mode'] }
  | { type: 'store/checkout'; order: Order; invoice: Invoice; couponId?: string }
  | { type: 'reviewRequest/add'; request: ReviewRequest }
  | { type: 'reviewRequest/send'; id: string }
  | { type: 'reviewRequest/delete'; id: string }
  | { type: 'campaign/add'; campaign: Campaign }
  | { type: 'form/add'; form: FormDef }
  | { type: 'form/update'; id: string; patch: Partial<Pick<FormDef, 'name' | 'kind' | 'completion'>> }
  | { type: 'form/toggle'; id: string }
  | { type: 'form/field/add'; formId: string; field: FormField }
  | { type: 'form/field/update'; formId: string; id: string; patch: Partial<FormField> }
  | { type: 'form/field/delete'; formId: string; id: string }
  | { type: 'form/field/move'; formId: string; id: string; direction: 'up' | 'down' }
  | { type: 'workflow/toggle'; id: string }
  | { type: 'workflow/add'; workflow: Workflow }
  | { type: 'workflow/update'; id: string; patch: Partial<Pick<Workflow, 'name' | 'trigger'>> }
  | { type: 'workflow/step/add'; workflowId: string; step: WorkflowAction; parentId?: string; branch?: 'yes' | 'no' }
  | { type: 'workflow/step/update'; workflowId: string; id: string; patch: Partial<WorkflowAction> }
  | { type: 'workflow/step/delete'; workflowId: string; id: string }
  | { type: 'workflow/step/move'; workflowId: string; id: string; direction: 'up' | 'down' }
  | { type: 'workflow/run/add'; run: WorkflowRun }
  | { type: 'integration/toggle'; id: string }
  | { type: 'review/reply'; id: string; reply: string }
  | { type: 'review/status'; id: string; status: 'new' | 'flagged' }
  | { type: 'listing/toggle'; id: string }
  | { type: 'course/toggle'; id: string }
  | { type: 'course/add'; course: Course }
  | { type: 'course/update'; id: string; patch: Partial<Course> }
  | { type: 'lesson/add'; courseId: string; lesson: Lesson }
  | { type: 'lesson/update'; courseId: string; id: string; patch: Partial<Lesson> }
  | { type: 'lesson/delete'; courseId: string; id: string }
  | { type: 'subAccount/add'; account: SubAccount }
  | { type: 'subAccount/update'; id: string; patch: Partial<SubAccount> }
  | { type: 'subAccount/status'; id: string; status: SubAccount['status'] }
  | { type: 'subAccount/delete'; id: string }
  | { type: 'plan/update'; id: string; patch: Partial<SaasPlan> }
  | { type: 'document/add'; document: ContractDoc }
  | { type: 'document/status'; id: string; status: ContractDoc['status'] }
  | { type: 'media/add'; asset: MediaAsset }
  | { type: 'media/delete'; id: string }
  | { type: 'prospect/status'; id: string; status: 'new' | 'contacted' | 'qualified' | 'skipped' }
  | { type: 'order/status'; id: string; status: 'paid' | 'pending' | 'refunded' }
  | { type: 'subscription/status'; id: string; status: 'active' | 'past_due' | 'canceled' }
  | { type: 'affiliate/status'; id: string; status: 'active' | 'pending' | 'paused' }
  | { type: 'template/use'; id: string }
  | { type: 'template/add'; template: EmailTemplate }
  | { type: 'template/update'; id: string; patch: Partial<Pick<EmailTemplate, 'name' | 'category' | 'subject' | 'body'>> }
  | { type: 'template/delete'; id: string }
  | { type: 'triggerLink/add'; link: TriggerLink }
  | { type: 'triggerLink/click'; id: string }
  | { type: 'blog/toggle'; id: string }
  | { type: 'qr/add'; code: QrCode }
  | { type: 'smartList/add'; list: SmartList }
  | { type: 'customField/add'; field: CustomField }
  | { type: 'team/add'; member: TeamMember }
  | { type: 'team/role'; id: string; role: TeamMember['role'] }
  | { type: 'call/log'; call: CallRecord }
  | { type: 'call/handled'; id: string }
  | { type: 'call/delete'; id: string }
  | {
      type: 'number/update';
      id: string;
      patch: Partial<Pick<PhoneNumber, 'label' | 'assignedTo' | 'status' | 'voice' | 'sms'>>;
    }
  | { type: 'snapshot/create'; id: string; name: string }
  | { type: 'snapshot/restore'; id: string }
  | { type: 'snapshot/delete'; id: string }
  | { type: 'notifications/readAll' }
  | { type: 'workspace/reset' };

function pruneContacts(state: WorkspaceState, ids: Set<string>): WorkspaceState {
  const keep = (contactId: string) => !ids.has(contactId);
  return {
    ...state,
    contacts: state.contacts.filter((c) => keep(c.id)),
    opportunities: state.opportunities.filter((o) => keep(o.contactId)),
    conversations: state.conversations.filter((c) => keep(c.contactId)),
    appointments: state.appointments.filter((a) => keep(a.contactId)),
    invoices: state.invoices.filter((i) => keep(i.contactId)),
    enrollments: state.enrollments.filter((e) => keep(e.contactId)),
    reviews: state.reviews.filter((r) => keep(r.contactId)),
    reviewRequests: state.reviewRequests.filter((r) => keep(r.contactId)),
    documents: state.documents.filter((d) => keep(d.contactId)),
    orders: state.orders.filter((o) => keep(o.contactId)),
    subscriptions: state.subscriptions.filter((s) => keep(s.contactId)),
    tasks: state.tasks.filter((t) => !t.contactId || keep(t.contactId)),
    workflowRuns: state.workflowRuns.filter((r) => keep(r.contactId)),
    calls: state.calls.filter((c) => keep(c.contactId)),
  };
}

interface StepLocation {
  list: WorkflowAction[];
  index: number;
  /** Rebuilds the workflow with this step list replaced. */
  replace: (next: WorkflowAction[]) => Workflow;
}

/** Finds a step in the top-level flow or in a condition's one-level branch. */
function locateStep(flow: Workflow, id: string): StepLocation | null {
  const topIndex = flow.actions.findIndex((step) => step.id === id);
  if (topIndex >= 0) {
    return { list: flow.actions, index: topIndex, replace: (next) => ({ ...flow, actions: next }) };
  }
  for (const parent of flow.actions) {
    if (parent.kind !== 'condition') continue;
    for (const branch of ['yes', 'no'] as const) {
      const list = parent[branch];
      if (!list) continue;
      const index = list.findIndex((step) => step.id === id);
      if (index < 0) continue;
      return {
        list,
        index,
        replace: (next) => ({
          ...flow,
          actions: flow.actions.map((step) =>
            step.id === parent.id
              ? branch === 'yes'
                ? { ...step, yes: next }
                : { ...step, no: next }
              : step,
          ),
        }),
      };
    }
  }
  return null;
}

function applyAction(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'contact/add':
      return { ...state, contacts: [action.contact, ...state.contacts] };

    case 'contact/update':
      return {
        ...state,
        contacts: state.contacts.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case 'contact/delete':
      return pruneContacts(state, new Set([action.id]));

    case 'contact/bulkTag': {
      const ids = new Set(action.ids);
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          ids.has(c.id) && !c.tags.includes(action.tag) ? { ...c, tags: [...c.tags, action.tag] } : c,
        ),
      };
    }

    case 'contact/bulkStatus': {
      const ids = new Set(action.ids);
      return {
        ...state,
        contacts: state.contacts.map((c) => (ids.has(c.id) ? { ...c, status: action.status } : c)),
      };
    }

    case 'contact/bulkDelete':
      return pruneContacts(state, new Set(action.ids));

    case 'contact/note': {
      const note: Note = { id: uid('note'), body: action.body, at: new Date().toISOString(), author: action.author };
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          c.id === action.id ? { ...c, notes: [note, ...c.notes] } : c,
        ),
      };
    }

    case 'opportunity/add':
      return { ...state, opportunities: [action.opportunity, ...state.opportunities] };

    case 'opportunity/move':
      return {
        ...state,
        opportunities: state.opportunities.map((o) =>
          o.id === action.id ? { ...o, stageId: action.stageId } : o,
        ),
      };

    case 'opportunity/delete':
      return { ...state, opportunities: state.opportunities.filter((o) => o.id !== action.id) };

    case 'conversation/send':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.id
            ? {
                ...c,
                unread: 0,
                messages: [
                  ...c.messages,
                  {
                    id: uid('msg'),
                    direction: 'out',
                    subject: action.subject,
                    body: action.body,
                    at: new Date().toISOString(),
                  },
                ],
              }
            : c,
        ),
      };

    case 'conversation/start': {
      const message = {
        id: uid('msg'),
        direction: 'out' as const,
        subject: action.subject,
        body: action.body,
        at: new Date().toISOString(),
      };
      const existing = state.conversations.find(
        (c) => c.contactId === action.contactId && c.channel === action.channel,
      );
      if (existing) {
        return {
          ...state,
          conversations: state.conversations.map((c) =>
            c.id === existing.id ? { ...c, unread: 0, messages: [...c.messages, message] } : c,
          ),
        };
      }
      return {
        ...state,
        conversations: [
          {
            id: action.id,
            contactId: action.contactId,
            channel: action.channel,
            unread: 0,
            starred: false,
            messages: [message],
          },
          ...state.conversations,
        ],
      };
    }

    case 'conversation/read':
      return {
        ...state,
        conversations: state.conversations.map((c) => (c.id === action.id ? { ...c, unread: 0 } : c)),
      };

    case 'conversation/star':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.id ? { ...c, starred: !c.starred } : c,
        ),
      };

    case 'appointment/add':
      return { ...state, appointments: [...state.appointments, action.appointment] };

    case 'appointment/status':
      return {
        ...state,
        appointments: state.appointments.map((a) =>
          a.id === action.id ? { ...a, status: action.status } : a,
        ),
      };

    case 'appointment/delete':
      return { ...state, appointments: state.appointments.filter((a) => a.id !== action.id) };

    case 'calendar/update':
      return {
        ...state,
        calendars: state.calendars.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case 'invoice/add':
      return { ...state, invoices: [action.invoice, ...state.invoices] };

    case 'invoice/status':
      return {
        ...state,
        invoices: state.invoices.map((i) => (i.id === action.id ? { ...i, status: action.status } : i)),
      };

    case 'product/toggle':
      return {
        ...state,
        products: state.products.map((p) => (p.id === action.id ? { ...p, active: !p.active } : p)),
      };

    case 'product/add':
      return { ...state, products: [...state.products, action.product] };

    case 'product/update':
      return {
        ...state,
        products: state.products.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };

    case 'paymentLink/add':
      return { ...state, paymentLinks: [action.link, ...state.paymentLinks] };

    case 'paymentLink/toggle':
      return {
        ...state,
        paymentLinks: state.paymentLinks.map((l) =>
          l.id === action.id ? { ...l, active: !l.active } : l,
        ),
      };

    case 'paymentLink/visit':
      return {
        ...state,
        paymentLinks: state.paymentLinks.map((l) =>
          l.id === action.id ? { ...l, visits: l.visits + 1 } : l,
        ),
      };

    case 'task/add':
      return { ...state, tasks: [action.task, ...state.tasks] };

    case 'task/toggle':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t)),
      };

    case 'task/delete':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };

    case 'coupon/add':
      return { ...state, coupons: [action.coupon, ...state.coupons] };

    case 'coupon/update':
      return {
        ...state,
        coupons: state.coupons.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case 'coupon/toggle':
      return {
        ...state,
        coupons: state.coupons.map((c) => (c.id === action.id ? { ...c, active: !c.active } : c)),
      };

    case 'coupon/delete':
      return { ...state, coupons: state.coupons.filter((c) => c.id !== action.id) };

    case 'customValue/add':
      return { ...state, customValues: [...state.customValues, action.customValue] };

    case 'customValue/update':
      return {
        ...state,
        customValues: state.customValues.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c,
        ),
      };

    case 'customValue/delete':
      return { ...state, customValues: state.customValues.filter((c) => c.id !== action.id) };

    case 'snippet/add':
      return { ...state, snippets: [action.snippet, ...state.snippets] };

    case 'snippet/update':
      return {
        ...state,
        snippets: state.snippets.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      };

    case 'snippet/delete':
      return { ...state, snippets: state.snippets.filter((s) => s.id !== action.id) };

    case 'snippet/use':
      return {
        ...state,
        snippets: state.snippets.map((s) => (s.id === action.id ? { ...s, uses: s.uses + 1 } : s)),
      };

    case 'audit/clear':
      return { ...state, auditLog: [] };

    case 'post/add':
      return { ...state, posts: [action.post, ...state.posts] };

    case 'post/status':
      return {
        ...state,
        posts: state.posts.map((p) => (p.id === action.id ? { ...p, status: action.status } : p)),
      };

    case 'site/toggle':
      return {
        ...state,
        sites: state.sites.map((s) => (s.id === action.id ? { ...s, published: !s.published } : s)),
      };

    case 'site/step/add':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId ? { ...s, pages: [...s.pages, action.page] } : s,
        ),
      };

    case 'site/step/update':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId
            ? {
                ...s,
                pages: s.pages.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
              }
            : s,
        ),
      };

    case 'site/step/move':
      return {
        ...state,
        sites: state.sites.map((s) => {
          if (s.id !== action.siteId) return s;
          const idx = s.pages.findIndex((p) => p.id === action.id);
          const target = action.direction === 'up' ? idx - 1 : idx + 1;
          if (idx < 0 || target < 0 || target >= s.pages.length) return s;
          const pages = [...s.pages];
          [pages[idx], pages[target]] = [pages[target], pages[idx]];
          return { ...s, pages };
        }),
      };

    case 'site/step/delete':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId ? { ...s, pages: s.pages.filter((p) => p.id !== action.id) } : s,
        ),
      };

    case 'site/checkout/set':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId
            ? { ...s, checkout: { productId: action.productId, bumps: s.checkout?.bumps ?? [] } }
            : s,
        ),
      };

    case 'site/bump/add':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId && s.checkout
            ? { ...s, checkout: { ...s.checkout, bumps: [...s.checkout.bumps, action.bump] } }
            : s,
        ),
      };

    case 'site/bump/update':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId && s.checkout
            ? {
                ...s,
                checkout: {
                  ...s.checkout,
                  bumps: s.checkout.bumps.map((b) =>
                    b.id === action.id ? { ...b, ...action.patch } : b,
                  ),
                },
              }
            : s,
        ),
      };

    case 'site/bump/delete':
      return {
        ...state,
        sites: state.sites.map((s) =>
          s.id === action.siteId && s.checkout
            ? {
                ...s,
                checkout: {
                  ...s.checkout,
                  bumps: s.checkout.bumps.filter((b) => b.id !== action.id),
                },
              }
            : s,
        ),
      };

    case 'site/duplicate':
      return { ...state, sites: [action.copy, ...state.sites] };

    case 'report/add':
      return { ...state, savedReports: [action.report, ...state.savedReports] };

    case 'report/delete':
      return { ...state, savedReports: state.savedReports.filter((r) => r.id !== action.id) };

    case 'widget/add':
      return { ...state, dashboardWidgets: [...state.dashboardWidgets, action.widget] };

    case 'widget/delete':
      return {
        ...state,
        dashboardWidgets: state.dashboardWidgets.filter((w) => w.id !== action.id),
      };

    case 'widget/move': {
      const idx = state.dashboardWidgets.findIndex((w) => w.id === action.id);
      const target = action.direction === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= state.dashboardWidgets.length) return state;
      const dashboardWidgets = [...state.dashboardWidgets];
      [dashboardWidgets[idx], dashboardWidgets[target]] = [dashboardWidgets[target], dashboardWidgets[idx]];
      return { ...state, dashboardWidgets };
    }

    case 'gateway/toggle':
      return {
        ...state,
        paymentGateways: state.paymentGateways.map((g) =>
          g.id === action.id ? { ...g, connected: !g.connected } : g,
        ),
      };

    case 'gateway/mode':
      return {
        ...state,
        paymentGateways: state.paymentGateways.map((g) =>
          g.id === action.id ? { ...g, mode: action.mode } : g,
        ),
      };

    case 'store/checkout':
      return {
        ...state,
        orders: [action.order, ...state.orders],
        invoices: [action.invoice, ...state.invoices],
        coupons: action.couponId
          ? state.coupons.map((c) =>
              c.id === action.couponId ? { ...c, redemptions: c.redemptions + 1 } : c,
            )
          : state.coupons,
      };

    case 'reviewRequest/add':
      return { ...state, reviewRequests: [action.request, ...state.reviewRequests] };

    case 'reviewRequest/send':
      return {
        ...state,
        reviewRequests: state.reviewRequests.map((r) =>
          r.id === action.id ? { ...r, sentAt: new Date().toISOString() } : r,
        ),
      };

    case 'reviewRequest/delete':
      return {
        ...state,
        reviewRequests: state.reviewRequests.filter((r) => r.id !== action.id),
      };

    case 'campaign/add':
      return { ...state, campaigns: [action.campaign, ...state.campaigns] };

    case 'form/add':
      return { ...state, forms: [action.form, ...state.forms] };

    case 'form/update':
      return {
        ...state,
        forms: state.forms.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)),
      };

    case 'form/toggle':
      return {
        ...state,
        forms: state.forms.map((f) => (f.id === action.id ? { ...f, published: !f.published } : f)),
      };

    case 'form/field/add':
      return {
        ...state,
        forms: state.forms.map((f) =>
          f.id === action.formId ? { ...f, fields: [...f.fields, action.field] } : f,
        ),
      };

    case 'form/field/update':
      return {
        ...state,
        forms: state.forms.map((f) =>
          f.id === action.formId
            ? {
                ...f,
                fields: f.fields.map((field) =>
                  field.id === action.id ? { ...field, ...action.patch } : field,
                ),
              }
            : f,
        ),
      };

    case 'form/field/delete':
      return {
        ...state,
        forms: state.forms.map((f) =>
          f.id === action.formId
            ? { ...f, fields: f.fields.filter((field) => field.id !== action.id) }
            : f,
        ),
      };

    case 'form/field/move': {
      const form = state.forms.find((f) => f.id === action.formId);
      if (!form) return state;
      const index = form.fields.findIndex((field) => field.id === action.id);
      const target = action.direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= form.fields.length) return state;
      const fields = [...form.fields];
      [fields[index], fields[target]] = [fields[target], fields[index]];
      return { ...state, forms: state.forms.map((f) => (f.id === form.id ? { ...f, fields } : f)) };
    }

    case 'workflow/toggle':
      return {
        ...state,
        workflows: state.workflows.map((w) =>
          w.id === action.id ? { ...w, status: w.status === 'published' ? 'draft' : 'published' } : w,
        ),
      };

    case 'workflow/add':
      return { ...state, workflows: [action.workflow, ...state.workflows] };

    case 'workflow/update':
      return {
        ...state,
        workflows: state.workflows.map((w) =>
          w.id === action.id ? { ...w, ...action.patch } : w,
        ),
      };

    case 'workflow/step/add':
      return {
        ...state,
        workflows: state.workflows.map((w) => {
          if (w.id !== action.workflowId) return w;
          if (!action.parentId || !action.branch) {
            return { ...w, actions: [...w.actions, action.step] };
          }
          return {
            ...w,
            actions: w.actions.map((step) => {
              if (step.id !== action.parentId) return step;
              return action.branch === 'yes'
                ? { ...step, yes: [...(step.yes ?? []), action.step] }
                : { ...step, no: [...(step.no ?? []), action.step] };
            }),
          };
        }),
      };

    case 'workflow/step/update': {
      // Branches only exist under condition steps; dropping the condition kind drops them too.
      const patch =
        action.patch.kind && action.patch.kind !== 'condition'
          ? { ...action.patch, yes: undefined, no: undefined }
          : action.patch;
      return {
        ...state,
        workflows: state.workflows.map((w) => {
          if (w.id !== action.workflowId) return w;
          const loc = locateStep(w, action.id);
          if (!loc) return w;
          return loc.replace(
            loc.list.map((step, i) => (i === loc.index ? { ...step, ...patch } : step)),
          );
        }),
      };
    }

    case 'workflow/step/delete':
      return {
        ...state,
        workflows: state.workflows.map((w) => {
          if (w.id !== action.workflowId) return w;
          const loc = locateStep(w, action.id);
          if (!loc) return w;
          return loc.replace(loc.list.filter((_, i) => i !== loc.index));
        }),
      };

    case 'workflow/step/move': {
      return {
        ...state,
        workflows: state.workflows.map((w) => {
          if (w.id !== action.workflowId) return w;
          const loc = locateStep(w, action.id);
          if (!loc) return w;
          const target = action.direction === 'up' ? loc.index - 1 : loc.index + 1;
          if (target < 0 || target >= loc.list.length) return w;
          const next = [...loc.list];
          [next[loc.index], next[target]] = [next[target], next[loc.index]];
          return loc.replace(next);
        }),
      };
    }

    case 'workflow/run/add':
      return { ...state, workflowRuns: [action.run, ...state.workflowRuns].slice(0, 40) };

    case 'integration/toggle':
      return {
        ...state,
        integrations: state.integrations.map((i) =>
          i.id === action.id ? { ...i, connected: !i.connected } : i,
        ),
      };

    case 'review/reply':
      return {
        ...state,
        reviews: state.reviews.map((r) =>
          r.id === action.id ? { ...r, reply: action.reply, status: 'replied' } : r,
        ),
      };

    case 'review/status':
      return {
        ...state,
        reviews: state.reviews.map((r) => (r.id === action.id ? { ...r, status: action.status } : r)),
      };

    case 'listing/toggle':
      return {
        ...state,
        listings: state.listings.map((l) => (l.id === action.id ? { ...l, connected: !l.connected } : l)),
      };

    case 'course/toggle':
      return {
        ...state,
        courses: state.courses.map((c) => (c.id === action.id ? { ...c, published: !c.published } : c)),
      };

    case 'course/add':
      return { ...state, courses: [action.course, ...state.courses] };

    case 'course/update':
      return {
        ...state,
        courses: state.courses.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case 'lesson/add':
      return {
        ...state,
        courses: state.courses.map((c) =>
          c.id === action.courseId ? { ...c, curriculum: [...c.curriculum, action.lesson] } : c,
        ),
      };

    case 'lesson/update':
      return {
        ...state,
        courses: state.courses.map((c) =>
          c.id === action.courseId
            ? {
                ...c,
                curriculum: c.curriculum.map((l) =>
                  l.id === action.id ? { ...l, ...action.patch } : l,
                ),
              }
            : c,
        ),
      };

    case 'lesson/delete':
      return {
        ...state,
        courses: state.courses.map((c) =>
          c.id === action.courseId
            ? { ...c, curriculum: c.curriculum.filter((l) => l.id !== action.id) }
            : c,
        ),
      };

    case 'subAccount/add':
      return { ...state, subAccounts: [action.account, ...state.subAccounts] };

    case 'subAccount/update':
      return {
        ...state,
        subAccounts: state.subAccounts.map((a) =>
          a.id === action.id ? { ...a, ...action.patch } : a,
        ),
      };

    case 'subAccount/status':
      return {
        ...state,
        subAccounts: state.subAccounts.map((a) =>
          a.id === action.id ? { ...a, status: action.status } : a,
        ),
      };

    case 'subAccount/delete':
      return { ...state, subAccounts: state.subAccounts.filter((a) => a.id !== action.id) };

    case 'plan/update':
      return {
        ...state,
        saasPlans: state.saasPlans.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };

    case 'document/add':
      return { ...state, documents: [action.document, ...state.documents] };

    case 'document/status':
      return {
        ...state,
        documents: state.documents.map((d) =>
          d.id === action.id ? { ...d, status: action.status, updatedAt: new Date().toISOString() } : d,
        ),
      };

    case 'media/add':
      return { ...state, media: [action.asset, ...state.media] };

    case 'media/delete':
      return { ...state, media: state.media.filter((m) => m.id !== action.id) };

    case 'prospect/status':
      return {
        ...state,
        prospects: state.prospects.map((p) => (p.id === action.id ? { ...p, status: action.status } : p)),
      };

    case 'order/status':
      return {
        ...state,
        orders: state.orders.map((o) => (o.id === action.id ? { ...o, status: action.status } : o)),
      };

    case 'subscription/status':
      return {
        ...state,
        subscriptions: state.subscriptions.map((s) =>
          s.id === action.id ? { ...s, status: action.status } : s,
        ),
      };

    case 'affiliate/status':
      return {
        ...state,
        affiliates: state.affiliates.map((a) => (a.id === action.id ? { ...a, status: action.status } : a)),
      };

    case 'template/use':
      return {
        ...state,
        templates: state.templates.map((t) => (t.id === action.id ? { ...t, uses: t.uses + 1 } : t)),
      };

    case 'template/add':
      return { ...state, templates: [action.template, ...state.templates] };

    case 'template/update':
      return {
        ...state,
        templates: state.templates.map((t) =>
          t.id === action.id ? { ...t, ...action.patch, updatedAt: new Date().toISOString() } : t,
        ),
      };

    case 'template/delete':
      return { ...state, templates: state.templates.filter((t) => t.id !== action.id) };

    case 'triggerLink/add':
      return { ...state, triggerLinks: [action.link, ...state.triggerLinks] };

    case 'triggerLink/click':
      return {
        ...state,
        triggerLinks: state.triggerLinks.map((l) =>
          l.id === action.id
            ? { ...l, clicks: l.clicks + 1, lastClickAt: new Date().toISOString() }
            : l,
        ),
      };

    case 'blog/toggle':
      return {
        ...state,
        blogs: state.blogs.map((b) =>
          b.id === action.id
            ? {
                ...b,
                status: b.status === 'published' ? 'draft' : 'published',
                publishedAt: b.status === 'published' ? b.publishedAt : new Date().toISOString(),
              }
            : b,
        ),
      };

    case 'qr/add':
      return { ...state, qrCodes: [action.code, ...state.qrCodes] };

    case 'smartList/add':
      return { ...state, smartLists: [action.list, ...state.smartLists] };

    case 'customField/add':
      return { ...state, customFields: [...state.customFields, action.field] };

    case 'team/add':
      return { ...state, team: [...state.team, action.member] };

    case 'team/role':
      return {
        ...state,
        team: state.team.map((m) => (m.id === action.id ? { ...m, role: action.role } : m)),
      };

    case 'notifications/readAll':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };

    case 'call/log':
      return { ...state, calls: [action.call, ...state.calls] };

    case 'call/handled':
      return {
        ...state,
        calls: state.calls.map((c) => (c.id === action.id ? { ...c, handled: true } : c)),
      };

    case 'call/delete':
      return { ...state, calls: state.calls.filter((c) => c.id !== action.id) };

    case 'number/update':
      return {
        ...state,
        phoneNumbers: state.phoneNumbers.map((n) =>
          n.id === action.id ? { ...n, ...action.patch } : n,
        ),
      };

    case 'snapshot/create': {
      // Neither the archive itself nor the live audit trail is copied into a snapshot.
      const { snapshots, auditLog, ...data } = state;
      void auditLog;
      const snapshot: Snapshot = {
        id: action.id,
        name: action.name,
        createdAt: new Date().toISOString(),
        data,
      };
      return { ...state, snapshots: [snapshot, ...snapshots].slice(0, SNAPSHOT_LIMIT) };
    }

    case 'snapshot/restore': {
      const snapshot = state.snapshots.find((s) => s.id === action.id);
      if (!snapshot) return state;
      // The archive and audit trail stay as they are; everything else rolls back.
      return { ...snapshot.data, snapshots: state.snapshots, auditLog: state.auditLog };
    }

    case 'snapshot/delete':
      return { ...state, snapshots: state.snapshots.filter((s) => s.id !== action.id) };

    case 'workspace/reset':
      return seed;

    default:
      return state;
  }
}

/**
 * Describes the workspace change for the audit log. Returning null keeps an
 * action out of the log (reads, resets and high-frequency pings).
 */
function auditMeta(
  state: WorkspaceState,
  action: Action,
): Pick<AuditEntry, 'action' | 'entity' | 'detail'> | null {
  const contactName = (id: string) => {
    const c = state.contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };
  const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id);

  switch (action.type) {
    case 'contact/add':
      return {
        action: 'Contact created',
        entity: 'Contact',
        detail: `${action.contact.firstName} ${action.contact.lastName}`,
      };
    case 'contact/update':
      return { action: 'Contact updated', entity: 'Contact', detail: contactName(action.id) };
    case 'contact/delete':
      return { action: 'Contact deleted', entity: 'Contact', detail: contactName(action.id) };
    case 'contact/bulkTag':
      return {
        action: 'Contacts tagged',
        entity: 'Contact',
        detail: `${action.ids.length} contact${action.ids.length === 1 ? '' : 's'} · ${action.tag}`,
      };
    case 'contact/bulkStatus':
      return {
        action: 'Contacts status changed',
        entity: 'Contact',
        detail: `${action.ids.length} contact${action.ids.length === 1 ? '' : 's'} → ${action.status}`,
      };
    case 'contact/bulkDelete':
      return {
        action: 'Contacts deleted',
        entity: 'Contact',
        detail: `${action.ids.length} contact${action.ids.length === 1 ? '' : 's'}`,
      };
    case 'contact/note':
      return { action: 'Note added', entity: 'Contact', detail: contactName(action.id) };

    case 'opportunity/add':
      return { action: 'Opportunity created', entity: 'Opportunity', detail: action.opportunity.name };
    case 'opportunity/move': {
      const opp = byId(state.opportunities, action.id);
      const stage = state.pipelines.flatMap((p) => p.stages).find((s) => s.id === action.stageId);
      return {
        action: 'Opportunity stage changed',
        entity: 'Opportunity',
        detail: opp && stage ? `${opp.name} → ${stage.name}` : opp?.name,
      };
    }
    case 'opportunity/delete':
      return {
        action: 'Opportunity deleted',
        entity: 'Opportunity',
        detail: byId(state.opportunities, action.id)?.name,
      };

    case 'appointment/add':
      return { action: 'Appointment booked', entity: 'Calendar', detail: action.appointment.title };
    case 'appointment/status':
      return {
        action: 'Appointment status changed',
        entity: 'Calendar',
        detail: byId(state.appointments, action.id)?.title,
      };
    case 'calendar/update': {
      const calendar = byId(state.calendars, action.id);
      return {
        action: 'Calendar booking rules updated',
        entity: 'Calendar',
        detail: calendar
          ? `${calendar.name}${action.patch.roundRobin !== undefined ? (action.patch.roundRobin ? ' · round-robin on' : ' · round-robin off') : ''}`
          : undefined,
      };
    }

    case 'invoice/add':
      return { action: 'Invoice created', entity: 'Invoice', detail: action.invoice.number };
    case 'invoice/status': {
      const invoice = byId(state.invoices, action.id);
      return {
        action: `Invoice marked ${action.status}`,
        entity: 'Invoice',
        detail: invoice ? `${invoice.number} · $${invoice.amount.toLocaleString('en-US')}` : undefined,
      };
    }

    case 'product/add':
      return { action: 'Product created', entity: 'Product', detail: action.product.name };
    case 'product/update':
      return {
        action: 'Product updated',
        entity: 'Product',
        detail: action.patch.name ?? byId(state.products, action.id)?.name,
      };
    case 'product/toggle': {
      const product = byId(state.products, action.id);
      return {
        action: `Product ${product?.active ? 'paused' : 'enabled'}`,
        entity: 'Product',
        detail: product?.name,
      };
    }

    case 'paymentLink/add':
      return { action: 'Payment link created', entity: 'Payment Link', detail: action.link.name };
    case 'paymentLink/toggle': {
      const link = byId(state.paymentLinks, action.id);
      return {
        action: `Payment link ${link?.active ? 'paused' : 'enabled'}`,
        entity: 'Payment Link',
        detail: link?.name,
      };
    }

    case 'task/add':
      return { action: 'Task created', entity: 'Task', detail: action.task.title };
    case 'task/toggle': {
      const task = byId(state.tasks, action.id);
      return {
        action: `Task ${task?.done ? 'reopened' : 'completed'}`,
        entity: 'Task',
        detail: task?.title,
      };
    }
    case 'task/delete':
      return { action: 'Task deleted', entity: 'Task', detail: byId(state.tasks, action.id)?.title };

    case 'coupon/add':
      return {
        action: 'Coupon created',
        entity: 'Coupon',
        detail: `${action.coupon.code} · ${action.coupon.kind === 'percent' ? `${action.coupon.value}% off` : `$${action.coupon.value} off`}`,
      };
    case 'coupon/update':
      return {
        action: 'Coupon updated',
        entity: 'Coupon',
        detail: action.patch.code ?? byId(state.coupons, action.id)?.code,
      };
    case 'coupon/toggle': {
      const coupon = byId(state.coupons, action.id);
      return {
        action: `Coupon ${coupon?.active ? 'paused' : 'enabled'}`,
        entity: 'Coupon',
        detail: coupon?.code,
      };
    }
    case 'coupon/delete':
      return { action: 'Coupon deleted', entity: 'Coupon', detail: byId(state.coupons, action.id)?.code };

    case 'customValue/add':
      return { action: 'Custom value created', entity: 'Custom Value', detail: action.customValue.name };
    case 'customValue/update':
      return {
        action: 'Custom value updated',
        entity: 'Custom Value',
        detail: action.patch.name ?? byId(state.customValues, action.id)?.name,
      };
    case 'customValue/delete':
      return {
        action: 'Custom value deleted',
        entity: 'Custom Value',
        detail: byId(state.customValues, action.id)?.name,
      };

    case 'snippet/add':
      return { action: 'Snippet created', entity: 'Snippet', detail: action.snippet.label };
    case 'snippet/update':
      return {
        action: 'Snippet updated',
        entity: 'Snippet',
        detail: action.patch.label ?? byId(state.snippets, action.id)?.label,
      };
    case 'snippet/delete':
      return {
        action: 'Snippet deleted',
        entity: 'Snippet',
        detail: byId(state.snippets, action.id)?.label,
      };

    case 'document/add':
      return { action: 'Document created', entity: 'Document', detail: action.document.name };
    case 'document/status':
      return {
        action: `Document marked ${action.status}`,
        entity: 'Document',
        detail: byId(state.documents, action.id)?.name,
      };

    case 'campaign/add':
      return { action: 'Campaign created', entity: 'Campaign', detail: action.campaign.name };

    case 'form/add':
      return { action: 'Form created', entity: 'Form', detail: action.form.name };
    case 'form/update':
      return {
        action: 'Form updated',
        entity: 'Form',
        detail: action.patch.name ?? byId(state.forms, action.id)?.name,
      };
    case 'form/field/add':
      return {
        action: 'Form field added',
        entity: 'Form',
        detail: `${byId(state.forms, action.formId)?.name ?? 'Form'} · ${action.field.label}`,
      };
    case 'form/field/update': {
      const form = byId(state.forms, action.formId);
      return {
        action: 'Form field updated',
        entity: 'Form',
        detail: action.patch.label ?? byId(form?.fields ?? [], action.id)?.label,
      };
    }
    case 'form/field/delete': {
      const form = byId(state.forms, action.formId);
      return {
        action: 'Form field removed',
        entity: 'Form',
        detail: byId(form?.fields ?? [], action.id)?.label,
      };
    }
    case 'form/field/move':
      return {
        action: 'Form field reordered',
        entity: 'Form',
        detail: byId(state.forms, action.formId)?.name,
      };

    case 'workflow/add':
      return { action: 'Workflow created', entity: 'Workflow', detail: action.workflow.name };
    case 'workflow/update':
      return {
        action: 'Workflow updated',
        entity: 'Workflow',
        detail: action.patch.name ?? byId(state.workflows, action.id)?.name,
      };
    case 'workflow/step/add':
      return {
        action: 'Workflow step added',
        entity: 'Workflow',
        detail: `${byId(state.workflows, action.workflowId)?.name ?? 'Workflow'} · ${action.step.label}`,
      };
    case 'workflow/step/update': {
      const flow = byId(state.workflows, action.workflowId);
      const loc = flow ? locateStep(flow, action.id) : null;
      return {
        action: 'Workflow step updated',
        entity: 'Workflow',
        detail: action.patch.label ?? (loc ? loc.list[loc.index].label : undefined),
      };
    }
    case 'workflow/step/delete': {
      const flow = byId(state.workflows, action.workflowId);
      const loc = flow ? locateStep(flow, action.id) : null;
      return {
        action: 'Workflow step removed',
        entity: 'Workflow',
        detail: loc ? loc.list[loc.index].label : undefined,
      };
    }
    case 'workflow/step/move':
      return {
        action: 'Workflow step reordered',
        entity: 'Workflow',
        detail: byId(state.workflows, action.workflowId)?.name,
      };
    case 'workflow/run/add': {
      const flow = byId(state.workflows, action.run.workflowId);
      return {
        action: `Workflow run ${action.run.status}`,
        entity: 'Workflow',
        detail: `${flow?.name ?? 'Workflow'} · ${contactName(action.run.contactId)} · ${action.run.status}`,
      };
    }
    case 'workflow/toggle': {
      const flow = byId(state.workflows, action.id);
      return {
        action: `Workflow ${flow?.status === 'published' ? 'unpublished' : 'published'}`,
        entity: 'Workflow',
        detail: flow?.name,
      };
    }

    case 'course/toggle': {
      const course = byId(state.courses, action.id);
      return {
        action: `Course ${course?.published ? 'unpublished' : 'published'}`,
        entity: 'Membership',
        detail: course?.title,
      };
    }
    case 'course/add':
      return { action: 'Offer created', entity: 'Membership', detail: action.course.title };
    case 'course/update':
      return {
        action: 'Offer updated',
        entity: 'Membership',
        detail: action.patch.title ?? byId(state.courses, action.id)?.title,
      };
    case 'lesson/add': {
      const course = byId(state.courses, action.courseId);
      return {
        action: 'Lesson added',
        entity: 'Membership',
        detail: course ? `${course.title} · ${action.lesson.title}` : action.lesson.title,
      };
    }
    case 'lesson/update': {
      const course = byId(state.courses, action.courseId);
      const lesson = course?.curriculum.find((l) => l.id === action.id);
      return {
        action: 'Lesson updated',
        entity: 'Membership',
        detail: course ? `${course.title} · ${action.patch.title ?? lesson?.title ?? ''}` : action.patch.title,
      };
    }
    case 'lesson/delete': {
      const course = byId(state.courses, action.courseId);
      return {
        action: 'Lesson removed',
        entity: 'Membership',
        detail: course
          ? `${course.title} · ${course.curriculum.find((l) => l.id === action.id)?.title ?? ''}`
          : undefined,
      };
    }
    case 'subAccount/add':
      return { action: 'Sub-account created', entity: 'Sub-account', detail: action.account.name };
    case 'subAccount/update':
      return {
        action: 'Sub-account updated',
        entity: 'Sub-account',
        detail: action.patch.name ?? byId(state.subAccounts, action.id)?.name,
      };
    case 'subAccount/status': {
      const account = byId(state.subAccounts, action.id);
      return {
        action: `Sub-account ${action.status}`,
        entity: 'Sub-account',
        detail: account?.name,
      };
    }
    case 'subAccount/delete':
      return {
        action: 'Sub-account deleted',
        entity: 'Sub-account',
        detail: byId(state.subAccounts, action.id)?.name,
      };
    case 'plan/update':
      return {
        action: 'SaaS plan updated',
        entity: 'SaaS plan',
        detail: action.patch.name ?? byId(state.saasPlans, action.id)?.name,
      };
    case 'blog/toggle': {
      const post = byId(state.blogs, action.id);
      return {
        action: `Blog post ${post?.status === 'published' ? 'unpublished' : 'published'}`,
        entity: 'Blog',
        detail: post?.title,
      };
    }

    case 'team/add':
      return { action: 'Team member added', entity: 'Team', detail: action.member.name };
    case 'team/role': {
      const member = byId(state.team, action.id);
      return {
        action: 'Team role changed',
        entity: 'Team',
        detail: member ? `${member.name} → ${action.role}` : `→ ${action.role}`,
      };
    }
    case 'integration/toggle': {
      const integration = byId(state.integrations, action.id);
      return {
        action: `Integration ${integration?.connected ? 'disconnected' : 'connected'}`,
        entity: 'Integration',
        detail: integration?.name,
      };
    }

    case 'review/reply':
      return {
        action: 'Review replied',
        entity: 'Reputation',
        detail: contactName(byId(state.reviews, action.id)?.contactId ?? ''),
      };
    case 'reviewRequest/add':
      return {
        action: 'Review request scheduled',
        entity: 'Reputation',
        detail: contactName(action.request.contactId),
      };
    case 'reviewRequest/send': {
      const request = byId(state.reviewRequests, action.id);
      return {
        action: 'Review request sent',
        entity: 'Reputation',
        detail: request ? contactName(request.contactId) : undefined,
      };
    }
    case 'reviewRequest/delete': {
      const request = byId(state.reviewRequests, action.id);
      return {
        action: 'Review request deleted',
        entity: 'Reputation',
        detail: request ? contactName(request.contactId) : undefined,
      };
    }
    case 'report/add':
      return { action: 'Report saved', entity: 'Reporting', detail: action.report.name };
    case 'report/delete':
      return {
        action: 'Report deleted',
        entity: 'Reporting',
        detail: byId(state.savedReports, action.id)?.name,
      };
    case 'widget/add':
      return { action: 'Dashboard widget added', entity: 'Reporting', detail: action.widget.title };
    case 'widget/delete':
      return {
        action: 'Dashboard widget removed',
        entity: 'Reporting',
        detail: byId(state.dashboardWidgets, action.id)?.title,
      };
    case 'widget/move':
      return {
        action: 'Dashboard widget reordered',
        entity: 'Reporting',
        detail: byId(state.dashboardWidgets, action.id)?.title,
      };
    case 'gateway/toggle': {
      const gateway = byId(state.paymentGateways, action.id);
      return {
        action: `Payment gateway ${gateway?.connected ? 'disconnected' : 'connected'}`,
        entity: 'Payments',
        detail: gateway?.name,
      };
    }
    case 'gateway/mode': {
      const gateway = byId(state.paymentGateways, action.id);
      return {
        action: `Payment gateway set to ${action.mode}`,
        entity: 'Payments',
        detail: gateway?.name,
      };
    }
    case 'store/checkout':
      return {
        action: 'Store checkout completed',
        entity: 'Store',
        detail: `${action.order.number} · $${action.order.total.toLocaleString('en-US')}${action.order.gateway ? ` · ${action.order.gateway}` : ''}`,
      };
    case 'template/add':
      return { action: 'Template created', entity: 'Template', detail: action.template.name };
    case 'template/update':
      return {
        action: 'Template updated',
        entity: 'Template',
        detail: action.patch.name ?? byId(state.templates, action.id)?.name,
      };
    case 'template/delete':
      return {
        action: 'Template deleted',
        entity: 'Template',
        detail: byId(state.templates, action.id)?.name,
      };
    case 'site/step/add': {
      const site = byId(state.sites, action.siteId);
      const noun = site?.kind === 'website' ? 'Website page' : 'Funnel step';
      return {
        action: `${noun} added`,
        entity: site?.kind === 'website' ? 'Website' : 'Funnel',
        detail: site ? `${site.name} · ${action.page.name}` : action.page.name,
      };
    }
    case 'site/step/update': {
      const site = byId(state.sites, action.siteId);
      const page = site?.pages.find((p) => p.id === action.id);
      const noun = site?.kind === 'website' ? 'Website page' : 'Funnel step';
      return {
        action: `${noun} updated`,
        entity: site?.kind === 'website' ? 'Website' : 'Funnel',
        detail: site ? `${site.name} · ${action.patch.name ?? page?.name ?? ''}` : action.patch.name,
      };
    }
    case 'site/step/move': {
      const site = byId(state.sites, action.siteId);
      const noun = site?.kind === 'website' ? 'Website page' : 'Funnel step';
      return {
        action: `${noun} reordered`,
        entity: site?.kind === 'website' ? 'Website' : 'Funnel',
        detail: site ? `${site.name} · ${site.pages.find((p) => p.id === action.id)?.name ?? ''}` : undefined,
      };
    }
    case 'site/step/delete': {
      const site = byId(state.sites, action.siteId);
      const noun = site?.kind === 'website' ? 'Website page' : 'Funnel step';
      return {
        action: `${noun} removed`,
        entity: site?.kind === 'website' ? 'Website' : 'Funnel',
        detail: site ? `${site.name} · ${site.pages.find((p) => p.id === action.id)?.name ?? ''}` : undefined,
      };
    }
    case 'site/checkout/set': {
      const site = byId(state.sites, action.siteId);
      return {
        action: 'Funnel checkout configured',
        entity: 'Funnel',
        detail: site ? `${site.name} · ${byId(state.products, action.productId)?.name ?? 'Product'}` : undefined,
      };
    }
    case 'site/bump/add': {
      const site = byId(state.sites, action.siteId);
      return {
        action: 'Funnel order bump added',
        entity: 'Funnel',
        detail: site ? `${site.name} · ${action.bump.title}` : action.bump.title,
      };
    }
    case 'site/bump/update': {
      const site = byId(state.sites, action.siteId);
      const bump = site?.checkout?.bumps.find((b) => b.id === action.id);
      return {
        action: 'Funnel order bump updated',
        entity: 'Funnel',
        detail: site ? `${site.name} · ${action.patch.title ?? bump?.title ?? ''}` : action.patch.title,
      };
    }
    case 'site/bump/delete': {
      const site = byId(state.sites, action.siteId);
      const bump = site?.checkout?.bumps.find((b) => b.id === action.id);
      return {
        action: 'Funnel order bump removed',
        entity: 'Funnel',
        detail: site ? `${site.name} · ${bump?.title ?? ''}` : undefined,
      };
    }
    case 'site/duplicate':
      return { action: 'Funnel duplicated', entity: 'Funnel', detail: action.copy.name };
    case 'review/status':
      return {
        action: `Review marked ${action.status}`,
        entity: 'Reputation',
        detail: contactName(byId(state.reviews, action.id)?.contactId ?? ''),
      };

    case 'call/log':
      return {
        action: 'Call logged',
        entity: 'Phone',
        detail: `${contactName(action.call.contactId)} · ${action.call.direction} ${action.call.outcome}`,
      };
    case 'call/handled':
      return {
        action: 'Call marked handled',
        entity: 'Phone',
        detail: contactName(byId(state.calls, action.id)?.contactId ?? ''),
      };
    case 'call/delete':
      return {
        action: 'Call log entry deleted',
        entity: 'Phone',
        detail: contactName(byId(state.calls, action.id)?.contactId ?? ''),
      };
    case 'number/update': {
      const number = byId(state.phoneNumbers, action.id);
      return {
        action: 'Phone number updated',
        entity: 'Phone',
        detail: number ? `${number.label} · ${number.number}` : undefined,
      };
    }
    case 'snapshot/create':
      return { action: 'Snapshot created', entity: 'Snapshot', detail: action.name };
    case 'snapshot/restore':
      return {
        action: 'Snapshot restored',
        entity: 'Snapshot',
        detail: byId(state.snapshots, action.id)?.name,
      };
    case 'snapshot/delete':
      return {
        action: 'Snapshot deleted',
        entity: 'Snapshot',
        detail: byId(state.snapshots, action.id)?.name,
      };

    default:
      return null;
  }
}

export function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  const next = applyAction(state, action);
  if (next === state) return state;
  const meta = auditMeta(state, action);
  if (!meta) return next;
  const entry: AuditEntry = {
    id: uid('au'),
    at: new Date().toISOString(),
    actor: 'Asim R.',
    ...meta,
  };
  return { ...next, auditLog: [entry, ...next.auditLog].slice(0, 250) };
}

function loadInitial(): WorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    // Merge over the seed so a workspace saved by an older build still gets new collections.
    return parsed.contacts ? { ...seed, ...parsed } : seed;
  } catch {
    return seed;
  }
}

interface StoreValue {
  state: WorkspaceState;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota exceeded — keep running in memory */
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

/** Convenience lookup helpers. */
export function useContact(id: string | undefined) {
  const { state } = useStore();
  return state.contacts.find((c) => c.id === id);
}

export function useContactName(id: string): string {
  const contact = useContact(id);
  return contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown contact';
}

export const CHANNEL_META = {
  sms: { label: 'SMS', icon: 'message' },
  email: { label: 'Email', icon: 'mail' },
  facebook: { label: 'Facebook', icon: 'facebook' },
  instagram: { label: 'Instagram', icon: 'instagram' },
  whatsapp: { label: 'WhatsApp', icon: 'whatsapp' },
  webchat: { label: 'Web chat', icon: 'globe' },
} as const;

export const INTEGRATION_CATEGORIES = [
  'Payments', 'Messaging', 'Email', 'Scheduling', 'Advertising', 'Automation', 'Notifications', 'Accounting',
] as const;
