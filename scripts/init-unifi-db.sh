#!/bin/bash
set -euo pipefail

# UniFi MongoDB Database Initialization Script
# This script creates the UniFi database and user in MongoDB

echo "🚀 Starting UniFi database initialization..."

# MongoDB connection parameters (from secrets via envFrom)
MONGO_HOST="${MONGO_HOST:-mongodb.mongodb}"
MONGO_PORT="${MONGO_PORT:-27017}"
MONGO_ADMIN_USER="${MONGODB_ROOT_USERNAME:-admin}"
MONGO_ADMIN_PASS="${MONGODB_ROOT_PASSWORD:-changeme}"
UNIFI_DB_NAME="${MONGO_DBNAME:-unifi}"
UNIFI_DB_USER="${MONGO_USER:-unifi}"
UNIFI_DB_PASS="${MONGO_PASS:-changeme}"

# Test MongoDB connectivity
echo "🔍 Testing MongoDB connectivity..."
until mongosh --host "$MONGO_HOST" --port "$MONGO_PORT" --eval "db.runCommand('ping')" > /dev/null 2>&1; do
  echo "⏳ Waiting for MongoDB to be ready..."
  sleep 5
done
echo "✅ MongoDB is ready"

# Create temporary JavaScript file for database operations
cat > /tmp/init-unifi.js << EOF
// UniFi Database Initialization Script
print('🔐 Authenticating with MongoDB admin...');
db = db.getSiblingDB('admin');
db.auth('$MONGO_ADMIN_USER', '$MONGO_ADMIN_PASS');

print('📂 Switching to UniFi database...');
db = db.getSiblingDB('$UNIFI_DB_NAME');

print('👤 Creating/updating UniFi database user...');
try {
  // Try to drop existing user first
  try {
    db.dropUser('$UNIFI_DB_USER');
    print('🗑️  Dropped existing UniFi user');
  } catch (e) {
    print('ℹ️  No existing user to drop');
  }
  
  // Create new user
  db.createUser({
    user: '$UNIFI_DB_USER',
    pwd: '$UNIFI_DB_PASS',
    roles: [
      { role: 'readWrite', db: '$UNIFI_DB_NAME' },
      { role: 'dbAdmin', db: '$UNIFI_DB_NAME' }
    ]
  });
  print('✅ UniFi user created successfully');
} catch (e) {
  print('❌ Error creating UniFi user: ' + e.message);
  throw e;
}

print('📚 Creating essential collections...');
const collections = ['site', 'admin', 'device', 'event', 'setting', 'stat', 'user'];
collections.forEach(function(collName) {
  try {
    db.createCollection(collName);
    print('✅ Collection ' + collName + ' created');
  } catch (e) {
    print('ℹ️  Collection ' + collName + ' already exists or creation not needed');
  }
});

print('🎉 UniFi database initialization completed successfully!');
EOF

# Execute the MongoDB initialization script
echo "📝 Executing UniFi database setup..."
mongosh --host "$MONGO_HOST" --port "$MONGO_PORT" --file /tmp/init-unifi.js

# Cleanup
rm -f /tmp/init-unifi.js

echo "🎉 UniFi database initialization completed!"