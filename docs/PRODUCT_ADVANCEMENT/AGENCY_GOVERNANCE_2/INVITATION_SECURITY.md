# Invitation Security

- `generateInvitationToken` creates a 32-byte `base64url` token; only SHA-256 `token_hash` is persisted in `agency_invitations`.
- `verifyInvitationRecord` & `acceptInvitation` enforce single-use (`accepted_at` / `INVITATION_ALREADY_ACCEPTED`), expiry (`INVITATION_EXPIRED`), revocation (`INVITATION_REVOKED`), agency binding (`INVITATION_AGENCY_MISMATCH`), and email identity binding (`INVITATION_EMAIL_MISMATCH`).
- Local/test runs record `delivery_status = 'pending_local'` without sending external emails.
