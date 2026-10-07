/** Firm WhatsApp that receives a new trial after email verification. */
export const TRIAL_WHATSAPP_E164 = '918140960601'
export const TRIAL_START_TEXT = 'Hi, I want to start my free quotation trial'

export function trialWhatsappHref() {
  return `https://wa.me/${TRIAL_WHATSAPP_E164}?text=${encodeURIComponent(TRIAL_START_TEXT)}`
}
