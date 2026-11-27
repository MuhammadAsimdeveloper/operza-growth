# Known Limitations — Stage 17

1. **Invitation Email Delivery**: Live external email delivery is disabled locally (`delivery_status = 'pending_local'`); invitations are exercised via local/test adapter mode.
2. **MFA (TOTP/WebAuthn)**: Native TOTP/WebAuthn MFA is not implemented in the local authentication flow and is honestly disclosed in `/api/agency/v2/sessions`.
3. **Distributed Infrastructure & Staging**: AWS deployment, managed RDS, and Redis clusters are not provisioned locally.
