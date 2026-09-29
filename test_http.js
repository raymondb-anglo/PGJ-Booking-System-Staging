import http from 'http';

http.get('http://localhost:3001/admin/reports/advanced-export?dateId=&teacherCode=64T00025&pcClass=S4+Mentorship+-+Mr+Arnel&teacherEmail=&studentEmail=&search=', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 302) {
      console.log('Got 302 redirect to:', res.headers.location);
    } else {
      console.log('Got response length:', data.length);
      console.log('Response excerpt:', data.substring(0, 500));
    }
  });
}).on('error', err => console.error(err));
