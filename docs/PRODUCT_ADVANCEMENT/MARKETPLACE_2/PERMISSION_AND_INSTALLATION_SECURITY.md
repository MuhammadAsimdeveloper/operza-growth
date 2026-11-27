# Permission & Installation Security

## 1. Scope Governance & Upgrade Consent
- Installing an app requires `status IN ('approved', 'published')` and `grantedScopes ⊆ app.requested_scopes`.
- Upgrading an installation (`upgradeInstallation`) compares `installed.granted_scopes` against `release.requested_scopes` via `checkUpgradeScopeEscalation`; if any new scope is requested, the upgrade fails with `409 PERMISSION_UPGRADE_CONSENT_REQUIRED` until explicit `consentUpgraded: true` is provided.
- Uninstallation clears `connection_id` and transitions status to `uninstalled`, revoking credential access.
