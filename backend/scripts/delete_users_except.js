const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const User = require('../models/User')

async function main() {
  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGO_URI)
  console.log('✅ Connected to MongoDB')

  // Backup current users
  const users = await User.find().lean()
  const backupDir = path.join(__dirname, 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = path.join(backupDir, `users_backup_${Date.now()}.json`)
  fs.writeFileSync(backupFile, JSON.stringify(users, null, 2))
  console.log('💾 Backup saved to:', backupFile)

  // Delete all users except testuser@gmail.com
  const preserveEmail = 'testuser@gmail.com'
  console.log(`🗑️  Deleting all users except: ${preserveEmail}`)
  const res = await User.deleteMany({ email: { $ne: preserveEmail } })
  console.log(`✅ Deleted ${res.deletedCount} user(s)`)

  const remaining = await User.find().lean()
  console.log('🔎 Remaining users:')
  remaining.forEach(u => console.log(` - ${u.email} (id: ${u._id})`))

  await mongoose.disconnect()
  console.log('✅ Disconnected from MongoDB')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
