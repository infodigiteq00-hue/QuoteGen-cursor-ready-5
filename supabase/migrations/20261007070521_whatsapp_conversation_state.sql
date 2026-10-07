-- WhatsApp conversation state for the n8n/WAHA pass-through.
-- Service role only. The webhook looks up a phone and stores the open enquiry.

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  phone_digits text PRIMARY KEY,
  phase text NOT NULL DEFAULT 'idle',
  pieces jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_open boolean NOT NULL DEFAULT false,
  last_question_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_sessions_phone_chk CHECK (phone_digits ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT whatsapp_sessions_phase_chk CHECK (phase IN ('idle', 'collecting', 'awaiting_confirm'))
);

CREATE TABLE IF NOT EXISTS public.whatsapp_inbound (
  message_id text PRIMARY KEY,
  phone_digits text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_inbound_phone_chk CHECK (phone_digits ~ '^[6-9][0-9]{9}$')
);

CREATE INDEX IF NOT EXISTS whatsapp_inbound_phone_created_idx
  ON public.whatsapp_inbound (phone_digits, created_at DESC);

COMMENT ON TABLE public.whatsapp_sessions IS
  'Open WhatsApp enquiry per mobile. Cleared after a quotation is created.';
COMMENT ON TABLE public.whatsapp_inbound IS
  'Idempotency receipts for WhatsApp message ids, plus a short rate-limit window.';

ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_inbound FROM anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_sessions TO service_role;
GRANT ALL ON TABLE public.whatsapp_inbound TO service_role;

NOTIFY pgrst, 'reload schema';
