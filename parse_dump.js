const fs = require('fs');
const xml = fs.readFileSync('rename_active_dump.xml', 'utf8');
const regex = /<node[^>]+bounds="([^"]+)"[^>]*>/g;
const lines = xml.split('><');
for (const line of lines) {
  if (line.includes('Save') || line.includes('Cancel') || line.includes('EditText') || line.includes('Conversation') || line.includes('Rename')) {
    console.log(line);
  }
}
