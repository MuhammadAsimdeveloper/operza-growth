import type { Contact, CustomValue } from './types';

export function customValueSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function customValueToken(name: string): string {
  return `{{custom_values.${customValueSlug(name) || 'value'}}}`;
}

/** Replaces merge tokens; unknown tokens are left untouched. */
export function resolveMerge(
  body: string,
  contact: Contact | undefined,
  customValues: CustomValue[],
): string {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, raw: string) => {
    const token = raw.trim();
    if (token.startsWith('custom_values.')) {
      const key = token.slice('custom_values.'.length);
      const value = customValues.find((v) => customValueSlug(v.name) === key);
      return value ? value.value : match;
    }
    if (!contact) return match;
    switch (token) {
      case 'contact.first_name':
        return contact.firstName;
      case 'contact.last_name':
        return contact.lastName;
      case 'contact.full_name':
        return `${contact.firstName} ${contact.lastName}`;
      case 'contact.company':
        return contact.company || match;
      case 'contact.email':
        return contact.email;
      case 'contact.phone':
        return contact.phone || match;
      default:
        return match;
    }
  });
}
