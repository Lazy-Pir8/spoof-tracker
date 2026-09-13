#!/bin/bash

echo "1. Registering a test device..."
curl -X POST http://127.0.0.1:3000/api/device/register \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-123",
    "fcmToken": "dummy_token_abc123",
    "deviceName": "Test Pixel 8"
  }'

echo -e "\n\n2. Updating device location..."
curl -X POST http://127.0.0.1:3000/api/device/location \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-123",
    "latitude": 40.7128,
    "longitude": -74.0060
  }'

echo -e "\n\n3. Fetching all registered devices (Admin)..."
curl -X GET http://127.0.0.1:3000/api/admin/devices

echo -e "\n"

