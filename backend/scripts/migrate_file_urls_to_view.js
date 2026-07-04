/**
 * Migration script: convert old fileUrl entries that point to /api/files/download/{filename}
 * into the new safe format /api/files/view/{fileId}, and populate storageFilename/originalName
 *
 * Usage:
 *  node scripts/migrate_file_urls_to_view.js        # dry-run (shows planned changes)
 *  node scripts/migrate_file_urls_to_view.js --apply # apply changes
 */

const mongoose = require('mongoose')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
const File = require('../models/File')

async function run() {
  const apply = process.argv.includes('--apply') || process.argv.includes('-a')
  console.log(`Migration started (apply=${apply})`)

  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to MongoDB')

  try {
    const files = await File.find({ fileUrl: /\/api\/files\/download\//i })
    console.log(`Found ${files.length} file(s) with old download URL format`)

    for (const f of files) {
      // Extract filename part from fileUrl
      const match = f.fileUrl.match(/\/api\/files\/download\/(.+)$/i)
      const filename = match ? match[1] : null

      let storageFilename = f.storageFilename || filename
      // Attempt to compute originalName: remove leading timestamp(s)
      let originalName = f.originalName || null
      if (!originalName && storageFilename) {
        // storageFilename may look like 1627382910-originalname.pdf or timestamp-timestamp-originalname.pdf
        const parts = storageFilename.split('-')
        if (parts.length > 1 && /^\d{10,}$/.test(parts[0])) {
          // remove the first part (timestamp)
          originalName = parts.slice(1).join('-')
        } else {
          originalName = storageFilename
        }
      }

      console.log(`- File ${f._id}: will set storageFilename='${storageFilename}', originalName='${originalName}', fileUrl='/api/files/view/${f._id}'`)

      if (apply) {
        f.storageFilename = storageFilename
        f.originalName = originalName
        f.fileUrl = `/api/files/view/${f._id}`
        await f.save()
        console.log(`  ✓ Applied`)
      }
    }

    if (!apply) console.log('\nDry-run complete. Re-run with --apply to persist changes.')
    else console.log('\nMigration applied successfully.')
  } catch (err) {
    console.error('Migration error', err)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

run()
