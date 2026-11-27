# Known Limitations — Stage 15

1. **External Channel Providers**: Live SMS (Twilio), Email (Resend/SendGrid), WhatsApp (Meta Cloud API), and Voice delivery are not activated in local testing (`OPERZA_LIVE_MESSAGING` disabled); `webchat` is the only natively `connected` local channel adapter.
2. **Live AI Drafting**: Without `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` configured in the environment, `ai-suggest` honestly reports `aiAvailable: false` and leaves manual composition + Saved Replies active.
3. **Distributed Worker / Staging**: Multi-worker Redis/BullMQ queues and AWS staging deployment are not provisioned locally.
