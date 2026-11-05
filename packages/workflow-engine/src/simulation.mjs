function matchesRule(rule, contact) {
  if (!rule || typeof rule !== 'object') return false;
  const expected = String(rule.value ?? '').trim().toLowerCase();
  if (!expected) return false;

  if (rule.field === 'tag') {
    const tags = Array.isArray(contact?.tags) ? contact.tags.map((tag) => String(tag).toLowerCase()) : [];
    if (rule.operator === 'is') return tags.includes(expected);
    if (rule.operator === 'is_not') return !tags.includes(expected);
    if (rule.operator === 'contains') return tags.some((tag) => tag.includes(expected));
    return false;
  }

  const actualValue = rule.field === 'status'
    ? contact?.status
    : rule.field === 'company'
      ? contact?.company
      : rule.field === 'email'
        ? contact?.email
        : undefined;
  const actual = String(actualValue ?? '').toLowerCase();

  if (rule.operator === 'is') return actual === expected;
  if (rule.operator === 'is_not') return actual !== expected;
  if (rule.operator === 'contains') return actual.includes(expected);
  return false;
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Evaluate a workflow locally without performing writes or external side effects.
 * Every executed step is explicitly marked as simulated; invalid configuration
 * fails the preview and downstream steps are marked skipped.
 */
export function simulateWorkflowActions(actions = [], contact = {}) {
  const steps = [];
  let failed = false;

  const visit = (list) => {
    for (const step of Array.isArray(list) ? list : []) {
      if (failed) {
        steps.push({
          id: step.id,
          label: step.label,
          kind: step.kind,
          status: 'skipped',
          detail: 'Skipped because an earlier simulation step failed.'
        });
        continue;
      }

      if (step.kind === 'condition') {
        const rule = step.config?.rule;
        const passed = matchesRule(rule, contact);
        steps.push({
          id: step.id,
          label: step.label,
          kind: step.kind,
          status: 'simulated',
          detail: passed ? 'Condition matched; would follow the Yes branch.' : 'Condition did not match; would follow the No branch.'
        });
        visit((passed ? step.yes : step.no) ?? []);
        continue;
      }

      if (step.kind === 'webhook') {
        const url = String(step.config?.url ?? '').trim();
        if (!validHttpUrl(url)) {
          steps.push({
            id: step.id,
            label: step.label,
            kind: step.kind,
            status: 'failed',
            detail: 'Invalid or missing HTTP(S) URL. No request was sent.'
          });
          failed = true;
          continue;
        }
        steps.push({
          id: step.id,
          label: step.label,
          kind: step.kind,
          status: 'simulated',
          detail: 'Webhook request previewed; no request was sent.'
        });
        continue;
      }

      if (step.kind === 'wait') {
        const hours = Number(step.delayHours) || 0;
        const delay = hours > 0 ? (hours % 24 === 0 ? `${hours / 24} day(s)` : `${hours} hour(s)`) : 'configured wait';
        steps.push({ id: step.id, label: step.label, kind: step.kind, status: 'simulated', detail: `Would wait ${delay}; simulation does not pause.` });
        continue;
      }

      if (step.kind === 'tag') {
        steps.push({
          id: step.id,
          label: step.label,
          kind: step.kind,
          status: 'simulated',
          detail: `Would apply tag "${step.config?.tag ?? 'untitled'}"; contact was not changed.`
        });
        continue;
      }

      if (step.kind === 'task') {
        const due = Number(step.config?.dueInDays) || 0;
        steps.push({
          id: step.id,
          label: step.label,
          kind: step.kind,
          status: 'simulated',
          detail: `Would create a follow-up task due in ${due} day(s); no task was created.`
        });
        continue;
      }

      if (step.kind === 'sms' || step.kind === 'email') {
        steps.push({
          id: step.id,
          label: step.label,
          kind: step.kind,
          status: 'simulated',
          detail: `${step.kind === 'sms' ? 'SMS' : 'Email'} preview only; no message sent.`
        });
        continue;
      }

      steps.push({
        id: step.id,
        label: step.label,
        kind: step.kind,
        status: 'simulated',
        detail: `Would execute ${step.kind}; no changes were made.`
      });
    }
  };

  visit(actions);
  return { status: failed ? 'failed' : 'simulated', steps };
}
