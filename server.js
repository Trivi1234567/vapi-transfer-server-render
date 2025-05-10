// Import necessary modules
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Temporary in-memory store for pending transfers
// Key: actualUserPhoneNumber (if available) or actualVapiCallId
// Value: { departmentName, vapiCallId: actualVapiCallId, userPhoneNumber: actualUserPhoneNumber, timestamp, status }
const pendingTransfers = {};

// Initialize the Express application
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Define a simple port, defaulting to 3000 if not set in .env
const PORT = process.env.PORT || 3000;

// --- Define a basic health check route ---
app.get('/health', (req, res) => {
  console.log('Health check endpoint was hit!');
  res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// --- VAPI Endpoint to prepare for a sequential transfer ---
app.post('/api/vapi/prepare-sequential-transfer', (req, res) => {
  console.log('Received request on /api/vapi/prepare-sequential-transfer');
  console.log('Request Body from VAPI:', JSON.stringify(req.body, null, 2));

  let departmentNameFromLlmArgs;
  let vapiCallIdFromLlmArgs;
  let userPhoneNumberFromLlmArgs;
  let toolCallIdForResponse; // The ID VAPI sends for this specific tool invocation

  // Extract toolCallId for the response (VAPI expects this back)
  if (req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0) {
    toolCallIdForResponse = req.body.message.toolCallList[0].id;
  } else if (req.body.toolCall && req.body.toolCall.toolCallId) { // Fallback for older/alternative structure
    toolCallIdForResponse = req.body.toolCall.toolCallId;
  }
  console.log(`Extracted toolCallIdForResponse: ${toolCallIdForResponse}`);

  // Extract parameters passed by the LLM within the tool arguments
  if (req.body.message && req.body.message.toolCallList && req.body.message.toolCallList.length > 0 && req.body.message.toolCallList[0].arguments) {
    const toolArguments = req.body.message.toolCallList[0].arguments;
    departmentNameFromLlmArgs = toolArguments.departmentName;
    vapiCallIdFromLlmArgs = toolArguments.vapiCallId;
    userPhoneNumberFromLlmArgs = toolArguments.userPhoneNumber;
    console.log(`LLM Tool Arguments: departmentName='${departmentNameFromLlmArgs}', vapiCallIdFromLlmArgs='${vapiCallIdFromLlmArgs}', userPhoneNumberFromLlmArgs='${userPhoneNumberFromLlmArgs}'`);
  } else {
    console.warn('Could not find tool arguments in req.body.message.toolCallList[0].arguments. Department name will likely be missing.');
  }

  // --- Determine actual identifiers ---
  let actualVapiCallId;
  let actualUserPhoneNumber;

  // Prioritize identifiers from the main 'call' object in the VAPI payload
  if (req.body.call && req.body.call.id) {
    actualVapiCallId = req.body.call.id;
    console.log(`Using vapiCallId from req.body.call.id: ${actualVapiCallId}`);
  } else if (vapiCallIdFromLlmArgs && vapiCallIdFromLlmArgs.toLowerCase() !== "call.id" && vapiCallIdFromLlmArgs.toLowerCase() !== "[call.id]") {
    actualVapiCallId = vapiCallIdFromLlmArgs; // Use LLM arg if it's not a placeholder and primary source is missing
    console.log(`Warning: req.body.call.id missing. Using vapiCallId from LLM arguments: ${actualVapiCallId}`);
  } else {
    console.error("CRITICAL: vapiCallId could not be determined from req.body.call.id or valid LLM argument.");
    return res.status(400).json({
      toolCallId: toolCallIdForResponse,
      result: "Error: Critical identifier 'vapiCallId' could not be determined."
    });
  }

  if (req.body.call && req.body.call.customer && req.body.call.customer.number) {
    actualUserPhoneNumber = req.body.call.customer.number;
    console.log(`Using userPhoneNumber from req.body.call.customer.number: ${actualUserPhoneNumber}`);
  } else if (userPhoneNumberFromLlmArgs && userPhoneNumberFromLlmArgs.toLowerCase() !== "call.customer.number" && userPhoneNumberFromLlmArgs.toLowerCase() !== "[call.customer.number]") {
    actualUserPhoneNumber = userPhoneNumberFromLlmArgs; // Use LLM arg if not placeholder and primary source is missing
    console.log(`Warning: req.body.call.customer.number missing. Using userPhoneNumber from LLM arguments: ${actualUserPhoneNumber}`);
  } else {
    console.log("User phone number not available from req.body.call.customer.number or valid LLM argument. Will proceed if vapiCallId is present.");
    actualUserPhoneNumber = null; // Explicitly null if not found or is placeholder
  }
  
  // Use the departmentName provided by the LLM
  const finalDepartmentName = departmentNameFromLlmArgs;

  // Validate departmentName (must be provided by LLM)
  if (!finalDepartmentName) {
    console.error('CRITICAL: departmentName is missing in the request from VAPI tool arguments.');
    return res.status(400).json({
      toolCallId: toolCallIdForResponse,
      result: `Error: Missing required 'departmentName' parameter from VAPI. Cannot proceed.`
    });
  }

  // Determine storage key
  const storageKey = actualUserPhoneNumber || actualVapiCallId; // actualVapiCallId should always be valid here

  // Store the information
  pendingTransfers[storageKey] = {
    departmentName: finalDepartmentName,
    vapiCallId: actualVapiCallId,
    userPhoneNumber: actualUserPhoneNumber || 'N/A', // Store 'N/A' if null
    timestamp: new Date().toISOString(),
    status: 'pending_vapi_transfer_to_twilio'
  };

  console.log(`Prepared for sequential transfer for storageKey '${storageKey}' to department: ${finalDepartmentName}`);
  console.log('Current pendingTransfers:', JSON.stringify(pendingTransfers, null, 2));

  // Send success response back to VAPI
  res.status(200).json({
    toolCallId: toolCallIdForResponse,
    result: `Successfully prepared for transfer to ${finalDepartmentName}. Ready for call.`
  });
});


// --- Start the server ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server.');
  if (process.env.YOUR_RENDER_APP_BASE_URL && process.env.YOUR_RENDER_APP_BASE_URL !== `http://localhost:${PORT}`) {
    console.log(`Once deployed, it should be accessible at ${process.env.YOUR_RENDER_APP_BASE_URL}`);
  }
});

// Export the app (optional, but can be useful for testing frameworks later)
module.exports = app;
