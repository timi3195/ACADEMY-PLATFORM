require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Course = require("../models/course");
const File = require("../models/File");

const levelMap = {
  "100 Level": "ND1",
  "200 Level": "ND2",
  "300 Level": "HND1",
  "400 Level": "HND2"
};

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  const results = {};

  for (const [legacy, current] of Object.entries(levelMap)) {
    const [users, courses, files] = await Promise.all([
      User.updateMany({ yearOfStudy: legacy }, { $set: { yearOfStudy: current } }),
      Course.updateMany({ level: legacy }, { $set: { level: current } }),
      File.updateMany({ level: legacy }, { $set: { level: current } })
    ]);
    results[legacy] = {
      current,
      users: users.modifiedCount,
      courses: courses.modifiedCount,
      files: files.modifiedCount
    };
  }

  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
