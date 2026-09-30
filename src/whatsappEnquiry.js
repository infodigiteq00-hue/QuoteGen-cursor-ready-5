/** Opens the user's own WhatsApp chats so they can copy a client enquiry. */
export function whatsappChatsLink() {
  if (typeof navigator === 'undefined') {
    return { href: 'https://web.whatsapp.com/', external: true }
  }
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) {
    return {
      href: 'intent://#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=https%3A%2F%2Fweb.whatsapp.com%2F;end',
      external: false
    }
  }
  const ios = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) return { href: 'whatsapp://', external: false }
  return { href: 'https://web.whatsapp.com/', external: true }
}
