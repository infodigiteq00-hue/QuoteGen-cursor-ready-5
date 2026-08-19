import 'dotenv/config'
import { getSupabase } from './server/db.js'
const supabase = getSupabase()
const { data, error } = await supabase.auth.admin.generateLink({
  type: 'signup',
  email: 'quotegen.tenant.a.test@gmail.com',
  password: 'TestPass123!'
})
if (error) { console.log('error:', error); process.exit(1) }
console.log('email_otp:', data.properties?.email_otp)
console.log('user id:', data.user?.id)
