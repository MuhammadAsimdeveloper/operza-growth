# Artifacts & Verification Reports (Gates C & H)

- **Gate C Artifact:** Uploads `tfsec-sarif-report` (`tfsec-results.sarif`) with `if: always()`.
- **Gate H Summary:** Writes `$GITHUB_STEP_SUMMARY` reporting commit SHA and exact pass/fail status of Gates B, C, D, E/F, and G, explicitly noting zero AWS provisioning or deployment occurred.
