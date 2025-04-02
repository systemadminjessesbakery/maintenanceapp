/**
 * Jesse's Bakery Maintenance App - Ultra Simple Server
 */

// Minimal server
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Jesse\'s Bakery Maintenance App</h1><p>Application is running!</p>');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 