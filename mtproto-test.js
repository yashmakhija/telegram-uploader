// Simple test script for MTProto
import MTProtoModule from "@mtproto/core/envs/node/index.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Extract credentials from env
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const PHONE = process.env.TELEGRAM_PHONE_NUMBER;

// Ensure the secure-sessions directory exists
const sessionDir = path.resolve(__dirname, "secure-sessions");
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

// Print credentials (with partial hiding)
console.log("Testing with credentials:");
console.log(`API_ID: ${API_ID}`);
console.log(
  `API_HASH: ${
    API_HASH
      ? API_HASH.substring(0, 4) +
        "..." +
        API_HASH.substring(API_HASH.length - 4)
      : "missing"
  }`
);
console.log(
  `PHONE: ${
    PHONE
      ? PHONE.substring(0, 4) + "****" + PHONE.substring(PHONE.length - 2)
      : "missing"
  }`
);

// Create MTProto instance with Data Center 5 (based on PHONE_MIGRATE_5 error)
console.log("Creating MTProto instance with Data Center 5...");
const mtproto = new MTProtoModule({
  api_id: API_ID,
  api_hash: API_HASH,
  storageOptions: {
    path: path.join(sessionDir, `${PHONE.replace(/[^0-9]/g, "")}.json`),
  },
  // Use DC5 based on the error PHONE_MIGRATE_5
  customDc: 5,
});

// Test connection
console.log("Testing connection to Telegram...");

async function testConnection() {
  try {
    // First test - get config
    const config = await mtproto.call(
      "help.getConfig",
      {},
      {
        dcId: 5, // Connect to DC5 explicitly
      }
    );
    console.log("✓ Connection successful!");
    console.log(`✓ Connected to ${config.dc_options.length} data centers`);

    // Second test - try sending code
    try {
      console.log("Attempting to send auth code...");
      // Phone number format test - remove + if present
      const formattedPhone = PHONE.replace(/^\+/, "");

      const result = await mtproto.call(
        "auth.sendCode",
        {
          phone_number: formattedPhone,
          api_id: API_ID,
          api_hash: API_HASH,
          settings: {
            _: "codeSettings",
          },
        },
        {
          dcId: 5, // Connect to DC5 explicitly
        }
      );

      console.log("✓ Auth code sent successfully!");
      console.log(`✓ Phone code hash: ${result.phone_code_hash}`);
      console.log("\nNow you can use this phone code hash to sign in.");

      return result.phone_code_hash;
    } catch (sendError) {
      console.error("✗ Failed to send auth code:");
      console.error(sendError);

      // Try alternative format
      console.log("\nTrying alternative format...");
      try {
        const result = await mtproto.call(
          "auth.sendCode",
          {
            phone_number: formattedPhone,
            api_id: API_ID,
            api_hash: API_HASH,
          },
          {
            dcId: 5, // Connect to DC5 explicitly
          }
        );

        console.log("✓ Auth code sent successfully with alternative format!");
        console.log(`✓ Phone code hash: ${result.phone_code_hash}`);
        return result.phone_code_hash;
      } catch (altError) {
        console.error("✗ Alternative format also failed:");
        console.error(altError);
        return null;
      }
    }
  } catch (error) {
    console.error("✗ Connection failed:");
    console.error(error);
    return null;
  }
}

// Run the test
testConnection()
  .then((phoneCodeHash) => {
    console.log("Test completed.");
    if (phoneCodeHash) {
      console.log("\n=== NEXT STEPS ===");
      console.log("1. Copy the phone_code_hash you received");
      console.log("2. Update your MTProto service to use DC5:");
      console.log("   - Add customDc: 5 to the MTProto constructor");
      console.log("   - Add dcId: 5 to all API calls");
      console.log("3. Restart your server and try the authentication again");
    }
  })
  .catch((err) => console.error("Unexpected error:", err));
