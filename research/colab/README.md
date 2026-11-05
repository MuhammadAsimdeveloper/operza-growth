# Operza Research & Evaluation Notebooks (Google Colab)

This directory contains research, benchmark, and evaluation notebooks powered by the **Google Colab CLI** (`google-colab-cli`).

## Available Notebooks

1. **`operza_benchmark_analysis.ipynb`**
   - Ingests k6 load test results and API telemetry.
   - Plots latency distributions (p50, p90, p95, p99), throughput curves, and error rate cliffs.
   - Identifies database connection pool and queue bottlenecks.

2. **`operza_ai_evaluation.ipynb`**
   - Synthesizes agency operational prompts and multi-turn conversations.
   - Evaluates Copilot tool calling accuracy, parameter validation, and hallucination rates.
   - Compares Gemini 1.5/2.0 Flash vs Pro response quality and cost efficiency.

3. **`operza_search_performance.ipynb`**
   - Analyzes Lighthouse, Core Web Vitals, and PageSpeed Insights reports.
   - Audits crawlability, Open Graph schema validity, and mobile performance scores.
   - Outputs prioritized optimization recommendations.

4. **`operza_synthetic_data.ipynb`**
   - Generates realistic, non-identifying test datasets (contacts, pipelines, opportunities, appointments, workflows).
   - Exports clean JSON fixtures for automated load tests and staging seed data.

## Running Remotely via Colab CLI

The authenticated `colab` CLI tool can execute these notebooks directly on remote Google Colab GPU or CPU instances:

```bash
# Execute benchmark analysis on remote Colab instance
colab exec -s operza-research -f research/colab/operza_benchmark_analysis.ipynb

# Run one-shot ephemeral evaluation job
colab run research/colab/operza_ai_evaluation.ipynb
```
