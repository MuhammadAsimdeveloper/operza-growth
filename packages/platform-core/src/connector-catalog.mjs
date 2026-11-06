/**
 * ============================================================================
 * Operza Universal App Connector Catalog
 * ============================================================================
 * 
 * Provides an authoritative, typed catalog of 22+ pre-configured external
 * integrations (Zapier-style) for CRM, Communications, Productivity, Payments,
 * and E-commerce.
 */

export const CONNECTOR_CATEGORIES = Object.freeze([
  'crm',
  'communication',
  'productivity',
  'payments',
  'ecommerce',
  'marketing'
]);

export const CONNECTOR_CATALOG = Object.freeze([
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    authType: 'oauth2',
    icon: 'message',
    description: 'Send alerts, direct messages, and channel notifications in Slack workspaces.',
    supportedTriggers: ['new_channel_message', 'channel_created', 'reaction_added'],
    supportedActions: ['post_message', 'send_direct_message', 'create_channel', 'set_status'],
    documentationUrl: 'https://docs.operza.io/integrations/slack'
  },
  {
    id: 'gmail',
    name: 'Gmail / Google Workspace',
    category: 'communication',
    authType: 'oauth2',
    icon: 'mail',
    description: 'Send emails, draft responses, and watch inbound threads via Google Workspace.',
    supportedTriggers: ['new_email_received', 'new_starred_email', 'new_thread'],
    supportedActions: ['send_email', 'create_draft', 'add_label', 'reply_to_thread'],
    documentationUrl: 'https://docs.operza.io/integrations/gmail'
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    category: 'productivity',
    authType: 'oauth2',
    icon: 'file-text',
    description: 'Append rows, look up spreadsheet data, and update sheets dynamically.',
    supportedTriggers: ['new_spreadsheet_row', 'new_or_updated_row'],
    supportedActions: ['append_row', 'update_row', 'find_row', 'clear_row'],
    documentationUrl: 'https://docs.operza.io/integrations/google-sheets'
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    authType: 'oauth2',
    icon: 'users',
    description: 'Two-way contact synchronization, deal stage mapping, and ticket tracking.',
    supportedTriggers: ['new_contact', 'deal_stage_updated', 'new_ticket'],
    supportedActions: ['create_or_update_contact', 'create_deal', 'update_deal_stage'],
    documentationUrl: 'https://docs.operza.io/integrations/hubspot'
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    authType: 'api_key',
    icon: 'credit-card',
    description: 'Accept credit card payments, track subscriptions, and process refunds.',
    supportedTriggers: ['charge_succeeded', 'invoice_paid', 'customer_subscription_created', 'refund_created'],
    supportedActions: ['create_customer', 'create_payment_intent', 'issue_refund', 'create_invoice'],
    documentationUrl: 'https://docs.operza.io/integrations/stripe'
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'ecommerce',
    authType: 'oauth2',
    icon: 'shopping-bag',
    description: 'Sync store orders, track abandoned carts, and create customer profiles.',
    supportedTriggers: ['order_paid', 'order_fulfilled', 'cart_abandoned', 'customer_created'],
    supportedActions: ['create_order', 'update_inventory', 'create_discount_code'],
    documentationUrl: 'https://docs.operza.io/integrations/shopify'
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'productivity',
    authType: 'api_key',
    icon: 'database',
    description: 'Create records, query views, and trigger workflows from relational tables.',
    supportedTriggers: ['new_record', 'new_record_in_view'],
    supportedActions: ['create_record', 'update_record', 'find_record'],
    documentationUrl: 'https://docs.operza.io/integrations/airtable'
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'marketing',
    authType: 'oauth2',
    icon: 'send',
    description: 'Add subscribers, manage marketing audiences, and tag email subscribers.',
    supportedTriggers: ['new_subscriber', 'unsubscriber'],
    supportedActions: ['add_or_update_subscriber', 'tag_subscriber', 'send_campaign'],
    documentationUrl: 'https://docs.operza.io/integrations/mailchimp'
  },
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'productivity',
    authType: 'oauth2',
    icon: 'calendar',
    description: 'Ingest scheduled appointments, meeting cancellations, and reschedule events.',
    supportedTriggers: ['invitee_created', 'invitee_canceled'],
    supportedActions: ['generate_scheduling_link'],
    documentationUrl: 'https://docs.operza.io/integrations/calendly'
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    authType: 'oauth2',
    icon: 'book',
    description: 'Create database items, query Notion pages, and append content blocks.',
    supportedTriggers: ['database_item_created', 'page_updated'],
    supportedActions: ['create_database_item', 'update_page_properties', 'append_block'],
    documentationUrl: 'https://docs.operza.io/integrations/notion'
  },
  {
    id: 'typeform',
    name: 'Typeform',
    category: 'marketing',
    authType: 'webhook',
    icon: 'clipboard',
    description: 'Capture responses from interactive conversational forms and lead quizzes.',
    supportedTriggers: ['form_submitted'],
    supportedActions: ['retrieve_responses'],
    documentationUrl: 'https://docs.operza.io/integrations/typeform'
  },
  {
    id: 'webflow',
    name: 'Webflow',
    category: 'marketing',
    authType: 'oauth2',
    icon: 'globe',
    description: 'Trigger automations on Webflow site submissions and update CMS items.',
    supportedTriggers: ['form_submission', 'site_published'],
    supportedActions: ['create_cms_item', 'publish_cms_item'],
    documentationUrl: 'https://docs.operza.io/integrations/webflow'
  },
  {
    id: 'quickbooks',
    name: 'Intuit QuickBooks',
    category: 'payments',
    authType: 'oauth2',
    icon: 'dollar-sign',
    description: 'Generate commercial invoices, record payments, and sync sales receipts.',
    supportedTriggers: ['invoice_paid', 'estimate_accepted'],
    supportedActions: ['create_customer', 'create_invoice', 'record_payment'],
    documentationUrl: 'https://docs.operza.io/integrations/quickbooks'
  },
  {
    id: 'xero',
    name: 'Xero Accounting',
    category: 'payments',
    authType: 'oauth2',
    icon: 'activity',
    description: 'Manage accounts receivable, issue invoices, and sync bank transactions.',
    supportedTriggers: ['invoice_paid', 'bank_transaction_created'],
    supportedActions: ['create_contact', 'create_invoice', 'send_invoice_email'],
    documentationUrl: 'https://docs.operza.io/integrations/xero'
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'productivity',
    authType: 'api_key',
    icon: 'check-square',
    description: 'Create tasks, assign project team members, and track status transitions.',
    supportedTriggers: ['task_created', 'task_status_updated'],
    supportedActions: ['create_task', 'update_task_status', 'add_comment'],
    documentationUrl: 'https://docs.operza.io/integrations/clickup'
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'productivity',
    authType: 'oauth2',
    icon: 'trello',
    description: 'Organize team deliverables, create tasks, and update section columns.',
    supportedTriggers: ['task_added_to_project', 'task_completed'],
    supportedActions: ['create_task', 'complete_task', 'add_task_to_section'],
    documentationUrl: 'https://docs.operza.io/integrations/asana'
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'crm',
    authType: 'api_key',
    icon: 'headphones',
    description: 'Ingest support tickets, create customer profiles, and post internal notes.',
    supportedTriggers: ['ticket_created', 'ticket_solved'],
    supportedActions: ['create_ticket', 'update_ticket', 'add_private_comment'],
    documentationUrl: 'https://docs.operza.io/integrations/zendesk'
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'communication',
    authType: 'api_key',
    icon: 'message-circle',
    description: 'Sync live chat users, track visitor events, and send targeted messages.',
    supportedTriggers: ['conversation_started', 'lead_created'],
    supportedActions: ['create_or_update_user', 'send_message', 'tag_user'],
    documentationUrl: 'https://docs.operza.io/integrations/intercom'
  },
  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    category: 'marketing',
    authType: 'api_key',
    icon: 'target',
    description: 'Manage email marketing lists, trigger automated journeys, and add deals.',
    supportedTriggers: ['contact_added', 'deal_stage_changed'],
    supportedActions: ['create_contact', 'add_tag', 'add_to_automation'],
    documentationUrl: 'https://docs.operza.io/integrations/activecampaign'
  },
  {
    id: 'twilio',
    name: 'Twilio Telephony',
    category: 'communication',
    authType: 'api_key',
    icon: 'phone',
    description: 'Direct SMS delivery, phone calls, and WhatsApp business communications.',
    supportedTriggers: ['incoming_sms', 'incoming_call'],
    supportedActions: ['send_sms', 'send_whatsapp_message', 'initiate_call'],
    documentationUrl: 'https://docs.operza.io/integrations/twilio'
  },
  {
    id: 'zoom',
    name: 'Zoom Video',
    category: 'communication',
    authType: 'oauth2',
    icon: 'video',
    description: 'Generate meeting links, register webinar attendees, and log call recordings.',
    supportedTriggers: ['meeting_ended', 'recording_completed'],
    supportedActions: ['create_meeting', 'register_webinar_attendee'],
    documentationUrl: 'https://docs.operza.io/integrations/zoom'
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'communication',
    authType: 'webhook',
    icon: 'hash',
    description: 'Post rich embed alerts and notifications directly into Discord server channels.',
    supportedTriggers: ['message_created'],
    supportedActions: ['post_webhook_message', 'send_direct_message'],
    documentationUrl: 'https://docs.operza.io/integrations/discord'
  }
]);

/**
 * Resolves a connector definition by its unique identifier.
 * @param {string} connectorId
 * @returns {object|null}
 */
export function getConnector(connectorId) {
  if (typeof connectorId !== 'string') return null;
  return CONNECTOR_CATALOG.find(c => c.id === connectorId.trim().toLowerCase()) || null;
}

/**
 * Lists all connectors filtered optionally by category.
 * @param {string} [category]
 * @returns {readonly object[]}
 */
export function listConnectors(category) {
  if (!category) return CONNECTOR_CATALOG;
  const cat = category.trim().toLowerCase();
  return CONNECTOR_CATALOG.filter(c => c.category === cat);
}
