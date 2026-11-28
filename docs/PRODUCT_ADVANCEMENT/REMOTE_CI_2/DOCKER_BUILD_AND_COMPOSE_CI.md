# Docker Build & Compose CI (Gate D)

- **Compose Validation:** Runs `docker compose config -q` and `docker compose -f docker-compose.staging.yml config -q` using non-secret dummy CI variables.
- **Image Builds (`push: false`):** Builds `apps/api/Dockerfile` (`operza/api:ci-${{ github.sha }}`, shared by API and worker) and `apps/web/Dockerfile` (`operza/web:ci-${{ github.sha }}`). Never pushes to any registry.
