# Agency Onboarding

- `agencies.onboarding_state` (`052`) persists onboarding progress and dismissal state.
- `computeOnboardingProgress` derives genuine completion across `agency_profile`, `regional_defaults`, `primary_location`, `team_and_roles`, and `security_review` from real persisted records without depending on live external providers.
