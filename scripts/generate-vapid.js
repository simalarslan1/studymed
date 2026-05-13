const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\n📋 Add these to .env.local:');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('');
