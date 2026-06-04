#!/bin/bash

# Ensure DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set."
    exit 1
fi

echo "Waiting for database to be ready..."

# Wait loop for database connectivity
# Handles local, Supabase (historical), and Aurora RDS.
# We strip SQLAlchemy driver prefixes (like +psycopg2) for the psycopg2 check.
python -c "
import time
import psycopg2
import os
import sys
import json

db_url = os.environ.get('DATABASE_URL')
if not db_url and os.environ.get('DB_SECRET_JSON'):
    try:
        secret = json.loads(os.environ.get('DB_SECRET_JSON'))
        db_url = f\"postgresql://{secret['username']}:{secret['password']}@{secret['host']}:{secret['port']}/{secret.get('dbname', 'postgres')}\"
    except Exception as e:
        print('Error parsing DB_SECRET_JSON in entrypoint:', e)

if db_url and '://' in db_url:
    protocol, rest = db_url.split('://', 1)
    if '+' in protocol:
        protocol = protocol.split('+')[0]
    db_url = f'{protocol}://{rest}'

attempts = 0
max_attempts = 30
while attempts < max_attempts:
    try:
        conn = psycopg2.connect(db_url, connect_timeout=5)
        conn.close()
        print('Database is ready!')
        sys.exit(0)
    except Exception as e:
        attempts += 1
        # Only print the error every few attempts to keep logs clean
        if attempts % 5 == 1:
            print(f'Waiting for database... ({attempts}/{max_attempts})')
        time.sleep(2)
sys.exit(1)
"

if [ $? -ne 0 ]; then
    echo "ERROR: Database did not become ready in time."
    exit 1
fi

# Run Alembic migrations
echo "Running database migrations..."
alembic upgrade head

echo "Database setup complete!"

# Start the application
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"