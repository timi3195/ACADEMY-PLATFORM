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
    console.log('\n=== Testing All Endpoints ===\n');

    // Test 1: GET /
    console.log('1. GET /');
    let res = await request({ hostname: 'localhost', port: 5000, path: '/', method: 'GET' });
    console.log(`   STATUS: ${res.status}`);
    console.log(`   BODY: ${res.body}\n`);

    // Test 2: POST /api/auth/login
    console.log('2. POST /api/auth/login');
    const loginData = JSON.stringify({ email: 'test@example.com', name: 'Test User' });
    res = await request({ hostname: 'localhost', port: 5000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) } }, loginData);
    console.log(`   STATUS: ${res.status}`);
    const loginBody = JSON.parse(res.body);
    console.log(`   SUCCESS: ${loginBody.success}`);
    console.log(`   USER EMAIL: ${loginBody.user?.email}\n`);

    // Test 3: GET /api/courses
    console.log('3. GET /api/courses');
    res = await request({ hostname: 'localhost', port: 5000, path: '/api/courses', method: 'GET' });
    console.log(`   STATUS: ${res.status}`);
    const coursesBody = JSON.parse(res.body);
    console.log(`   COURSES COUNT: ${coursesBody.courses?.length || 0}\n`);

    // Test 4: GET /api/notes
    console.log('4. GET /api/notes');
    res = await request({ hostname: 'localhost', port: 5000, path: '/api/notes', method: 'GET' });
    console.log(`   STATUS: ${res.status}`);
    const notesBody = JSON.parse(res.body);
    console.log(`   NOTES COUNT: ${notesBody.notes?.length || 0}\n`);

    // Test 5: POST /api/ai/generate-questions
    console.log('5. POST /api/ai/generate-questions');
    const aiData = JSON.stringify({ topic: 'Machine Learning' });
    res = await request({ hostname: 'localhost', port: 5000, path: '/api/ai/generate-questions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(aiData) } }, aiData);
    console.log(`   STATUS: ${res.status}`);
    const aiBody = JSON.parse(res.body);
    console.log(`   SUCCESS: ${aiBody.success}`);
    console.log(`   QUESTIONS COUNT: ${aiBody.questions?.length || 0}`);
    if (aiBody.questions && aiBody.questions.length > 0) {
      console.log(`   SAMPLE: ${aiBody.questions[0]}\n`);
    }

    console.log('=== All Tests Complete ===\n');
  } catch (e) {
    console.error('ERROR:', e.message || e);
  }
})();
