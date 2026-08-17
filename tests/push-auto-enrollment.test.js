const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

const requiredSnippets = [
  'installAutomaticPushEnrollment',
  "Notification.permission || 'default'",
  "!== 'granted'",
  'Session',
  'isAuthenticated',
  'registerCurrentDevicePushSubscription',
  "scheduleAttempt('startup'",
  "scheduleAttempt('session-change'"
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing automatic push enrollment contract: ${snippet}`);
  }
}

if (source.includes('Notification.requestPermission()')) {
  throw new Error('Automatic push enrollment must not trigger the first browser permission prompt without a user gesture.');
}

console.log('Automatic push enrollment contract PASS');
