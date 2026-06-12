const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    const courses = await request({ hostname: 'localhost', port: 5000, path: '/api/courses', method: 'GET' });
    const parsed = JSON.parse(courses.body);
    if (!parsed.success || !parsed.courses || parsed.courses.length === 0) {
      console.error('No courses found to attach note to.');
      return;
    }
    const courseId = parsed.courses[0]._id;
    const note = { title: 'Lecture 1 Notes', content: 'Intro to programming basics', course: courseId };
    const data = JSON.stringify(note);
    const res = await request({ hostname: 'localhost', port: 5000, path: '/api/notes', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, data);
    console.log('STATUS', res.status);
    console.log('BODY', res.body);
  } catch (e) {
    console.error('ERROR', e.message || e);
  }
})();
