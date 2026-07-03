/**
 * Fix PDF file URLs that have double timestamps
 * This script corrects the fileUrl for files that were uploaded before the fix
 * where the URL pattern was: /api/files/download/${Date.now()}-${Date.now()}-${originalname}
 */

const mongoose = require('mongoose');
require('dotenv').config();
const File = require('../models/File');

async function fixFileUrls() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find all files with fileUrl pattern containing double timestamps
    const allFiles = await File.find();
    console.log(`📊 Total files found: ${allFiles.length}`);

    let fixedCount = 0;

    for (const file of allFiles) {
      const fileUrl = file.fileUrl;
      
      // Check if the fileUrl has the pattern of double timestamp (multiple numbers in a row)
      // Pattern: /api/files/download/{timestamp}-{timestamp}-{originalname}
      const match = fileUrl.match(/\/api\/files\/download\/(\d+)-(\d+)-(.*)/);
      
      if (match) {
        const timestamp1 = match[1];
        const timestamp2 = match[2];
        const rest = match[3];
        
        // If timestamps are very close (within 1000ms) or identical, they're likely duplicates
        if (Math.abs(parseInt(timestamp1) - parseInt(timestamp2)) < 1000) {
          // Construct the correct URL with just one timestamp
          const correctUrl = `/api/files/download/${timestamp1}-${rest}`;
          
          console.log(`📝 Fixing file: ${file.title}`);
          console.log(`   Old URL: ${fileUrl}`);
          console.log(`   New URL: ${correctUrl}`);
          
          // Update the file in the database
          file.fileUrl = correctUrl;
          await file.save();
          fixedCount++;
        }
      }
    }

    console.log(`\n✅ Successfully fixed ${fixedCount} files with double timestamps`);
    console.log(`✅ Database migration completed successfully`);
    
  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  } finally {
    // Close the MongoDB connection
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the migration
fixFileUrls();
