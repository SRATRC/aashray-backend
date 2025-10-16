import dotenv from "dotenv";
import { sendWhatsAppMessage } from "./utils/sendWhatsAppMessage.js";

// Load environment variables
dotenv.config({ path: ".env.dev" });

// Test the WhatsApp integration
(async () => {
  console.log("🧪 Testing WhatsApp Integration...\n");
  
  // Replace with your actual test phone number (with country code)
  const testPhone = "918274856695"; // ← Change this to your number
  
  await sendWhatsAppMessage(
    testPhone,
    "room_allocation_2025",
    ["Test Name", "Room 101", "2025-01-20"]
  );
  
  console.log("\n✅ Test completed. Check the logs above for results.");
})();